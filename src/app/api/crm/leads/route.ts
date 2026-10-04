import { requireAdmin } from '@/lib/dashboard-auth';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { NextResponse } from 'next/server';
import { insertOrUpdateLead, getAllLeads, LeadRecord } from '@/lib/db';

export async function POST(req: Request) {
    await requireAdmin();
    try {
        const body = await req.json();

        const rawLeads = Array.isArray(body) ? body : [body];
        
        const results = [];
        for (const lead of rawLeads) {
            const mappedLead: Partial<LeadRecord> = {};
            if (lead.linkedin_url || lead.url) mappedLead.linkedin_url = lead.linkedin_url || lead.url;
            if (lead.first_name || lead.firstName) mappedLead.first_name = lead.first_name || lead.firstName;
            if (lead.last_name || lead.lastName) mappedLead.last_name = lead.last_name || lead.lastName;
            if (lead.company || lead.company_name) mappedLead.company = lead.company || lead.company_name;
            if (lead.website) mappedLead.website = lead.website;
            if (lead.website_source) mappedLead.website_source = lead.website_source;
            if (lead.email) mappedLead.email = lead.email;
            if (lead.all_emails) mappedLead.all_emails = lead.all_emails;
            if (lead.hook) mappedLead.hook = lead.hook;
            if (lead.location) mappedLead.location = lead.location;
            if (lead.contacted !== undefined) mappedLead.contacted = lead.contacted;
            // Ingestion may never assert an email is sendable or move it to
            // outreach. New leads default to UNVERIFIED / INBOX; direct SMTP
            // verification is the only promotion path.
            
            const inserted = await insertOrUpdateLead(mappedLead);
            results.push(inserted);
        }

        return NextResponse.json({ success: true, count: results.length, inserted: results });
    } catch (error: any) {
        console.error('API /api/crm/leads error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function GET(req: Request) {
    await requireAdmin();
    try {
        const { searchParams } = new URL(req.url);
        const location = searchParams.get('location');
        const status = searchParams.get('status');

        let leads = await getAllLeads();

        if (location) {
            leads = leads.filter(l => l.location?.toUpperCase() === location.toUpperCase());
        }
        if (status) {
            leads = leads.filter(l => l.pipeline_status === status);
        }

        return NextResponse.json({ success: true, count: leads.length, data: leads });
    } catch (error: any) {
        // Logged, not just returned. This is the call the whole CRM depends on, and
        // a hosted-Postgres connect timeout here used to surface as an empty table
        // with no explanation anywhere.
        console.error('API GET /api/crm/leads failed:', error);
        return NextResponse.json(
            { success: false, error: error?.message || String(error) },
            { status: 500 },
        );
    }
}
