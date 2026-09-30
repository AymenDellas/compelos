const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/agreement-pdf.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (name) => {
    if (name === './business') return { CASE_STUDY_CONSENT_TEXT: 'Case study consent.' };
    throw new Error(`Unexpected import: ${name}`);
  },
  mod,
  mod.exports,
);

async function main() {
  const agreement = {
    intro: 'This agreement sets out the project terms.',
    scope: 'Build a conversion-focused landing page.',
    deliverables: 'Landing page design and copy. Booking flow.',
    timeline: 'Four weeks after required access is received.',
    revisions: 'One consolidated revision round.',
    clientResponsibilities: 'Provide accurate information and feedback.',
    compelResponsibilities: 'Deliver the agreed work.',
    ownership: 'The client owns approved deliverables after payment.',
    caseStudyRights: 'Requires separate written permission.',
    confidentiality: 'Keep non-public business information confidential.',
    termination: 'Either party may end the work with written notice.',
  };
  const data = {
    clientName: 'Sample Client',
    businessName: 'Sample Business',
    projectName: 'Sample funnel',
    projectType: 'PAID',
    payment: { price: 1200, currency: 'USD', structure: 'FULL', deposit: null, balance: null, dueDate: '', notes: '' },
    agreement,
  };
  const original = Buffer.from(await mod.exports.agreementPdf(data).arrayBuffer());
  const repeated = Buffer.from(await mod.exports.agreementPdf(data).arrayBuffer());
  assert.deepEqual(original, repeated);
  assert.equal(original.subarray(0, 4).toString(), '%PDF');
  assert.equal(original.includes(Buffer.from('Signed electronically by')), false);
  const hash = createHash('sha256').update(original).digest('hex');
  const signed = Buffer.from(await mod.exports.agreementPdf({
    ...data,
    agreement: {
      ...agreement,
      clientSignature: { name: 'Sample Client', email: 'sample@example.com', signedAt: '2026-09-30T12:00:00.000Z', documentSha256: hash },
    },
  }).arrayBuffer());
  assert.equal(signed.subarray(0, 4).toString(), '%PDF');
  assert.equal(signed.includes(Buffer.from('Signed electronically by Sample Client')), true);
  assert.equal(signed.includes(Buffer.from(hash)), true);
  const destination = path.join(__dirname, '../tmp/pdfs/client-signed-sample.pdf');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, signed);
  process.stdout.write('Agreement PDF signature and document hash verified.\n');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
