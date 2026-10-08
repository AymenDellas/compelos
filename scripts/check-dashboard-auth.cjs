const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const salt = 'a'.repeat(32);
process.env.DASHBOARD_PASSWORD_HASH = 'scrypt:' + salt + ':' + crypto.scryptSync('fixture-password', salt, 64).toString('hex');
process.env.DASHBOARD_SESSION_SECRET = crypto.randomBytes(48).toString('hex');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/dashboard-session.ts'), 'utf8');
const moduleObject = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(require, moduleObject, moduleObject.exports);
const auth = moduleObject.exports;
assert.equal(auth.verifyPassword('fixture-password'), true);
assert.equal(auth.verifyPassword('wrong-password'), false);
assert.equal(auth.verifyPassword('Fixture-password'), false);
const now = Date.now();
const { session, token } = auth.createSession(now);
assert.equal(auth.verifySession(token, now).id, session.id);
assert.equal(auth.verifySession(token, now + 8 * 60 * 60 * 1000), null);
assert.equal(auth.verifySession(token.slice(0, -2) + 'AA', now), null);
assert.equal(auth.verifySession('forged.unsigned', now), null);
process.env.DASHBOARD_PASSWORD_HASH += 'changed';
assert.equal(auth.verifySession(token, now), null);
delete process.env.DASHBOARD_SESSION_SECRET;
assert.equal(auth.verifySession(token, now), null);
assert.equal(auth.sameOrigin('https://compelos-three.vercel.app', 'compelos-three.vercel.app'), true);
assert.equal(auth.sameOrigin('https://attacker.example', 'compelos-three.vercel.app'), false);
let checked = 0;
const dir = path.join(__dirname, '../src/app/actions');
for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.ts') && name !== 'portal-actions.ts')) {
  const code = fs.readFileSync(path.join(dir, file), 'utf8');
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  for (const statement of ast.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      assert.match(statement.body.statements[0].getText(ast), /^await requireAdmin\(\)/, `${file}: ${statement.name.text} must authenticate before accessing data`);
      checked++;
    }
  }
}
console.log(`Authentication checks passed; ${checked} internal actions authenticate first.`);
for (const route of ['linkedin-accounts','queue-batch','queue-status','process-lead','clear-queue']) {
  const code=fs.readFileSync(path.join(__dirname,`../src/app/api/${route}/route.ts`),'utf8');
  const ast=ts.createSourceFile(route,code,ts.ScriptTarget.Latest,true);
  for (const statement of ast.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body && statement.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword))
      assert.match(statement.body.statements[0].getText(ast),/^await requireWorkerAdmin\(\)/,`${route}: authenticate before reading worker data`);
  }
}
assert.match(fs.readFileSync(path.join(__dirname,'../src/lib/worker-admin.ts'),'utf8'),/await requireAdmin\(\)/);
console.log('Worker account and queue endpoints authenticate first.');
