'use strict';

// Shared by the LinkedIn worker, server and browser. No network calls or CRM outcomes.
const VERSION = 1;
const RESEARCH_MAX_AGE_DAYS = 90;
const SEGMENTS = ['EXECUTIVE', 'CAREER', 'BUSINESS'];
const SEGMENT_LABELS = { EXECUTIVE: 'Executive coaching', CAREER: 'Career coaching', BUSINESS: 'Business coaching', UNKNOWN: 'Segment needs review' };
const DEFAULT_TITLES = ['Executive Coach', 'Leadership Coach', 'Career Coach', 'Business Coach'];
const FACT_KEYS = ['independentBusiness', 'paidOffer', 'clientProof', 'demandSignals', 'funnelOpportunity', 'marketingControl', 'economics', 'capacity', 'targetMarket'];
const FACT_LABELS = {
    independentBusiness: 'Independent coaching business', paidOffer: 'Established coaching offer',
    clientProof: 'Client evidence', demandSignals: 'Demand and marketing signals',
    funnelOpportunity: 'Relevant conversion opportunity', marketingControl: 'Control over marketing',
    economics: 'Offer economics', capacity: 'Capacity for new clients', targetMarket: 'Market fit',
};
const STATES = ['OBSERVED', 'INDICATED', 'UNKNOWN', 'NEGATIVE'];
const STATE_LABELS = { OBSERVED: 'Observed', INDICATED: 'Indicated', UNKNOWN: 'Unknown', NEGATIVE: 'Contrary evidence' };
const TIER_LABELS = { A: 'Contact now', B: 'Investigate', C: 'Nurture', OUTSIDE_ICP: 'Outside ICP', UNREVIEWED: 'Not researched' };
const PLATFORM_DOMAINS = new Set([
    'linkedin.com', 'instagram.com', 'facebook.com', 'youtube.com', 'youtu.be', 'twitter.com', 'x.com',
    'slideshare.net', 'topmate.io', 'linktr.ee', 'linktree.com', 'calendly.com', 'cal.com',
    'tidycal.com', 'acuityscheduling.com', 'live.vcita.com', 'bit.ly', 'tinyurl.com',
    'voyagela.com', 'voyagedenver.com', 'canvasrebel.com', 'boldjourney.com', 'shoutoutla.com',
    'coachingfederation.org', 'noomii.com', 'bark.com', 'thumbtack.com', 'meetup.com', 'eventbrite.com',
    'amazon.com', 'canva.com', 'medium.com', 'substack.com', 'wix.com', 'squarespace.com',
]);
const VENDOR_DOMAINS = new Set([
    ...PLATFORM_DOMAINS, 'xecurify.com', 'surecart.com', 'jouwweb.nl', 'shopify.com', 'wordpress.com',
    'wordpress.org', 'godaddy.com', 'weebly.com', 'webflow.com', 'carrd.co', 'notion.so',
    'kajabi.com', 'teachable.com', 'thinkific.com', 'systeme.io', 'clickfunnels.com',
    'hubspot.com', 'mailchimp.com', 'stripe.com', 'paypal.com', 'zoom.us', 'yourmail.com',
    'example.com', 'example.org', 'yourdomain.com', 'domain.com', 'sentry.io',
]);
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com', 'me.com', 'email.com', 'mail.com']);
const normalText = value => String(value || '').replace(/\s+/g, ' ').trim();
const hostOf = value => { try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const onDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);
const validHttpUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } };
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isPlatformWebsite = value => { const host = hostOf(value); return [...PLATFORM_DOMAINS].some(d => onDomain(host, d)); };
const isUnsafeContact = address => {
    const email = String(address || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return true;
    const [local, host] = email.split('@');
    return [...VENDOR_DOMAINS].some(d => onDomain(host, d))
        || /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|postmaster|abuse|privacy|security|legal|notifications?)$/.test(local)
        || /\d{5,}/.test(local) || /^(?:your[-_.]?(?:name|email)|john[-_.]?doe|jane[-_.]?doe|test|sample)$/.test(local);
};

function segmentsFromText(value) {
    const text = normalText(value).toLowerCase().replace(/coaching|coaches/g, 'coach');
    if (!/\bcoach\b/.test(text)) return [];
    const parts = text.split(/[|;\n]/);
    const has = pattern => parts.some(part => /\bcoach\b/.test(part) && pattern.test(part));
    const out = [];
    if (has(/\b(executive|leadership|leader|leaders|c[- ]?suite|executive presence|senior management)\b/)) out.push('EXECUTIVE');
    if (has(/\b(career|job search|interview|return to work|professional transition|outplacement)\b/)) out.push('CAREER');
    if (has(/\b(business|entrepreneur|founder|small business|smb|business owner|business owners)\b/)) out.push('BUSINESS');
    return out;
}

function emptyFact(reason = 'No reliable evidence has been collected.') {
    return { state: 'UNKNOWN', value: '', reason, evidence: [] };
}
function makeFact(state, value, reason, evidence) {
    return { state, value: normalText(value).slice(0, 500), reason: normalText(reason).slice(0, 700), evidence: evidence || [] };
}
function emptyResearch(input = {}, now = new Date().toISOString()) {
    return {
        version: VERSION, researchedAt: now, engine: 'rules', profileIdentityConfirmed: input.profileIdentityConfirmed === true,
        headline: normalText(input.headline).slice(0, 1000), about: normalText(input.about).slice(0, 5000),
        profileLocation: normalText(input.profileLocation).slice(0, 500),
        latestPostText: normalText(input.latestPostText).slice(0, 2500), lastActivityAt: input.lastActivityAt || null,
        linkedinUrl: input.linkedinUrl || input.url || '', website: '', websiteStatus: 'NONE',
        segments: segmentsFromText(input.headline), segment: segmentsFromText(input.headline)[0] || 'UNKNOWN',
        facts: Object.fromEntries(FACT_KEYS.map(key => [key, emptyFact()])),
        pages: [], limitations: [], contacts: [],
    };
}

// AI evidence must be an actual excerpt from the cited source, not a made-up quote.
function groundedFact(candidate, sources) {
    if (!candidate || !STATES.includes(candidate.state) || candidate.state === 'UNKNOWN') return emptyFact(candidate?.reason);
    const evidence = (Array.isArray(candidate.evidence) ? candidate.evidence : []).slice(0, 3).flatMap(item => {
        const source = item && sources[item.sourceIndex];
        if (!item) return [];
        const excerpt = normalText(item.excerpt);
        if (!source || excerpt.length < 12 || excerpt.length > 600 || !normalText(source.text).toLowerCase().includes(excerpt.toLowerCase())) return [];
        return [{ url: source.url, excerpt, source: source.kind || 'WEBSITE', observedAt: source.observedAt }];
    });
    return evidence.length ? makeFact(candidate.state, candidate.value, candidate.reason, evidence) : emptyFact('The proposed finding could not be checked against its source.');
}

function validateResearch(value) {
    if (!value || value.version !== VERSION || !value.facts || !Array.isArray(value.segments)) throw new Error('Invalid prospect research.');
    if (!Number.isFinite(Date.parse(value.researchedAt))) throw new Error('Research needs a valid date.');
    if (JSON.stringify(value).length > 100000) throw new Error('Prospect research is too large.');
    const research = emptyResearch(value, value.researchedAt);
    research.linkedinUrl = typeof research.linkedinUrl === 'string' && validHttpUrl(research.linkedinUrl) ? research.linkedinUrl.slice(0, 2000) : '';
    research.lastActivityAt = validDate(value.lastActivityAt) ? value.lastActivityAt : null;
    research.engine = ['rules', 'ai', 'manual'].includes(value.engine) ? value.engine : 'rules';
    research.website = typeof value.website === 'string' && validHttpUrl(value.website) ? value.website.slice(0, 2000) : '';
    research.websiteStatus = ['OWNED', 'PROFILE_PLATFORM', 'UNCONFIRMED', 'NONE'].includes(value.websiteStatus) ? value.websiteStatus : 'NONE';
    research.segments = [...new Set(value.segments.filter(s => SEGMENTS.includes(s)))];
    research.segment = research.segments.includes(value.segment) ? value.segment : research.segments[0] || 'UNKNOWN';
    for (const key of FACT_KEYS) {
        const fact = value.facts[key];
        if (!fact || !STATES.includes(fact.state)) continue;
        const evidence = (Array.isArray(fact.evidence) ? fact.evidence : []).slice(0, 4).filter(e => e && typeof e.excerpt === 'string' && e.excerpt.length >= 8 && typeof e.url === 'string' && validHttpUrl(e.url) && ['WEBSITE', 'PROFILE', 'MANUAL'].includes(e.source)).map(e => ({ url: e.url.slice(0, 2000), excerpt: e.excerpt.slice(0, 700), source: e.source, observedAt: validDate(e.observedAt) ? e.observedAt : research.researchedAt }));
        research.facts[key] = fact.state !== 'UNKNOWN' && !evidence.length ? emptyFact('Evidence is required for this finding.') : makeFact(fact.state, fact.value, fact.reason, evidence);
    }
    research.pages = (Array.isArray(value.pages) ? value.pages : []).slice(0, 8).filter(p => p && typeof p.url === 'string' && validHttpUrl(p.url)).map(p => ({ url: p.url.slice(0, 2000), label: normalText(p.label).slice(0, 150), status: p.status === 'inspected' ? 'inspected' : 'blocked', note: normalText(p.note).slice(0, 400) }));
    research.limitations = (Array.isArray(value.limitations) ? value.limitations : []).slice(0, 12).map(s => normalText(s).slice(0, 500));
    research.contacts = (Array.isArray(value.contacts) ? value.contacts : []).slice(0, 15).filter(c => c && !isUnsafeContact(c.address)).map(c => ({ address: String(c.address).trim().toLowerCase().slice(0, 320), source: ['linkedin', 'website', 'pattern_guess', 'manual'].includes(c.source) ? c.source : 'website', url: validHttpUrl(c.url) ? String(c.url).slice(0, 2000) : '', ownership: validHttpUrl(c.url) && ['PUBLISHED', 'DOMAIN_MATCH', 'GUESSED', 'UNCONFIRMED'].includes(c.ownership) ? c.ownership : 'UNCONFIRMED' }));
    return research;
}

function validateReview(value) {
    if (!value || typeof value !== 'object') throw new Error('Invalid review.');
    const review = { facts: {}, segment: value.segment || '', contactOwnership: value.contactOwnership || '', contactEmail: normalText(value.contactEmail).toLowerCase().slice(0, 320), note: normalText(value.note).slice(0, 1200), reviewedAt: new Date().toISOString() };
    if (review.segment && !SEGMENTS.includes(review.segment)) throw new Error('Choose an executive, career or business coaching segment.');
    if (review.contactOwnership && !['CONFIRMED', 'UNCONFIRMED'].includes(review.contactOwnership)) throw new Error('Invalid contact ownership choice.');
    if ((review.segment || review.contactOwnership) && review.note.length < 12) throw new Error('Record the evidence or conversation supporting your review.');
    for (const key of FACT_KEYS) {
        const fact = value.facts?.[key];
        if (!fact) continue;
        if (!STATES.includes(fact.state)) throw new Error(`Invalid finding for ${FACT_LABELS[key]}.`);
        const note = normalText(fact.note);
        if (fact.state !== 'UNKNOWN' && note.length < 12) throw new Error(`Add an evidence note for ${FACT_LABELS[key]}.`);
        if (fact.url && !validHttpUrl(fact.url)) throw new Error('Evidence links must be valid HTTP or HTTPS URLs.');
        review.facts[key] = { state: fact.state, note: note.slice(0, 700), url: String(fact.url || '').slice(0, 2000) };
    }
    return review;
}

function applyReview(research, review) {
    const result = validateResearch(research);
    if (!review) return result;
    for (const key of FACT_KEYS) {
        const fact = review.facts?.[key];
        if (!fact || !STATES.includes(fact.state)) continue;
        result.facts[key] = fact.state === 'UNKNOWN' ? emptyFact('Marked unknown in your review.') : makeFact(fact.state, fact.note, 'Recorded in your manual review.', [{ url: fact.url || result.linkedinUrl || result.website, excerpt: fact.note, source: 'MANUAL', observedAt: review.reviewedAt }]);
    }
    if (SEGMENTS.includes(review.segment)) { result.segment = review.segment; result.segments = [...new Set([review.segment, ...result.segments])]; }
    return result;
}

function assessProspect(researchInput, context = {}) {
    const baseResearch = validateResearch(researchInput);
    const research = applyReview(researchInput, context.review);
    const f = research.facts;
    const positive = key => ['OBSERVED', 'INDICATED'].includes(f[key].state);
    const observed = key => f[key].state === 'OBSERVED';
    const unknowns = FACT_KEYS.filter(k => f[k].state === 'UNKNOWN').map(k => FACT_LABELS[k]);
    const blockers = [];
    const researchAge = (Date.parse(context.now || new Date().toISOString()) - Date.parse(research.researchedAt)) / 86400000;
    const researchFresh = researchAge <= RESEARCH_MAX_AGE_DAYS && researchAge >= -1;
    if (!researchFresh) blockers.push('Refresh the public business research before approaching this coach.');
    if (!research.segments.length) blockers.push('Executive, career or business coaching has not been established.');
    if (!positive('independentBusiness')) blockers.push('Independent ownership needs review.');
    if (!positive('paidOffer')) blockers.push('An identifiable paid coaching offer needs review.');
    if (!positive('targetMarket')) blockers.push('The coach’s location or target market needs confirmation.');
    if (!research.profileIdentityConfirmed && !context.review?.segment) blockers.push('Confirm the identity of the coaching profile.');
    const contraryCore = ['independentBusiness', 'marketingControl', 'targetMarket'].some(key => f[key].state === 'NEGATIVE');
    const explicitlyOther = research.segments.length === 0 && /\b(?:sports?|football|soccer|basketball|agile|scrum|fitness|health|wellness|nutrition)\s+coach(?:ing)?\b/i.test(research.headline);
    const fit = contraryCore || explicitlyOther ? 'OUTSIDE_ICP'
        : research.segments.length && positive('independentBusiness') && positive('paidOffer') ? 'MATCH'
        : research.segments.length ? 'POTENTIAL' : 'UNKNOWN';
    const weights = { independentBusiness: 20, paidOffer: 20, clientProof: 15, demandSignals: 15, funnelOpportunity: 20, marketingControl: 10 };
    let score = Object.entries(weights).reduce((sum, [key, weight]) => sum + (observed(key) ? weight : positive(key) ? Math.round(weight * 0.55) : 0), 0);
    // Outreach qualification establishes ICP and a real coaching offer. Client
    // results, current promotion and a funnel problem improve ranking; they are
    // discovery-call questions, not prerequisites for sending an introduction.
    const ready = researchFresh && fit === 'MATCH' && positive('targetMarket')
        && !['capacity', 'economics', 'clientProof'].some(key => f[key].state === 'NEGATIVE')
        && (research.profileIdentityConfirmed || context.review?.segment);
    let tier = fit === 'OUTSIDE_ICP' ? 'OUTSIDE_ICP' : ready ? 'A'
        : fit === 'MATCH' && (f.paidOffer.state === 'NEGATIVE' || f.clientProof.state === 'NEGATIVE' || f.demandSignals.state === 'NEGATIVE') ? 'C'
        : positive('independentBusiness') && (f.paidOffer.state === 'NEGATIVE' || f.capacity.state === 'NEGATIVE' || f.economics.state === 'NEGATIVE') ? 'C' : 'B';
    if (tier === 'OUTSIDE_ICP') score = 0;
    const email = String(context.email || '').trim().toLowerCase();
    const contact = research.contacts.find(c => c.address === email);
    const contactOverride = email && context.review?.contactEmail === email ? context.review.contactOwnership : '';
    const ownerConfirmed = contactOverride !== 'UNCONFIRMED' && (contactOverride === 'CONFIRMED' || contact?.ownership === 'PUBLISHED' || contact?.ownership === 'DOMAIN_MATCH');
    const ownership = !email ? 'NO_EMAIL' : isUnsafeContact(email) ? 'INVALID'
        : contactOverride === 'UNCONFIRMED' ? 'UNCONFIRMED'
        : contactOverride === 'CONFIRMED' ? 'MANUAL_CONFIRMED'
        : contact?.ownership || 'UNCONFIRMED';
    const contactability = !email || ownership === 'INVALID' ? (research.linkedinUrl ? 'LINKEDIN_ONLY' : 'UNAVAILABLE')
        : !ownerConfirmed ? 'OWNERSHIP_UNCLEAR' : context.emailProven ? 'EMAIL_READY' : 'EMAIL_NEEDS_VERIFICATION';
    const cautions = [];
    if (!researchFresh) cautions.push('This assessment needs fresh public research; the established practice remains in the research pool.');
    if (!research.profileIdentityConfirmed) cautions.push('Profile identity was not confirmed by a matching LinkedIn profile.');
    if (f.demandSignals.state !== 'UNKNOWN') cautions.push('Marketing activity does not establish actual traffic volume or lead quality.');
    if (!observed('economics')) cautions.push('Confirm price, contribution margin and sales conversion before agreeing to a performance-based build.');
    if (!observed('capacity')) cautions.push('Confirm willingness and capacity to take on new clients before agreeing to delivery.');
    if (research.websiteStatus !== 'OWNED') cautions.push('An owned business website has not been confirmed.');
    if (research.lastActivityAt) {
        const age = Math.max(0, Math.floor((Date.parse(context.now || new Date().toISOString()) - Date.parse(research.lastActivityAt)) / 86400000));
        if (age > 30) { score = Math.max(0, score - (age > 90 ? 8 : 4)); cautions.push(`Latest known LinkedIn activity was ${age} days ago; this lowers freshness, not business fit.`); }
    }
    const interpretationIncomplete = research.limitations.some(note => /^Automated interpretation (?:failed|could not complete|is unavailable)/.test(note));
    const nextAction = tier === 'A' ? (contactability === 'EMAIL_READY' ? 'Qualified coach; ready for email outreach.' : contactability === 'LINKEDIN_ONLY' ? 'Not qualified for email outreach: no email found. Retry contact research.' : contactability === 'OWNERSHIP_UNCLEAR' ? 'Not qualified for email outreach: confirm who owns the email.' : 'Qualified coach; verify the email before sending.')
        : tier === 'B' && interpretationIncomplete ? 'Retry automated research or review the sources manually; the automated assessment is incomplete.'
        : tier === 'B' ? `Not qualified: ${blockers[0] || 'insufficient evidence of the coaching practice and target market.'}`
        : tier === 'C' ? 'Not qualified: the offer, client base or available capacity does not meet the criteria.' : 'Not qualified: outside the requested coaching ICP.';
    return { version: VERSION, researchedAt: research.researchedAt, tier, segment: research.segment, segments: research.segments,
        score, businessFit: fit, readiness: tier === 'A' ? 'READY_TO_APPROACH' : tier === 'C' ? 'EARLY' : 'NEEDS_REVIEW',
        engagementReady: tier === 'A' && observed('economics') && observed('capacity') && observed('marketingControl') && observed('demandSignals'),
        contact: { channel: contactability, ownership, email }, blockers, unknowns, cautions, nextAction, research, baseResearch };
}

function isContactNow(assessment) {
    const age = assessment ? (Date.now() - Date.parse(assessment.researchedAt)) / 86400000 : Infinity;
    return Boolean(assessment && assessment.version === VERSION && assessment.tier === 'A' && assessment.businessFit === 'MATCH' && age >= -1 && age <= RESEARCH_MAX_AGE_DAYS);
}
function hasAttributableEmail(assessment) {
    return Boolean(assessment && isContactNow(assessment) && assessment.contact?.email && !isUnsafeContact(assessment.contact.email)
        && ['PUBLISHED', 'DOMAIN_MATCH', 'MANUAL_CONFIRMED'].includes(assessment.contact.ownership));
}
function isQualifiedRecord(lead) {
    return Boolean(lead && ['QUALIFIED', 'OUTREACH'].includes(lead.pipeline_status)
        && String(lead.email || '').trim() && !isUnsafeContact(lead.email)
        && (!lead.prospect_assessment || hasAttributableEmail(lead.prospect_assessment)));
}
function hasQualifiedEmail(lead) {
    const email = String(lead?.email || '').trim().toLowerCase();
    return Boolean(isQualifiedRecord(lead) && email && !isUnsafeContact(email)
        && (!lead.prospect_assessment || (hasAttributableEmail(lead.prospect_assessment) && lead.prospect_assessment.contact.email === email)));
}
function pipelineForAssessment(assessment) {
    return hasAttributableEmail(assessment) ? 'QUALIFIED' : 'NOT_QUALIFIED';
}
function extractMatchingProfile(response, slug) {
    const candidates = [response?.data?.profile, response?.profile, response?.data, response, ...(response?.included || []), ...(response?.data?.included || []), ...(response?.data?.elements || [])].filter(Boolean);
    const identifier = value => { try { return decodeURIComponent(String(value || '')).toLowerCase(); } catch { return String(value || '').toLowerCase(); } };
    const expected = identifier(slug);
    const matches = candidates.filter(item => [item.publicIdentifier, item.vanityName].some(value => typeof value === 'string' && identifier(value) === expected));
    const richness = item => (item.headline ? 4 : item.occupation ? 2 : 0) + (item.summary || item.about ? 2 : 0) + (item.firstName && item.lastName ? 1 : 0);
    return matches.sort((a, b) => richness(b) - richness(a))[0] || null;
}

function extractProfileLocation(response, slug) {
    const profile = extractMatchingProfile(response, slug);
    if (!profile) return '';
    const text = value => typeof value === 'string' ? normalText(value) : '';
    const direct = text(profile.locationName) || text(profile.geoLocationName) || text(profile.location);
    const included = [...(response?.included || []), ...(response?.data?.included || [])];
    const geo = profile.geoLocation;
    const geoRef = geo?.['*geo'] || geo?.geoUrn || profile['*geoLocation'];
    // Follow only this identified person's location. Employer positions and
    // unrelated included geographies are not evidence of their current market.
    const linked = typeof geoRef === 'string' && /^urn:li:(?:fsd|fs)_geo:/.test(geoRef)
        ? included.find(item => item?.entityUrn === geoRef) : null;
    const label = direct || text(linked?.defaultLocalizedName) || text(geo?.geo?.defaultLocalizedName) || text(geo?.name);
    const code = profile.location?.countryCode;
    let country = '';
    if (typeof code === 'string' && /^[a-z]{2}$/i.test(code)) {
        try { country = new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) || ''; } catch { /* missing country */ }
    }
    return label && country && !label.toLowerCase().includes(country.toLowerCase()) ? `${label}, ${country}` : label || country;
}

function extractProfileContactInfo(response, slug) {
    const data = response?.data?.profileContactInfo || response?.profileContactInfo || response?.data || response || {};
    if (Array.isArray(data.websites) || data.emailAddress) return data;
    const matching = extractMatchingProfile(response, slug);
    if (matching?.profileContactInfo && typeof matching.profileContactInfo === 'object') return matching.profileContactInfo;
    if (matching && (Array.isArray(matching.websites) || matching.emailAddress)) return matching;
    const references = Object.entries(data).filter(([key, value]) => /contactInfo/i.test(key) && typeof value === 'string').map(([, value]) => value);
    const included = [...(response?.included || []), ...(response?.data?.included || [])];
    return included.find(item => item && (references.includes(item.entityUrn) || item.entityUrn === `urn:li:fs_profileContactInfo:${slug}`)
        && (Array.isArray(item.websites) || item.emailAddress)) || {};
}

module.exports = { VERSION, RESEARCH_MAX_AGE_DAYS, SEGMENTS, SEGMENT_LABELS, DEFAULT_TITLES, FACT_KEYS, FACT_LABELS, STATES, STATE_LABELS, TIER_LABELS, PLATFORM_DOMAINS, FREE_MAIL,
    normalText, hostOf, onDomain, isPlatformWebsite, isUnsafeContact, segmentsFromText, emptyFact, makeFact, emptyResearch,
    groundedFact, validateResearch, validateReview, applyReview, assessProspect, isContactNow, hasAttributableEmail, isQualifiedRecord, hasQualifiedEmail, pipelineForAssessment, extractMatchingProfile, extractProfileLocation, extractProfileContactInfo };
