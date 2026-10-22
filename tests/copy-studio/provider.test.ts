import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompletion } from '../../src/lib/copy-studio/server/provider';
import { providerConfig } from '../../src/lib/copy-studio/server/config';
import { responseTokenLimit } from '../../src/lib/copy-studio/server/response-tokens';

const config = {
  apiKey: 'test-token-not-a-real-key',
  baseUrl: 'https://provider.invalid/v1',
  model: 'test-model',
  timeoutMs: 1000,
};

test('AgentRouter GPT imports retain output headroom when the gateway ignores reasoning=none', () => {
  const gateway = { ...config, baseUrl: 'https://agentrouter.org/v1', model: 'gpt-5.6-sol', reasoningEffort: 'none' as const };
  assert.equal(responseTokenLimit(gateway, 7000), 25000);
  assert.equal(responseTokenLimit(gateway, 512), 512, 'A minimal connection probe stays small');
  assert.equal(responseTokenLimit({ ...gateway, baseUrl: 'https://provider.invalid/v1' }, 7000), 7000);
});

test('Responses HTTP requests use the native request/response contract and reject unfinished output', async () => {
  const original = globalThis.fetch;
  let status = 'completed';
  let outputAllowance = 22000;
  let reasoningEffort = 'low';
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://provider.invalid/v1/responses');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_output_tokens, outputAllowance);
      assert.equal(body.max_tokens, undefined);
      assert.equal(body.temperature, undefined);
      assert.equal(body.instructions, 'System instructions');
      assert.equal(body.input[0].content, 'Source data');
      assert.equal(body.store, false);
      assert.equal(body.reasoning.effort, reasoningEffort);
      return Response.json({ status, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"verified":true}' }] }] });
    };
    const complete = createCompletion({ ...config, apiFormat: 'responses', reasoningEffort: 'low' });
    assert.equal(await complete('System instructions', 'Source data', new AbortController().signal, 4000), '{"verified":true}');
    status = 'incomplete';
    await assert.rejects(complete('System instructions', 'Source data', new AbortController().signal, 4000), /cut short/);
    status = 'failed';
    await assert.rejects(complete('System instructions', 'Source data', new AbortController().signal, 4000), /did not complete/);
    status = 'completed'; outputAllowance = 512;
    assert.equal(await complete('System instructions', 'Source data', new AbortController().signal, 512), '{"verified":true}');
    outputAllowance = 4000; reasoningEffort = 'none';
    const fast = createCompletion({ ...config, apiFormat: 'responses', reasoningEffort: 'none' });
    assert.equal(await fast('System instructions', 'Source data', new AbortController().signal, 4000), '{"verified":true}');
  } finally { globalThis.fetch = original; }
});

test('fresh AgentRouter configuration uses Responses while explicit legacy models preserve their protocol', () => {
  const keys = ['COPY_STUDIO_MODEL', 'AGENTROUTER_MODEL', 'COPY_STUDIO_BASE_URL', 'AGENTROUTER_BASE_URL', 'COPY_STUDIO_API_FORMAT', 'COPY_STUDIO_REASONING_EFFORT', 'COPY_STUDIO_EXTRACTION_REASONING_EFFORT'];
  const saved = keys.map(key => [key, process.env[key]] as const);
  try {
    keys.forEach(key => delete process.env[key]);
    assert.equal(providerConfig().model, 'gpt-5.6-sol');
    assert.equal(providerConfig().apiFormat, 'responses');
    assert.equal(providerConfig().reasoningEffort, 'low');
    process.env.COPY_STUDIO_EXTRACTION_REASONING_EFFORT = 'none';
    assert.equal(providerConfig('extraction').reasoningEffort, 'none');
    assert.equal(providerConfig().reasoningEffort, 'low', 'Fast extraction must not change the writing configuration');
    process.env.COPY_STUDIO_REASONING_EFFORT = 'none';
    assert.equal(providerConfig().reasoningEffort, 'none');
    process.env.COPY_STUDIO_MODEL = 'legacy-model';
    assert.equal(providerConfig().apiFormat, 'chat_completions');
    process.env.COPY_STUDIO_API_FORMAT = 'responses';
    process.env.COPY_STUDIO_REASONING_EFFORT = 'low';
    assert.equal(providerConfig().apiFormat, 'responses');
    assert.equal(providerConfig().reasoningEffort, 'low');
    process.env.COPY_STUDIO_API_FORMAT = 'guess';
    assert.throws(() => providerConfig(), /API_FORMAT/);
  } finally {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('Groq GPT-OSS requests leave room for JSON output with low reasoning effort while other models retain their provider defaults', async () => {
  const original = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(init!.body as string));
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    };
    await createCompletion({ ...config, baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' })('', '', new AbortController().signal, 4000);
    await createCompletion(config)('', '', new AbortController().signal);
    assert.equal(bodies[0].reasoning_effort, 'low');
    assert.equal(bodies[0].max_tokens, 4000);
    assert.equal(bodies[1].reasoning_effort, undefined);
  } finally { globalThis.fetch = original; }
});
test('a client authorization rejection is not mislabeled as an invalid key', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json(
        { type: 'unauthorized_client_error', error: { message: 'unauthorized client detected' } },
        { status: 401 },
      );
    await assert.rejects(
      createCompletion(config)('', '', new AbortController().signal),
      /rejected the client integration/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('model permission errors and unclassified forbidden responses do not claim the key is invalid', async () => {
  const original = globalThis.fetch;
  try {
    for (const failure of [
      { error: { code: 'model_access_denied', message: 'Private account details' } },
      { type: 'permission_error', message: 'You do not have access to this model' },
    ]) {
      globalThis.fetch = async () => Response.json(failure, { status: 403 });
      await assert.rejects(createCompletion(config)('', '', new AbortController().signal), error => {
        assert.match((error as Error).message, /denied access to the configured model/);
        assert.doesNotMatch((error as Error).message, /Private account details|rejected the API key/);
        return true;
      });
    }
    globalThis.fetch = async () => new Response('Access forbidden by gateway', { status: 403 });
    await assert.rejects(createCompletion(config)('', '', new AbortController().signal), /refused access.*does not establish/);
    globalThis.fetch = async () => Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    await assert.rejects(createCompletion(config)('', '', new AbortController().signal), /could not authenticate.*key and provider endpoint/);
  } finally { globalThis.fetch = original; }
});

test('explicit invalid credentials remain actionable without exposing the key or raw provider message', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: { code: 'invalid_api_key', message: `Rejected ${config.apiKey}` } }, { status: 401 });
    await assert.rejects(createCompletion(config)('', '', new AbortController().signal), error => {
      assert.match((error as Error).message, /reports an invalid or expired API key/);
      assert.doesNotMatch((error as Error).message, new RegExp(config.apiKey));
      return true;
    });
    globalThis.fetch = async () => Response.json({ error: { type: 'unauthorized_client_error' } }, { status: 401 });
    await assert.rejects(createCompletion(config)('', '', new AbortController().signal), /rejected the client integration/);
  } finally { globalThis.fetch = original; }
});

test('short Groq retry hints in the response body receive the same bounded, cancellable retry as Retry-After', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => ++calls === 1
      ? Response.json({ error: { message: 'Rate limit. Please try again in 0.001s.' } }, { status: 429 })
      : Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    assert.equal(await createCompletion(config)('', '', new AbortController().signal), '{"ok":true}');
    assert.equal(calls, 2);
    globalThis.fetch = async () => Response.json({ error: { message: 'Please try again in 30s.' } }, { status: 429 });
    await assert.rejects(createCompletion(config)('', '', AbortSignal.timeout(10)), /aborted|timeout/i);
  } finally { globalThis.fetch = original; }
});
test('provider identifies the application and rejects truncated drafts', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://provider.invalid/v1/chat/completions');
      assert.equal((init?.headers as Record<string, string>)['User-Agent'], 'CopyStudio/2.0');
      assert.equal(JSON.parse(init?.body as string).stream, false);
      return Response.json({
        choices: [{ finish_reason: 'length', message: { content: '{"partial":true}' } }],
      });
    };
    await assert.rejects(
      createCompletion(config)('', '', new AbortController().signal),
      /cut short/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test('network and balance errors are actionable without exposing provider internals', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error('secret internal host');
    };
    await assert.rejects(
      createCompletion(config)('', '', new AbortController().signal),
      /could not be reached/,
    );
    globalThis.fetch = async () =>
      Response.json(
        { error: { message: 'Access denied due to overdue account' } },
        { status: 403 },
      );
    await assert.rejects(
      createCompletion(config)('', '', new AbortController().signal),
      /account balance or quota/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('daily token exhaustion is distinguished from a temporary limit without exposing account details', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: { message: 'Rate limit for model in organization private-org on tokens per day (TPD). Please try again in 6h12m3.5s.' } }, { status: 429 });
    await assert.rejects(createCompletion(config)('', '', new AbortController().signal), error => {
      assert.match((error as Error).message, /daily token allowance/);
      assert.match((error as Error).message, /6h12m3.5s/);
      assert.doesNotMatch((error as Error).message, /private-org/);
      return true;
    });
    globalThis.fetch = async () => Response.json({ error: { message: 'Temporary token limit in private-org.' } }, { status: 429, headers: { 'retry-after': '90' } });
    await assert.rejects(createCompletion(config)('', '', new AbortController().signal), /temporary usage limit.*90 seconds/);
  } finally { globalThis.fetch = original; }
});
