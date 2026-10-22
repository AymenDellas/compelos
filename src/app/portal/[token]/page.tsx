import { createHash } from 'node:crypto';
import { notFound } from 'next/navigation';
import { ClientOnboardingWizard } from '@/components/business/ClientOnboardingWizard';
import { clientBriefReady, journeyFor } from '@/lib/onboarding-journey';
import { saveGuidedOnboardingAction } from '@/app/actions/portal-actions';
import { pool } from '@/lib/pg_setup';
import { agreementPdf } from '@/lib/agreement-pdf';
import { normalizeOnboarding, type OfferProfile, type OpportunityData, type ProjectData } from '@/lib/business';

export const dynamic = 'force-dynamic';

export default async function ClientPortalPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) notFound();
    const result = await pool.query(
        `SELECT p.data AS project, p.revision, o.data AS opportunity, v.profile
         FROM business_projects p
         JOIN business_opportunities o ON o.id=p.opportunity_id
         JOIN business_offer_versions v ON v.version=p.offer_version
         WHERE p.data->'onboarding'->>'portalToken'=$1 LIMIT 1`, [token],
    );
    if (!result.rows[0]) notFound();
    const data = normalizeOnboarding(result.rows[0].project as ProjectData, result.rows[0].opportunity as OpportunityData, result.rows[0].profile as OfferProfile);
    const agreementReady = Boolean(data.agreement.scope.trim() && data.agreement.deliverables.trim()) && (data.projectType === 'CASE_STUDY' || data.payment.price !== null);
    const canSign = agreementReady && !data.agreement.clientSignature && !data.agreement.signedPdfData && ['DRAFT', 'SENT', 'VIEWED'].includes(data.agreement.status);
    const documentSha256 = canSign ? createHash('sha256').update(Buffer.from(await agreementPdf(data).arrayBuffer())).digest('hex') : '';
    return <ClientOnboardingWizard token={token} revision={Number(result.rows[0].revision)} save={saveGuidedOnboardingAction} briefReady={clientBriefReady(data)} signing={{ canSign, documentSha256, email: data.email }} initial={{
        clientName: data.clientName, projectName: data.projectName, projectType: data.projectType, website: data.website,
        form: data.form, journey: { ...journeyFor(data), briefPrepared: clientBriefReady(data), reference: null },
        scope: data.scope, access: data.access, overrides: data.overrides,
        agreement: { status: data.agreement.status, deliverables: data.agreement.deliverables },
        payment: { structure: data.payment.structure, status: data.payment.status, price: data.payment.price, currency: data.payment.currency, deposit: data.payment.deposit, balance: data.payment.balance, link: data.payment.link },
    }} />;
}
