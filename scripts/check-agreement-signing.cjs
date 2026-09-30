const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const token = '00000000-0000-4000-8000-000000000000';
const onboarding = {
  projectName: 'Sample project',
  projectType: 'PAID',
  agreement: { status: 'DRAFT', scope: 'Agreed scope', deliverables: 'Landing page' },
  payment: { price: 1200 },
  documents: [],
};
let project = { onboarding };
let activity = '';
const client = {
  async query(sql, args) {
    if (sql.includes('SELECT p.*')) return { rows: [{ id: 'project-1', opportunity_id: 'opportunity-1', data: project, opportunity: {}, profile: {} }] };
    if (sql.startsWith('UPDATE business_projects')) {
      project = JSON.parse(args[1]);
      return { rows: [] };
    }
    throw new Error('Unexpected query');
  },
};
const source = fs.readFileSync(path.join(__dirname, '../src/app/actions/business-actions.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (name) => {
    if (name === 'node:crypto') return require(name);
    if (name === 'next/cache') return { revalidatePath() {} };
    if (name === '@/lib/agreement-pdf') return {
      agreementPdf: (data) => new Blob([`%PDF-1.4\n${data.agreement.clientSignature ? 'Signed' : 'Original'}\n`], { type: 'application/pdf' }),
    };
    if (name === '@/lib/business') return { normalizeOnboarding: (record) => record.onboarding };
    if (name === '@/lib/business-store') return {
      businessTransaction: (fn) => fn(client),
      recordActivity: (_client, _opportunityId, _kind, note) => { activity = note; },
    };
    if (name === '@/lib/business-validation') return { validateProject() {} };
    throw new Error(`Unexpected import: ${name}`);
  },
  mod,
  mod.exports,
);

async function main() {
  const form = new FormData();
  form.set('token', token);
  form.set('signerName', 'Sample Client');
  form.set('signerEmail', 'sample@example.com');
  form.set('signatureConsent', 'accepted');
  form.set('documentSha256', createHash('sha256').update('%PDF-1.4\nOriginal\n').digest('hex'));
  const result = await mod.exports.signClientAgreementAction({ error: '', signed: false }, form);
  assert.deepEqual(result, { error: '', signed: true });
  assert.equal(project.onboarding.agreement.status, 'SIGNED_CLIENT');
  assert.equal(project.onboarding.agreement.clientSignature.name, 'Sample Client');
  assert.match(project.onboarding.agreement.clientSignature.documentSha256, /^[0-9a-f]{64}$/);
  assert.match(project.onboarding.agreement.signedPdfData, /^data:application\/pdf;base64,/);
  assert.equal(project.onboarding.documents.length, 2);
  assert.match(activity, /Client electronically signed/);
  const second = await mod.exports.signClientAgreementAction({ error: '', signed: false }, form);
  assert.equal(second.signed, false);
  assert.match(second.error, /already been signed/);
  project = { onboarding };
  form.set('documentSha256', '0'.repeat(64));
  const changed = await mod.exports.signClientAgreementAction({ error: '', signed: false }, form);
  assert.equal(changed.signed, false);
  assert.match(changed.error, /agreement changed/);
  assert.equal(project.onboarding.agreement.status, 'DRAFT');
  process.stdout.write('Portal signing saves a fixed PDF and rejects repeats or changed terms.\n');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
