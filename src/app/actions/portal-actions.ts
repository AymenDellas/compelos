'use server';

import { createHash, randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { agreementPdf } from '@/lib/agreement-pdf';
import { CASE_STUDY_CONSENT_VERSION, generateAccessChecklist, mergeAccessChecklist, normalizeOnboarding, type ProjectData } from '@/lib/business';
import { businessTransaction, recordActivity } from '@/lib/business-store';
import { validateProject } from '@/lib/business-validation';

const PORTAL_FORM_FIELDS = [
    'offer', 'audience', 'customerProblem', 'desiredOutcome', 'trafficSources',
    'landingPageUrl', 'bookingUrl', 'qualification', 'nurture', 'traffic', 'bookings', 'showRate',
    'closeRate', 'bookingPlatform', 'crm', 'emailPlatform', 'analyticsPlatform', 'hostingPlatform',
    'domainProvider', 'websitePlatform', 'repositoryProvider', 'assets', 'mustStay', 'avoid',
    'importantContext',
] as const;

function portalValue(formData: FormData, key: string) {
    const value = formData.get(key);
    return typeof value === 'string' ? value.trim().slice(0, 20_000) : '';
}

function validPortalToken(token: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
}

export type SignAgreementState = { error: string; signed: boolean };

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

    try {
        await businessTransaction(async (client) => {
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
    return { error: '', signed: true };
}

export async function saveClientPortalFormAction(formData: FormData) {
    const token = portalValue(formData, 'token');
    if (!validPortalToken(token)) throw new Error('This portal link is invalid.');
    await businessTransaction(async (client) => {
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
        const nextForm = { ...onboarding.form };
        for (const key of PORTAL_FORM_FIELDS) nextForm[key] = portalValue(formData, key);
        nextForm.caseStudyConsent = onboarding.projectType === 'CASE_STUDY' && formData.get('caseStudyConsent') === 'accepted';
        nextForm.testimonialCommitment = nextForm.caseStudyConsent && (
            formData.get('caseStudyConsentVersion') === CASE_STUDY_CONSENT_VERSION ||
            formData.get('testimonialCommitment') === 'accepted'
        );
        nextForm.deploymentAccessConsent = formData.get('deploymentAccessConsent') === 'accepted';
        nextForm.status = portalValue(formData, 'intent') === 'complete' ? 'COMPLETE' : 'IN_PROGRESS';
        const generated = nextForm.status === 'COMPLETE' ? generateAccessChecklist(nextForm) : [];
        const access = mergeAccessChecklist(onboarding.access, generated);
        const next = { ...project, onboarding: { ...onboarding, form: nextForm, access } };
        validateProject(next);
        await client.query(
            'UPDATE business_projects SET data=$2,revision=revision+1,updated_at=NOW() WHERE id=$1',
            [result.rows[0].id, JSON.stringify(next)],
        );
        await recordActivity(client, result.rows[0].opportunity_id, 'ONBOARDING', nextForm.status === 'COMPLETE' ? 'Client completed the onboarding form' : 'Client saved onboarding form progress');
    });
    revalidatePath(`/portal/${token}`);
}

export async function confirmClientScopeAction(formData: FormData) {
    const token = portalValue(formData, 'token');
    if (!validPortalToken(token)) throw new Error('This portal link is invalid.');
    await businessTransaction(async (client) => {
        const result = await client.query(
            `SELECT * FROM business_projects WHERE data->'onboarding'->>'portalToken'=$1 FOR UPDATE`,
            [token],
        );
        if (!result.rows[0]) throw new Error('This portal link is no longer available.');
        const project = result.rows[0].data as ProjectData;
        if (!project.onboarding) throw new Error('Onboarding has not been prepared.');
        const next = {
            ...project,
            onboarding: {
                ...project.onboarding,
                scope: { ...project.onboarding.scope, confirmed: true, confirmedAt: new Date().toISOString() },
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
