import type { EmailVerificationUpdate } from "@/lib/db";
import type { VerificationResult } from "@/app/actions/email-verifier-actions";

/**
 * The last gate before a verification verdict becomes a CRM fact.
 *
 * This lives in its own module because there are two independent write paths —
 * the CRM's manual/batch verify (`crm-actions.ts`) and the worker's on-arrival
 * verify (`api/crm/leads/[location]`) — and they had drifted: one applied a
 * (nominal) check, the other inlined the field mapping and applied nothing. A
 * single shared function is what stops the next path from inventing a third
 * policy.
 *
 * The invariant it enforces, independently of whatever the verifier concluded:
 *
 *   VALID means direct SMTP accepted this address **and** a random address at the
 *   same domain was refused at mailbox level.
 *
 * A catch-all domain cannot meet that bar, and no provider is exempt from it. A
 * previous revision waived it for Google Workspace on the reasoning that a
 * catch-all "accepts email without bouncing"; accepting at RCPT is not a promise
 * to deliver, and that waiver put 106 unproven addresses on the send list.
 *
 * Anything arriving as VALID without the proof is recorded as RISKY — still live,
 * still exportable via `?include=risky` — with the downgrade written into the
 * reason so it shows up in the CRM instead of vanishing.
 */
export function toPersistedVerification(result: VerificationResult): EmailVerificationUpdate {
    const provenDeliverable =
        result.method === "SMTP_DIRECT" &&
        result.checks.smtpValid === true &&
        result.checks.catchAll === false && !result.checks.policyBlocked
        && !result.checks.disposable && !result.checks.systemAddress && !result.checks.freeProvider;

    const downgraded = result.status === "VALID" && !provenDeliverable;
    const unsupportedInvalid = result.status === 'INVALID' && result.checks.syntax
        && result.checks.smtpValid !== false && result.checks.dnsStatus !== 'NO_MAIL';
    const status = unsupportedInvalid ? 'UNKNOWN'
        : downgraded ? (result.checks.smtpValid === true ? 'RISKY' : 'UNKNOWN') : result.status;

    return {
        expectedEmail: result.email,
        status,
        method: result.method,
        reason: unsupportedInvalid ? `${result.reason} · downgraded: no definitive DNS or mailbox refusal evidence` : downgraded
            ? `${result.reason} · downgraded: VALID requires a refused random recipient at this domain`
            : result.reason,
        score: status === 'UNKNOWN' ? Math.min(result.score, 35) : downgraded ? Math.min(result.score, 70) : result.score,
        checkedAt: result.checkedAt,
        // Only a VALID verdict carries an expiry; the send gate reads it as proof
        // freshness, so leaving one on a downgraded row would outlive the claim.
        expiresAt: status === "VALID" ? result.expiresAt : undefined,
    };
}
