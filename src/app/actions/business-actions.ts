'use server';

import { revalidatePath } from 'next/cache';
import { generateAccessChecklist, normalizeOnboarding, type ProjectData } from '@/lib/business';
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
        nextForm.status = portalValue(formData, 'intent') === 'complete' ? 'COMPLETE' : 'IN_PROGRESS';
        const generated = nextForm.status === 'COMPLETE' ? generateAccessChecklist(nextForm) : [];
        const access = generated.length
            ? generated.map((item) => onboarding.access.find((saved) => saved.id === item.id) || item)
            : onboarding.access;
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
