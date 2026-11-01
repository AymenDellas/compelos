# Feed browsing warm-up — 2 November 2026

Warm-up now browses the rendered feed instead of visiting queued profiles. The
account card exposes **Start warm-up**, **Stop warm-up**, observed minutes,
scroll/expansion counts and day progress. **Warm-up settings** edits duration
and required days directly on the card; **Session setup** is also visible
without opening the overflow menu. A completed day explains why the next
warm-up cannot start yet. Qualification has its own **Start processing** action.

The default is 20 observed minutes per session and the existing four observed
days, including the prior elapsed-day rule. Timing accepts 1–40 minutes and
1–90 observed days. Changing only these values requires a paused account and no
pending session requests, but does not require closing its browser or repeating
network/identity checks. The update leaves session revision, raw diagnostics,
approval, proxy binding, prior warm-up days and exact holds unchanged. It never
starts an account or clears review/recovery requirements.

The worker checks admission and confirms the signed-in member before browsing.
Warm-up branches before CRM/discovery claims: an empty queue is supported, no
profile reservation/daily slot is consumed, and no CompelOS profile/activity/
contact qualification reads, research handoffs or lead decisions originate here.
LinkedIn's own feed can make its normal background requests; these are still
observed for reactive stops. Subsequent qualification keeps its existing daily
profile ceiling, spacing, duplicate locks, follower/location rules and ramp.

Each bounded action either scrolls or selects an eligible visible in-feed post
“See more” button. Expansion requires the exact supported post/button structure,
no form/submission, a matching text label, a live handle and a hit test. Other
buttons/links are excluded; unsupported layouts simply scroll. There are no
likes, comments, follows, connections, messages, submissions or arbitrary clicks.
An unexpected destination, unavailable feed, identity mismatch or account warning
stops the session rather than navigating around it.

PostgreSQL stores `FEED_WARMUP_V1` progress: elapsed observed time, target duration,
scroll/expansion counts, the last twelve action types/times and ownership/
continuity metadata. Only short verified gaps on the same page, owner and
control version accrue time. Pause, a replacement/disconnected page, restart
and long gaps cannot earn a day in the background. Interrupted sessions expire
after the remaining duration plus five minutes and stop without a completed day.
A successful session saves its day and disables processing in the same SQL
statement, fenced by active intent, version, lease, configuration and absence
of a hold or competing session command. No callback can automatically enter
qualification after warm-up completes.

The agent schedules each account's next browsing action independently and keeps
active feed browsing out of idle recycling. Existing memory, browser ownership,
account concurrency and public research resource controls remain. Legacy
`warmupVisits` evidence is retained, and `warmupProfilesPerDay` is still accepted
in historical policy records; it no longer drives ordinary warm-up. Both consumed
John experiments and their saved holds remain untouched.

Validation uses pure clock/pause/restart fixtures, isolated PostgreSQL fencing
tests and an intercepted local feed. Browser checks verify actual text expansion,
scrolling, no social writes/profile navigation, and cancellation. The real React
interface is bundled into a loopback-only synthetic fixture to exercise settings,
Start, Stop, completion and desktop/390px layouts. Screenshots and full logs stay
under ignored `data/engine-v2/feed-warmup-20261101/`; benchmark manifests and the
50-record stored-CRM replay are retained in PostgreSQL. No authenticated LinkedIn
measurement or account start is performed as part of implementation.

The [verification receipt](engine-feed-warmup-receipt.json) records 525 passing
engine tests, 14 passing CRM tests and 24 final affected checks. Types, the
production build and changed-file lint passed. Whole-repository lint retains
six existing errors/four warnings in unchanged copy-studio components. All 92
deployment traces exclude private runtime assets. The 50-record replays have
zero decision/evidence changes or errors; account controls and CRM contents
remain unchanged. A security warning at the session deadline retains its exact
reason rather than becoming a generic timer-expiry message.

A pre-existing navigation timeout regression was also restored to the user's
explicit 60-second requirement; the original timeout-propagation tests remain
strict. Browser provider configuration, detector verdicts and the earlier
unresolved cross-profile visitor-ID finding are unchanged. Feed browsing does
not establish account safety or guarantee avoidance of restrictions.
