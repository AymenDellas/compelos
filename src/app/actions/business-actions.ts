'use server';

import { requireAdmin } from '@/lib/dashboard-auth';
import { randomUUID } from 'node:crypto';
import {
    blankOpportunity,
    buildProject,
    type OfferProfile,
    type OpportunityData,
    type ProjectData,
} from '@/lib/business';
import {
    businessTransaction,
    readBusinessSnapshot,
    mapOffer,
    mapProject,
    recordActivity,
} from '@/lib/business-store';
import { validateOffer, validateOpportunity, validateProject } from '@/lib/business-validation';
import { newOnboardingJourney } from '@/lib/onboarding-journey';

export async function loadBusinessAction() {
    await requireAdmin();
    return readBusinessSnapshot();
}

export async function saveOfferAction(profile: OfferProfile, expectedVersion: number) {
    await requireAdmin();
    validateOffer(profile);
    return businessTransaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(83472102)');
        const latest = await client.query(
            'SELECT version FROM business_offer_versions ORDER BY version DESC LIMIT 1',
        );
        if (latest.rows[0].version !== expectedVersion)
            throw new Error('The offer changed in another window. Reload before saving.');
        const result = await client.query(
            'INSERT INTO business_offer_versions(profile) VALUES ($1) RETURNING *',
            [JSON.stringify(profile)],
        );
        return mapOffer(result.rows[0]);
    });
}

export type CreateOnboardingInput = {
    clientName: string;
    businessName: string;
    email: string;
    website: string;
    projectName: string;
    funnel: ProjectData['funnel'];
    projectType: 'PAID' | 'CASE_STUDY';
};

/** Start a client workflow even when the accepted deal was not previously tracked in Sales. */
export async function createOnboardingAction(input: CreateOnboardingInput) {
    await requireAdmin();
    const opportunity: OpportunityData = {
        ...blankOpportunity(),
        name: input.clientName.trim(),
        email: input.email.trim(),
        website: input.website.trim(),
        stage: 'WON',
        funnel: input.funnel,
        mode: input.projectType === 'CASE_STUDY' ? 'CASE_STUDY' : 'PERFORMANCE',
        currentOffer: input.projectName.trim(),
        nextAction: 'Complete client onboarding',
    };
    validateOpportunity(opportunity);
    return businessTransaction(async (client) => {
        const offer = await client.query(
            'SELECT * FROM business_offer_versions ORDER BY version DESC LIMIT 1',
        );
        const opportunityId = randomUUID();
        await client.query(
            'INSERT INTO business_opportunities(id,lead_id,offer_version,data) VALUES ($1,NULL,$2,$3)',
            [opportunityId, offer.rows[0].version, JSON.stringify(opportunity)],
        );
        const project = buildProject(opportunity, offer.rows[0].profile);
        project.name = input.projectName.trim();
        project.onboarding = {
            ...project.onboarding!,
            clientName: input.clientName.trim(),
            businessName: input.businessName.trim(),
            email: input.email.trim(),
            website: input.website.trim(),
            projectName: input.projectName.trim(),
            projectType: input.projectType,
            portalToken: randomUUID(),
            journey: newOnboardingJourney(),
        };
        const result = await client.query(
            'INSERT INTO business_projects(id,opportunity_id,offer_version,data) VALUES ($1,$2,$3,$4) RETURNING *',
            [randomUUID(), opportunityId, offer.rows[0].version, JSON.stringify(project)],
        );
        await recordActivity(client, opportunityId, 'PROJECT', 'Client onboarding started');
        return mapProject(result.rows[0]);
    });
}

export async function saveClientProjectAction(id: string, data: ProjectData, expectedRevision: number) {
    await requireAdmin();
    validateProject(data);
    return businessTransaction(async (client) => {
        const result = await client.query(
            'UPDATE business_projects SET data=$2,revision=revision+1,updated_at=NOW() WHERE id=$1 AND revision=$3 RETURNING *',
            [id, JSON.stringify(data), expectedRevision],
        );
        if (!result.rows[0]) throw new Error('This project changed in another window. Reload before saving.');
        await recordActivity(
            client,
            result.rows[0].opportunity_id,
            'PROJECT',
            `Client project updated · ${data.status.toLowerCase()}`,
        );
        return mapProject(result.rows[0]);
    });
}

