import { agentRouterError } from './agentrouter-error';
import { spawn } from 'node:child_process';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { z } from 'zod/v4';
import type { Completion, ProviderConfig } from './provider';
import { AppError } from './errors';
import { startAgentRouterRelay } from './agentrouter-relay';

const resultSchema = z.object({
  type: z.literal('result'),
  is_error: z.boolean(),
  result: z.string().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  stats: z.object({ tools: z.object({ totalCalls: z.number() }).optional() }).optional(),
});

/** Only a broken client envelope is retryable; provider refusals remain actionable errors. */
export class ClientOutputError extends AppError {}

export async function retryClientOutput(
  run: () => Promise<string>,
  signal: AbortSignal,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await run();
      signal.throwIfAborted();
      return response;
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof ClientOutputError) || attempt >= 1) throw error;
    }
  }
}

export function clientResult(output: string): string {
  let messages: unknown;
  try {
    messages = JSON.parse(output);
  } catch {
    throw new ClientOutputError(
      502,
      'The AI client returned an unreadable response. Your previous draft is safe. Please retry.',
    );
  }
  if (!Array.isArray(messages))
    throw new ClientOutputError(502, 'The AI client returned an unexpected response. Please retry.');
  const parsed = resultSchema.safeParse(
    messages.filter((message) => message?.type === 'result').at(-1),
  );
  if (!parsed.success)
    throw new ClientOutputError(
      502,
      'The AI client ended before returning a complete response. Please retry.',
    );
  const result = parsed.data;
  if (result.stats?.tools?.totalCalls)
    throw new AppError(
      502,
      'The AI response requested an unsupported tool. No draft was saved. Please retry.',
    );
  if (result.is_error) throw agentRouterError(result.error?.message || '');
  if (!result.result?.trim())
    throw new AppError(502, 'AgentRouter returned an empty response. Please retry.');
  return result.result;
}

/** A CLI failure on stderr must not be mistaken for malformed model output. */
export function clientProcessResult(output: string, stderr: string, exitCode: number | null, exitSignal: string | null): string {
  if (exitCode === 55 || /FatalBudgetExceededError|wall.clock budget|wall.time exceeded/i.test(stderr))
    throw agentRouterError('FatalBudgetExceededError');
  if (exitCode !== 0 || exitSignal) {
    try { clientResult(output); } catch (error) {
      if (!(error instanceof ClientOutputError)) throw error;
    }
    throw new AppError(502, 'The AI client stopped before completing the request. Check the server connection and retry. Your saved work is unchanged.');
  }
  return clientResult(output);
}

/** Use AgentRouter's documented client, preserving its real authentication headers.
 * The child is restricted to one text response, with tools and customizations disabled.
 */
export function createAgentRouterCompletion(config: ProviderConfig): Completion {
  return async (system, prompt, signal, maxTokens = 7000) => {
    if (!config.apiKey || /your.*key|placeholder/i.test(config.apiKey))
      throw new AppError(
        503,
        'Configure COPY_STUDIO_API_KEY in .env.local, then restart the dashboard.',
      );
    signal.throwIfAborted();
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    const deadline = setTimeout(() => controller.abort(new DOMException('The AI request exceeded its time limit.', 'TimeoutError')), config.timeoutMs);
    const combinedSignal = controller.signal;
    let workspace: string | undefined;
    let closeRelay: (() => Promise<void>) | undefined;
    try {
      workspace = await mkdtemp(join(tmpdir(), 'copy-studio-ai-'));
      combinedSignal.throwIfAborted();
      const relay = await startAgentRouterRelay(config, combinedSignal, maxTokens);
      closeRelay = relay.close;
      const args = [
        '--expose-gc',
        createRequire(join(process.cwd(), 'package.json')).resolve('@qwen-code/qwen-code/cli.js'),
        '--bare',
        '--safe-mode',
        '--auth-type',
        config.apiFormat === 'responses' ? 'openai-responses' : 'openai',
        '--output-format',
        'json',
        '--chat-recording=false',
        '--telemetry=false',
        '--openai-logging=false',
        '--max-tool-calls',
        '0',
        '--max-session-turns',
        '1',
        '--max-wall-time',
        `${Math.ceil(config.timeoutMs / 1000)}s`,
        '--system-prompt',
        system,
      ];
      const attempt = retryClientOutput(() => new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, args, {
          cwd: workspace,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          signal: combinedSignal,
          env: {
            ...process.env,
            OPENAI_API_KEY: relay.localToken,
            OPENAI_BASE_URL: relay.baseUrl,
            OPENAI_MODEL: config.model,
            QWEN_CODE_API_TIMEOUT_MS: String(config.timeoutMs),
            QWEN_STREAM_MAX_LIFETIME_MS: String(config.timeoutMs),
          },
        });
        let output = '';
        let diagnosticStderr = '';
        let tooLarge = false;
        let launchFailed = false;
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          output += chunk;
          if (output.length > 2_000_000) {
            tooLarge = true;
            child.kill();
          }
        });
        // Drain diagnostics, but never expose the CLI's environment or provider internals.
        child.stderr.on('data', (chunk: Buffer) => {
          diagnosticStderr = (diagnosticStderr + chunk.toString('utf8')).slice(-16_000);
        });
        child.stdin.on('error', () => {
          /* The close event reports early process failures. */
        });
        child.on('error', () => {
          launchFailed = true;
        });
        child.on('close', (exitCode, exitSignal) => {
          if (combinedSignal.aborted) return reject(combinedSignal.reason);
          if (launchFailed)
            return reject(
              new AppError(
                502,
                'The AI client could not start. Run npm install and restart Copy Studio.',
              ),
            );
          if (tooLarge)
            return reject(
              new AppError(502, 'The AI response exceeded the size limit. No draft was saved.'),
            );
          try {
            resolve(clientProcessResult(output, diagnosticStderr, exitCode, exitSignal));
          } catch (error) {
            if (process.env.COPY_STUDIO_DIAGNOSTIC === '1') console.error('AgentRouter client diagnostic:', JSON.stringify({
              exitCode, exitSignal, outputLength: output.length, stderrLength: diagnosticStderr.length,
              message: error instanceof AppError ? error.message : 'Invalid client output',
            }));
            reject(error);
          }
        });
        // Source fields are JSON data. Escape @ to prevent the CLI's file-mention expansion.
        child.stdin.end(prompt.replaceAll('@', '\\u0040'));
      }), combinedSignal);
      return await Promise.race([attempt, relay.failure.then(error => { controller.abort(error); throw error; })]);
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener('abort', cancel);
      await closeRelay?.();
      // Remove only the empty directory we created. Never recursively delete unexpected files.
      if (workspace) await rmdir(workspace).catch(() => {});
    }
  };
}
