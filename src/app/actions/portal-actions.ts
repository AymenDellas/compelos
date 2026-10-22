'use server';

import { createHash, randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { agreementPdf } from '@/lib/agreement-pdf';
import { CASE_STUDY_CONSENT_VERSION, generateAccessChecklist, onboardingAccessChecklist, reconcileOnboardingAccess, mergeAccessChecklist, normalizeOnboarding, type ProjectData } from '@/lib/business';
import { businessTransaction, recordActivity } from '@/lib/business-store';
import { validateProject } from '@/lib/business-validation';
import { applyClientBooking, practiceBookingReady } from '@/lib/funnel-focus';
import { CLIENT_JOURNEY_FIELDS, clientBriefReady, essentialsPresent, journeyFor, needsWebsiteIntroduction } from '@/lib/onboarding-journey';

const PORTAL_FORM_FIELDS = [
    'offerName', 'offer', 'audience', 'customerProblem', 'desiredOutcome', 'differentiation', 'unsuitableClients', 'trafficSources',
    'landingPageUrl', 'bookingUrl', 'qualification', 'nurture', 'traffic', 'bookings', 'showRate',
    'closeRate', 'bookingPlatform', 'crm', 'emailPlatform', 'analyticsPlatform', 'hostingPlatform',
    'domainProvider', 'websitePlatform', 'repositoryProvider', 'assets', 'mustStay', 'avoid',
    'importantContext', 'coachBio', 'proof', 'preferences',
] as const;

function portalValue(formData: FormData, key: string) {
    const value = formData.get(key);
    return typeof value === 'string' ? value.trim().slice(0, 20_000) : '';
}

function validPortalToken(token: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
}

export type SignAgreementState = { error: string; signed: boolean; revision?: number };

export async function signClientAgreementAction(
    _previous: SignAgreementState,
    formData: FormData,
): Promise<SignAgreementState> {
    const token = portalValue(formData, 'token');
    const name = portalValue(formData, 'signerName').replace(/\s+/g, ' ');
    const email = portalValue(formData, 'signerEmail').toLowerCase();
    const reviewedHash = portalValue(formData, 'documentSha256');
    if (!validPortalToken(token)) return { error: 'This portal link is invalid.', signed: false };
    if (name.length < 2 || name.length > 120) return { error: 'Enter your full name to sign.', signed: false };
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return { error: 'Enter a valid email address.', signed: false };
    if (formData.get('signatureConsent') !== 'accepted')
        return { error: 'Confirm that you agree to sign electronically.', signed: false };
    if (!/^[0-9a-f]{64}$/.test(reviewedHash))
        return { error: 'Reload the agreement and review it before signing.', signed: false };

    let signedRevision: number | undefined;
    try {
        signedRevision = await businessTransaction(async (client) => {
            const result = await client.query(
                `SELECT p.*,o.data AS opportunity,v.profile
                 FROM business_projects p
                 JOIN business_opportunities o ON o.id=p.opportunity_id
                 JOIN business_offer_versions v ON v.version=p.offer_version
                 WHERE p.data->'onboarding'->>'portalToken'=$1 FOR UPDATE OF p`,
                [token],
            );
            if (!result.rows[0]) throw new Error('This portal link is no longer available.');
            const project = result.rows[0].data as ProjectData;
            const onboarding = normalizeOnboarding(project, result.rows[0].opportunity, result.rows[0].profile);
            if (onboarding.agreement.clientSignature || onboarding.agreement.signedPdfData ||
                !['DRAFT', 'SENT', 'VIEWED'].includes(onboarding.agreement.status))
                throw new Error('This agreement has already been signed.');
            if (!onboarding.agreement.scope.trim() || !onboarding.agreement.deliverables.trim() ||
                (onboarding.projectType === 'PAID' && onboarding.payment.price === null))
                throw new Error('Compel must finish the agreement terms before you can sign.');

            const original = Buffer.from(await agreementPdf(onboarding).arrayBuffer());
            const documentSha256 = createHash('sha256').update(original).digest('hex');
            if (documentSha256 !== reviewedHash)
                throw new Error('The agreement changed. Reload and review the current PDF before signing.');
            const originalPdfData = `data:application/pdf;base64,${original.toString('base64')}`;
            const clientSignature = {
                name,
                email,
                signedAt: new Date().toISOString(),
                documentSha256,
            };
            const signedOnboarding = {
                ...onboarding,
                agreement: { ...onboarding.agreement, status: 'SIGNED_CLIENT' as const, clientSignature },
            };
            const signedBytes = Buffer.from(await agreementPdf(signedOnboarding).arrayBuffer());
            const signedPdfData = `data:application/pdf;base64,${signedBytes.toString('base64')}`;
            const signedPdfName = `${onboarding.projectName.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '') || 'project'}-client-signed.pdf`;
            const next = {
                ...project,
                onboarding: {
                    ...signedOnboarding,
                    agreement: { ...signedOnboarding.agreement, signedPdfName, signedPdfData },
                    documents: [
                        ...onboarding.documents.filter((item) => item.kind !== 'AGREEMENT' || !['Agreement reviewed before signing', 'Client-signed agreement'].includes(item.name)),
                        {
                            id: randomUUID(), name: 'Agreement reviewed before signing', kind: 'AGREEMENT' as const,
                            url: '', fileName: signedPdfName.replace('-client-signed.pdf', '-reviewed.pdf'),
                            dataUrl: originalPdfData, createdAt: clientSignature.signedAt,
                        },
                        {
                            id: randomUUID(), name: 'Client-signed agreement', kind: 'AGREEMENT' as const,
                            url: '', fileName: signedPdfName, dataUrl: signedPdfData, createdAt: clientSignature.signedAt,
                        },
                    ],
                },
            };
            validateProject(next);
            await client.query(
                'UPDATE business_projects SET data=$2,revision=revision+1,updated_at=NOW() WHERE id=$1',
                [result.rows[0].id, JSON.stringify(next)],
            );
            await recordActivity(client, result.rows[0].opportunity_id, 'ONBOARDING', 'Client electronically signed the agreement; Compel signature pending');
            return Number(result.rows[0].revision || 0) + 1;
        });
    } catch (error) {
        if (error instanceof Error && [
            'This portal link is no longer available.',
            'This agreement has already been signed.',
            'Compel must finish the agreement terms before you can sign.',
            'The agreement changed. Reload and review the current PDF before signing.',
        ].includes(error.message)) return { error: error.message, signed: false };
        return { error: 'We could not save your signature. Please try again or contact Compel.', signed: false };
    }
    revalidatePath(`/portal/${token}`);
    return { error: '', signed: true, revision: signedRevision };
}

export async function saveClientPortalFormAction(formData: FormData) {
    const token = portalValue(formData, 'token');
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error('This portal link is invalid.');
    const guided = formData.get('guidedVersion') === '1';
    const savedRevision = await businessTransaction(async (client) => {
        const result = await client.query(
            `SELECT p.*,o.data AS opportunity,v.profile
             FROM business_projects p
             JOIN business_opportunities o ON o.id=p.opportunity_id
             JOIN business_offer_versions v ON v.version=p.offer_version
             WHERE p.data->'onboarding'->>'portalToken'=$1 FOR UPDATE OF p`,
            [token],
        );
        if (!result.rows[0]) throw new Error('This portal link is no longer available.');
        const project = result.rows[0].data as ProjectData;
        const onboarding = normalizeOnboarding(project, result.rows[0].opportunity, result.rows[0].profile);
        if (onboarding.journey && !guided) throw new Error('This onboarding now uses the guided brief. Reload this page before saving.');
        if (guided && Number(formData.get('revision')) !== Number(result.rows[0].revision))
            throw new Error('This onboarding changed in another window. Reload to see the latest answers before saving.');
        if (guided && !clientBriefReady(onboarding))
            throw new Error('Compel is still preparing your offer summary. Please return when your brief is ready.');
        const nextForm = { ...onboarding.form };
        for (const key of PORTAL_FORM_FIELDS) {
            if (!formData.has(key)) continue;
            const raw = formData.get(key);
            nextForm[key] = typeof raw === 'string' ? raw.trim().slice(0, key === 'proof' ? 480000 : 20000) : '';
        }
        let journey = onboarding.journey;
        const complete = portalValue(formData, 'intent') === 'complete';
        if (guided) {
            journey = { ...journeyFor(onboarding), briefPrepared: clientBriefReady(onboarding) };
            const patch = JSON.parse(String(formData.get('journeyPatch') || '{}'));
            for (const key of CLIENT_JOURNEY_FIELDS) if (Object.hasOwn(patch, key)) Object.assign(journey, { [key]: patch[key] });
            const essentialChanged = ['offerName', 'offer', 'audience', 'customerProblem', 'desiredOutcome'].some(key => nextForm[key as keyof typeof nextForm] !== onboarding.form[key as keyof typeof nextForm]);
            if (essentialChanged) { journey.offerConfirmed = false; journey.offerConfirmedAt = ''; }
            if (formData.get('confirmOffer') === 'yes') {
                if (!essentialsPresent({ ...onboarding, form: nextForm })) throw new Error('Please complete the five offer facts before confirming this summary.');
                journey.offerConfirmed = true; journey.offerConfirmedAt = new Date().toISOString();
            }
            const old = journeyFor(onboarding);
            if (['websiteManager', 'publisher', 'contactName', 'contactEmail'].some(key => journey![key as keyof typeof journey] !== old[key as keyof typeof old]) ||
                ['domainProvider', 'websitePlatform', 'bookingPlatform', 'emailPlatform', 'analyticsPlatform'].some(key => nextForm[key as keyof typeof nextForm] !== onboarding.form[key as keyof typeof nextForm])) {
                journey.responsibilityConfirmed = false; journey.verifiedAt = '';
            }
            if (complete && (!journey.offerConfirmed || !journey.websiteManager || !journey.publisher)) throw new Error('Confirm your offer and choose how your page will be published before finishing.');
            if (complete && (journey.websiteManager === 'OTHER' || journey.publisher === 'DEVELOPER') && (!journey.contactName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(journey.contactEmail))) throw new Error('Add a valid name and email for the person who helps with your website.');
            if ((complete || (journey.flowVersion && journey.step >= 4)) && needsWebsiteIntroduction(journey) && !journey.introductionSent)
                throw new Error('Send the introduction email and confirm “I’ve sent the introduction” before continuing.');
            if (complete && journey.flowVersion && !onboarding.scope.confirmed && !onboarding.overrides.includes('scope') && formData.get('confirmScope') !== 'yes')
                throw new Error('Review and confirm the project scope before submitting.');
        }
        if (!guided || formData.has('caseStudyConsentPresent')) {
            nextForm.caseStudyConsent = onboarding.projectType === 'CASE_STUDY' && formData.get('caseStudyConsent') === 'accepted';
            nextForm.testimonialCommitment = nextForm.caseStudyConsent && (formData.get('caseStudyConsentVersion') === CASE_STUDY_CONSENT_VERSION || formData.get('testimonialCommitment') === 'accepted');
        }
        if (!guided || formData.has('deploymentAccessConsent')) nextForm.deploymentAccessConsent = formData.get('deploymentAccessConsent') === 'accepted';
        nextForm.status = complete ? 'COMPLETE' : guided && onboarding.form.status === 'COMPLETE' && journey?.offerConfirmed ? 'COMPLETE' : 'IN_PROGRESS';
        const funnelFocus = formData.has('bookingChoices')
            ? applyClientBooking(onboarding.funnelFocus, JSON.parse(String(formData.get('bookingChoices')))) : onboarding.funnelFocus;
        if ((complete || (guided && journey?.flowVersion && journey.step >= 4)) && !practiceBookingReady(funnelFocus))
            throw new Error('Review your booking services and tick the confirmation in Going live before continuing.');
        const withForm = { ...onboarding, ...(funnelFocus ? { funnelFocus } : {}), form: nextForm, ...(journey ? { journey } : {}) };
        const generated = guided || nextForm.status === 'COMPLETE' ? onboardingAccessChecklist(withForm) : [];
        let access = guided ? reconcileOnboardingAccess(withForm) : mergeAccessChecklist(onboarding.access, generated);
        if (guided && formData.has('receivedAccessIds')) {
            const received: unknown = JSON.parse(String(formData.get('receivedAccessIds')));
            if (!Array.isArray(received) || received.some(id => typeof id !== 'string' || !access.some(item => item.id === id))) throw new Error('This access request is no longer available. Reload before trying again.');
            access = access.map(item => received.includes(item.id) && !['VERIFIED', 'NOT_NEEDED'].includes(item.status) ? { ...item, status: 'RECEIVED' as const } : item);
        }
        const scope = guided && complete && formData.get('confirmScope') === 'yes'
            ? { ...onboarding.scope, confirmed: true, confirmedAt: onboarding.scope.confirmedAt || new Date().toISOString() }
            : onboarding.scope;
        const next = { ...project, onboarding: { ...withForm, scope, access } };
        validateProject(next);
        await client.query(
            'UPDATE business_projects SET data=$2,revision=revision+1,updated_at=NOW() WHERE id=$1',
            [result.rows[0].id, JSON.stringify(next)],
        );
        if (!guided || complete) await recordActivity(client, result.rows[0].opportunity_id, 'ONBOARDING', complete ? 'Client completed the onboarding form' : 'Client saved onboarding form progress');
        return Number(result.rows[0].revision || 0) + 1;
    });
    if (!guided || formData.get('intent') === 'complete') revalidatePath(`/portal/${token}`);
    return { revision: savedRevision };
}

export async function saveGuidedOnboardingAction(formData: FormData) {
    try { return { ok: true as const, ...await saveClientPortalFormAction(formData) }; }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : 'Your answers could not be saved. Please retry.' }; }
}

export async function confirmClientScopeAction(formData: FormData) {
    const token = portalValue(formData, 'token');
    if (!validPortalToken(token)) throw new Error('This portal link is invalid.');
    await businessTransaction(async (client) => {
        const result = await client.query(
            `SELECT p.*,o.data AS opportunity,v.profile FROM business_projects p
             JOIN business_opportunities o ON o.id=p.opportunity_id
             JOIN business_offer_versions v ON v.version=p.offer_version
             WHERE p.data->'onboarding'->>'portalToken'=$1 FOR UPDATE OF p`,
            [token],
        );
        if (!result.rows[0]) throw new Error('This portal link is no longer available.');
        const project = result.rows[0].data as ProjectData;
        if (!project.onboarding) throw new Error('Onboarding has not been prepared.');
        const onboarding = normalizeOnboarding(project, result.rows[0].opportunity, result.rows[0].profile);
        const next = {
            ...project,
            onboarding: {
                ...onboarding,
                scope: { ...onboarding.scope, confirmed: true, confirmedAt: new Date().toISOString() },
            },
        };
        validateProject(next);
        await client.query('UPDATE business_projects SET data=$2,revision=revision+1,updated_at=NOW() WHERE id=$1', [result.rows[0].id, JSON.stringify(next)]);
        await recordActivity(client, result.rows[0].opportunity_id, 'ONBOARDING', 'Client confirmed the project scope');
    });
    revalidatePath(`/portal/${token}`);
}

export async function markPortalAccessReceivedAction(formData: FormData) {
    const token = portalValue(formData, 'token');
    const itemId = portalValue(formData, 'itemId');
    if (!validPortalToken(token) || !itemId) throw new Error('This access request is invalid.');
    await businessTransaction(async (client) => {
        const result = await client.query(
            `SELECT * FROM business_projects WHERE data->'onboarding'->>'portalToken'=$1 FOR UPDATE`,
            [token],
        );
        if (!result.rows[0]) throw new Error('This portal link is no longer available.');
        const project = result.rows[0].data as ProjectData;
        if (!project.onboarding) throw new Error('Onboarding has not been prepared.');
        const access = project.onboarding.access.map((item) => item.id === itemId ? { ...item, status: 'RECEIVED' as const } : item);
        if (!access.some((item) => item.id === itemId)) throw new Error('Access request not found.');
        const next = { ...project, onboarding: { ...project.onboarding, access } };
        validateProject(next);
        await client.query('UPDATE business_projects SET data=$2,revision=revision+1,updated_at=NOW() WHERE id=$1', [result.rows[0].id, JSON.stringify(next)]);
        await recordActivity(client, result.rows[0].opportunity_id, 'ONBOARDING', 'Client marked an access request received');
    });
    revalidatePath(`/portal/${token}`);
}
