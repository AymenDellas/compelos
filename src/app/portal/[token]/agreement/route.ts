import { agreementPdf } from '@/lib/agreement-pdf';
import { normalizeOnboarding, type OfferProfile, type OpportunityData, type ProjectData } from '@/lib/business';
import { pool } from '@/lib/pg_setup';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return new Response('Not found', { status: 404 });
    const result = await pool.query(
        `SELECT p.data AS project,o.data AS opportunity,v.profile
         FROM business_projects p
         JOIN business_opportunities o ON o.id=p.opportunity_id
         JOIN business_offer_versions v ON v.version=p.offer_version
         WHERE p.data->'onboarding'->>'portalToken'=$1 LIMIT 1`,
        [token],
    );
    if (!result.rows[0]) return new Response('Not found', { status: 404 });
    const project = result.rows[0].project as ProjectData;
    const onboarding = normalizeOnboarding(
        project,
        result.rows[0].opportunity as OpportunityData,
        result.rows[0].profile as OfferProfile,
    );
    const bytes = await agreementPdf(onboarding).arrayBuffer();
    const name = onboarding.projectName.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '') || 'project';
    return new Response(bytes, {
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${name}-agreement.pdf"`,
            'Cache-Control': 'private, no-store',
        },
    });
}
