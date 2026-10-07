const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relative, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected import: ${name}`);
  }, mod, mod.exports);
  return mod.exports;
}

const business = load('src/lib/business.ts');
const validation = load('src/lib/business-validation.ts', { './business': business });
const opportunity = { ...business.blankOpportunity(), name: 'Test Client', funnel: 'DIRECT_TO_CALL', mode: 'CASE_STUDY' };
const initial = business.buildProject(opportunity, business.DEFAULT_OFFER);
const complete = structuredClone(initial);
Object.assign(complete.onboarding.form, {
  status: 'COMPLETE', offer: 'One coaching offer', audience: 'Coaches', customerProblem: 'Low bookings',
  desiredOutcome: 'More discovery calls', websitePlatform: 'Webflow', hostingPlatform: 'Webflow',
  domainProvider: 'Cloudflare', repositoryProvider: 'Not used', caseStudyConsent: true,
  testimonialCommitment: true, deploymentAccessConsent: true,
});

assert.equal(initial.onboarding.form.testimonialCommitment, false);
assert.equal(initial.onboarding.form.deploymentAccessConsent, false);
assert.ok(business.missingOnboardingFormFields(initial.onboarding).includes('Honest testimonial after delivery'));
validation.validateProject(complete);
for (const key of ['testimonialCommitment', 'deploymentAccessConsent', 'caseStudyConsent']) {
  const missing = structuredClone(complete);
  missing.onboarding.form[key] = false;
  assert.throws(() => validation.validateProject(missing), /required onboarding/);
}
for (const [key] of business.DEPLOYMENT_TOOL_FIELDS) {
  const missing = structuredClone(complete);
  missing.onboarding.form[key] = '';
  assert.throws(() => validation.validateProject(missing), /required onboarding/);
}
const noDestination = structuredClone(complete);
for (const [key] of business.DEPLOYMENT_TOOL_FIELDS) noDestination.onboarding.form[key] = 'Not used';
assert.throws(() => validation.validateProject(noDestination), /website builder or hosting/);
const unknown = structuredClone(complete);
unknown.onboarding.form.hostingPlatform = 'Unknown';
assert.throws(() => validation.validateProject(unknown), /Hosting/);

const paid = structuredClone(complete);
paid.onboarding.projectType = 'PAID';
paid.onboarding.form.caseStudyConsent = false;
paid.onboarding.form.testimonialCommitment = false;
validation.validateProject(paid);
const paidDraft = business.buildProject({ ...opportunity, mode: 'PERFORMANCE' }, business.DEFAULT_OFFER);
assert.equal(paidDraft.onboarding.agreement.clientResponsibilities.includes(business.TESTIMONIAL_COMMITMENT_TEXT), false);

const generated = business.generateAccessChecklist(complete.onboarding.form);
assert.equal(generated.length, 3);
assert.equal(new Set(generated.map(item => item.id)).size, generated.length);
assert.ok(generated.find(item => item.id.endsWith('-website')).required);
assert.equal(generated.some(item => item.platform === 'Not used'), false);
const hosting = generated.find(item => item.id.endsWith('-hosting'));
const oldVerified = { ...hosting, id: hosting.id.replace(/-hosting$/, ''), status: 'VERIFIED' };
const manual = { ...hosting, id: 'manual-deployment', platform: 'Manual deployment requirement', status: 'VERIFIED' };
const merged = business.mergeAccessChecklist([oldVerified, manual], generated);
assert.equal(merged.find(item => item.id === hosting.id).status, 'VERIFIED');
assert.equal(merged.find(item => item.id.endsWith('-website')).status, 'NOT_REQUESTED');
assert.ok(merged.some(item => item.id === manual.id));
assert.equal(oldVerified.id.endsWith('-hosting'), false);

assert.equal(business.onboardingAccessComplete(complete.onboarding), false, 'An empty access list must not bypass required tools');
complete.onboarding.access = generated.map(item => ({ ...item, status: 'VERIFIED' }));
assert.equal(business.onboardingAccessComplete(complete.onboarding), true);
complete.onboarding.access.find(item => item.id.endsWith('-website')).status = 'RECEIVED';
assert.equal(business.onboardingAccessComplete(complete.onboarding), false, 'Client confirmation still needs Compel verification');
assert.ok(business.onboardingBlockers(complete.onboarding).some(item => item.key === 'access'));
complete.onboarding.access = [];

const legacy = structuredClone(initial);
delete legacy.onboarding.form.testimonialCommitment;
delete legacy.onboarding.form.deploymentAccessConsent;
legacy.onboarding.agreement.clientResponsibilities = 'Existing custom responsibilities.';
legacy.onboarding.agreement.status = 'SENT';
const normalized = business.normalizeOnboarding(legacy, opportunity);
assert.equal(normalized.form.testimonialCommitment, false);
assert.equal(normalized.form.deploymentAccessConsent, false);
assert.ok(normalized.agreement.clientResponsibilities.includes(business.TESTIMONIAL_COMMITMENT_TEXT));
assert.ok(normalized.agreement.clientResponsibilities.includes('Existing custom responsibilities.'));
assert.equal(legacy.onboarding.agreement.clientResponsibilities, 'Existing custom responsibilities.');
assert.equal(business.normalizeOnboarding({ ...legacy, onboarding: normalized }, opportunity).agreement.clientResponsibilities, normalized.agreement.clientResponsibilities);
for (const status of ['SIGNED_CLIENT', 'FULLY_SIGNED']) {
  const signed = structuredClone(legacy);
  signed.onboarding.agreement.status = status;
  signed.onboarding.agreement.signedPdfData = 'data:application/pdf;base64,c2lnbmVk';
  assert.equal(business.normalizeOnboarding(signed, opportunity).agreement.clientResponsibilities, 'Existing custom responsibilities.');
}

let stored = structuredClone(initial);
stored.onboarding.access = [manual];
let writes = 0;
const actions = load('src/app/actions/portal-actions.ts', {
  'next/cache': { revalidatePath() {} },
  '@/lib/business': business,
  '@/lib/business-validation': validation,
  '@/lib/agreement-pdf': { agreementPdf() { throw new Error('Signing is outside this save test'); } },
  '@/lib/business-store': {
    businessTransaction: fn => fn({ async query(sql, args) {
      if (sql.includes('SELECT p.*')) return { rows: [{ id: 'fixture', opportunity_id: 'fixture-opportunity', data: structuredClone(stored), opportunity, profile: business.DEFAULT_OFFER }] };
      if (sql.startsWith('UPDATE business_projects')) { stored = JSON.parse(args[1]); writes++; return { rows: [] }; }
      throw new Error('Unexpected query');
    } }),
    recordActivity() {},
  },
});

function submission(intent = 'complete') {
  const form = new FormData();
  for (const [key, value] of Object.entries(complete.onboarding.form))
    if (typeof value === 'string' && key !== 'status') form.set(key, value);
    else if (value === true) form.set(key, 'accepted');
  form.set('token', '00000000-0000-4000-8000-000000000000');
  form.set('intent', intent);
  return form;
}

async function main() {
  for (const key of ['testimonialCommitment', 'deploymentAccessConsent', 'websitePlatform']) {
    const form = submission();
    form.delete(key);
    await assert.rejects(actions.saveClientPortalFormAction(form), /required onboarding/);
    assert.equal(writes, 0, 'Rejected completion must not write client data');
  }
  const draft = new FormData();
  draft.set('token', '00000000-0000-4000-8000-000000000000');
  draft.set('intent', 'save');
  await actions.saveClientPortalFormAction(draft);
  assert.equal(stored.onboarding.form.status, 'IN_PROGRESS');
  assert.equal(stored.onboarding.form.testimonialCommitment, false);
  await actions.saveClientPortalFormAction(submission());
  assert.equal(stored.onboarding.form.status, 'COMPLETE');
  assert.equal(stored.onboarding.form.testimonialCommitment, true);
  assert.equal(stored.onboarding.form.deploymentAccessConsent, true);
  assert.ok(stored.onboarding.access.some(item => item.id === manual.id));
  assert.ok(stored.onboarding.access.find(item => item.id.endsWith('-website')).required);
  assert.equal(business.onboardingAccessComplete(stored.onboarding), false);
  console.log('Onboarding checks passed: required commitments, deployment tools, access verification, draft saves, legacy records, signed terms, and server-side rejection. No live database used.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
