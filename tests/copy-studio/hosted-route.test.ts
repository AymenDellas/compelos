import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function fixture(authenticated = true, unavailable = false) {
  const calls = { authentication: 0, onboardings: 0, operation: '' };
  const source = readFileSync('src/app/api/copy-studio/[operation]/route.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as Record<string, (request: Request, context: unknown) => Promise<Response>> };
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name === '@/lib/dashboard-auth') return { async requireAdmin() {
      calls.authentication++;
      if (!authenticated) throw new Error('Sign in required');
    } };
    if (name === '@/lib/copy-studio/server/onboarding') return { async readCopyStudioOnboardings() {
      calls.onboardings++;
      if (unavailable) throw new Error('Private database diagnostic');
      return [{ id: 'fixture', clientName: 'Test Coach' }];
    } };
    if (name === '@/lib/copy-studio/server/http') return { async handleCopyStudio(_request: Request, operation: string) {
      calls.operation = operation;
      return Response.json({ ok: true });
    } };
    throw new Error(`Unexpected import: ${name}`);
  }, module, module.exports);
  return { calls, route: module.exports };
}

const context = (operation: string) => ({ params: Promise.resolve({ operation }) });
const request = new Request('https://workspace.example/api/copy-studio/onboardings');

test('hosted Copy Studio authenticates before reading onboarding or invoking AI', async () => {
  const { calls, route } = fixture(false);
  await assert.rejects(route.GET(request, context('onboardings')), /Sign in required/);
  await assert.rejects(route.POST(request, context('generate')), /Sign in required/);
  assert.equal(calls.authentication, 2);
  assert.equal(calls.onboardings, 0);
  assert.equal(calls.operation, '');
});

test('hosted onboarding picker returns fresh data only after authentication', async () => {
  const { calls, route } = fixture();
  const response = await route.GET(request, context('onboardings'));
  assert.equal(calls.authentication, 1);
  assert.equal(calls.onboardings, 1);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { onboardings: [{ id: 'fixture', clientName: 'Test Coach' }] });
});

test('hosted onboarding errors hide private diagnostics and permit a manual brief', async () => {
  const { route } = fixture(true, true);
  const response = await route.GET(request, context('onboardings'));
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.match(body, /continue with a manual brief/);
  assert.doesNotMatch(body, /Private database/);
});

test('hosted generation and reference reading retain the authenticated API handler', async () => {
  for (const operation of ['generate', 'reference', 'import', 'revise']) {
    const { calls, route } = fixture();
    assert.equal((await route.POST(request, context(operation))).status, 200);
    assert.equal(calls.authentication, 1);
    assert.equal(calls.operation, operation);
    assert.equal(calls.onboardings, 0);
  }
});
