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
6. **Permanently out of scope** (unless overruled): payments, native app-store builds, realtime sync, background server-side polling of provider data.

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

### v2.4 — "Insights": Variflight-style analytics from your own data (autonomous)

Variflight's superpower is data depth; much of it is computable on device from the user's own history.

- **Punctuality panels** per airline / route / airport from logged scheduled-vs-actual times: average delay, on-time %, best/worst routes.
- **Delay context on Flight Detail**: "Your history on this route: 4 flights, avg departure delay 22m."
- **Map upgrades**: great-circle arcs (tested as pure math), per-trip map filtering, trip-detail mini map.
- **Yearly "wrapped"**: a stepped, story-style summary reusing the PNG share-card renderer per slide.
- Tests: `src/utils/insights.ts` pure functions; arc math pure and covered.

### v2.5 — "Doors open": import/export ecosystem (mostly autonomous)

Lower switching cost from other trackers.

- **Importers** with dedupe preview (reusing backup-merge duplicate detection): Flighty CSV, myFlightradar24 CSV, App in the Air export, and a generic column-mapping wizard.
- **Deep-link Quick Add**: `#/add?flight=SQ38&date=2026-06-02` prefills the lookup form.
- **Calendar feed export**: one `.ics` with all upcoming flights.
- **Share-card themes**: 2–3 additional PNG palettes selectable in the share panel.
- *Soft dependency:* real exported files from the owner's accounts would harden importer tests (optional assist, not a blocker — public format docs suffice for fixtures).

### v2.6 — "你好": Chinese localization (autonomous build, human review gate)

Highest-leverage reach feature; the owner is bilingual and Variflight's market is Chinese-speaking.

- **Dependency-free i18n**: a `t(key)` dictionary module, a `language` setting (`system | en | zh-CN`), locale-aware Luxon/Intl formatting.
- **Full zh-CN dictionary** for every user-facing string; English fallback for missing keys; a test asserting dictionary completeness against the key registry.
- ⚠️ **Human gate (quality, not build):** native-speaker review of aviation terminology (值机 / 登机口 / 经停 / 备降) before announcement.

### v2.7 — "Live depth": provider-powered day-of data (autonomous code, human deploy gate)

Where Flighty/Variflight parity needs richer upstream data; the Worker grows.

- **Provider fallback chain** in the Worker (AeroDataBox primary + optional secondary), normalized output, mock-mode preserved so the app stays fully testable without credentials.
- **Airport delay board** panel fed by a new Worker endpoint.
- **Inbound-aircraft awareness** ("your plane is arriving from…") — the best single delay predictor Flighty offers.
- **Smarter refresh cadence** near departure, within the no-background-polling rule.
- ⚠️ **Human gate:** provider accounts, `wrangler secret put`, `wrangler deploy`.

---

## 5. The v3.x line — PLATFORM

Goal: deepen the passport identity and turn FlightLog from an app into a small, forkable platform. Mostly autonomous, with a few decision/credential gates.

### v3.0 — "Passport Pro": identity & achievements (autonomous)

- **Achievements v2**: continents, red-eyes, longest streaks, hemisphere crossings, equator/date-line crossings — a milestone engine with Canvas-drawn stamp artwork.
- **Passport book view**: a paginated, page-turn passport reusing the share renderer; each visited country a stamped page.
- **Streaks & goals**: user-set targets (countries/year, airports) with progress on the dashboard.
- Tests: milestone engine as pure functions over flight history.

### v3.1 — "Sealed sync": end-to-end encrypted Sync Lite records (autonomous build, one design gate)

Extend E2EE from snapshots to record-level sync.

- Per-record AES-GCM using a key derived from a sync passphrase; server stores only ciphertext + non-sensitive routing columns.
- Backward-compatible: unencrypted records still sync; a per-user "encrypt sync" opt-in.
- ⚠️ **Human gate (security design):** cross-device key management — passphrase re-entry per device vs. a wrapped-key escrow. Changes the threat model; the owner chooses. Everything else is autonomous.

### v3.2 — "Bring your own provider": pluggable data layer (autonomous)

Make FlightLog forkable and self-hostable end to end.

- **Provider adapter interface** in the Worker so a fork can swap AeroDataBox for FlightAware, OpenSky, AviationStack, etc., by implementing one module.
- **Self-host guide + one-click templates**: documented `wrangler` deploy, `.dev.vars` templates, and a GitHub-Pages-plus-Worker fork checklist.
- **Config surface**: the app reads provider capability flags from the Worker so features degrade gracefully per deployment.
- All autonomous; a maintainer deploying a fork is doing their own human step, not ours.

### v3.3 — "Companion surfaces": read-only widgets & views (autonomous, within constraints)

- **Focus / trip mode**: a full-screen day-of view (big countdown, gate, progress) suitable for leaving on a second screen.
- **Web share target**: register as a share target so a flight number shared from another app opens Quick Add.
- **URL-embeddable read-only card**: a self-contained, no-data share view (renders from URL params only — no stored data, no server).
- Deliberately *not* an OS home-screen widget (needs a native shell — out of scope).

---

## 6. The v4.x line — INTELLIGENCE

Goal: move from recording to assisting. This is where FlightLog earns the "smart" comparison. Provider- and decision-gated.

### v4.0 — "Delay sense": on-device prediction (autonomous heuristics; better with provider data)

- **Heuristic delay model** trained/tuned on device from the user's own history + (when available) inbound-aircraft status: a probability and expected-delay band per upcoming flight. No server ML — a transparent, explainable weighted model in `src/utils/predict.ts`, fully unit-tested against fixtures.
- **Confidence + explanation**: every prediction shows its inputs ("this route delayed 3/5 times; inbound aircraft currently 40m late").
- ⚠️ **Soft gate:** the richest signal (inbound aircraft, airport board) needs the v2.7 Worker endpoints deployed; the heuristic degrades gracefully to history-only without them.

### v4.1 — "Trip planner": forward-looking assistant (autonomous)

- **Connection risk**: for multi-leg trips, flag tight connections using logged/scheduled times and the delay model.
- **What-if & rebooking hints**: surface the user's own alternative routes from history when a flight is cancelled/diverted (no booking — informational only).
- **Packing/prep checklist** per trip type, local and user-editable.

### v4.2 — "Shared journeys": careful, serverless collaboration (build autonomous; one product gate)

Collaboration without betraying the non-negotiables.

- **Export a trip as a signed, optionally-encrypted link/file** a companion can import — asynchronous, no live server, no accounts required.
- **Merge a shared trip** into the recipient's log with the existing dedupe preview.
- ⚠️ **Human gate (product/privacy):** anything beyond file/link exchange (a shared live view) would need a server and moderation — explicitly deferred pending an owner decision recorded in §10.

### v4.3 — "Deep parity": Variflight-grade reference data (provider/data gated)

- **Historical route analytics** (typical aircraft, seasonal punctuality) where a free/permissively-licensed dataset exists.
- **Aircraft registration history** ("you've flown this exact tail before") from logged registrations + optional provider lookup.
- ⚠️ **Human gate:** each depends on a data source whose licensing must be confirmed before shipping (see §9/§10). No scraping; permissive/licensed sources only.

---

## 7. The v5.x line and beyond — LONGEVITY

Goal: make FlightLog outlive its original author — sustainable, governed, accessible, and archival-grade. Increasingly community- and decision-gated.

### v5.0 — "Built to last": durability & standards (autonomous)

- **Documented, versioned data format** with a migration guarantee and a standalone spec doc.
- **Accessibility certification**: WCAG 2.2 AA audit and fixes; keyboard-complete flows; screen-reader passes.
- **Performance budget**: enforced bundle/size budgets in CI; Lighthouse PWA ≥ 95 gate per release.
- **Storage resilience**: IndexedDB corruption detection + guided recovery from the last backup.

### v5.1 — "Open house": community & governance (human/community gated)

- **Contribution infrastructure**: CONTRIBUTING, issue/PR templates, a public roadmap board, and a triage rota.
- **Localization program**: a translation-contribution workflow so the community can add languages beyond en/zh-CN.
- ⚠️ **Human gates:** LICENSE confirmation, governance model (BDFL vs. maintainer team), code of conduct adoption, and whether/how to announce the project.

### v5.2 — "Sustainable": funding without betraying "free" (human decision gated)

- Document a **zero-cost operating baseline** (what must always run on free tiers).
- ⚠️ **Human decision:** if optional shared/provider infrastructure ever needs funding, choose a model (donations, sponsor-run Workers, self-host-only) that never gates the core app behind payment — recorded in §10.

### v5.3 — "Archive": lifetime data stewardship (autonomous)

- **Lifetime export**: a single portable archive (data + generated passport + wrapped pages) designed to be readable decades later without the app.
- **Print/PDF passport**: a high-quality printable passport and yearly report via the Canvas/PDF path.
- **Import from archive**: full round-trip from the lifetime export.

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
| Aircraft/tail history | — | ✅ | v4.3 (data-license gated) |
| Historical route analytics | — | ✅ | v4.3 (data-license gated) |
| Collaboration / sharing | ✅ | — | v4.2 file/link only; live sharing is a product gate |
| Self-host / bring-your-own-provider | — | — | v3.2 (FlightLog-specific strength) |
| Accessibility AA | ◐ | ◐ | v5.0 (target: exceed both) |
| Friends/social feed | ✅ | — | Deliberately out of scope (needs server + moderation) |
| Seat maps, baggage carousel | — | ✅ | Out of scope (no free/licensed data source) |

Legend: ✅ done · ◐ partial/planned · — absent.

---

## 9. What genuinely needs a human

Everything not listed here is autonomously implementable within the non-negotiables. Grouped by stage.

**Credentials / infra**
1. **Provider accounts + Worker deploys** (v2.7, v4.0, v4.3): RapidAPI/secondary provider signup, `wrangler secret put`, `wrangler deploy`.
2. **Apple Developer configuration** (v3.x Apple login, if pursued): account, Services ID, Supabase Apple provider.
3. **Supabase console actions** (any future migration): running SQL, auth URL config. Near-term stages avoid new tables on purpose.

**Quality / review**
4. **zh-CN translation review** (v2.6) and community-language reviews (v5.1): native-speaker passes.
5. **Accessibility audit sign-off** (v5.0): human verification alongside automated checks.

**Decisions (recorded in §10)**
6. **Sync-record key-management model** (v3.1).
7. **Live collaboration beyond file/link** (v4.2).
8. **Data-source licensing** for reference data (v4.3).
9. **Governance, LICENSE, code of conduct, announcement** (v5.1).
10. **Sustainability/funding model** (v5.2).
11. **Any Horizon promotion** — especially push, which tensions "free to run" / "no server."

---

## 10. Constraint-evolution ledger

The non-negotiables are a contract; this ledger is where the owner records any deliberate exception. **Empty by default — nothing here is pre-approved.** An implementation session must not relax a non-negotiable without a corresponding entry.

| Date | Constraint touched | Feature | Decision | Owner |
| --- | --- | --- | --- | --- |
| — | (none yet) | — | — | — |

Candidate future entries (pending, not decided): push relay vs. "no server"; live collaboration vs. "no server"; any funded infra vs. "free to run."

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
