# FlightLog Product Plan (Complete)

FlightLog is a free, open-source personal flight tracker and passport: the day-of-travel awareness of **Flighty** and the data depth of **Variflight (飞常准)**, built local-first so it costs nothing to run and the user always owns their data.

This is the **complete** plan — from where we are today through the finished product and its long-term life. It covers every planned major version line (v2.x maturity, v3.x platform, v4.x intelligence, v5.x longevity) plus a speculative horizon, the feature-parity target, the engineering loop each release follows, and an explicit ledger of everything that genuinely needs a human decision or credential.

Each stage is scoped so a single implementation session can pick it up and ship it end to end.

---

## 1. Vision and non-negotiables

**Vision.** One app that covers the full arc of a flight — plan it, check in, watch it live on the day, log what actually happened, and look back at a beautiful passport of everywhere you have flown — without accounts, subscriptions, or data leaving the device unless the user explicitly opts in.

**Non-negotiables** (hold at every stage unless the owner explicitly overrules them in the ledger in §10):

1. **Local-first.** The core app works fully offline from IndexedDB. Cloud features stay optional.
2. **Free to run.** Static hosting (GitHub Pages) plus free-tier services only. No component may require a paid server to exist.
3. **No secrets in the frontend.** Provider API keys live only in the Cloudflare Worker environment.
4. **Privacy by default.** Nothing is uploaded without an explicit user action; E2EE is offered wherever data leaves the device.
5. **No heavy dependencies.** Prefer WebCrypto, Canvas, and hand-rolled utilities over new packages.
6. **Permanently out of scope** (unless overruled): payments, native app-store builds, realtime sync, background server-side polling of provider data, and **Apple login** (declined by the owner — the Apple Developer Program cost is not justified; recorded in §10).

The vision is fixed. The **non-negotiables are a living contract**: some later-horizon features (push, collaboration) tension against them. Where that happens the feature is gated behind an explicit owner decision recorded in §10 — never quietly relaxed.

---

## 2. Where we are (shipped)

| Release | Theme | Highlights |
| --- | --- | --- |
| v1.x | Foundation | Manual + live logging, 9k-airport dataset, local + cloud backups, Sync Lite, tombstones/Trash |
| v2.0 | Mobile PWA | Bottom nav, installable shell, offline behavior, HTML share-card previews |
| v2.1 | Lifecycle & trips | Flight lifecycle assistant, day-of-travel card, post-flight completion prompts, PNG share cards, manual trip editor |
| v2.2 | Data security | E2EE local + cloud backups (PBKDF2/AES-GCM, AEAD-bound headers), field-level conflict merge |
| v2.3 | Day-of notifications | Opt-in phase-transition and gate-change alerts while the app is open |

Every release follows the engineering loop in §11, including an adversarial multi-agent review of the diff before merge.

> **v2.3.1 (shipped):** the v2.3 review's notification-hardening items are done — forward-only phase transitions plus a dedicated delay alert, Android service-worker `showNotification`, per-transition tags with `renotify`, nested gate-shape reads, midnight/estimated-arrival softening, watcher reset on wholesale data swaps, aggregated fallback toasts, and a symmetric `appSettings` sync normalization.

---

## 3. Release-line map

```
v2.x  MATURITY      make what we have excellent and reach more people   (mostly autonomous)
v3.x  PLATFORM      identity, achievements, and FlightLog-as-a-platform (some human gates)
v4.x  INTELLIGENCE  prediction, planning, and ecosystem                 (provider + decision gates)
v5.x  LONGEVITY     governance, sustainability, community, archival     (human/community gates)
∞     HORIZON       speculative bets, revisited each cycle
```

Ordering principle: **value-per-unit-risk, autonomy first.** On-device work (analytics, imports, i18n, UX polish) ships before anything needing credentials; credential- and decision-gated work sits later, so by the time we reach a human gate everything autonomous around it is already done and the human step is small and well-framed.

---

## 4. The v2.x line — MATURITY

Goal: make the existing feature set excellent, portable, and multilingual. Almost entirely autonomous.

### v2.3.1 — Notification hardening (autonomous) — ✅ shipped

Closed the v2.3 review findings before building more on top of notifications.

- **Forward-only phase transitions**: rank phases (`scheduled < check-in < departing-soon < en-route < landed`) and notify only on forward moves; a provider refresh that regresses the phase (delay pushing estimated departure out) must not re-fire "check-in open." Add a dedicated **"Flight delayed"** notification for the delay case.
- **Android delivery**: use `navigator.serviceWorker.ready → registration.showNotification(...)` with the page `Notification` constructor as fallback; the page constructor throws on Android Chromium, so the current path silently degrades to a toast while Settings claims success.
- **Per-transition tags + `renotify`**: so each day-of event actually alerts instead of silently replacing the tray card.
- **Gate comparison**: read the nested `terminalGate` shape the rest of the codebase uses; compare gate alone so a terminal appearing/disappearing doesn't flap.
- **Toast queue**: fallback toasts become a small stacked queue instead of one overwritten string.
- **Midnight suppression**: don't fire "departing soon" for flights with no resolvable departure instant at origin-local midnight.
- **Snapshot reset** on backup restore/import and cloud pulls so a wholesale data swap doesn't emit stale transitions.
- **Settings sync**: normalize the `appSettings` record before comparing so the new `dayOfNotificationsEnabled` field doesn't create a phantom conflict against pre-upgrade cloud records.

### v2.4 — "Insights": Variflight-style analytics from your own data (autonomous) — ✅ shipped

Variflight's superpower is data depth; much of it is computable on device from the user's own history.

- **Punctuality panels** per airline / route / airport from logged scheduled-vs-actual times: average delay, on-time %, best/worst routes.
- **Delay context on Flight Detail**: "Your history on this route: 4 flights, avg departure delay 22m."
- **Map upgrades**: great-circle arcs (tested as pure math), per-trip map filtering, trip-detail mini map.
- **Yearly "wrapped"**: a stepped, story-style summary reusing the PNG share-card renderer per slide.
- Tests: `src/utils/insights.ts` pure functions; arc math pure and covered.

### v2.5 — "Doors open": import/export ecosystem (mostly autonomous) — ✅ shipped (share-card themes deferred)

Lower switching cost from other trackers.

- **Importers** with dedupe preview (reusing backup-merge duplicate detection): Flighty CSV, myFlightradar24 CSV, App in the Air export, and a generic column-mapping wizard.
- **Deep-link Quick Add**: `#/add?flight=SQ38&date=2026-06-02` prefills the lookup form.
- **Calendar feed export**: one `.ics` with all upcoming flights.
- **Share-card themes**: 2–3 additional PNG palettes selectable in the share panel.
- *Soft dependency:* real exported files from the owner's accounts would harden importer tests (optional assist, not a blocker — public format docs suffice for fixtures).

### v2.6 — "你好": localization, en / zh-CN / zh-TW / ja (autonomous build + owner review) — ◐ foundation shipped, translations reviewed

Highest-leverage reach feature; the owner is bilingual and Variflight's market is Chinese-speaking. Scope was widened (owner request) to add Traditional Chinese and Japanese concurrently.

- **Dependency-free i18n (shipped)**: a `t(key)` dictionary module (`src/utils/i18n.ts`), a `language` setting (`system | en | zh-CN | zh-TW | ja`) with system detection that distinguishes Traditional from Simplified, `<html lang>` sync, and a completeness test across all locales.
- **Coverage (progressive)**: navigation, mobile More menu, add action, footer, and the language setting are translated in all four languages; the remaining strings fall back to English and are keyed over subsequent iterations.
- **Review gate — resolved:** the maintainer reviewed and approved the current translations, so the in-app "pending review" disclaimer was removed. Future added keys should still be reviewed as they land.

### v2.7 — "Live depth": provider-powered day-of data (autonomous code, human deploy gate) — ◐ shipped (airport board + refresh cadence; inbound-aircraft deferred)

Where Flighty/Variflight parity needs richer upstream data; the Worker grows.

- **Provider fallback chain** in the Worker (AeroDataBox primary + optional secondary), normalized output, mock-mode preserved so the app stays fully testable without credentials.
- **Airport delay board** panel fed by a new Worker endpoint.
- **Inbound-aircraft awareness** ("your plane is arriving from…") — the best single delay predictor Flighty offers.
- **Smarter refresh cadence** near departure, within the no-background-polling rule.
- ⚠️ **Human gate:** provider accounts, `wrangler secret put`, `wrangler deploy`.

---

## 5. The v3.x line — PLATFORM

Goal: deepen the passport identity and turn FlightLog from an app into a small, forkable platform. Mostly autonomous, with a few decision/credential gates.

### v3.0 — "Passport Pro": identity & achievements (autonomous) — ✅ shipped

- **Achievements v2 (shipped)**: a pure milestone engine (`src/utils/achievements.ts`) over flight history — 22 achievements across reach/distance/frequency/special, including continents (derived from an ISO-2 country→continent map), red-eyes, longest consecutive-year streaks, both-hemisphere, and equator/date-line crossings. Each milestone reports tier, progress, earned state, and the date it was first earned.
- **Passport book view (shipped)**: `src/utils/passportBook.ts` — deterministic stamp visuals (stable rotation + continent ink colour, no randomness) drive both a paginated, page-turn DOM book (one continent block per page) and a Canvas passport-page PNG export.
- **Streaks & goals (shipped)**: user-set yearly targets (flights / countries / airports) in `AppSettings`, with current-year progress on the passport page.
- **Tests (shipped)**: 33 pure-function tests (`achievements.test.ts`, `passportBook.test.ts`) over synthetic flight histories with an injected airport resolver.

### v3.1 — "Sealed sync": end-to-end encrypted Sync Lite records (autonomous build, one design gate) — ✅ shipped

Extend E2EE from snapshots to record-level sync.

- **Human gate resolved (2026-07-19):** cross-device key management — the owner chose **passphrase re-entry per device** (zero-knowledge, same model as encrypted backups) over wrapped-key escrow, for consistency with what's already shipped and to avoid the server ever storing key material, even wrapped.
- **Per-record encryption (shipped)**: `src/utils/sealedSync.ts` reuses the existing PBKDF2 + AES-GCM envelope from encrypted backups per record — no new crypto primitives or schema migration; the envelope drops directly into the existing `record_json` column, the same way `cloud_backups.backup_json` already stores one.
- **Backward-compatible (shipped)**: a per-user "Encrypt sync" opt-in (`AppSettings.syncEncryptionEnabled`, default off); unencrypted records keep syncing exactly as before. Sealed records from another device surface as **locked** (visible metadata, unreadable content) until unlocked with the correct passphrase — never silently corrupted or treated as plaintext.
- **Tests (shipped)**: 9 new unit tests (`sealedSync.test.ts`) plus 4 new integration tests in `settingsSync.test.ts` covering seal/unseal round-trips, the locked state, wrong-passphrase rejection, and mixed sealed/unsealed histories.

### v3.2 — "Bring your own provider": pluggable data layer (autonomous) — ✅ shipped

Make FlightLog forkable and self-hostable end to end.

- **Provider adapter interface (shipped)** in the Worker (`workers/flight-status-worker/providers/`) — AeroDataBox-specific logic extracted behind a fixed adapter contract; a fork swaps in FlightAware, OpenSky, AviationStack, etc. by implementing one module and registering it, with zero changes to routing, validation, or caching.
- **Self-host guide (shipped)**: `docs/SELF_HOSTING.md` — a fork checklist for the static app, the Worker (including adding a provider), and Supabase, each step independent and skippable.
- **Config surface (shipped)**: `GET /capabilities` reports the active provider and its capability flags; the frontend (`src/utils/providerCapabilities.ts`) fails open (treats an older Worker with no route as fully capable) and hides a feature (e.g. the airport delay board) a provider doesn't implement instead of erroring.
- All autonomous; a maintainer deploying a fork is doing their own human step, not ours.

### v3.3 — "Companion surfaces": read-only widgets & views (autonomous, within constraints) — ✅ shipped

- **Focus / trip mode (shipped)**: a full-screen day-of view (`#/focus`, `#/focus/:flightId`) — big countdown, phase, gate, progress — suitable for leaving on a second screen. Reuses the existing `flightLifecycle`/`formatCountdown` engine and `LifecycleChip`/`LifecycleProgress` primitives; ticks a local re-render every 15s (no network activity) to keep the countdown current. Bypasses the normal app shell (no header/nav) for a distraction-free view.
- **Web share target (shipped)**: registered via `manifest.webmanifest` → `share_target` (GET method — the service worker only handles GET requests, so this needed no SW changes). `src/utils/shareTarget.ts` extracts a flight number/date from shared text client-side and routes into the existing `#/add` Quick Add deep link.
- **URL-embeddable read-only card (shipped)**: `#/card?...` — `src/utils/embedCard.ts` encodes/decodes the existing `ShareCardData` shape to/from URL query params; the view reuses the extracted `ShareCardArticle` component with zero IndexedDB access. A "Copy embed link" action ships next to every share-card preview (flight/trip/year).
- Deliberately *not* an OS home-screen widget (needs a native shell — out of scope).

---

## 6. The v4.x line — INTELLIGENCE

Goal: move from recording to assisting. This is where FlightLog earns the "smart" comparison. Provider- and decision-gated.

### v4.0 — "Delay sense": on-device prediction (autonomous heuristics; better with provider data) — ✅ shipped (history-based; live inbound-aircraft data source not yet wired)

- **Heuristic delay model (shipped)**: a transparent, explainable weighted model in `src/utils/predict.ts` — weighs the upcoming flight's own route, airline, and origin-airport delay history (reusing `src/utils/insights.ts`'s existing punctuality aggregation, more measured flights = more weight, capped), producing a delay probability, an expected-delay band, and a low/medium/high confidence tier. Accepts an optional live inbound-aircraft delay minutes signal that folds into the same weighted average when supplied. 20 unit tests with hand-verified weighted-average math against fixtures.
- **Confidence + explanation (shipped)**: every prediction lists which signals fed it and their own stats (e.g. "Your SIN-LAX history: delayed 1 time out of 2, avg 20m late"), surfaced as a compact one-liner on the Dashboard's day-of-travel card and a full breakdown (probability, band, confidence, every signal) on the Flight Detail page's Flight assistant panel — both gated to flights that haven't departed yet.
- ⚠️ **Soft gate (as designed):** the richest signal (inbound aircraft, airport board) needs the v2.7 Worker endpoints plus a new inbound-aircraft-status data source that doesn't exist yet in any provider adapter — `predictDelay()`'s `inboundDelayMinutes` option is already wired to accept it once built, but no live inbound-aircraft fetch ships in this stage. The heuristic works fully history-only today, exactly as the soft-gate design intended.

### v4.1 — "Trip planner": forward-looking assistant (autonomous) — ✅ shipped

- **Connection risk (shipped)**: `src/utils/connectionRisk.ts` — for consecutive same-airport legs of a trip, weighs the scheduled layover against the incoming leg's own delay history via `predictDelay` (v4.0) and flags it low/medium/high with a plain-language explanation. Skips pairs that aren't a real same-airport connection or whose gap is too long to be one (the next leg of a multi-day trip, not a layover).
- **What-if & rebooking hints (shipped)**: `src/utils/rebookingHints.ts` — surfaces the user's own alternative airline/flight-number combinations from history when a flight is cancelled/diverted (no booking — informational only, purely a reflection of the user's own log).
- **Packing/prep checklist (shipped)**: `src/utils/packingChecklist.ts` — a per-trip-type template (personal/work/school/other), fully user-editable (check/add/remove), persisted on `TripMetadata` and synced like any other trip edit.

### v4.2 — "Shared journeys": careful, serverless collaboration (build autonomous; one product gate) — ✅ shipped

Collaboration without betraying the non-negotiables.

- **Export a trip as a signed, optionally-encrypted file (shipped)**: `src/utils/tripShare.ts` — a trip export is a regular full-backup export (scoped to that trip's flights, local/device fields stripped) plus a checksum and a trip-share marker, so it's asynchronous, needs no live server, and no accounts.
- **Merge a shared trip (shipped)** into the recipient's log via the *existing* backup-import pipeline (`parseFullBackupJson`/`previewBackupImport`) unchanged — the Backup Center detects the trip-share marker and shows trip-specific preview copy, hides "Replace all local data", and flags a checksum-mismatch warning if the file was altered after export.
- ⚠️ **Human gate (product/privacy), still deferred:** anything beyond file/link exchange (a shared live view) would need a server and moderation — explicitly out of scope for this stage, pending an owner decision recorded in §10.

### v4.3 — "Deep parity": Variflight-grade reference data (provider/data gated) — ◐ partially shipped (licensing-gated slice skipped; see §10)

- **Aircraft registration history (shipped)** — two layers, per the licensing decision recorded in §10:
  - "You've flown this exact tail before" (`src/utils/tailHistory.ts`): from the user's own logged registrations, no external data.
  - Aircraft lookup (Worker `GET /aircraft-history`, `src/utils/aircraftHistory.ts`): on-demand type/age/delivery-date enrichment via the already-integrated AeroDataBox provider, following the v3.2 provider-adapter pattern, gated by `/capabilities` so forks without it degrade gracefully.
- **Historical route analytics (skipped)** — researched OpenSky Network, US DOT/BTS, AeroDataBox, and OpenFlights; none clears the bar of free + globally applicable + safe for a public open-source app without a bespoke licensing agreement or a from-scratch ETL pipeline over US-only data. Recorded as a declined decision in §10 rather than left as a silent gap.

---

## 7. The v5.x line and beyond — LONGEVITY

Goal: make FlightLog outlive its original author — sustainable, governed, accessible, and archival-grade. Increasingly community- and decision-gated.

### v5.0 — "Built to last": durability & standards (autonomous) — ✅ shipped (Lighthouse gate deferred, see below)

- **Documented, versioned data format (shipped)**: `docs/DATA_FORMAT.md` — every IndexedDB and interchange (backup, encrypted backup, trip share) shape, the migration guarantee (any past backup still imports), and regression tests locking that guarantee in.
- **Accessibility fixes (shipped, autonomous half)**: heading landmarks on every page, a skip-to-content link, the two remaining unlabeled form controls fixed, Escape-to-close + focus-on-open for all overlay UI, a color-contrast fix on locked achievement cards. ⚠️ **Human gate (as designed, see §9):** a full WCAG 2.2 AA sign-off needs human verification alongside these automated fixes — not claimed as "certified." `eslint-plugin-jsx-a11y` (automated regression linting) is deferred until it supports this project's ESLint 10; no compatible release exists yet.
- **Performance budget (shipped, partial)**: `size-limit` bundle-size budgets enforced in a new PR-gated CI workflow (`.github/workflows/ci.yml`) and on the release/deploy path — previously nothing ran automatically before merge. ⚠️ **Deferred:** the Lighthouse PWA ≥ 95 gate — `@lhci/cli`'s current release drags in 300+ transitive packages with several unpatched vulnerabilities (including one high-severity) and no clean fix path; not a tradeoff worth making until the tooling catches up.
- **Storage resilience (shipped)**: an app-wide error boundary, IndexedDB availability feature-detection at startup with a clear on-screen message, a visible recovery banner (linking to Backup Center) instead of a silent empty-dashboard failure when the initial load fails, and error handling on the backup merge/replace actions.

### v5.1 — "Open house": community & governance (human/community gated) — ✅ shipped (announcement still open)

- **Contribution infrastructure (shipped)**: `CONTRIBUTING.md`, issue templates (bug report, feature
  request, a `config.yml` pointing at the roadmap and data-format docs), and a PR template with a
  checklist tied to this repo's actual checks (lint/typecheck/test/build/size, light+dark UI,
  mobile width). The "public roadmap board" is `docs/ROADMAP.md` itself, already public in the
  repo — a separate GitHub Projects board was judged redundant rather than skipped for scope
  reasons. A triage rota needs more than one active maintainer to be meaningful, so it's deferred
  alongside the governance model below rather than invented as a placeholder.
- **Localization program (shipped)**: `docs/LOCALIZATION.md` documents the concrete steps to add a
  language (which files change, how the coverage tests validate it, and that translation quality
  still needs human review before the in-app "pending review" caveat is lifted — the same bar
  zh-CN/zh-TW/ja already cleared, per §10).
- **License, governance, code of conduct (shipped)**: MIT (`LICENSE`), a single-maintainer
  governance model documented in `GOVERNANCE.md` with a described path to a maintainer team if
  the project grows, and the Contributor Covenant v2.1 (`CODE_OF_CONDUCT.md`) — decided by the
  owner; see §10.
- ⚠️ **Still open:** whether/how to announce the project — an exposure decision only the owner
  should make, at the time they actually want to make it, not something to default into.

### v5.2 — "Sustainable": funding without betraying "free" (human decision gated)

- Document a **zero-cost operating baseline** (what must always run on free tiers).
- ⚠️ **Human decision:** if optional shared/provider infrastructure ever needs funding, choose a model (donations, sponsor-run Workers, self-host-only) that never gates the core app behind payment — recorded in §10.

### v5.3 — "Archive": lifetime data stewardship (autonomous) — ✅ shipped

- **Lifetime export (shipped)**: a single self-contained `.html` archive (lifetime stats, achievements, and passport stamp pages rendered as a readable page, no external stylesheet/script/network reference) with the full flight data embedded for round-trip re-import. `docs/DATA_FORMAT.md` documents the `ArchivePayload` shape.
- **Print/PDF passport (shipped)**: the same renderer, reused rather than duplicated, feeds an offscreen iframe on the Passport page that calls the browser's native print/Save-as-PDF — no separate print template or popup window, and the embedded-data/checksum step is skipped since a print is ephemeral.
- **Import from archive (shipped)**: Backup Center's existing restore-file picker also accepts a lifetime archive `.html` file, detected and checksum-verified automatically, previewed and merged/replaced through the same pipeline a plain backup already uses.

### ∞ — HORIZON (revisited each cycle, none committed)

Speculative bets to reconsider as the platform and web evolve — each would require re-testing against the non-negotiables and an explicit §10 entry before promotion out of the horizon:

- **True push notifications** (would need a push server + service — tension with "free to run" / "no server"; only viable via a self-host-optional, sponsor-run relay).
- **Passkey/WebAuthn** local unlock for encrypted data.
- **On-device richer ML** (WebGPU) for prediction, if it stays explainable and offline.
- **Federated, privacy-preserving aggregate stats** (e.g. community route punctuality) only if it can be done without central data collection.
- **CO₂ / offset awareness** per flight and per year, from open emissions datasets.
- **Rail/multimodal legs** — likely a permanent no (keeps the product focused), listed to keep the decision explicit.

---

## 8. Feature-parity matrix (full horizon)

| Capability | Flighty | Variflight | FlightLog plan |
| --- | --- | --- | --- |
| Live status + gates | ✅ | ✅ | ✅ shipped (Worker proxy) |
| Day-of timeline/phases | ✅ | ✅ | ✅ shipped v2.1 |
| Notifications | ✅ | ✅ | ◐ v2.3 (app-open) → v2.3.1 hardening; full push is a Horizon decision |
| Delay prediction | ✅ | ✅ | v2.4 (own history) → v4.0 (inbound-aircraft heuristic) |
| Airport delay boards | — | ✅ | v2.7 |
| Passport / wrapped stats | ✅ | — | ✅ shipped; richer in v2.4 & v3.0 |
| Trip organization | ✅ | — | ✅ shipped v2.1; planner in v4.1 |
| Import from other apps | ✅ | — | v2.5 |
| Calendar integration | ✅ | ✅ | ✅ per-flight; feed export v2.5 |
| Share cards | ✅ | — | ✅ shipped (PNG, E2EE-safe); themes v2.5; passport book v3.0 |
| Chinese localization | — | ✅ | v2.6 (+ community languages v5.1) |
| Check-in reminders/links | ✅ | ✅ | ✅ basic; per-airline deep links (v2.5+) |
| Connection risk / planning | ✅ | ◐ | v4.1 |
| Aircraft/tail history | — | ✅ | ✅ shipped v4.3 (own log + AeroDataBox lookup) |
| Historical route analytics | — | ✅ | Declined — no license-safe global data source (see §10) |
| Collaboration / sharing | ✅ | — | ✅ shipped v4.2 (file/link only); live sharing is a product gate |
| Self-host / bring-your-own-provider | — | — | v3.2 (FlightLog-specific strength) |
| Accessibility AA | ◐ | ◐ | ◐ v5.0 automated audit+fixes shipped; human sign-off pending (target: exceed both) |
| Friends/social feed | ✅ | — | Deliberately out of scope (needs server + moderation) |
| Seat maps, baggage carousel | — | ✅ | Out of scope (no free/licensed data source) |

Legend: ✅ done · ◐ partial/planned · — absent.

---

## 9. What genuinely needs a human

Everything not listed here is autonomously implementable within the non-negotiables. Grouped by stage.

Owner status is noted inline where a gate has already been resolved or declined.

**Credentials / infra**
1. **Provider accounts + Worker deploys** (v2.7, v4.0, v4.3): RapidAPI/secondary provider signup, `wrangler secret put`, `wrangler deploy`. — *Worker + Supabase + Pages already configured by the owner; v2.7 endpoints can build against the live Worker.*
2. ~~**Apple Developer configuration** (v3.x Apple login)~~ — **declined by the owner (cost).** Apple login is not pursued; it moves to the permanently-out-of-scope list unless revisited.
3. **Supabase console actions** (any future migration): running SQL, auth URL config. Near-term stages avoid new tables on purpose. — *Current migrations 001–003 already applied by the owner.*

**Quality / review**
4. ~~**zh-CN / zh-TW / ja translation review** (v2.6)~~ — **done: reviewed and approved by the owner.** Community-language reviews (v5.1) still apply as new languages are added.
5. **Accessibility audit sign-off** (v5.0): human verification alongside automated checks.

**Decisions (recorded in §10)**
6. **Sync-record key-management model** (v3.1).
7. **Live collaboration beyond file/link** (v4.2).
8. ~~**Data-source licensing** for reference data (v4.3)~~ — **decided: see §10.** Aircraft tail history ships (own-log + AeroDataBox); historical route analytics is declined for lack of a clean license-safe global source.
9. ~~**Governance, LICENSE, code of conduct** (v5.1)~~ — **decided: see §10.** MIT license, single-maintainer governance (`GOVERNANCE.md`), Contributor Covenant v2.1. **Announcement** is still open — deliberately left to the owner to decide if/when, not defaulted into alongside the other three.
10. **Sustainability/funding model** (v5.2).
11. **Any Horizon promotion** — especially push, which tensions "free to run" / "no server."

---

## 10. Constraint-evolution ledger

The non-negotiables are a contract; this ledger is where the owner records any deliberate exception. **Empty by default — nothing here is pre-approved.** An implementation session must not relax a non-negotiable without a corresponding entry.

| Date | Constraint touched | Feature | Decision | Owner |
| --- | --- | --- | --- | --- |
| 2026-07-18 | — (scope) | Apple login | **Declined** — Apple Developer Program cost not justified; added to the permanent out-of-scope list. | zheyuanlai |
| 2026-07-18 | — (quality gate) | v2.6 translations (zh-CN / zh-TW / ja) | **Reviewed and approved**; in-app "pending review" disclaimer removed. | zheyuanlai |
| 2026-07-19 | — (security design) | v3.1 Sealed Sync key management | **Decided: passphrase re-entry per device** over wrapped-key escrow — zero-knowledge, consistent with the already-shipped encrypted-backup model, no server-stored key material even wrapped. | zheyuanlai |
| 2026-07-19 | — (data licensing) | v4.3 Deep parity data sources | **Researched and decided.** Aircraft tail history: ships two ways — "you've flown this tail before" from the user's own logged flights (no external data, no license question) plus an aircraft-lookup enrichment via AeroDataBox, the provider already integrated and paid for since v2.7 (confirmed to offer a registration-lookup endpoint, works globally, no non-commercial restriction). Historical route analytics: **declined** — OpenSky Network's terms require a separate written license for use in any live product regardless of non-commercial status; US DOT/BTS is public-domain but US-domestic-only with no API (bulk monthly files only, would require building and hosting a full ETL pipeline for a feature that would then only cover a fraction of routes); OpenFlights' routes data is stale since ~2014 and has no aircraft/on-time fields. No source met the bar of free + globally applicable + safe for a public open-source app without a bespoke agreement or major new infrastructure — skipped rather than shipped on a shaky license or with US-only coverage presented as general. | zheyuanlai |
| 2026-07-19 | — (governance) | v5.1 License, governance, code of conduct | **Decided.** License: **MIT** — permissive, standard for a small tool with no existing forks/external contributors to disrupt, easy to revisit later since nothing depends on the choice yet. Governance: **single maintainer** (`GOVERNANCE.md`), documenting current reality rather than adopting a committee structure prematurely; describes a path to a maintainer team if sustained outside contribution happens. Code of conduct: **Contributor Covenant v2.1** (`CODE_OF_CONDUCT.md`), the de facto standard. Deliberately excludes the fourth item bundled with these in earlier drafts of this ledger — **whether/how to announce the project** — since that's an exposure decision that needs the owner's explicit go-ahead at the time, not a default. | zheyuanlai |

Candidate future entries (pending, not decided): whether/how to announce the project; push relay vs. "no server"; live collaboration vs. "no server"; any funded infra vs. "free to run."

---

## 11. Engineering loop per release

Applies to every stage; this is the loop v2.1–v2.3 already used.

1. **Utilities + types first**, as pure functions with vitest coverage.
2. **UI wiring + CSS** second — including dark mode and ≤800px mobile layout.
3. **Version chores**: service-worker cache bump, `appVersion`, README section, and update the tables in this file.
4. **Adversarial review** of the full diff (multi-agent: correctness, security, UI/regression dimensions; each finding independently verified); fix all confirmed findings before merge.
5. **Green gates**: `lint` / `typecheck` / `test` / `build` → push → PR → merge → Pages deploy.

**Definition of done for a stage**: all listed features shipped and documented, no regression in the data-safety checklist, review findings closed, and this file's status tables updated in the same commit as the release's README notes.

---

## 12. Sequencing summary

```
NOW
 │
 ├─ v2.x MATURITY ─────────────────────────────────────────────────────────────
 │   v2.3.1 notif hardening → v2.4 Insights → v2.5 Doors open
 │        → v2.6 你好 (zh-CN, human review) → v2.7 Live depth (human deploy)
 │
 ├─ v3.x PLATFORM ─────────────────────────────────────────────────────────────
 │   v3.0 Passport Pro → v3.1 Sealed sync (key design gate)
 │        → v3.2 Bring-your-own-provider → v3.3 Companion surfaces
 │
 ├─ v4.x INTELLIGENCE ─────────────────────────────────────────────────────────
 │   v4.0 Delay sense → v4.1 Trip planner
 │        → v4.2 Shared journeys (product gate) → v4.3 Deep parity (data gate)
 │
 ├─ v5.x LONGEVITY ────────────────────────────────────────────────────────────
 │   v5.0 Built to last → v5.1 Open house (governance gates)
 │        → v5.2 Sustainable (funding gate) → v5.3 Archive
 │
 └─ ∞ HORIZON  (push, passkeys, WebGPU ML, federated stats, CO₂) — revisited each cycle
```

Autonomous stages front-load value; every human gate is small, well-framed, and sits after the autonomous work around it is done.

## 13. Definition of "finished"

FlightLog is "done" — the target software realized — when:

- The **full flight arc** (plan → check-in → live day-of → log → passport) is covered end to end (through v3.0).
- It is **at parity** with Flighty and Variflight on everything achievable without their paid infrastructure (through v4.x), and **ahead** on ownership, privacy, and self-hostability (v3.2) — capabilities neither competitor offers.
- It is **multilingual, accessible (AA), performant, and archival-grade** (v2.6, v5.0, v5.3).
- It is **sustainable and governed** so it outlives its original author (v5.x).

At that point the Horizon list is the only open work, and each item is a deliberate, owner-approved bet — not a gap.

---

*Maintained by the FlightLog development loop. Update the status tables here in the same commit as each release's README notes. The vision and non-negotiables change only by an explicit entry in the §10 ledger.*
