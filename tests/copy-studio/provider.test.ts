import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod/v4';
import { createCompletion, createPrefillCompletion, structured } from '../../src/lib/copy-studio/server/provider';

const config = {
  apiKey: 'test-token-not-a-real-key',
  baseUrl: 'https://provider.invalid/v1',
  model: 'test-model',
  timeoutMs: 1000,
};

const agentRouter = { ...config, baseUrl: 'https://agentrouter.org/v1', timeoutMs: 20_000 };

test('prefill stops the legacy client after a confirmed missing route and reuses the Responses fallback', async (t) => {
  const requests: Array<{ path: string; model: string }> = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(init!.body as string);
    requests.push({ path, model: body.model });
    if (path.endsWith('/chat/completions')) {
      return Response.json({ error: { message: '当前分组 default 下对于模型 deepseek-v4-flash 无可用渠道' } }, { status: 503 });
    }
    assert.equal(body.max_output_tokens, 32768);
    assert.equal(body.stream, true);
    assert.equal(body.tools, undefined);
    assert.equal(body.text.format.type, 'json_object');
    assert.match(body.input, /Return a JSON object/);
    assert.ok(Buffer.byteLength(body.input) < 20_000);
    const event = {
      type: 'response.completed',
      response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"ok":true}' }] }] },
    };
    return new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const complete = createPrefillCompletion({ ...agentRouter, model: 'deepseek-v4-flash', inputByteLimit: 24_000 });
  const signal = new AbortController().signal;
  assert.deepEqual(await structured(complete, z.object({ ok: z.boolean() }), 'Return JSON.',
    () => 'x'.repeat(complete.inputByteLimit! - 100), signal), { ok: true });
  assert.equal(complete.inputByteLimit, 20_000);
  assert.equal(await complete('Return JSON.', 'Repair the answer.', signal), '{"ok":true}');
  assert.deepEqual(requests, [
    { path: '/v1/chat/completions', model: 'deepseek-v4-flash' },
    { path: '/v1/responses', model: 'gpt-6.1-sol' },
    { path: '/v1/responses', model: 'gpt-6.1-sol' },
  ]);
});

test('prefill returns access and incomplete-response errors without changing models', async (t) => {
  const results = [
    () => Response.json({ error: { message: 'unauthorized client' } }, { status: 401 }),
    () => Response.json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"partial":true}' }] }] }),
  ];
  const models: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    models.push(JSON.parse(init!.body as string).model);
    return results.shift()!();
  });
  const complete = createPrefillCompletion({ ...agentRouter, model: 'gpt-5.6-sol' });
  const signal = new AbortController().signal;
  await assert.rejects(complete('Return JSON.', 'Read this source.', signal), /rejected the client integration/);
  await assert.rejects(complete('Return JSON.', 'Read this source.', signal), /reached its response limit/);
  assert.deepEqual(models, ['gpt-5.6-sol', 'gpt-5.6-sol']);
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
