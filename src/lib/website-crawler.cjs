'use strict';
const { hostOf, isPlatformWebsite } = require('./prospect-qualification.cjs');

// Only URLs observed in a supplied website, its redirects, or its real links
// enter the queue. A contact/about pathname is never constructed or guessed.
function routeUrl(value, publicUrl) {
    const url = publicUrl(value);
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|fbclid|gclid|mc_[ce]id)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
}
function routeKey(value) {
    const url = new URL(value);
    return hostOf(value) + (url.pathname.replace(/\/$/, '') || '/') + url.search;
}
function publicRoute(value) {
    const url = new URL(value);
    return !/\.(?:jpe?g|png|gif|webp|svg|ico|pdf|zip|mp[34]|mov|woff2?|ttf|css|js|xml|json|rss)(?:$|\/)/i.test(url.pathname)
        && !/\/(?:wp-admin|wp-login\.php|wp-json|cdn-cgi|logout|signout|login|signin|cart|checkout)(?:\/|$)/i.test(url.pathname)
        && ![...url.searchParams.keys()].some(key => /^(?:s|search|add-to-cart|action|replytocom)$/i.test(key));
}
function routePriority(item) {
    const label = `${item.label || ''} ${new URL(item.url).pathname}`;
    return /contact|get.in.touch|reach.out|connect/i.test(label) ? 0
        : /about|biography|our.story|who.we|meet/i.test(label) ? 1
        : /coaching|services|work.with|offer|program/i.test(label) ? 2 : 3;
}

async function crawlWebsiteRoutes(input, options) {
    const { publicUrl, fetchPage, parsePage, ownedPage } = options;
    const previous = options.previousResearch?.crawl;
    const resume = previous?.version === 1 && !previous.complete;
    const pages = resume ? [...options.previousResearch.pages] : [];
    const parsed = [], sources = [];
    const visited = new Map((resume ? previous.visited : []).map(url => [routeKey(url), url]));
    const failed = new Map();
    const roots = new Set(resume ? previous.roots : []);
    const matchedHosts = new Set(resume ? previous.matchedHosts : []);
    const candidates = resume ? [...previous.candidates] : [];
    const queue = new Map();
    const discovered = new Set(visited.keys());
    const maxPages = Math.max(1, Math.min(200, options.maxPages || 200));
    const deadline = Date.now() + Math.max(100, Math.min(90000, options.maxTimeMs || 90000));
    let inspected = resume ? previous.inspected : 0;
    let contactPages = resume ? previous.contactPages : 0;
    let descriptionPages = resume ? previous.descriptionPages : 0;
    let description = resume ? options.previousResearch.description : null;
    const descriptionScore = value => !value ? -1 : (/about|biography|our.story|meet|who.we/i.test(new URL(value.url).pathname) ? 4 : 0) + (/coach(?:ing)?|leadership|career|practice/i.test(value.text) ? 2 : 0);
    let attempts = 0, stoppedReason = '';
    const enqueue = (value, label = '', root = false) => {
        try {
            const url = routeUrl(value, publicUrl), key = routeKey(url);
            if (!publicRoute(url) || isPlatformWebsite(url)) return;
            if (url.length > 1000 || discovered.size >= 2000 && !discovered.has(key)) { stoppedReason = 'Website route storage limit reached; further research needs attention.'; return; }
            discovered.add(key);
            if (!visited.has(key) && !queue.has(key)) queue.set(key, { url, label, root });
            if (root) roots.add(url);
        } catch { /* invalid/private/unsupported route */ }
    };
    if (resume) for (const url of [...previous.pending, ...previous.failed]) {
        visited.delete(routeKey(url));
        enqueue(url, '', previous.roots.some(root => routeKey(root) === routeKey(url)));
    }
    else for (const url of [...new Set([...(input.websites || []), input.website].filter(Boolean))].slice(0, 8)) enqueue(url, 'Linked website', true);
    const sameSite = url => [...roots].some(root => hostOf(root) === hostOf(url));
    while (queue.size && attempts < maxPages && Date.now() < deadline) {
        const batch = [...queue.values()].sort((a, b) => routePriority(a) - routePriority(b)).slice(0, Math.min(3, maxPages - attempts));
        // Mark a batch before fetching so two pages discovering the same route
        // cannot schedule duplicate requests. Redirect destinations are also keys.
        for (const item of batch) { const key = routeKey(item.url); queue.delete(key); visited.set(key, item.url); attempts++; }
        const results = await Promise.allSettled(batch.map(async item => {
            const fetched = await fetchPage(item.url, { timeoutMs: Math.max(1, Math.min(10000, deadline - Date.now())) });
            return { item, page: parsePage(fetched.html, routeUrl(fetched.url || item.url, publicUrl)) };
        }));
        for (let i = 0; i < results.length; i++) {
            const result = results[i], item = batch[i];
            if (result.status === 'rejected') {
                const note = String(result.reason?.message || 'Website could not be read.').slice(0, 300);
                failed.set(routeKey(item.url), item.url);
                const record = { url: item.url, label: item.label || 'Public route', status: 'blocked', note };
                const index = pages.findIndex(page => routeKey(page.url) === routeKey(item.url));
                if (index >= 0) pages[index] = record; else pages.push(record);
                continue;
            }
            const page = result.value.page;
            // A linked website's redirect establishes the real site root. An
            // internal route redirecting off-site cannot attribute foreign data.
            if (item.root) roots.add(page.url);
            if (!sameSite(page.url) || isPlatformWebsite(page.url)) continue;
            const key = routeKey(page.url);
            if (page.canonical && sameSite(page.canonical)) {
                const canonicalKey = routeKey(page.canonical);
                // Real canonical metadata prevents endless duplicate pagination
                // aliases from expanding a site's route graph indefinitely.
                if (visited.has(canonicalKey) && canonicalKey !== key && pages.some(p => routeKey(p.url) === canonicalKey)) continue;
                visited.set(canonicalKey, page.canonical); queue.delete(canonicalKey);
            }
            if (parsed.some(p => routeKey(p.url) === key)) continue;
            visited.set(key, page.url); discovered.add(key); queue.delete(key); failed.delete(key);
            const practiceRoot = [...roots].some(root => hostOf(root) === hostOf(page.url) && !/\/(?:team|staff|employees|our-coaches|people|members)(?:\/|$)/i.test(new URL(root).pathname));
            if (practiceRoot && ownedPage(page, input)) matchedHosts.add(hostOf(page.url));
            parsed.push(page); inspected++;
            const contactPage = routePriority({ url: page.url, label: page.title }) === 0;
            if (contactPage) contactPages++;
            if (page.description?.length >= 50) {
                descriptionPages++;
                const candidate = { url: page.url, text: page.description };
                if (descriptionScore(candidate) > descriptionScore(description)) description = candidate;
            }
            candidates.push(...page.contacts.map(contact => ({ ...contact, url: page.url, contactPage })));
            sources.push({ url: page.url, text: page.text, links: page.links, label: page.title || item.label, kind: 'WEBSITE', owned: false, observedAt: options.now });
            const record = { url: page.url, label: page.title || item.label || 'Public route', status: 'inspected', note: page.readable ? 'Public page inspected for contact information and description.' : 'Page has too little readable text; JavaScript or access restrictions may hide content.' };
            const index = pages.findIndex(p => routeKey(p.url) === key || routeKey(p.url) === routeKey(item.url));
            if (index >= 0) pages[index] = record; else pages.push(record);
            if (!page.readable) failed.set(key, page.url);
            for (const link of page.links) if (sameSite(link.url)) enqueue(link.url, link.text);
        }
    }
    if (queue.size && !stoppedReason) stoppedReason = attempts >= maxPages ? 'Page budget reached; remaining discovered routes will be continued.' : 'Time budget reached; remaining discovered routes will be continued.';
    for (const source of sources) source.owned = matchedHosts.has(hostOf(source.url));
    const contacts = [...new Map(candidates.map(contact => [contact.address + '|' + contact.url, contact])).values()];
    return {
        pages, parsed, sources, description,
        crawl: { version: 1, complete: !queue.size && !failed.size && !stoppedReason, visited: [...visited.values()], pending: [...queue.values()].map(item => item.url), failed: [...failed.values()], roots: [...roots], matchedHosts: [...matchedHosts],
            discovered: discovered.size, inspected, contactPages, descriptionPages, stoppedReason, candidates: contacts },
    };
}
module.exports = { crawlWebsiteRoutes, routeUrl, routeKey, publicRoute, routePriority };
