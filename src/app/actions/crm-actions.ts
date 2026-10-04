"use server";
import { requireAdmin } from '@/lib/dashboard-auth';

import { updateLead, updateLeadEmailVerification, deleteLead, bulkDeleteLeads, getLead, getLeadsByIds, getAllLeads, type EmailVerificationUpdate, LeadRecord, insertOrUpdateLead, bulkInsertOrUpdateLeads, bulkMarkContacted, setLeadOutcome, setDoNotContact } from "@/lib/db";
import { classifyJunkAddress } from "@/lib/junk-addresses";
import { getVerificationReadiness, verifyEmail, verifyEmailBatchFast } from "@/app/actions/email-verifier-actions";
import { toPersistedVerification } from "@/lib/verification-persist";
import { generateHook } from "@/lib/groqClient";

export async function updateLeadAction(id: string, updates: Partial<LeadRecord>) {
    await requireAdmin();
    return await updateLead(id, updates);
}

export async function deleteLeadAction(id: string) {
    await requireAdmin();
    return await deleteLead(id);
}

export async function bulkDeleteLeadsAction(ids: string[]) {
    await requireAdmin();
    return await bulkDeleteLeads(ids);
}


export async function verifyLeadEmailAction(id: string) {
    await requireAdmin();
    const lead = await getLead(id);
    if (!lead || !lead.email) return null;
    const readiness = await getVerificationReadiness();
    if (!readiness.selfHostedReady) throw new Error(readiness.message);
    const result = await verifyEmail(lead.email, "crm");
    return await updateLeadEmailVerification(id, toPersistedVerification(result));
}

/** Batch direct-SMTP verification without weakening the send gate. */
export async function verifyLeadEmailsAction(ids: string[]) {
    await requireAdmin();
    if (ids.length === 0) return [];
    if (ids.length > 100) throw new Error("Verify up to 100 CRM leads at a time");
    const readiness = await getVerificationReadiness();
    if (!readiness.selfHostedReady) throw new Error(readiness.message);

    const leads = (await getLeadsByIds(ids)).filter(lead => Boolean(lead.email));
    const results = await verifyEmailBatchFast(leads.map(lead => ({ address: lead.email, source: "crm" })));
    const updated = [];
    for (let i = 0; i < leads.length; i++) {
        updated.push(await updateLeadEmailVerification(leads[i].id, toPersistedVerification(results[i])));
    }
    return updated;
}

/**
 * Ticking the box for a single lead is a deliberate claim that this person was
 * reached, so it's stamped MANUAL and trusted like any other evidence. Bulk pushes
 * deliberately don't do this — see `ContactedSource`.
 */
export async function toggleContactedAction(id: string, contacted: boolean) {
    await requireAdmin();
    const existing = await getLead(id);
    if (!existing) throw new Error('Lead not found.');
    if (existing.in_hunter && !contacted)
        throw new Error('This lead is already managed in Case Study Hunter and remains marked contacted here.');
    if (existing.contacted_source === 'LINKEDIN' || existing.linkedin_dm_at) {
        if (!contacted) throw new Error('This DM is tracked in the Hunter. Update its outreach record there.');
        return existing;
    }
    return await updateLead(id, { contacted, contacted_source: contacted ? 'MANUAL' : null });
}

/** Records the result of outreach. NOT_INTERESTED and BOUNCED also suppress the lead. */
export async function setLeadOutcomeAction(id: string, outcome: string) {
    await requireAdmin();
    return await setLeadOutcome(id, outcome);
}

export async function setDoNotContactAction(ids: string[], flag: boolean) {
    await requireAdmin();
    return await setDoNotContact(ids, flag);
}

/**
 * Suppresses addresses that can't belong to a lead — placeholders left in website
 * markup, vendor and registrar contacts the crawler picked up, mangled fragments.
 * Several of these verify fine over SMTP because they are real mailboxes, just not
 * the lead's, so verification never catches them. Suppression rather than deletion:
 * the lead row still carries a LinkedIn URL worth re-scraping.
 */
export async function suppressJunkAddressesAction(): Promise<{
    suppressed: number;
    byReason: Record<string, number>;
    examples: { email: string; reason: string }[];
}> {
    await requireAdmin();
    const leads = await getAllLeads();
    const byReason: Record<string, number> = {};
    const examples: { email: string; reason: string }[] = [];
    const ids: string[] = [];

    for (const lead of leads) {
        if (!lead.email || lead.do_not_contact) continue;
        const reason = classifyJunkAddress(lead.email);
        if (!reason) continue;
        ids.push(lead.id);
        byReason[reason] = (byReason[reason] || 0) + 1;
        if (examples.length < 30) examples.push({ email: lead.email, reason });
    }

    const suppressed = ids.length ? await setDoNotContact(ids, true) : 0;
    return { suppressed, byReason, examples };
}

export async function generateHookAction(id: string) {
    await requireAdmin();
    const lead = await getLead(id);
    if (!lead) return null;

    // Use available data to generate a hook
    const context = `
        Name: ${lead.first_name} ${lead.last_name}
        Company: ${lead.company}
        LinkedIn URL: ${lead.linkedin_url}
        Website: ${lead.website || lead.website_source}
    `;

    try {
        const result = await generateHook(context, 0);
        if (result && result.hook) {
            return await updateLead(id, { hook: result.hook, hook_source: result.hookSource || 'manual' });
        }
        return lead;
    } catch (err) {
        console.error("Failed to generate hook", err);
        return lead;
    }
}

export async function pushLeadsToInboxAction(ids: string[]) {
    await requireAdmin();
    const results = [];
    for (const id of ids) {
        try {
            results.push(await updateLead(id, { pipeline_status: 'INBOX' }));
        } catch (e) {
            console.error("Failed to push lead to inbox", id, e);
        }
    }
    return results;
}

export async function importLeadsAction(leads: Partial<LeadRecord>[]) {
    await requireAdmin();
    try {
        // Imports are leads to be verified, never a bypass around the strict
        // send gate. Existing SMTP evidence is retained only when the
        // incoming email has not changed (enforced again in the DB layer).
        const importedLeads = leads;
        return await bulkInsertOrUpdateLeads(importedLeads);
    } catch (e) {
        console.error("Failed to bulk import leads", e);
        return [];
    }
}

export async function markLeadsContactedAction(identifiers: string[]) {
    await requireAdmin();
    try {
        return await bulkMarkContacted(identifiers);
    } catch (e) {
        console.error("Failed to bulk mark contacted", e);
        return 0;
    }
}
