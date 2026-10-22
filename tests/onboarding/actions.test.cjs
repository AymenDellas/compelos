const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
    return resolve.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, parent, ...args);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const stub = (filename, exports) => { require.cache[require.resolve(filename)] = { id: filename, filename, loaded: true, exports }; };
let authenticated = false, checks = 0, queries = 0, row;
stub(path.join(root, 'src/lib/dashboard-auth.ts'), { async requireAdmin() { checks++; if (!authenticated) throw new Error('Sign in first'); } });
stub(path.join(root, 'src/lib/business-store.ts'), {
    async readBusinessSnapshot() { queries++; return { projects: [row] }; },
    businessTransaction: fn => fn({ async query(sql, values) {
        queries++;
        if (sql.startsWith('UPDATE business_projects')) {
            if (values[2] !== row.revision) return { rows: [] };
            row = { ...row, data: JSON.parse(values[1]), revision: row.revision + 1 };
            return { rows: [row] };
        }
        throw new Error('Unexpected fixture query');
    } }),
    recordActivity() {}, mapProject: value => value,
});
const b = require('../../src/lib/business.ts');
const actions = require('../../src/app/actions/business-actions.ts');
function reset() {
    authenticated = false; checks = 0; queries = 0;
    row = { id: 'test-project', opportunity_id: 'test-opportunity', revision: 1,
        data: b.buildProject({ ...b.blankOpportunity(), name: 'Example Coach', funnel: 'DIRECT_TO_CALL', mode: 'CASE_STUDY' }, b.DEFAULT_OFFER) };
}
test('internal onboarding reads, preparation and saves authenticate before any data access', async () => {
    reset();
    for (const action of [() => actions.loadBusinessAction(), () => actions.saveOfferAction(b.DEFAULT_OFFER, 1),
        () => actions.createOnboardingAction({}), () => actions.saveClientProjectAction(row.id, row.data, 1)])
        await assert.rejects(action, /Sign in/);
    assert.equal(checks, 4); assert.equal(queries, 0);
});
test('approved focus uses the existing admin revision save and stale edits cannot overwrite client answers', async () => {
    reset(); authenticated = true;
    const { newFunnelFocus } = require('../../src/lib/funnel-focus.ts');
    const data = structuredClone(row.data);
    data.onboarding.funnelFocus = { ...newFunnelFocus('practice_wide'), approvedAt: '2026-10-22T10:00:00Z' };
    const saved = await actions.saveClientProjectAction(row.id, data, 1);
    assert.equal(saved.revision, 2); assert.equal(saved.data.onboarding.funnelFocus.mode, 'practice_wide');
    const before = JSON.stringify(row);
    await assert.rejects(actions.saveClientProjectAction(row.id, { ...data, brief: 'stale operator change' }, 1), /changed/);
    assert.equal(JSON.stringify(row), before);
});
test('invalid internal funnel focus cannot be stored through a project save', async () => {
    reset(); authenticated = true;
    row.data.onboarding.funnelFocus = { version: 1, mode: 'automatic-mixed-services', approvedAt: '' };
    await assert.rejects(actions.saveClientProjectAction(row.id, row.data, 1));
    assert.equal(queries, 0);
});
