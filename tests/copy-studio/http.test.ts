import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCopyStudio } from '../../src/lib/copy-studio/server/http';
import { input, draft, strategy } from './fixtures';

const request = (operation: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000/api/copy-studio/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', ...headers },
    body: JSON.stringify(body),
  });

test('dashboard API validates before calling AI and preserves the streaming contract', async () => {
  let calls = 0;
  const complete = async () => JSON.stringify([strategy, draft, { findings: [] }][calls++]);
  const invalid = await handleCopyStudio(request('generate', {}), 'generate', complete);
  assert.equal(invalid.status, 400);
  assert.equal(calls, 0);
  const response = await handleCopyStudio(request('generate', input), 'generate', complete);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const events = await response.text();
  assert.match(events, /"type":"progress"/);
  assert.match(events, /"type":"result"/);
  assert.equal(calls, 3);
});

test('dashboard API rejects foreign origins, oversized bodies, private URLs, and removed features', async () => {
  const complete = async () => {
    throw new Error('Must not reach AI');
  };
  assert.equal(
    (
      await handleCopyStudio(
        request('generate', input, { Origin: 'https://foreign.example' }),
        'generate',
        complete,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleCopyStudio(
        request('generate', input, { 'Sec-Fetch-Site': 'cross-site' }),
        'generate',
        complete,
      )
    ).status,
    403,
  );
  assert.equal(
    (await handleCopyStudio(request('import', { text: 'a'.repeat(2_000_001) }), 'import', complete))
      .status,
    413,
  );
  assert.equal(
    (await handleCopyStudio(request('import', { url: 'http://localhost' }), 'import', complete))
      .status,
    400,
  );
  assert.equal(
    (await handleCopyStudio(request('custom-prompt', {}), 'custom-prompt', complete)).status,
    404,
  );
});

test('cancelling the dashboard response cancels generation', async () => {
  let signalSeen: AbortSignal | undefined;
  const complete = async (_system: string, _prompt: string, signal: AbortSignal) => {
    signalSeen = signal;
    return new Promise<string>((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  };
  const response = await handleCopyStudio(request('generate', input), 'generate', complete);
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(signalSeen?.aborted, true);
});

test('Read page can override reasoning without changing the writing profile', async () => {
  const settings = { COPY_STUDIO_BASE_URL: 'https://provider.invalid/v1', COPY_STUDIO_API_KEY: 'fixture-only-token', COPY_STUDIO_MODEL: 'gpt-5.6-sol', COPY_STUDIO_API_FORMAT: 'responses', COPY_STUDIO_REASONING_EFFORT: 'low', COPY_STUDIO_EXTRACTION_REASONING_EFFORT: 'none' };
  const saved = Object.keys(settings).map(key => [key, process.env[key]] as const);
  const original = globalThis.fetch;
  const efforts: string[] = [];
  try {
    Object.assign(process.env, settings);
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      efforts.push(body.reasoning.effort);
      assert.equal(body.max_output_tokens, efforts.length === 1 ? 7000 : 512);
      const text = efforts.length === 1 ? JSON.stringify({ offers: [], fields: {}, evidence: [], warnings: ['No named offer in this source.'] }) : 'OK';
      return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
    };
    const imported = await handleCopyStudio(request('import', { text: 'Example Coach provides support for decisions at work. This source has no defined offer, fees or terms. Contact the coach to ask a question.' }), 'import');
    assert.equal(imported.status, 200);
    assert.deepEqual((await imported.json()).extraction.fields, {});
    const connection = await handleCopyStudio(request('connection', {}), 'connection');
    assert.equal(connection.status, 200);
    assert.deepEqual(efforts, ['none', 'low']);
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
