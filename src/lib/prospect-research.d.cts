import type { ProspectResearch } from './prospect-qualification.cjs';
export function publicUrl(value: string): URL;
export function fetchPublicPage(value: string, options: {
    resource: true; followRedirects: false; signal: AbortSignal; userAgent?: string;
}): Promise<{ url: string; status: number; headers: Record<string, string>; body: Buffer }>;
export function fetchPublicPage(value: string, options: {
    signal: AbortSignal; allowUrl?: (url: URL) => boolean;
}): Promise<{ url: string; html: string }>;
export function parsePage(html: string, url: string): {
    url: string; title: string; h1: string; identityText: string; text: string; readable: boolean;
    links: { url: string; text: string }[];
    contacts: { address: string; explicit: boolean; businessContact: boolean; contactInvitation: boolean }[];
};
export function researchProspect(input: {
    firstName?: string; lastName?: string; headline?: string; about?: string; profileLocation?: string;
    profileIdentityConfirmed?: boolean; linkedinUrl?: string; url?: string; website?: string; websites?: string[];
    email?: string; emails?: string[]; emailSource?: string; latestPostText?: string; lastActivityAt?: string | null;
}, options?: { ai?: boolean; now?: string }): Promise<ProspectResearch>;
