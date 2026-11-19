# ORIGIN

ORIGIN is the Compel OS workstation for researching public coaching-business opportunities. Its queue, evidence and publication policy are separate from the LinkedIn qualification engine. The local worker reuses the existing PostgreSQL pool, the two public research lanes and their shared three-request limiter. ORIGIN takes at most one research lane and opens at most one disposable Chrome browser at a time. The ORIGIN API uses the existing loopback admin guard and requires same-origin JSON mutations.

## Run it

Install the repository dependencies including the local worker's development dependencies. Run the dashboard and agent from the checkout.

```powershell
npm run dev
npm run worker
```

In Compel OS, open **Acquisition → ORIGIN → Start run**. The first start or settings save applies the additive schema. Operations controls the schedule, research limits, budget, and desktop/mobile capture. Pause, resume, and cancel act on the saved run. The local agent and machine must stay online for scheduled work. With the agent offline, a queued run remains in PostgreSQL.

## CLI

```powershell
node origin.cjs help
node origin.cjs doctor
node origin.cjs sources probe
node origin.cjs run --qualification --require-qualified
node origin.cjs evaluate latest
```

Use `migrate` to update an earlier installation. `doctor` reports the deployed worker policy and the number of independent configured publishers. The dashboard and CLI identify discovery-only runs when fewer than two independent feeds are configured. `--qualification` blocks a run before enqueueing if that prerequisite is absent. `--require-qualified` exits with code 5 when a completed run has no current ready opportunity. Without either switch, a discovery-only run can still collect useful identity, offer and journey evidence.

`start` queues work for the Compel worker. `run` queues and follows the named run. `work active` continues saved work, and `wait` follows progress without claiming stages. If the persistent agent is offline, `run` and `work` can drive a single ORIGIN run using its normal PostgreSQL lease. They reuse the persistent agent when it is online. A foreground run ends after the named run and leaves recurring scheduling to the persistent agent. Use `pause`, `resume` and `cancel` with an ID or `active`. Ctrl+C leaves the saved run available for continuation.

`runs`, `show-run`, `investigations`, `opportunities`, `dossier`, and `evidence` read the same PostgreSQL records as the dashboard. Export screenshot bytes with `artifact <investigation-id> <artifact-id> --output <new-file>`. The CLI checks the SHA-256 before writing and refuses to overwrite a file. `settings set` changes one value, `settings import` applies a JSON patch, and `schedule every 90` or `schedule off` controls future runs. `usage`, `evaluate`, and `evaluations` report costs, per-gate blockers, and benchmark results. Output is JSON and progress goes to stderr. Run `node origin.cjs help` for arguments.

Register each publisher only after verifying that its feed permits the intended use. Specify a shared `--publisher` value for feeds owned by the same publisher. `sources probe` reads the configured feeds and shows observed website overlap. `sources history` reports stored source outcomes and official identity corroboration.

```powershell
node origin.cjs sources add "Publisher name" "https://publisher.example/feed" "https://publisher.example/terms" --publisher "publisher-owner"
node origin.cjs sources list
```

The schedule starts disabled. A run snapshots its configuration and spends up to ten minutes by default. Model budgets default to $2/run, $6/day and $25/month with zero model requests enabled. Positive scheduled intervals are in minutes. A paused run occupies the active slot, and resuming restores its remaining wall-clock budget. For a stopped process, another owner can continue after the 95-second lease expires. An in-flight stage may complete a public read after a control change, but its checkpoint cannot commit against the old lease or control revision. Existing CRM account permissions remain the responsibility of Engine.

## Data and verification

1. `discovery.ts` reads source adapters and preserves original source identities, publisher URL and terms references, dated activity and same-record relationships. Wikidata rotates coaching specialties. ECHO and CONSTELLATION read named contributors from configured feeds. IGNITION seeds revisits and compares saved normalized offer scope and booking destinations. The first observation establishes a baseline. FRONTIER uses corroborated official identities per second and reserves every third run for underexplored sources. It does not optimize on automated qualification labels.
2. `research.ts` corroborates source identity on the official entry or a linked About page. It reads bounded offer, contact, and case-study pages and a declared direct booking destination. VOID records navigation and re-reads the offer and exact destination in a separate verification stage. This checks reproducible HTTP 404/410 behavior. Functional alternate paths, unreproduced failures, login, CAPTCHAs and restricted access cannot pass the opportunity gate. Sections behind form submission remain untested.
3. `policy.ts` applies all seven gates and versions the decision. Qualification requires corroborated identity, a scoped coaching service, an explicit eligible market, commercial substance, two recent independent publisher records, a reproducible direct-booking defect, and a public role address explicitly inviting relevant business inquiries. Commercial substance requires reported operating history and published premium pricing or a named client case with a documented coaching engagement. Public exposure is stored as evidence of activity. Traffic, deliverability, revenue, conversion loss, and ability to pay remain unknown. A confirmed exclusion rejects. Missing, conflicting or expired proof stays unresolved. Ready opportunities sort by acquisition evidence count and investigation recency, with stable tie-breakers.
4. PostgreSQL owns `origin_settings`, `origin_runs`, `origin_businesses`, `origin_identity_keys`, `origin_investigations`, `origin_artifacts`, `origin_model_usage` and `origin_evaluations`. Investigations hold checkpointed JSON claims, source relationships, journey steps, evidence hashes, dated observations and the adjudicated decision. Stable business IDs key the in-app pipeline. Same-host variants and recurring Wikidata IDs deduplicate. A changed external domain triggers an unresolved identity finding. The read-only `readyOpportunities()` contract serves only fresh, current, unsuppressed records for future in-app consumers. ORIGIN does not insert LinkedIn leads or invoke any outreach action. Later CRM suppression immediately removes the matching business from the ready view.

The public transport pins validated DNS addresses, rejects local and restricted destinations, checks redirects and publisher scope, reads robots rules, and keeps a conservative per-host document gap. Browser network access goes through the same reader. Captures admit the observed page and a bounded set of passive same-site resources, so some views report missing assets. No forms are submitted. One screenshot per device is persisted by content hash. The next available worker sweep removes image bytes after 30 days while retaining capture metadata. Trace records are bounded HTTP observations and resource-state notes. Full browser traces, HTML archives and behavioral analytics are outside this implementation.

## Source capability matrix

| Source | Observations and freshness | Access, cost and practical limit | Use and current status |
| --- | --- | --- | --- |
| Wikidata | Candidate names and P856 official-site pointers, revision referenced where available. Community-edited and variable in freshness. | Keyless. Up to two serial requests per run, a named user agent, `maxlag=5`, timeouts and Retry-After. | Active, verified live. Structured data under CC0. These pointers need official corroboration. [Data access](https://www.wikidata.org/wiki/Help:Data_access) · [API guidelines](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines) |
| Approved public RSS/Atom | Dated publisher records with explicit contributor-to-official-site links. | Keyless where the publisher offers a public feed. Up to two selected feeds and 18 parsed entries per source per run. | Adapter implemented. Publisher permission must cover the intended use. No default publisher is assumed to grant it. [RSS specification](https://www.rssboard.org/rss-specification) |
| Official business and permitted booking URLs | Current offer, business statements, contact route and technical journey observations. | Bounded public GETs, robots checks, with restricted paths and at most two capture viewports. No paid traffic estimates. | Active, verified live. Public visibility is evidence of what a site publishes. [Robots Exclusion Protocol](https://datatracker.ietf.org/doc/html/rfc9309) |
| GDELT DOC | News article URL/title metadata. Article syndication and rights vary by site. | Public API. No guaranteed throughput used in this release. | Evaluated, unintegrated. GDELT data permits commercial use with attribution. Publisher article rights need a separate check. [GDELT terms](https://gdeltproject.org/about.html#termsofuse) · [DOC API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) |
| Common Crawl | Historical web snapshots with per-crawl freshness. | Free public index, heavily rate-limited. | Unintegrated. Crawled content can carry third-party terms. [Provider terms](https://www.commoncrawl.org/terms-of-use) · [Index limits](https://www.commoncrawl.org/faq) |
| Podcast Index and YouTube | Podcast feed metadata and video metadata. | Credentials, provider quotas and service terms apply. | Unintegrated. Review reuse and storage terms before enabling either provider. [Podcast Index terms](https://api.podcastindex.org/tos_v1.1.pdf) · [YouTube policies](https://developers.google.com/youtube/terms/developer-policies/) |
| Companies House | UK company registry facts which can corroborate entity history. | API credentials required. | Unintegrated. Registry facts can establish a legal identity. [Companies House API](https://developer.company-information.service.gov.uk/get-started) |

Publisher feeds can also come from `ORIGIN_APPROVED_FEEDS` as a JSON array of `{ "title", "url", "permission", "publisher" }` objects. The database configuration takes precedence after the first CLI source edit. Each run snapshots its approved feeds. Each feed record needs a dated item permalink on the publisher domain and an external official-site link explicitly marked as an author or performer. Still-current observations from earlier runs can corroborate a new discovery while the source remains configured. Shared syndicated titles and same-publisher repeats count once. Unchanged Wikidata pointers investigated in the last 72 hours are skipped. Creating a new adapter requires a bounded `Adapter.run()` that produces `Seed` records with immutable source keys, official-site pointers and observed dates. Keep provider credentials server-side and use the common transport.

## AgentRouter

ORIGIN reuses Compel OS's supported AgentRouter client, private relay, and `AGENTROUTER_*` configuration. Set `ORIGIN_AGENTROUTER_MAX_CENTS` only after establishing an upper bound for one request with the selected model and the configured input/output bounds. Then enable model requests in Operations. Submitted input is a compact set of deterministic journey observations without scraped page text, URLs or private contact data. Model output is an optional schema-validated recommendation and cannot affect eligibility.

The database reserves the full configured bound before dispatch and retains it even if the result is lost. ORIGIN permits one upstream request per reservation, one active request and one request per minute. It caches matching summaries and records classified failures, bounded cooldowns, and any reported token count available in response usage frames. Authentication and quota failures open a longer cooldown. Rate limits use Retry-After where supplied. Unknown provider costs remain unavailable. The reserved amount shown in Operations is a conservative budget reservation. The live acceptance opted out of inference and did not verify live quotas, billing or model output.

## Verification

```powershell
$env:ORIGIN_TEST_POSTGRES='1'
node --require ./scripts/test-env.cjs --import tsx --test tests/origin/*.test.ts
node origin.cjs benchmark fixture
node origin.cjs benchmark live --limit 12
npx tsc --noEmit
npm run build
```

The fixture suite exercises an eligible dossier, broken and functional routes, stale and missing proof, syndicated exposure, conflicting evidence and identity mismatches, prompt injection, provider failure classes, budget exhaustion, duplicate identities, and interrupted or invalidated leases. It uses isolated PostgreSQL fixtures. The live command uses the real discovery and worker lane in a temporary schema. It saves a versioned summary to `origin_evaluations` and retains a private report and JPEG captures under `data/engine-v2/origin/`. No LinkedIn sessions are used for acceptance.

The v2 fixture benchmark discovers seven businesses through two RSS feeds, renders their journeys in Chrome, replaces the worker after a saved checkpoint, and checks publication and screenshots through PostgreSQL. Its cases cover two qualified opportunities, three unresolved cases, and two rejections, including CRM suppression. Synthetic labels measure regression behavior. The live benchmark reports actual gate counts without ground-truth labels. The 95% precision target has no held-out real-world measurement yet.

The original dashboard run completed eight investigations with six corroborated identities and no acquisition proof. The v2 isolated live benchmark completed 12 with eight corroborated identities and eight verified screenshots. A separate CLI run on the restarted Compel worker completed another eight using the leadership query, saved six captures, and returned exit 5 with `--require-qualified`. Both live configurations had zero approved publishers, made zero AgentRouter requests and published zero opportunities. The live runs also found gaps in eligible market, commercial substance, conversion opportunity and permitted contact evidence. Historic decisions remain viewable through `evaluate <run-id>`.

The CLI regression suite covers publisher configuration, the strict readiness check, schedules, settings, pause/resume/cancel, and the read model. The saved-evidence CRM replay reproduced all 50 frozen decisions without changes. The live artifact export reproduced the saved screenshot hash. Reports live under ignored `data/engine-v2/origin-cli/`.

The first release focuses on official-domain corroboration and direct booking faults. It has no dedicated identity-merge review workflow, independent downstream outcome feed, semantic model analysis of offer changes, advanced model tiers, or live benchmark with verified qualifying businesses. Feed coverage and commissioning of additional permitted sources are the main constraints on discovering qualified opportunities.
