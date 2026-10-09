/**
 * Persistent LinkedIn Worker
 *
 * One isolated browser and LinkedIn session per account process. The supervisor
 * coordinates the selected accounts through leased database jobs.
 *
 * Usage:
 *   node worker.cjs          → Start and resume pending queue jobs
 *   node worker.cjs --resume → Resumes processing any leftover queue jobs
 */

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { researchProspect } = require('./src/lib/prospect-research.cjs');
const { identityFromMe } = require('./src/lib/linkedin-session-identity.cjs');
const { VERSION: QUALIFICATION_VERSION, assessProspect, pipelineForAssessment, extractMatchingProfile, extractProfileLocation, extractProfileContactInfo, isPlatformWebsite, isUnsafeContact, hostOf } = require('./src/lib/prospect-qualification.cjs');

puppeteerExtra.use(StealthPlugin());

// ── Config ──
const ACTIVITY_DAYS_THRESHOLD = 30;
const BROWSER_PROFILES_DIR = path.join(__dirname, '.browser-profiles');
const QUEUE_DIR = path.join(__dirname, 'queue');
const RESULTS_DIR = path.join(__dirname, 'queue-results');
const POLL_INTERVAL_MS = 2000;
const RESULT_TTL_DAYS = 7; // Auto-purge results older than this
// How many leads may be in the post-LinkedIn enrichment stage at once. These do
// not touch LinkedIn, so they're safe to run in parallel with the scrape loop.
const ENRICH_CONCURRENCY = Math.max(1, parseInt(process.env.ENRICH_CONCURRENCY || '3', 10));
// Profiles per day for this LinkedIn account. 400 is the tested ceiling; going
// higher is what triggers the commercial-use limit warning.
const DEFAULT_DAILY_SCRAPE_LIMIT = '400';

// ── CLI Flags ──
const RESUME_MODE = process.argv.includes('--resume');
const MANUAL_LOGIN_MODE = process.argv.includes('--login');
const CHECK_LOGIN_MODE = process.argv.includes('--check-login');
const accountArg = process.argv.indexOf('--account');
const ACCOUNT_ID = accountArg >= 0 ? process.argv[accountArg + 1] : null;
if (accountArg >= 0 && !/^(?:legacy-\d+|[a-f0-9-]{36})$/.test(ACCOUNT_ID || '')) throw new Error('Invalid worker account ID.');
let dbWorker = null;
let settleJobs = async () => {};
let latestStatus = { status: 'starting' };
let signedInIdentity = null;

// ── Ensure dirs exist ──
if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true });
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const LIMITS_FILE = path.join(DATA_DIR, 'worker-limits.json');
const WORKER_PID_FILE = path.join(DATA_DIR, ACCOUNT_ID ? `worker-${ACCOUNT_ID}.pid` : 'worker.pid');
let workerLockOwned = false;

function acquireWorkerLock() {
    if (!ACCOUNT_ID) {
        for (const name of ['worker-supervisor.pid', 'worker-legacy-0.pid']) {
            try {
                const pid = JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')).pid;
                if (Number.isInteger(pid) && isProcessRunning(pid)) { log('Account workers already manage this browser session. Use the dashboard account controls.'); return false; }
            } catch { /* no managed session */ }
        }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            fs.writeFileSync(WORKER_PID_FILE, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
            workerLockOwned = true;
            return true;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            let pid;
            try { pid = JSON.parse(fs.readFileSync(WORKER_PID_FILE, 'utf8')).pid; } catch { }
            if (!Number.isInteger(pid) || pid <= 0 || isProcessRunning(pid)) {
                log(`A worker is already running or starting. This duplicate will exit without launching Chrome.`);
                return false;
            }
            try { fs.unlinkSync(WORKER_PID_FILE); } catch { return false; }
        }
    }
    return false;
}

function releaseWorkerLock() {
    if (!workerLockOwned) return;
    try {
        if (JSON.parse(fs.readFileSync(WORKER_PID_FILE, 'utf8')).pid === process.pid) fs.unlinkSync(WORKER_PID_FILE);
    } catch { /* cleanup after process exit */ }
    workerLockOwned = false;
}
// Recovery net for nativePostProcess: a lead that's fully scraped/enriched but
// fails to save to the CRM (after retries) lands here instead of being lost.
const FAILED_PUSHES_DIR = path.join(RESULTS_DIR, 'failed-pushes');
if (!fs.existsSync(FAILED_PUSHES_DIR)) fs.mkdirSync(FAILED_PUSHES_DIR, { recursive: true });

// ── Load env ──
function loadEnv() {
    const envPath = path.join(__dirname, '.env.local');
    if (!fs.existsSync(envPath)) throw new Error('.env.local not found');
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const clean = line.replace(/\r/g, '');
        const match = clean.match(/^([^#=]+)=(.+)$/);
        if (!match) continue;
        // Strip surrounding quotes the way dotenv (and therefore Next.js) does.
        // Without this a quoted value is passed through with its quotes attached,
        // which silently corrupts anything parsed as a URL or JSON.
        const value = match[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
        process.env[match[1].trim()] = value;
    }
}

function getAccounts() {
    const raw = process.env.LINKEDIN_ACCOUNTS;
    if (!raw) throw new Error('LINKEDIN_ACCOUNTS not set in .env.local');
    return JSON.parse(raw);
}

async function startDatabaseAccount() {
    if (!ACCOUNT_ID) return;
    const core = require('./src/lib/linkedin-workers.cjs');
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 10000,
        ssl: process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n'), rejectUnauthorized: true } : { rejectUnauthorized: false } });
    const owner = require('node:crypto').randomUUID();
    await core.ensure(pool);
    const account = (await pool.query('SELECT *,login_requested_at::text AS login_request_token FROM compel_linkedin_accounts WHERE id=$1 AND archived IS FALSE', [ACCOUNT_ID])).rows[0];
    if (!account || !await core.acquireSession(pool, ACCOUNT_ID, owner)) { await pool.end(); return false; }
    dbWorker = { core, pool, owner, account, timer: null };
    process.env.LINKEDIN_ACCOUNTS = JSON.stringify([{ email: account.email, password: core.decrypt(account.secret) }]);
    if (MANUAL_LOGIN_MODE) await core.consumeLoginRequest(pool, ACCOUNT_ID, account.login_request_token);
    let updating = false;
    dbWorker.timer = setInterval(async () => {
        if (updating) return;
        updating = true;
        try { await core.heartbeat(pool, ACCOUNT_ID, owner, latestStatus); }
        catch { await shutdown('Database connection or account lease lost; jobs are retained.', 1); }
        finally { updating = false; }
    }, 20000);
    dbWorker.timer.unref();
    return true;
}
async function stopDatabaseAccount() {
    if (!dbWorker) return;
    clearInterval(dbWorker.timer);
    try { await dbWorker.core.releaseSession(dbWorker.pool, ACCOUNT_ID, dbWorker.owner, latestStatus); } catch { /* leases expire after a disconnected host */ }
    await dbWorker.pool.end();
    dbWorker = null;
}

// ── Utilities ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
/** Randomised pause. Fixed round-number delays are both slower than they need to
 *  be and more regular than a human, which is the worst of both. */
function jitter(min, max) { return sleep(min + Math.floor(Math.random() * (max - min))); }
function log(msg) { console.log(`[Worker] ${new Date().toLocaleTimeString()} — ${msg}`); }

// Recovery net: called when a CRM save fails after retries so the already-scraped
// lead data isn't just lost. Never throws — a dead-letter write failing shouldn't
// crash the job.
function writeDeadLetter(jobId, endpoint, payload) {
    try {
        const filePath = path.join(FAILED_PUSHES_DIR, `${jobId}.json`);
        fs.writeFileSync(filePath, JSON.stringify({ savedAt: new Date().toISOString(), endpoint, payload }, null, 2));
        log(`  [NativeFlow] 💾 Saved failed push to ${filePath} for manual recovery`);
    } catch (e) {
        log(`  [NativeFlow] ⚠️ Failed to write dead-letter for ${jobId}: ${e.message}`);
    }
}

function isRecentActivity(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ACTIVITY_DAYS_THRESHOLD);
    return d > cutoff;
}

// Vendor domains that show up in a site's own markup — payment widgets, CMS
// chrome, theme authors. An address here belongs to the platform, not the lead.
const THIRD_PARTY_MAIL_DOMAINS = [
    'surecart.com', 'jouwweb.nl', 'wix.com', 'squarespace.com', 'shopify.com',
    'wordpress.com', 'wordpress.org', 'godaddy.com', 'weebly.com', 'webflow.com',
    'carrd.co', 'notion.so', 'kajabi.com', 'teachable.com', 'thinkific.com',
    'systeme.io', 'clickfunnels.com', 'hubspot.com', 'mailchimp.com', 'calendly.com',
    'about.me', 'linktr.ee', 'stripe.com', 'paypal.com', 'zoom.us', 'acuityscheduling.com',
];

// Local parts that are a company's back office. Harmless on the lead's own domain
// (a solo operator's support@ is still them), but on someone else's domain they're
// unambiguously the vendor's.
const VENDOR_ROLE_LOCALS = [
    'support', 'privacy', 'legal', 'abuse', 'billing', 'notifications', 'notification',
    'noreply', 'no-reply', 'donotreply', 'security', 'compliance', 'help', 'helpdesk',
];

/**
 * Drops addresses that were scraped off a page but don't belong to the lead.
 * Emailing a vendor's support desk isn't a wasted send — it's a spam complaint
 * from a company with an abuse team.
 */
function rejectNonLeadEmails(emails, websiteDomain, logs) {
    const wd = (websiteDomain || '').toLowerCase();
    return emails.filter(email => {
        const [localRaw, domainRaw] = email.split('@');
        if (!localRaw || !domainRaw) return false;
        const local = localRaw.toLowerCase();
        const domain = domainRaw.toLowerCase();
        const onLeadDomain = Boolean(wd) && (domain === wd || domain.endsWith('.' + wd));

        if (THIRD_PARTY_MAIL_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
            logs?.push(`Rejected ${email}: third-party platform address, not the lead's`);
            return false;
        }
        if (!onLeadDomain && VENDOR_ROLE_LOCALS.includes(local)) {
            logs?.push(`Rejected ${email}: back-office address on a domain that isn't the lead's`);
            return false;
        }
        // Long digit runs never appear in a hand-written address; they're the
        // signature of a regex over-capture across concatenated page text.
        if (/\d{5,}/.test(local)) {
            logs?.push(`Rejected ${email}: looks like a mangled extraction`);
            return false;
        }
        return true;
    });
}

// ── Email Priority Scoring ──
function prioritizeEmails(emails, firstName, websiteDomain) {
    if (!emails || emails.length <= 1) return emails;
    const fn = (firstName || '').toLowerCase();
    const wd = (websiteDomain || '').toLowerCase();
    const scored = emails.map(email => {
        const [local, domain] = email.split('@');
        let priority = 50;
        // BEST: firstName@theirdomain.com
        if (wd && domain === wd && fn && local.toLowerCase().includes(fn)) priority = 10;
        // GREAT: hello/hi@theirdomain.com
        else if (wd && domain === wd && ['hello','hi','hey'].includes(local)) priority = 20;
        // GOOD: personal-looking email on their domain
        else if (wd && domain === wd && !['info','support','admin','billing','help','sales','team','office','noreply','no-reply'].includes(local)) priority = 25;
        // OK: info/contact on their domain
        else if (wd && domain === wd && ['info','contact'].includes(local)) priority = 35;
        // DECENT: personal Gmail/Yahoo
        else if (['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','protonmail.com'].includes(domain)) priority = 40;
        // MEH: support/admin
        else if (['support','admin','billing','help','sales','team','office'].includes(local)) priority = 80;
        return { email, priority };
    });
    scored.sort((a, b) => a.priority - b.priority);
    return scored.map(s => s.email);
}

// ── Startup: Handle stale queue ──
function handleStaleQueue() {
    const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) return;

    // Always resume in production. We do not want to wipe pending jobs on container restarts.
    log(`📂 Found ${files.length} pending job(s) in queue on startup. Resuming processing.`);
}

// ── Startup: Purge old result files ──
function purgeOldResults() {
    const cutoff = Date.now() - (RESULT_TTL_DAYS * 24 * 60 * 60 * 1000);
    const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json') && f !== 'worker-status.json');
    let purged = 0;
    for (const f of files) {
        try {
            const stat = fs.statSync(path.join(RESULTS_DIR, f));
            if (stat.mtimeMs < cutoff) {
                fs.unlinkSync(path.join(RESULTS_DIR, f));
                purged++;
            }
        } catch { /* ignore */ }
    }
    if (purged > 0) log(`🗑️  Purged ${purged} result file(s) older than ${RESULT_TTL_DAYS} days`);
}

// ── Write worker status ──
function writeStatus(status, extra = {}) {
    latestStatus = { status, qualificationVersion: QUALIFICATION_VERSION, accountId: ACCOUNT_ID, ...extra, signedIn: signedInIdentity, updatedAt: new Date().toISOString() };
    try {
        fs.writeFileSync(
            path.join(RESULTS_DIR, ACCOUNT_ID ? `worker-status-${ACCOUNT_ID}.json` : 'worker-status.json'),
            JSON.stringify(latestStatus)
        );
    } catch { /* non-fatal */ }
}

// ── HTTP fetch utility (used by website scraper + fallback chain) ──
const https = require('https');
const http = require('http');
const fetchPage = (url, timeout = 10000, redirectCount = 0) => {
    return new Promise((resolve, reject) => {
        if (redirectCount >= 5) return reject(new Error('Too many redirects'));

        let req;
        const hardTimeout = setTimeout(() => {
            if (req) req.destroy();
            reject(new Error('Hard Timeout'));
        }, timeout + 5000);

        const done = (err, res) => {
            clearTimeout(hardTimeout);
            if (err) reject(err);
            else resolve(res);
        };

        const lib = url.startsWith('https') ? https : http;
        req = lib.get(url, {
            timeout,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                let redirect = res.headers.location;
                if (redirect.startsWith('/')) redirect = new URL(redirect, url).href;
                fetchPage(redirect, timeout, redirectCount + 1).then(data => done(null, data)).catch(done);
                return;
            }
            let data = '';
            res.on('data', chunk => {
                data += chunk;
                if (data.length > 5 * 1024 * 1024) {
                    req.destroy();
                    done(new Error('Response too large'));
                }
            });
            res.on('end', () => done(null, data));
            res.on('error', done);
        });
        req.on('error', done);
        req.on('timeout', () => { req.destroy(); done(new Error('Timeout')); });
    });
};

// ── Webhook callback to n8n ──
async function fireWebhook(webhookUrl, payload, maxRetries = 3) {
    const body = JSON.stringify(payload);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await new Promise((resolve, reject) => {
                const url = new URL(webhookUrl);
                const lib = url.protocol === 'https:' ? https : http;
                const req = lib.request({
                    hostname: url.hostname,
                    port: url.port || (url.protocol === 'https:' ? 443 : 80),
                    path: url.pathname + url.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body),
                    },
                    timeout: 10000,
                }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve({ status: res.statusCode, data }));
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
                req.write(body);
                req.end();
            });
            if (result.status >= 200 && result.status < 300) {
                log(`  [Webhook] ✅ Delivered to n8n (attempt ${attempt})`);
                return true;
            }
            log(`  [Webhook] HTTP ${result.status} (attempt ${attempt}/${maxRetries})`);
        } catch (e) {
            log(`  [Webhook] Failed: ${e.message} (attempt ${attempt}/${maxRetries})`);
        }
        if (attempt < maxRetries) await sleep(1000 * Math.pow(2, attempt - 1));
    }
    log(`  [Webhook] ❌ All ${maxRetries} attempts failed — result saved to disk only`);
    return false;
}

// ── Website email scraping (Puppeteer-powered with HTTP fallback) ──

// Shared email extraction helpers (used by both Puppeteer and HTTP paths)
const emailExtractHelpers = {
    extractEmails: (text) => {
        const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const badTlds = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico',
            'css', 'js', 'json', 'xml', 'html', 'htm', 'php', 'asp', 'woff', 'woff2',
            'ttf', 'eot', 'otf', 'mp4', 'mp3', 'pdf', 'zip', 'doc', 'docx'];
        return [...new Set((text.match(regex) || []).map(e => e.toLowerCase()))]
            .filter(e => !badTlds.includes(e.split('.').pop()));
    },

    isPlaceholder: (email) => {
        const skip = ['example.com', 'test.com', 'email.com', 'domain.com', 'yoursite.com',
            'sentry.io', 'wixpress.com', 'squarespace.com', 'wordpress.com', 'w3.org',
            'schema.org', 'googleusercontent.com', 'gstatic.com', 'gravatar.com',
            'bootstrapcdn.com', 'jsdelivr.net', 'cloudflare.com', 'google.com',
            'facebook.com', 'twitter.com', 'github.com'];
        const emailDomain = email.split('@')[1] || '';
        return skip.some(d => emailDomain === d || emailDomain.endsWith('.' + d)) || email.startsWith('noreply') || email.startsWith('no-reply');
    },

    stripHtml: (html) => html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s+/g, ' '),

    decodeCfEmail: (encoded) => {
        try {
            const r = parseInt(encoded.substr(0, 2), 16);
            let email = '';
            for (let i = 2; i < encoded.length; i += 2) {
                email += String.fromCharCode(parseInt(encoded.substr(i, 2), 16) ^ r);
            }
            return email;
        } catch { return null; }
    },

    extractAllFromHtml: (html, text, emails) => {
        // mailto: links (including with query params like ?subject=...)
        const mailtoRegex = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?:\?|"|'| |&|;|$)/gi;
        let m;
        while ((m = mailtoRegex.exec(html)) !== null) emails.add(m[1].toLowerCase());

        // Plain text emails
        for (const e of emailExtractHelpers.extractEmails(text)) emails.add(e);
        for (const e of emailExtractHelpers.extractEmails(html)) emails.add(e);

        // Obfuscated: name [at] domain [dot] com
        const obfRegex = /([a-zA-Z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\{at\}|\bat\b)\s*([a-zA-Z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\{dot\}|\bdot\b)\s*([a-zA-Z]{2,6})/gi;
        while ((m = obfRegex.exec(text)) !== null) emails.add(`${m[1]}@${m[2]}.${m[3]}`.toLowerCase());

        // Cloudflare email protection
        const cfRegex = /\/cdn-cgi\/l\/email-protection#([a-f0-9]+)/gi;
        while ((m = cfRegex.exec(html)) !== null) { const dec = emailExtractHelpers.decodeCfEmail(m[1]); if (dec) emails.add(dec.toLowerCase()); }
        const dataRegex = /data-cfemail="([a-f0-9]+)"/gi;
        while ((m = dataRegex.exec(html)) !== null) { const dec = emailExtractHelpers.decodeCfEmail(m[1]); if (dec) emails.add(dec.toLowerCase()); }

        // Custom data attributes: data-email, data-contact, data-address, data-mail
        const dataEmailRegex = /data-(?:email|contact|address|mail)\s*=\s*["']([^"']+@[^"']+)["']/gi;
        while ((m = dataEmailRegex.exec(html)) !== null) emails.add(m[1].toLowerCase().replace(/^mailto:/i, ''));

        // onclick/href attributes with email content
        const onclickRegex = /(?:onclick|data-href)\s*=\s*["'][^"']*?([\w._%+-]+@[\w.-]+\.[\w]{2,})[^"']*?["']/gi;
        while ((m = onclickRegex.exec(html)) !== null) emails.add(m[1].toLowerCase());

        // JSON-LD structured data (Squarespace, Wix, WordPress)
        const ldJsonRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let ldMatch;
        while ((ldMatch = ldJsonRegex.exec(html)) !== null) {
            try {
                const json = JSON.parse(ldMatch[1].trim());
                const walkJson = (obj, depth = 0) => {
                    if (depth > 10 || !obj || typeof obj !== 'object') return;
                    for (const [key, val] of Object.entries(obj)) {
                        if ((key === 'email' || key === 'contactPoint') && typeof val === 'string' && val.includes('@')) {
                            const clean = val.replace(/^mailto:/i, '').toLowerCase().trim();
                            if (!emailExtractHelpers.isPlaceholder(clean)) emails.add(clean);
                        }
                        if (typeof val === 'object') walkJson(val, depth + 1);
                    }
                };
                walkJson(json);
            } catch { /* invalid JSON-LD */ }
        }

        // HTML entity obfuscation decode (&#106;&#111;&#104;&#110;&#64;...)
        const entityRegex = /(&#\d{2,3};){5,}/g;
        const entityMatches = html.match(entityRegex) || [];
        for (const encoded of entityMatches) {
            const decoded = encoded.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
            for (const e of emailExtractHelpers.extractEmails(decoded)) { if (!emailExtractHelpers.isPlaceholder(e)) emails.add(e); }
        }

        // Meta tags with email content
        const metaRegex = /<meta[^>]*content\s*=\s*["']([^"']*@[^"']+)["'][^>]*>/gi;
        while ((m = metaRegex.exec(html)) !== null) {
            for (const e of emailExtractHelpers.extractEmails(m[1])) { if (!emailExtractHelpers.isPlaceholder(e)) emails.add(e); }
        }
    }
};

// Priority paths to check (expanded from original 7 to cover more patterns)
const CONTACT_PATHS = [
    '/contact', '/contact-us', '/about', '/about-me', '/about-us',
    '/get-in-touch', '/work-with-me', '/connect', '/reach-out',
    '/lets-talk', '/lets-connect', '/hire-me', '/booking',
    '/schedule', '/services', '/support', '/help',
    '/team', '/start', '/inquiry', '/enquiry'
];

// Priority keywords for internal link sorting
const LINK_PRIORITY = ['contact', 'about', 'team', 'connect', 'reach', 'get-in-touch',
    'info', 'work-with', 'hire', 'booking', 'schedule', 'support', 'help', 'inquiry'];

// ── Puppeteer-based website scraper (renders JavaScript) ──
async function scrapeWebsiteWithBrowser(browserInstance, websiteUrl) {
    const baseUrl = websiteUrl.replace(/\/$/, '');
    const domain = baseUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].toLowerCase();
    const emails = new Set();
    const crawled = new Set();
    let context = null;

    try {
        // Create incognito context to avoid leaking LinkedIn cookies
        context = await browserInstance.createBrowserContext();
        const page = await context.newPage();

        // Set reasonable viewport and user agent
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Block heavy resources to speed up loading
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Helper: navigate to a URL and extract HTML + text
        const scrapePage = async (url, timeout = 15000) => {
            try {
                // networkidle2 waits out analytics beacons, chat widgets and ad
                // pixels that never settle on a typical marketing site — 10-30s for
                // markup that was complete in two. The contact details we want are
                // in the DOM at domcontentloaded; a short settle covers the rest.
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
                await sleep(600);

                const html = await page.content();
                const text = await page.evaluate(() => document.body ? document.body.innerText : '');

                // Also extract emails that Puppeteer can see in the rendered DOM
                const domEmails = await page.evaluate(() => {
                    const found = [];
                    // All mailto: links
                    document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
                        const email = a.href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
                        if (email && email.includes('@')) found.push(email);
                    });
                    // data-email and similar attributes
                    document.querySelectorAll('[data-email], [data-contact], [data-mail], [data-address]').forEach(el => {
                        const val = el.getAttribute('data-email') || el.getAttribute('data-contact') ||
                                    el.getAttribute('data-mail') || el.getAttribute('data-address') || '';
                        if (val.includes('@')) found.push(val.toLowerCase());
                    });
                    // Cloudflare email protection — decode in browser context
                    document.querySelectorAll('[data-cfemail]').forEach(el => {
                        try {
                            const enc = el.getAttribute('data-cfemail');
                            if (!enc) return;
                            const r = parseInt(enc.substr(0, 2), 16);
                            let decoded = '';
                            for (let i = 2; i < enc.length; i += 2) {
                                decoded += String.fromCharCode(parseInt(enc.substr(i, 2), 16) ^ r);
                            }
                            if (decoded.includes('@')) found.push(decoded.toLowerCase());
                        } catch {}
                    });
                    // Footer text specifically (high-value area for emails)
                    const footer = document.querySelector('footer');
                    if (footer) {
                        const footerText = footer.innerText || '';
                        const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
                        const matches = footerText.match(re) || [];
                        matches.forEach(m => found.push(m.toLowerCase()));
                    }
                    return found;
                });

                for (const e of domEmails) emails.add(e);
                return { html, text };
            } catch (e) {
                log(`  [BrowserScrape] Failed to load ${url}: ${e.message}`);
                return null;
            }
        };

        // ── Step 1: Scrape homepage ──
        log(`  [BrowserScrape] Loading homepage: ${baseUrl}`);
        const homepage = await scrapePage(baseUrl);
        if (!homepage || homepage.html.length < 200) {
            log(`  [BrowserScrape] Homepage too small or failed, falling back to HTTP`);
            if (context) await context.close().catch(() => {});
            return null; // Signal to fall back to HTTP
        }
        crawled.add(baseUrl);
        emailExtractHelpers.extractAllFromHtml(homepage.html, homepage.text, emails);

        // ── Step 2: Find internal links from homepage ──
        const internalLinks = await page.evaluate((baseDomain) => {
            const links = [];
            document.querySelectorAll('a[href]').forEach(a => {
                let href = a.href;
                if (!href || href.startsWith('mailto:') || href.startsWith('tel:') ||
                    href.startsWith('javascript:') || href.startsWith('data:')) return;
                if (href.match(/\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|woff|mp4|zip|webp)$/i)) return;
                try {
                    const url = new URL(href);
                    const linkDomain = url.hostname.replace(/^www\./, '').toLowerCase();
                    if (linkDomain !== baseDomain && linkDomain !== 'www.' + baseDomain) return;
                    const clean = url.origin + url.pathname.replace(/\/$/, '');
                    links.push(clean);
                } catch {}
            });
            return [...new Set(links)];
        }, domain);

        // Also grab footer links specifically (often have contact pages not in main nav)
        const footerLinks = await page.evaluate((baseDomain) => {
            const footer = document.querySelector('footer');
            if (!footer) return [];
            const links = [];
            footer.querySelectorAll('a[href]').forEach(a => {
                let href = a.href;
                if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) return;
                try {
                    const url = new URL(href);
                    const linkDomain = url.hostname.replace(/^www\./, '').toLowerCase();
                    if (linkDomain !== baseDomain && linkDomain !== 'www.' + baseDomain) return;
                    links.push(url.origin + url.pathname.replace(/\/$/, ''));
                } catch {}
            });
            return [...new Set(links)];
        }, domain);

        // Merge and deduplicate, prioritize contact-related pages
        const allLinks = [...new Set([...footerLinks, ...internalLinks])].filter(l => !crawled.has(l) && l !== baseUrl);
        allLinks.sort((a, b) => {
            const aScore = LINK_PRIORITY.findIndex(p => a.toLowerCase().includes(p));
            const bScore = LINK_PRIORITY.findIndex(p => b.toLowerCase().includes(p));
            return (aScore === -1 ? 99 : aScore) - (bScore === -1 ? 99 : bScore);
        });

        // ── Step 3: Crawl top priority internal links ──
        // Links are already sorted contact-first, so the tail of a long list is
        // almost never where an address hides — it just costs page loads.
        for (const pageUrl of allLinks.slice(0, 6)) {
            if (emails.size > 0) {
                // Already found emails — no need to crawl more aggressively
                // But still check 1-2 more contact-type pages for better emails
                const isContactPage = LINK_PRIORITY.slice(0, 5).some(p => pageUrl.toLowerCase().includes(p));
                if (!isContactPage) continue;
            }
            crawled.add(pageUrl);
            const pageResult = await scrapePage(pageUrl, 12000);
            if (pageResult) {
                emailExtractHelpers.extractAllFromHtml(pageResult.html, pageResult.text, emails);
                log(`  [BrowserScrape] Crawled: ${pageUrl} (${emails.size} emails so far)`);
            }
        }

        // ── Step 4: Blind-guess common contact paths not yet visited ──
        for (const guessPath of CONTACT_PATHS) {
            const guessUrl = baseUrl + guessPath;
            if (crawled.has(guessUrl)) continue;
            // If we already have emails, only try the top 3 paths
            if (emails.size > 0 && CONTACT_PATHS.indexOf(guessPath) > 2) continue;

            crawled.add(guessUrl);
            const guessResult = await scrapePage(guessUrl, 8000);
            if (guessResult && guessResult.html.length > 500) {
                emailExtractHelpers.extractAllFromHtml(guessResult.html, guessResult.text, emails);
                log(`  [BrowserScrape] Blind guess hit: ${guessPath} (${emails.size} emails so far)`);
            }
        }

        // Close the incognito context
        await context.close().catch(() => {});
        context = null;

        // ── Step 5: Filter and MX-verify ──
        const candidateEmails = [...emails].filter(e => e.includes('@') && !emailExtractHelpers.isPlaceholder(e));
        log(`  [BrowserScrape] Raw: ${emails.size}, after filter: ${candidateEmails.length} → ${candidateEmails.join(', ') || 'none'}`);

        const dns = require('dns').promises;
        const verifiedEmails = [];
        // Parallelize MX lookups for speed
        const mxResults = await Promise.allSettled(candidateEmails.map(async (email) => {
            const emailDomain = email.split('@')[1];
            try {
                const records = await dns.resolveMx(emailDomain);
                if (records && records.length > 0) return { email, ok: true };
            } catch { /* MX failed, try A record fallback per RFC 5321 */ }
            try {
                const aRecords = await dns.resolve4(emailDomain);
                if (aRecords && aRecords.length > 0) return { email, ok: true, fallback: true };
            } catch { /* A record also failed */ }
            return { email, ok: false };
        }));
        for (const r of mxResults) {
            if (r.status === 'fulfilled' && r.value.ok) {
                verifiedEmails.push(r.value.email);
                log(`  [BrowserScrape] MX verified${r.value.fallback ? ' (A-record)' : ''}: ${r.value.email}`);
            } else if (r.status === 'fulfilled') {
                log(`  [BrowserScrape] MX failed (no records): ${r.value.email}`);
            }
        }
        log(`  [BrowserScrape] Final verified: ${verifiedEmails.length}`);
        return verifiedEmails;

    } catch (e) {
        log(`  [BrowserScrape] Fatal: ${e.message}`);
        if (context) await context.close().catch(() => {});
        return null; // Signal to fall back to HTTP
    }
}

// ── HTTP fallback scraper (original logic, improved) ──
async function scrapeWebsiteForEmails(websiteUrl) {
    try {
        const baseUrl = websiteUrl.replace(/\/$/, '');
        const domain = baseUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].toLowerCase();
        let allText = '';
        let allHtml = '';
        const crawled = new Set();

        let homepageHtml = '';
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                homepageHtml = await fetchPage(baseUrl, 20000);
                break;
            } catch (e) {
                if (attempt === 0) {
                    log(`  [EmailScrape] Attempt 1 failed for ${baseUrl}: ${e.message}, retrying...`);
                    await sleep(2000);
                } else {
                    log(`  [EmailScrape] Attempt 2 failed for ${baseUrl}: ${e.message}`);
                    return [];
                }
            }
        }
        if (!homepageHtml || homepageHtml.length < 100) return [];
        log(`  [EmailScrape] Homepage: ${homepageHtml.length} bytes from ${baseUrl}`);

        crawled.add(baseUrl);
        allText += ' ' + emailExtractHelpers.stripHtml(homepageHtml);
        allHtml += homepageHtml;

        const hrefRegex = /href=["']([^"'#]+)["']/gi;
        const internalLinks = [];
        let hrefMatch;
        while ((hrefMatch = hrefRegex.exec(homepageHtml)) !== null) {
            let href = hrefMatch[1].trim();
            if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:') || href.startsWith('//') || href.startsWith('data:')) continue;
            if (href.match(/\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|mp4|zip|webp)$/i)) continue;
            if (href.startsWith('/')) href = baseUrl + href;
            else if (!href.startsWith('http')) href = baseUrl + '/' + href;
            try {
                const linkDomain = href.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].toLowerCase();
                if (linkDomain !== domain && linkDomain !== 'www.' + domain) continue;
            } catch { continue; }
            href = href.replace(/\/$/, '').split('?')[0].split('#')[0];
            if (!crawled.has(href) && href !== baseUrl) {
                internalLinks.push(href);
                crawled.add(href);
            }
        }

        // Also extract footer links from HTML
        const footerMatch = homepageHtml.match(/<footer[\s\S]*?<\/footer>/i);
        if (footerMatch) {
            const footerHrefRegex = /href=["']([^"'#]+)["']/gi;
            let fMatch;
            while ((fMatch = footerHrefRegex.exec(footerMatch[0])) !== null) {
                let href = fMatch[1].trim();
                if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
                if (href.startsWith('/')) href = baseUrl + href;
                else if (!href.startsWith('http')) href = baseUrl + '/' + href;
                try {
                    const linkDomain = href.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].toLowerCase();
                    if (linkDomain !== domain && linkDomain !== 'www.' + domain) continue;
                } catch { continue; }
                href = href.replace(/\/$/, '').split('?')[0].split('#')[0];
                if (!crawled.has(href) && href !== baseUrl && !internalLinks.includes(href)) {
                    internalLinks.unshift(href); // Footer links get priority
                    crawled.add(href);
                }
            }
            // Also extract emails directly from footer HTML
            allText += ' ' + emailExtractHelpers.stripHtml(footerMatch[0]);
        }

        internalLinks.sort((a, b) => {
            const aScore = LINK_PRIORITY.findIndex(p => a.toLowerCase().includes(p));
            const bScore = LINK_PRIORITY.findIndex(p => b.toLowerCase().includes(p));
            return (aScore === -1 ? 99 : aScore) - (bScore === -1 ? 99 : bScore);
        });

        for (const pageUrl of internalLinks.slice(0, 12)) {
            try {
                const pageHtml = await fetchPage(pageUrl, 15000);
                if (pageHtml && pageHtml.length > 100) {
                    allText += ' ' + emailExtractHelpers.stripHtml(pageHtml);
                    allHtml += pageHtml;
                }
            } catch { /* skip */ }
        }

        // Blind-guess common contact pages (parallel batches of 5 for speed)
        const guessUrls = CONTACT_PATHS.map(p => ({ path: p, url: baseUrl + p })).filter(g => !crawled.has(g.url));
        for (let gi = 0; gi < guessUrls.length; gi += 5) {
            // Stop once we actually have an address. The browser crawler already bails
            // after three blind paths; this loop fired all 21 regardless, because
            // extraction only happens after every fetch is done. Re-probing what we
            // have costs local CPU — the paths it lets us skip cost network round
            // trips, and this is the single largest per-lead expense in the worker.
            if (gi > 0) {
                const soFar = new Set();
                emailExtractHelpers.extractAllFromHtml(allHtml, allText, soFar);
                if ([...soFar].some(e => e.includes('@') && !emailExtractHelpers.isPlaceholder(e))) {
                    log(`  [EmailScrape] Address already found — skipping ${guessUrls.length - gi} remaining blind path(s)`);
                    break;
                }
            }
            const batch = guessUrls.slice(gi, gi + 5);
            const results = await Promise.allSettled(batch.map(async (g) => {
                try {
                    const html = await fetchPage(g.url, 6000);
                    return { path: g.path, url: g.url, html: (html && html.length > 500) ? html : null };
                } catch { return { path: g.path, url: g.url, html: null }; }
            }));
            for (const r of results) {
                if (r.status === 'fulfilled' && r.value.html) {
                    crawled.add(r.value.url);
                    allText += ' ' + emailExtractHelpers.stripHtml(r.value.html);
                    allHtml += r.value.html;
                    log(`  [EmailScrape] Blind guess hit: ${r.value.path}`);
                }
            }
        }

        const emails = new Set();
        emailExtractHelpers.extractAllFromHtml(allHtml, allText, emails);

        const candidateEmails = [...emails].filter(e => e.includes('@') && !emailExtractHelpers.isPlaceholder(e));
        log(`  [EmailScrape] Raw emails found: ${emails.size}, after filter: ${candidateEmails.length} → ${candidateEmails.join(', ') || 'none'}`);
        const dns = require('dns').promises;
        const verifiedEmails = [];
        // Parallelize MX lookups for speed
        const mxResults = await Promise.allSettled(candidateEmails.map(async (email) => {
            const emailDomain = email.split('@')[1];
            try {
                const records = await dns.resolveMx(emailDomain);
                if (records && records.length > 0) return { email, ok: true };
            } catch { /* MX failed, try A record fallback per RFC 5321 */ }
            try {
                const aRecords = await dns.resolve4(emailDomain);
                if (aRecords && aRecords.length > 0) return { email, ok: true, fallback: true };
            } catch { /* A record also failed */ }
            return { email, ok: false };
        }));
        for (const r of mxResults) {
            if (r.status === 'fulfilled' && r.value.ok) {
                verifiedEmails.push(r.value.email);
                log(`  [EmailScrape] MX verified${r.value.fallback ? ' (A-record)' : ''}: ${r.value.email}`);
            } else if (r.status === 'fulfilled') {
                log(`  [EmailScrape] MX failed (no records): ${r.value.email}`);
            }
        }
        log(`  [EmailScrape] Final verified: ${verifiedEmails.length}`);
        return verifiedEmails;
    } catch (e) { log(`  [EmailScrape] Fatal: ${e.message}`); return []; }
}


// ── Voyager API call via browser fetch() ──
async function voyagerFetch(page, apiPath) {
    return await page.evaluate(async (p) => {
        try {
            const csrfMatch = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
            const csrf = csrfMatch ? csrfMatch[1] : '';
            const res = await fetch(`https://www.linkedin.com${p}`, {
                headers: {
                    'accept': 'application/vnd.linkedin.normalized+json+2.1',
                    'x-restli-protocol-version': '2.0.0',
                    'x-li-lang': 'en_US',
                    'csrf-token': csrf,
                },
                credentials: 'include',
                signal: AbortSignal.timeout(15000),
            });
            if (res.status === 200) return { status: 200, data: await res.json() };
            return { status: res.status };
        } catch (e) { return { status: 0, error: e.message }; }
    }, apiPath);
}

// ── Scrape a single profile via Voyager API ──
async function scrapeProfile(page, profileUrl, browserInstance) {
    const result = {
        url: profileUrl, firstName: '', lastName: '', headline: '',
        activityStatus: 'Unknown', emails: [], websites: [],
        website: '', primaryEmail: '', websiteSource: '',
        emailSource: '',
        latestPostText: '',
        about: '', profileLocation: '', profileIdentityConfirmed: false, lastActivityAt: null,
        status: 'PENDING', logs: [],
    };
    const slug = profileUrl.replace(/\/+$/, '').split('/').pop().split('?')[0];

    try {
        // ── 1. Contact Info (website + email) ──
        result.logs.push('Fetching contact info via Voyager API...');
        let contactRes = await voyagerFetch(page, `/voyager/api/identity/profiles/${slug}/profileContactInfo`);
        if (contactRes.status !== 200) {
            await sleep(1000);
            contactRes = await voyagerFetch(page, `/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${slug}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.ProfileContactInfo-14`);
        }

        if (contactRes.status === 200) {
            const data = extractProfileContactInfo(contactRes.data, slug);
            const websites = Array.isArray(data.websites) ? data.websites : [];
            const emailAddress = data.emailAddress || null;
            result.websites = websites.map(w => (typeof w === 'string' ? w : (w.url || w.label || ''))).filter(Boolean);
            if (emailAddress) {
                const email = typeof emailAddress === 'string' ? emailAddress : (emailAddress.emailAddress || emailAddress.email || '');
                if (email) { result.emails.push(email); result.emailSource = 'linkedin'; }
            }
            if (result.websites.length > 0) result.website = result.websites[0];
            result.logs.push(`Contact: ${result.websites.length} website(s), ${result.emails.length} email(s)`);
        } else {
            result.logs.push(`Contact info failed: ${contactRes.status}`);
        }

        await jitter(180, 520);

        // ── 2. Profile Data (name, headline, URN) ──
        result.logs.push('Fetching profile data via Voyager API...');
        let profileRes = await voyagerFetch(page, `/voyager/api/identity/profiles/${slug}/profileView`);
        if (profileRes.status !== 200) {
            await sleep(1000);
            profileRes = await voyagerFetch(page, `/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${slug}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101`);
        }

        let profileUrn = null;
        if (profileRes.status === 200) {
            const item = extractMatchingProfile(profileRes.data, slug);
            if (item) {
                result.profileIdentityConfirmed = true;
                result.firstName = item.firstName || '';
                result.lastName = item.lastName || '';
                result.headline = item.headline || item.occupation || '';
                result.about = item.summary || item.about || '';
                result.profileLocation = extractProfileLocation(profileRes.data, slug);
                const urnMatch = JSON.stringify(item).match(/urn:li:(?:fsd_profile|fs_profile|fs_miniProfile):(ACoA[a-zA-Z0-9_-]+)/);
                if (urnMatch) profileUrn = `urn:li:fsd_profile:${urnMatch[1]}`;
                result.logs.push(`Name: ${result.firstName} ${result.lastName} (profile identity matched)`);
                result.logs.push(result.profileLocation ? `Profile location: ${result.profileLocation}` : 'Profile location was not returned; target market remains unconfirmed.');
            } else {
                result.logs.push('Requested profile identity could not be matched; referenced members were not substituted.');
            }
        } else {
            result.logs.push(`Profile data failed: ${profileRes.status}`);
        }

        await jitter(180, 520);

        // ── Website Fallback Chain (if contact modal had no website) ──
        if (result.websites.length === 0) {
            result.logs.push('No website in contact info — trying fallback chain...');

            // Layer 2: Parse About/Summary section for URLs
            if (profileRes.status === 200) {
                for (const summary of [result.about]) {
                    if (summary) {
                        const urlRegex = /https?:\/\/[^\s"'<>)\]]+/gi;
                        const aboutUrls = (summary.match(urlRegex) || [])
                            .filter(u => !u.includes('linkedin.com') && !u.includes('licdn.com'))
                            .map(u => u.replace(/[.,;:!?)]+$/, ''));
                        if (aboutUrls.length > 0) {
                            result.websites.push(...aboutUrls);
                            result.website = aboutUrls[0];
                            result.websiteSource = 'about_section';
                            result.logs.push(`Fallback L2: Found ${aboutUrls.length} URL(s) in About section`);
                        }
                    }
                }
            }

            // Layer 3: Featured section links
            if (result.websites.length === 0) {
                try {
                    const featuredRes = await voyagerFetch(page, `/voyager/api/identity/profiles/${slug}/featuredContent`);
                    if (featuredRes.status === 200) {
                        const fStr = JSON.stringify(featuredRes.data);
                        const fUrlRegex = /https?:\/\/[^\s"'<>\\]+/g;
                        const featuredUrls = (fStr.match(fUrlRegex) || [])
                            .filter(u => !u.includes('linkedin.com') && !u.includes('licdn.com')
                                      && !u.includes('media.licdn') && !u.includes('static.licdn'))
                            .map(u => u.replace(/[\\"',]+$/, ''));
                        const uniqueFeatured = [...new Set(featuredUrls)];
                        if (uniqueFeatured.length > 0) {
                            result.websites.push(...uniqueFeatured.slice(0, 3));
                            result.website = uniqueFeatured[0];
                            result.websiteSource = 'featured_section';
                            result.logs.push(`Fallback L3: Found ${uniqueFeatured.length} URL(s) in Featured section`);
                        }
                    }
                } catch (e) { result.logs.push(`Fallback L3 failed: ${e.message}`); }
                await jitter(250, 700);
            }

            // Layer 4: Domain name guessing (firstName + lastName .com)
            if (result.websites.length === 0 && result.firstName) {
                const fn = result.firstName.toLowerCase().replace(/[^a-z]/g, '');
                const ln = (result.lastName || '').toLowerCase().replace(/[^a-z]/g, '');
                const domainGuesses = [];
                if (fn && ln) {
                    domainGuesses.push(`${fn}${ln}.com`, `${fn}-${ln}.com`);
                }
                if (fn) {
                    domainGuesses.push(`${fn}coaching.com`, `coach${fn}.com`, `the${fn}.com`);
                }
                const dns = require('dns').promises;
                for (const domain of domainGuesses) {
                    try {
                        await dns.resolve(domain);
                        // Domain exists — verify it returns real HTML
                        const testUrl = `https://${domain}`;
                        const testHtml = await fetchPage(testUrl, 5000).catch(() => null);
                        if (testHtml && testHtml.length > 500) {
                            result.websites.push(testUrl);
                            result.website = testUrl;
                            result.websiteSource = 'domain_guess';
                            result.logs.push(`Fallback L4: Guessed domain ${domain} exists!`);
                            break;
                        }
                    } catch { /* domain doesn't exist */ }
                }
            }
        } else {
            result.websiteSource = 'contact_modal';
        }

        // ── 3. Activity Check ──
        if (profileUrn) {
            result.logs.push('Checking activity via Voyager API...');
            const actRes = await voyagerFetch(page,
                `/voyager/api/identity/profileUpdatesV2?count=10&includeLongTermHistory=true&moduleKey=creator_profile_all_content_view%3Adesktop&numComments=0&numLikes=0&profileUrn=${encodeURIComponent(profileUrn)}&q=memberShareFeed`
            );
            if (actRes.status === 200) {
                const str = JSON.stringify(actRes.data);

                // Method 1: Extract activity URN snowflake IDs (most reliable)
                const activityUrns = str.match(/urn:li:activity:(\d+)/g) || [];
                const urnDates = [];
                for (const urn of activityUrns) {
                    try {
                        const id = BigInt(urn.match(/\d+/)[0]);
                        const tsMs = Number(id >> BigInt(22));
                        const d = new Date(tsMs);
                        if (d.getFullYear() > 2015 && d.getFullYear() < 2100) urnDates.push(d);
                    } catch {}
                }

                // Method 2: Extract timestamp fields
                const timestamps = [];
                let m;
                const regex = /"(?:createdAt|postedAt|publishedAt|lastModifiedAt)"\s*:\s*(\d{13})/g;
                while ((m = regex.exec(str)) !== null) timestamps.push(parseInt(m[1]));

                // Method 3: Check paging metadata (if elements exist, there's activity)
                const hasElements = str.includes('"elements"') && !str.includes('"elements":[]');

                log(`  [Activity] URN dates: ${urnDates.length}, Timestamp fields: ${timestamps.length}, Has elements: ${hasElements}, Response size: ${str.length}`);

                if (urnDates.length > 0) {
                    urnDates.sort((a, b) => b - a);
                    const days = Math.floor((Date.now() - urnDates[0].getTime()) / 86400000);
                    result.activityStatus = days <= ACTIVITY_DAYS_THRESHOLD ? 'Active' : 'Inactive';
                    result.lastActivityAt = urnDates[0].toISOString();
                    result.logs.push(`Latest post (URN): ${urnDates[0].toISOString().slice(0,10)} (${days} days ago) → ${result.activityStatus}`);
                } else if (timestamps.length > 0) {
                    timestamps.sort((a, b) => b - a);
                    const days = Math.floor((Date.now() - timestamps[0]) / 86400000);
                    result.activityStatus = days <= ACTIVITY_DAYS_THRESHOLD ? 'Active' : 'Inactive';
                    result.lastActivityAt = new Date(timestamps[0]).toISOString();
                    result.logs.push(`Latest post (timestamp): ${days} days ago → ${result.activityStatus}`);
                } else if (hasElements) {
                    result.activityStatus = 'Unknown';
                    result.logs.push('Activity elements found without a reliable date; freshness remains unknown');
                } else {
                    result.activityStatus = 'Inactive';
                    result.logs.push('No posts found → Inactive');
                }

                // ── Extract latest post text for hook generation ──
                try {
                    const postTexts = [];

                    // Helper to deeply extract text from a commentary object
                    function extractTextFrom(val) {
                        if (typeof val === 'string') return val;
                        if (val && typeof val === 'object') {
                            if (val.text && typeof val.text.text === 'string') return val.text.text;
                            if (typeof val.text === 'string') return val.text;
                        }
                        return null;
                    }

                    // Recursively search the entire activity response for post commentary
                    function searchForCommentary(obj) {
                        if (!obj || typeof obj !== 'object') return;
                        if (Array.isArray(obj)) {
                            for (const item of obj) searchForCommentary(item);
                            return;
                        }

                        // Skip actor/profile objects to avoid grabbing headlines
                        const type = (obj.$type || obj['$type'] || '').toLowerCase();
                        if (type.includes('profile') || type.includes('actor') || type.includes('member')) return;

                        for (const [key, value] of Object.entries(obj)) {
                            if (key === 'commentary' || key === 'shareCommentary') {
                                const txt = extractTextFrom(value);
                                if (txt && txt.length > 50) postTexts.push(txt);
                            } else {
                                searchForCommentary(value);
                            }
                        }
                    }

                    if (actRes.data) {
                        searchForCommentary(actRes.data);
                    }

                    if (postTexts.length > 0) {
                        // Take the longest post (usually the most substantive)
                        postTexts.sort((a, b) => b.length - a.length);
                        result.latestPostText = postTexts[0].substring(0, 2000);
                        result.logs.push(`Captured latest post text (${result.latestPostText.length} chars)`);
                    } else {
                        result.logs.push('No post text found in activity feed');
                    }
                } catch (postExtractErr) {
                    result.logs.push(`Post text extraction failed: ${postExtractErr.message}`);
                }
            } else {
                result.activityStatus = 'Unknown';
                result.logs.push(`Activity check failed: ${actRes.status}`);
            }
        } else {
            result.activityStatus = 'Unknown';
            result.logs.push('No URN — cannot check activity');
        }

        // Website crawling, email guessing and final scoring happen in
        // enrichAndFinalize() instead of here. Those steps need no LinkedIn
        // session, so running them inline would hold the (rate-limited, ban-prone)
        // LinkedIn tab open while an unrelated marketing site loads — the single
        // slowest thing this worker does.
        result.status = 'PENDING';
    } catch (e) {
        result.logs.push(`Fatal error: ${e.message}`);
        result.status = 'ERROR';
    }

    return result;
}

// ── Stage 2: enrichment (no LinkedIn session required) ──
// Runs concurrently with the next profile scrape. HTTP-first: the browser crawler
// renders JS but costs 10-30s a site, so it is now the fallback rather than the
// default, and only one browser crawl runs at a time to bound memory.
let browserCrawlChain = Promise.resolve();
function queueBrowserCrawl(task) {
    const run = browserCrawlChain.then(task, task);
    browserCrawlChain = run.then(() => {}, () => {});
    return run;
}

async function enrichAndFinalize(result, browserInstance) {
    try {
        result.logs.push('Researching independent ownership, coaching offer, clients, demand and conversion readiness...');
        const research = await researchProspect({
            ...result, linkedinUrl: result.url, email: result.primaryEmail || result.emails[0] || '',
        });
        for (const limitation of research.limitations.filter(note => /^Automated interpretation/.test(note))) result.logs.push(limitation);
        // Email extraction is restricted to the identified practice. Inactivity is
        // a freshness signal and does not prevent business research.
        result.website = research.website || result.website;
        result.emails = research.contacts.filter(c => ['PUBLISHED', 'DOMAIN_MATCH', 'GUESSED'].includes(c.ownership)).map(c => c.address);
        result.emails = prioritizeEmails([...new Set(result.emails)], result.firstName, hostOf(research.website));
        result.primaryEmail = result.emails[0] || '';
        const chosen = research.contacts.find(c => c.address === result.primaryEmail);
        result.emailSource = chosen?.source === 'website' ? 'website_scraped' : chosen?.source || '';
        result.prospectQualification = assessProspect(research, { email: result.primaryEmail });
        const tier = result.prospectQualification.tier;
        const interpretationFailed = research.limitations.some(note => /^Automated interpretation (?:failed|could not complete|is unavailable)/.test(note));
        result.status = pipelineForAssessment(result.prospectQualification) === 'QUALIFIED' ? 'QUALIFIED' : interpretationFailed ? 'ERROR' : 'REJECTED';
        result.logs.push('Qualification: ' + result.status + ' — ' + (tier === 'A' ? result.prospectQualification.nextAction : result.prospectQualification.blockers.join(' ') || result.prospectQualification.nextAction));
        if (!result.primaryEmail) result.logs.push('No attributable email found; the LinkedIn profile remains available.');
    } catch (error) {
        result.logs.push('Research could not complete: ' + error.message);
        result.status = 'ERROR';
    }
    return result;
}


function isProcessRunning(pid) {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

const browserCleanups = new Map();
function killBrowserProcess(b, pid) {
    const key = pid || b;
    if (browserCleanups.has(key)) return browserCleanups.get(key);
    const task = closeBrowserProcess(b, pid).finally(() => browserCleanups.delete(key));
    browserCleanups.set(key, task);
    return task;
}

async function closeBrowserProcess(b, pid) {
    // Step 1: Try graceful close
    if (b) {
        try { await Promise.race([b.close(), sleep(2500)]); } catch { /* force cleanup below */ }
    }

    if (!Number.isInteger(pid) || pid <= 0) return;

    // Step 2: Wait up to 3s for graceful exit
    for (let i = 0; i < 6; i++) {
        if (!isProcessRunning(pid)) { log('Browser exited cleanly ✅'); return; }
        await sleep(500);
    }

    // Step 3: Force kill entire process tree (cross-platform)
    log(`Browser PID ${pid} still alive — force-killing process tree...`);
    try {
        if (process.platform === 'win32') {
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
            log('Process tree killed via taskkill ✅');
        } else {
            // Linux/macOS: kill the process group (negative PID)
            try { process.kill(-pid, 'SIGKILL'); } catch {}
            // Also try pkill as fallback for child processes
            try { execSync(`pkill -P ${pid} 2>/dev/null || true`, { stdio: 'ignore' }); } catch {}
            log('Process tree killed via SIGKILL ✅');
        }

    } catch (e) {
        log(`taskkill failed: ${e.message} — trying process.kill`);
        try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
    }

    // Step 4: Wait for process to actually die
    for (let i = 0; i < 10; i++) {
        if (!isProcessRunning(pid)) return;
        await sleep(500);
    }
    log(`⚠️ PID ${pid} may still be alive after kill attempts`);
}

// ── Chrome profile lock cleanup ──
function cleanupChromeLocks(profileDir) {
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    for (const lockFile of lockFiles) {
        const lockPath = path.join(profileDir, lockFile);
        try {
            if (fs.existsSync(lockPath)) {
                fs.unlinkSync(lockPath);
                log(`Removed stale lock: ${lockFile}`);
            }
        } catch { /* ignore — file may not exist */ }
    }
}

// Shared by the main loop, browser launch/recycle and signal handlers.
let browser = null;
let browserPid = null;
let isShuttingDown = false;
let browserLaunchTask = null;

async function shutdown(signal, exitCode = 0) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    if (dbWorker) await settleJobs();
    log(`${signal} received — shutting down gracefully...`);
    writeStatus('offline', { reason: signal });

    let launchingBrowser = null;
    if (browserLaunchTask) {
        try { launchingBrowser = await browserLaunchTask; } catch { /* failed launch */ }
    }
    await killBrowserProcess(browser || launchingBrowser, browserPid || launchingBrowser?.process()?.pid);
    browser = null;
    browserPid = null;
    releaseWorkerLock();
    await stopDatabaseAccount();
    process.exit(exitCode);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('message', message => { if (message?.type === 'stop') shutdown('Account stopped from dashboard.'); });
process.on('exit', () => {
    // Unexpected exits also reap this worker's own browser tree. Never target
    // all chrome.exe processes: the user's normal browser must stay untouched.
    if (Number.isInteger(browserPid) && browserPid > 0) {
        try {
            if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${browserPid}`, { stdio: 'ignore' });
            else process.kill(browserPid, 'SIGKILL');
        } catch { /* browser may already be closed */ }
    }
    releaseWorkerLock();
});

// ── Browser lifecycle management ──
const RECYCLE_EVERY_N_JOBS = 50; // Restart browser every 50 jobs to prevent OOM
const workerPages = new WeakMap();

async function closeStartupTabs(b) {
    // Do not call browser.pages(): it initializes every restored page and its
    // network session before we can close it. That can overwhelm a saved profile.
    const session = await b.target().createCDPSession();
    try {
        const { targetInfos } = await session.send('Target.getTargets');
        const restored = targetInfos.filter(target => target.type === 'page');
        for (const target of restored) {
            const result = await session.send('Target.closeTarget', { targetId: target.targetId });
            if (!result.success) throw new Error('Could not close a saved worker tab.');
        }
        if (restored.length > 1) log(`Closed ${restored.length} saved worker tabs before initializing LinkedIn.`);
    } finally {
        await session.detach().catch(() => {});
    }
}

async function launchBrowser(profileDir, headless = true) {
    let acceptPages = false;
    browserLaunchTask = puppeteerExtra.launch({
        headless: headless,
        userDataDir: profileDir,
        timeout: 30000, protocolTimeout: 90000,
        // Suppress page/plugin initialization until saved tabs have been closed.
        waitForInitialPage: false,
        targetFilter: target => target.type() !== 'page' || acceptPages,
        handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-gpu', '--disable-dev-shm-usage',
            '--window-size=1366,768',
            // Memory management flags
            '--js-flags=--max-old-space-size=512',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--no-first-run',
        ],
        env: Object.assign({}, process.env, { DISPLAY: ':99' })
    });
    let b;
    try { b = await browserLaunchTask; } finally { browserLaunchTask = null; }

    // Track the PID for reliable cleanup
    const proc = b.process();
    browserPid = proc ? proc.pid : null;
    if (browserPid) log(`Chrome launched (PID: ${browserPid}, headless: ${headless})`);

    try {
        await closeStartupTabs(b);
        acceptPages = true;
    } catch (error) {
        await killBrowserProcess(b, browserPid);
        browserPid = null;
        throw error;
    }
    return b;
}

async function loginAndGetPage(b, accounts) {
    // One clean tab per worker browser; its cookies/session stay in the profile.
    let page = workerPages.get(b);
    if (!page || page.isClosed()) {
        page = await b.newPage();
        workerPages.set(b, page);
    }
    await page.setViewport({ width: 1366, height: 768 });

    log('Checking login...');
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(3000);
    let url = page.url();
    if (url.includes('/feed') && !url.includes('authwall') && !url.includes('/login')) {
        log('Already logged in ✅');
    } else {
        log(`Logging in as ${accounts[0].email}...`);
        await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);
        try {
            await page.waitForSelector('#username, #session_key', { timeout: 15000 });
            const usernameInput = await page.$('#username') ? '#username' : '#session_key';
            const passwordInput = await page.$('#password') ? '#password' : '#session_password';

            await page.type(usernameInput, accounts[0].email, { delay: 120 });
            await sleep(800);
            await page.type(passwordInput, accounts[0].password, { delay: 120 });
            await sleep(800);
            await page.click('button[type="submit"]');
            await sleep(5000);
        } catch (e) {
            log(`⚠️ Login form not found: ${e.message}`);
        }

        url = page.url();
        if (url.includes('/feed')) {
            log('Login successful ✅');
        } else {
            // Return null to signal that manual login is needed
            return null;
        }
    }
    return page;
}

function getMemoryMB() {
    const mem = process.memoryUsage();
    return Math.round(mem.rss / 1024 / 1024);
}

// ── Extracted post-processing function (runs in background while next profile scrapes) ──
async function nativePostProcess(job, result, log) {
    if (result.status === 'ERROR' || !result.prospectQualification?.research) return;
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const endpoint = appUrl + '/api/prospects/research-result';
    const payload = {
        linkedinUrl: result.url, firstName: result.firstName, lastName: result.lastName,
        email: result.primaryEmail || '', emailSource: result.emailSource || '',
        websiteSource: result.websiteSource || '', research: result.prospectQualification.research,
    };
    if (dbWorker) {
        try {
            const { saveWorkerResearch } = require('./src/lib/worker-research-store.cjs');
            const saved = await saveWorkerResearch(dbWorker.pool, {...payload,jobId:job.jobId,owner:dbWorker.owner});
            result.crmSaved = true; result.crmLeadId = saved.id;
            result.prospectQualification = saved.assessment;
            result.primaryEmail = saved.assessment.contact.email;
            if (result.primaryEmail && !result.emails.includes(result.primaryEmail)) result.emails.unshift(result.primaryEmail);
            result.status = saved.pipelineStatus === 'QUALIFIED' ? 'QUALIFIED' : 'REJECTED';
            return;
        } catch(error) {
            result.crmSaved = false; result.status = 'ERROR';
            result.logs.push('CRM save failed; research retained for recovery.');
            writeDeadLetter(job.jobId, 'database', payload);
            throw error;
        }
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(120000) });
            if (response.ok) {
                const saved = await response.json();
                result.crmSaved = true;
                result.crmLeadId = saved.id;
                if (saved.assessment) result.prospectQualification = saved.assessment;
                result.status = (saved.pipelineStatus || pipelineForAssessment(result.prospectQualification)) === 'QUALIFIED' ? 'QUALIFIED' : 'REJECTED';
                log('  [Research] Saved to CRM: ' + result.status + '.');
                return;
            }
            log('  [Research] CRM save attempt ' + attempt + ' failed: HTTP ' + response.status);
        } catch (error) { log('  [Research] CRM save attempt ' + attempt + ' failed: ' + error.message); }
        if (attempt < 3) await sleep(2000 * attempt);
    }
    result.crmSaved = false;
    result.logs.push('Business research completed but CRM save failed; retained for recovery.');
    writeDeadLetter(job.jobId, endpoint, payload);
}


async function main() {
    loadEnv();
    if (!acquireWorkerLock()) return;
    if (await startDatabaseAccount() === false) { releaseWorkerLock(); return; }
    const accounts = getAccounts();
    const profileDir = path.join(BROWSER_PROFILES_DIR, dbWorker ? dbWorker.account.profile_key : 'account-0');
    if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

    // Startup housekeeping
    handleStaleQueue();
    purgeOldResults();

    let totalJobsProcessed = 0;
    let cycleJobCount = 0;

    // ── Enhanced stats tracking ──
    const sessionStartedAt = new Date().toISOString();
    let dailyQualified = 0;
    let dailyRejected = 0;
    let dailyReview = 0;
    let dailyNurture = 0;
    let dailyErrors = 0;
    let lastJobDurationMs = 0;
    let jobDurations = []; // rolling window for avg calculation
    let startupFailures = 0;
    const pendingPostProcessing = []; // track background post-processing promises
    settleJobs = () => Promise.allSettled([...pendingPostProcessing]);
    const inFlightJobs = new Set();

    // Outer loop: manages browser lifecycle
    while (!isShuttingDown) {
        // Try headless first (silent, no visible windows)
        log(`Launching browser in HEADLESS mode... (cycle start, total processed: ${totalJobsProcessed})`);

        browser = await launchBrowser(profileDir, true);
        if (isShuttingDown) return;
        let page;
        try {
            page = await loginAndGetPage(browser, accounts);
        } catch (e) {
            // A navigation/CDP timeout does not establish that login expired.
            // Retry once with a clean headless browser; never open visible Chrome
            // or request manual login solely because the browser failed to load.
            log(`❌ Browser could not check LinkedIn: ${e.message}`);
            await killBrowserProcess(browser, browserPid);
            browser = null; browserPid = null;
            if (isShuttingDown) return;
            startupFailures++;
            if (startupFailures < 2) {
                log('Retrying the browser startup once. Pending jobs are preserved.');
                await sleep(2000);
                continue;
            }
            writeStatus('paused', { reason: 'Browser could not load LinkedIn after two attempts. Check the connection and restart the worker; login status could not be determined.' });
            log('Browser startup failed twice. Login status is unknown. Pending jobs are preserved.');
            releaseWorkerLock();
            if (CHECK_LOGIN_MODE) process.exitCode = 1;
            return;
        }
        startupFailures = 0;

        // If headless login failed, fall back to headful for manual login
        if (!page) {
            if (!MANUAL_LOGIN_MODE) {
                const loginHelp = ACCOUNT_ID ? 'Use Sign in on worker computer in the dashboard account settings.' : 'Run npm run worker:single -- --login once.';
                log(`LinkedIn login is required. ${loginHelp} Pending jobs are preserved.`);
                await killBrowserProcess(browser, browserPid);
                browser = null; browserPid = null;
                writeStatus('paused', { reason: `LinkedIn login required. ${loginHelp}` });
                releaseWorkerLock();
                if (CHECK_LOGIN_MODE) process.exitCode = 1;
                return;
            }
            log('⚠️ Session expired or CAPTCHA needed — switching to HEADFUL mode for manual login...');
            await killBrowserProcess(browser, browserPid);
            browser = null;
            browserPid = null;

            browser = await launchBrowser(profileDir, false);
            try {
                const headfulPage = await loginAndGetPage(browser, accounts);
                if (!headfulPage) {
                    // loginAndGetPage returned null = needs manual intervention
                    log('⚠️ Please complete login or CAPTCHA in the browser window within 10 minutes...');
                    const manualPage = workerPages.get(browser);
                    let loggedIn = false;
                    for (let i = 0; i < 120; i++) {
                        await sleep(5000);
                        try {
                            const currentUrl = manualPage.url();
                            if (currentUrl.includes('/feed') && !currentUrl.includes('authwall')) {
                                log('Manual login detected ✅');
                                loggedIn = true;
                                break;
                            }
                        } catch { /* page may have navigated */ }
                    }
                    if (!loggedIn) {
                        log('❌ Manual login timed out. Exiting.');
                        await killBrowserProcess(browser, browserPid);
                        process.exit(1);
                    }
                    page = manualPage;
                } else {
                    page = headfulPage;
                }
            } catch (e) {
                log(`❌ Headful login also failed: ${e.message}. Retrying in 30s...`);
                await killBrowserProcess(browser, browserPid);
                browser = null;
                browserPid = null;
                await sleep(30000);
                continue;
            }

            // Login succeeded in headful mode — close it and relaunch headlessly
            log('Login session saved. Switching back to HEADLESS mode...');
            await killBrowserProcess(browser, browserPid);
            browser = null;
            browserPid = null;
            await sleep(2000);

            browser = await launchBrowser(profileDir, true);
            try {
                page = await loginAndGetPage(browser, accounts);
                if (!page) {
                    log('❌ Headless still failed after manual login. Running in headful mode for this cycle.');
                    await killBrowserProcess(browser, browserPid);
                    browser = null;
                    browserPid = null;
                    browser = await launchBrowser(profileDir, false);
                    page = await loginAndGetPage(browser, accounts);
                    if (!page) {
                        log('❌ Cannot login. Exiting.');
                        await killBrowserProcess(browser, browserPid);
                        process.exit(1);
                    }
                }
            } catch (e) {
                log(`❌ Headless relaunch failed: ${e.message}. Retrying in 30s...`);
                await killBrowserProcess(browser, browserPid);
                browser = null;
                browserPid = null;
                await sleep(30000);
                continue;
            }
        }

        const me = await voyagerFetch(page, '/voyager/api/me');
        signedInIdentity = me?.status === 200 ? identityFromMe(me.data) : null;
        if (signedInIdentity) log(`Signed in as ${signedInIdentity.name} (${signedInIdentity.profileUrl || signedInIdentity.memberUrn}).`);
        else log('Signed-in LinkedIn profile could not be confirmed; no saved email was substituted.');
        log('🟢 Worker is READY. Watching queue/ for jobs...');
        log(`   Queue dir: ${QUEUE_DIR}`);
        log(`   Results dir: ${RESULTS_DIR}`);
        log(`   Memory: ${getMemoryMB()} MB | Recycle after: ${RECYCLE_EVERY_N_JOBS} jobs`);

        writeStatus('ready', { startedAt: new Date().toISOString(), totalJobsProcessed });

        if (CHECK_LOGIN_MODE) {
            log('Startup login check passed. Pending jobs were not processed.');
            await shutdown('Startup check complete');
            return;
        }

        cycleJobCount = 0;
        let lastHeartbeat = Date.now();
        let needsRecycle = false;

        // Inner loop: processes jobs with current browser
        while (!isShuttingDown && !needsRecycle) {
            try {
                // Heartbeat every 30s
                if (Date.now() - lastHeartbeat > 30000) {
                    writeStatus('ready', { totalJobsProcessed, cycleJobCount, memoryMB: getMemoryMB(), idle: true });
                    lastHeartbeat = Date.now();
                }

                let reservation, job, jobFile, jobPath;
                if (dbWorker) {
                    reservation = await dbWorker.core.claim(dbWorker.pool, ACCOUNT_ID, dbWorker.owner);
                    if (reservation?.disabled) { await shutdown('Account disabled or no longer selected.'); return; }
                    if (reservation?.limited) {
                        writeStatus('paused', { reason: `Daily limit of ${reservation.dailyLimit} reached`, ...reservation });
                        await sleep(POLL_INTERVAL_MS); continue;
                    }
                    if (!reservation) { await sleep(POLL_INTERVAL_MS); continue; }
                    job = reservation.job; jobFile = `${job.jobId}.json`;
                    jobPath = path.join(QUEUE_DIR, jobFile);
                } else {
                const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json') && !inFlightJobs.has(f)).sort();

                if (files.length === 0) {
                    await sleep(POLL_INTERVAL_MS);
                    continue;
                }

                jobFile = files[0];
                jobPath = path.join(QUEUE_DIR, jobFile);

                try {
                    job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
                } catch (e) {
                    log(`⚠️ Bad job file ${jobFile}: ${e.message} — removing`);
                    try { fs.unlinkSync(jobPath); } catch { }
                    await sleep(2000);
                    continue;
                }

                // ── Check Daily Limit ──
                // Runs after the job file is confirmed parseable, so a corrupt/bad
                // job file (handled above) never burns a real slot off the count.
                const dailyLimit = parseInt(process.env.DAILY_SCRAPE_LIMIT || DEFAULT_DAILY_SCRAPE_LIMIT, 10);
                if (dailyLimit > 0) {
                    let limitData = { date: '', count: 0 };
                    try {
                        if (fs.existsSync(LIMITS_FILE)) limitData = JSON.parse(fs.readFileSync(LIMITS_FILE, 'utf8'));
                    } catch {}

                    const today = new Date().toISOString().split('T')[0];
                    if (limitData.date !== today) {
                        limitData = { date: today, count: 0 };
                    }

                    if (limitData.count >= dailyLimit) {
                        writeStatus('paused', { reason: `Daily limit of ${dailyLimit} reached`, nextReset: 'midnight' });
                        log(`⏳ Daily limit of ${dailyLimit} reached. Sleeping for 15 minutes before checking again...`);
                        await sleep(15 * 60 * 1000);
                        continue;
                    }

                    // Pre-increment to reserve the slot
                    limitData.count++;
                    try { fs.writeFileSync(LIMITS_FILE, JSON.stringify(limitData)); } catch {}
                }
                }

                // (Job claimed, will unlink on completion to avoid losing mid-scrape)

                const jobId = job.jobId;
                inFlightJobs.add(jobFile);
                const profileUrl = job.linkedinUrl;
                const jobStartTime = Date.now();

                log(`Processing job ${jobId}: ${profileUrl} [${cycleJobCount + 1}/${RECYCLE_EVERY_N_JOBS} in cycle, ${getMemoryMB()} MB]`);

                // Read daily stats for status
                let dailyCount = reservation?.dailyCount || 0;
                let dailyLimitVal = reservation?.dailyLimit || parseInt(process.env.DAILY_SCRAPE_LIMIT || DEFAULT_DAILY_SCRAPE_LIMIT, 10);
                try {
                    if (!dbWorker && fs.existsSync(LIMITS_FILE)) {
                        const ld = JSON.parse(fs.readFileSync(LIMITS_FILE, 'utf8'));
                        const today = new Date().toISOString().split('T')[0];
                        if (ld.date === today) dailyCount = ld.count;
                    }
                } catch {}

                writeStatus('processing', {
                    jobId, url: profileUrl, totalJobsProcessed, cycleJobCount,
                    sessionStartedAt, dailyCount, dailyLimit: dailyLimitVal,
                    dailyQualified, dailyRejected, dailyReview, dailyNurture, dailyErrors,
                    lastJobDurationMs, avgJobDurationMs: jobDurations.length > 0 ? Math.round(jobDurations.reduce((a,b) => a+b, 0) / jobDurations.length) : 0,
                    memoryMB: getMemoryMB(),
                    pendingPostProcessing: pendingPostProcessing.length
                });

                // Health check: is browser/page still alive?
                let pageAlive = false;
                try {
                    await page.evaluate(() => true);
                    pageAlive = true;
                } catch {
                    log('⚠️ Page crashed mid-cycle. Recycling browser...');
                }

                let result;
                if (pageAlive) {
                    try {
                        result = await scrapeProfile(page, profileUrl, browser);
                    } catch (e) {
                        log(`⚠️ scrapeProfile threw: ${e.message}`);
                        result = { url: profileUrl, firstName: '', headline: '', activityStatus: 'Unknown', emails: [], websites: [], website: '', status: 'ERROR', logs: [`Fatal: ${e.message}`] };
                    }
                } else {
                    result = { url: profileUrl, firstName: '', headline: '', activityStatus: 'Unknown', emails: [], websites: [], website: '', status: 'ERROR', logs: ['Browser page crashed before scrape'] };
                }

                // The LinkedIn half of the job is finished here. Everything that
                // remains — business research, contact attribution and CRM persistence —
                // needs no LinkedIn session, so it runs in the background while this
                // loop immediately claims the next profile. LinkedIn time is the
                // scarce, rate-limited resource; nothing else should consume it.
                const linkedinDurationMs = Date.now() - jobStartTime;
                totalJobsProcessed++;
                cycleJobCount++;
                // Retain the job through research and persistence so a restart can resume it.

                const finishJob = (async () => {
                    if (result.status !== 'ERROR') {
                        try {
                            result = await enrichAndFinalize(result, browser);
                        } catch (e) {
                            log(`⚠️ Enrichment threw for ${jobId}: ${e.message}`);
                            if (result.status === 'PENDING') result.status = 'ERROR';
                        }
                    }

                    const jobDuration = Date.now() - jobStartTime;
                    lastJobDurationMs = jobDuration;
                    jobDurations.push(jobDuration);
                    if (jobDurations.length > 50) jobDurations.shift(); // rolling window of 50

                    if (job.nativePostProcess) {
                        await nativePostProcess(job, result, log)
                            .catch(err => { result.crmSaved = false; log(`  [Research] Save error: ${err.message}`); });
                    }
                    if (result.status === 'QUALIFIED') dailyQualified++;
                    else if (result.status === 'ERROR') dailyErrors++;
                    else if (result.status === 'REJECTED') dailyRejected++;
                    else if (result.status === 'NURTURE') dailyNurture++;
                    else dailyReview++;

                    if (dbWorker) {
                        result.accountId = ACCOUNT_ID;
                        await dbWorker.core.complete(dbWorker.pool, jobId, dbWorker.owner, result);
                    }
                    fs.writeFileSync(
                        path.join(RESULTS_DIR, `${jobId}.json`),
                        JSON.stringify({ status: 'done', result, completedAt: new Date().toISOString() })
                    );
                    if (!dbWorker) { try { fs.unlinkSync(jobPath); } catch { } }

                    if (job.webhookUrl) {
                        await fireWebhook(job.webhookUrl, { jobId, status: 'done', result, completedAt: new Date().toISOString() });
                    }

                    log(`✅ Job ${jobId} done → ${result.status} | ${result.firstName} | Emails: ${result.emails.length} | ${Math.round(jobDuration / 1000)}s total, ${Math.round(linkedinDurationMs / 1000)}s on LinkedIn (Total: ${totalJobsProcessed}, Mem: ${getMemoryMB()} MB)`);
                })();

                const tracked = finishJob
                    .catch(err => log(`❌ Job ${jobId} post-scrape stage failed: ${err.message}`))
                    .finally(() => {
                        inFlightJobs.delete(jobFile);
                        const idx = pendingPostProcessing.indexOf(tracked);
                        if (idx >= 0) pendingPostProcessing.splice(idx, 1);
                    });
                pendingPostProcessing.push(tracked);

                // Cap how many leads sit mid-enrichment at once, so a run of slow
                // websites can't pile up unbounded work behind a fast scrape loop.
                while (pendingPostProcessing.length >= ENRICH_CONCURRENCY) {
                    await Promise.race(pendingPostProcessing);
                }

                writeStatus('ready', {
                    totalJobsProcessed, cycleJobCount, lastJob: jobId, memoryMB: getMemoryMB(),
                    sessionStartedAt, dailyCount, dailyLimit: dailyLimitVal,
                    dailyQualified, dailyRejected, dailyReview, dailyNurture, dailyErrors,
                    lastJobDurationMs, avgJobDurationMs: jobDurations.length > 0 ? Math.round(jobDurations.reduce((a,b) => a+b, 0) / jobDurations.length) : 0,
                    pendingPostProcessing: pendingPostProcessing.length
                });

                // Check if we need to recycle the browser
                if (!pageAlive || cycleJobCount >= RECYCLE_EVERY_N_JOBS) {
                    needsRecycle = true;
                    log(`🔄 Browser recycle triggered (${!pageAlive ? 'page crashed' : `${cycleJobCount} jobs reached`}). Restarting browser...`);
                }

                // Clear page memory between jobs: navigate back to LinkedIn feed
                if (!needsRecycle && pageAlive) {
                    try {
                        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15000 });
                    } catch { /* ignore */ }
                }

                // Delay between profiles
                await jitter(700, 1600);

            } catch (e) {
                log(`Error in poll loop: ${e.message}`);
                await sleep(5000);
            }
        }

        // Wait for any pending post-processing to finish before recycling
        // Enrichment tasks may still be using this browser for a rendered crawl,
        // so they must all settle before it is killed.
        if (pendingPostProcessing.length > 0) {
            log(`⏳ Waiting for ${pendingPostProcessing.length} background enrichment tasks to finish...`);
            await Promise.allSettled(pendingPostProcessing);
            pendingPostProcessing.length = 0;
            log(`✅ All background tasks complete.`);
        }

        // Close the old browser before starting a new one — use proper Windows process killing
        log(`Closing browser for recycle... (processed ${cycleJobCount} jobs this cycle)`);
        await killBrowserProcess(browser, browserPid);
        browser = null;
        browserPid = null;

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            log(`GC forced. Memory after: ${getMemoryMB()} MB`);
        }

        // Brief pause before relaunching
        if (!isShuttingDown) {
            log('Waiting 5s before relaunching browser...');
            await sleep(5000);
        }
    }
}

main().catch(async e => { console.error('Fatal:', e.message); await shutdown('Fatal error', 1); }).finally(stopDatabaseAccount);
