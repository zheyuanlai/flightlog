# FlightLog Product Plan

FlightLog is a free, open-source personal flight tracker and passport: the day-of-travel awareness of Flighty and the data depth of Variflight (飞常准), built local-first so it costs nothing to run and the user always owns their data.

This document is the complete staged plan toward that goal: what ships in which stage, why the stages are ordered this way, and which items genuinely require a human decision or credential. It is written to be executable — each stage is scoped so an implementation session can pick it up and ship it end to end.

## 1. Vision and non-negotiables

**Vision.** One app that covers the full arc of a flight: plan it, check in for it, watch it live on the day, log what actually happened, and look back at a beautiful passport of everywhere you have flown — without accounts, subscriptions, or data leaving the device unless the user explicitly opts in.

**Non-negotiables** (these hold at every stage):

1. **Local-first.** The core app works fully offline from IndexedDB. Cloud features (Supabase auth, backup, Sync Lite) stay optional.
2. **Free to run.** Static hosting (GitHub Pages) plus free-tier services only. No component may require a paid server to exist.
3. **No secrets in the frontend.** Provider API keys live only in the Cloudflare Worker environment.
4. **Privacy by default.** Nothing is uploaded without an explicit user action; E2EE is offered wherever data leaves the device.
5. **No heavy dependencies.** Prefer WebCrypto, Canvas, and hand-rolled utilities over new packages.
6. **Out of scope permanently** (unless the owner overrules): payments, native iOS/Android builds, realtime sync, background polling.

## 2. Where we are (shipped)

| Release | Theme | Highlights |
| --- | --- | --- |
| v1.x | Foundation | Manual + live logging, airports dataset, backups, cloud backup, Sync Lite, tombstones/Trash |
| v2.0 | Mobile PWA | Bottom nav, installable shell, offline behavior, share-card previews |
| v2.1 | Lifecycle & trips | Flight lifecycle assistant, day-of-travel card, post-flight completion prompts, PNG share cards, manual trip editor |
| v2.2 | Data security | E2EE local + cloud backups (PBKDF2/AES-GCM with AEAD-bound headers), field-level conflict merge |
| v2.3 | Day-of notifications | Opt-in phase-transition and gate-change notifications while the app is open |

Each release follows the same engineering loop (see §6), including an adversarial multi-agent review before merge.

## 3. Staged roadmap

Stages are ordered by user value per unit of risk: on-device analytics before provider-dependent features, localization before social, and anything requiring human credentials parked in clearly marked slots.

### Stage A — v2.4 "Insights": Variflight-style analytics from your own data

Variflight's superpower is data depth. Much of that depth can be computed **on device** from the user's own history — no provider, no server.

- **Punctuality panels**: per airline, per route, and per airport, computed from logged scheduled vs actual times — average delay, on-time percentage, best/worst routes. Surfaced on Passport and a new "Insights" section.
- **Delay context on Flight Detail**: "Your history on this route: 4 flights, avg departure delay 22m."
- **Map upgrades**: great-circle arcs instead of straight polylines, per-trip map filtering, and a trip-detail mini map.
- **Yearly wrapped flow**: a stepped, story-style yearly summary (top routes, new airports/countries, longest flight, punctuality) reusing the PNG share-card renderer per slide.
- Tests: pure analytics utilities (`src/utils/insights.ts`) with vitest coverage; map arc math tested as pure functions.

*Dependencies: none. Fully autonomous.*

### Stage B — v2.5 "Doors open": import/export ecosystem

Adoption depends on switching cost. Make it trivial to arrive from other trackers.

- **Importers** with dedupe preview (reusing the backup-merge duplicate detection): Flighty CSV export, myFlightradar24 CSV, App in the Air text export, and a generic column-mapping CSV wizard for anything else.
- **Deep-link Quick Add**: `#/add?flight=SQ38&date=2026-06-02` so links from anywhere prefill the lookup form.
- **Calendar feed export**: one .ics file containing all upcoming flights (each with the existing per-flight event content).
- **Share-card themes**: 2–3 additional PNG palettes (light, dark, passport-stamp) selectable in the share panel.

*Dependencies: sample export files for the importers are the only soft spot — formats are documented well enough in community sources to implement against fixtures, but a real exported file from the owner's accounts would harden the tests (optional human assist, not a blocker).*

### Stage C — v2.6 "你好": Chinese localization

Variflight's home market is Chinese-speaking; the owner is bilingual. This is the single highest-leverage reach feature.

- **i18n foundation without dependencies**: a `t(key)` dictionary module, a `language` setting (`system | en | zh-CN`), and locale-aware date formatting via the existing Luxon/Intl paths.
- **Full zh-CN dictionary** for all user-facing strings (navigation, dashboard, lifecycle labels, settings, backup/sync flows, notifications, share cards).
- **Mechanics**: extraction sweep over App.tsx and utils, English fallback for missing keys, tests asserting dictionary completeness against the key registry.
- ⚠️ **Needs human (quality gate, not implementation)**: a native-speaker review pass of the translations before the release is announced — aviation terminology (值机/登机口/经停/备降) deserves a human eye. Implementation and a best-effort translation are autonomous; the review is the human step.

### Stage D — v2.7 "Live depth": provider-powered day-of data

This is where Flighty/Variflight parity requires better upstream data, and where the Cloudflare Worker grows.

- **Worker: provider fallback chain** (AeroDataBox primary, optional secondary provider) with normalized output — code is autonomous; ⚠️ **needs human**: creating provider accounts, setting Worker secrets, and running `wrangler deploy`.
- **Airport delay board**: a Variflight-style "how is SIN doing right now" panel fed by a new Worker endpoint (provider-dependent; same human deploy gate).
- **Inbound-aircraft awareness** ("your plane is arriving from…"), the single best delay predictor Flighty offers — provider-dependent.
- **Smarter refresh cadence**: auto-refresh suggestions tightening near departure within the existing no-background-polling rule.
- Every Worker change ships with mock-mode support so the app remains fully testable without credentials.

### Stage E — v3.0 "Passport Pro": identity and longevity

- **Passport achievements v2**: richer milestone system (continents, red-eyes, longest streaks) with stamp artwork drawn via Canvas.
- **Encrypted Sync Lite records**: extend E2EE from snapshots to record-level sync. ⚠️ **Needs human (design decision)**: key management across devices — passphrase-per-device re-entry vs. stored wrapped key trade-off changes the security posture, and the owner should choose.
- **Apple login**: implementation is small; ⚠️ **needs human**: Apple Developer account, Services ID, and Supabase provider configuration.
- **Public "wrapped" pages** (optional): publishing a yearly summary as a static shareable page. ⚠️ **Needs human (product/privacy decision)**: whether FlightLog should ever host user-generated public content.

### Continuous tracks (every stage)

- Data-safety regression checklist before each merge (soft-delete visibility, Trash, backup round-trip, RLS untouched).
- Adversarial review workflow on each release diff; confirmed findings fixed before merge.
- Service-worker cache bump + README release notes per release.
- Dependency updates quarterly; Lighthouse/PWA audit each minor release.

## 4. Feature parity matrix

| Capability | Flighty | Variflight | FlightLog status |
| --- | --- | --- | --- |
| Live status + gates | ✅ | ✅ | ✅ shipped (Worker proxy) |
| Day-of timeline/phases | ✅ | ✅ | ✅ shipped v2.1 |
| Push notifications | ✅ | ✅ | ◐ v2.3 (while app open; full push is out of scope — no server) |
| Delay prediction | ✅ | ✅ | ◐ Stage A (own-history stats) + Stage D (inbound aircraft) |
| Airport delay boards | — | ✅ | Stage D |
| Passport / wrapped stats | ✅ | — | ✅ shipped; richer in Stages A & E |
| Trip organization | ✅ | — | ✅ shipped v2.1 (manual trip editor) |
| Import from other apps | ✅ | — | Stage B |
| Calendar integration | ✅ | ✅ | ✅ per-flight; feed export in Stage B |
| Share cards | ✅ | — | ✅ shipped v2.1–v2.2 (PNG, E2EE-safe) |
| Chinese localization | — | ✅ | Stage C |
| Check-in reminders/links | ✅ | ✅ | ✅ basic (airline link in check-in window); per-airline deep links later |
| Friends/social sharing | ✅ | — | Deliberately out of scope (requires a server and moderation) |
| Seat maps, baggage carousel | — | ✅ | Out of scope (no free data source) |

## 5. What genuinely needs a human

Everything not listed here is autonomously implementable within the non-negotiables.

1. **Apple Developer configuration** (Stage E): account, Services ID, Supabase Apple provider setup.
2. **Provider credentials + Worker deploys** (Stage D): RapidAPI/secondary provider accounts, `wrangler secret put`, `wrangler deploy`.
3. **Supabase console actions** (any future migration): running SQL migrations, auth URL configuration. Current stages deliberately avoid new tables.
4. **zh-CN translation review** (Stage C): native-speaker quality pass.
5. **Product/privacy decisions**: public wrapped pages (Stage E), sync-record key management model (Stage E), and any revisiting of the out-of-scope list.
6. **Community setup** (whenever desired): LICENSE choice confirmation, CONTRIBUTING.md tone, issue templates, and whether to announce the project.

## 6. Engineering loop per release

Applies to every stage; this is the loop v2.1–v2.3 already used.

1. Utilities + types first, as pure functions with vitest coverage.
2. UI wiring + CSS (including dark mode and ≤800px mobile layout) second.
3. Version chores: service-worker cache bump, `appVersion`, README section.
4. Adversarial review of the full diff (multi-agent: correctness, security, UI/regression dimensions; each finding independently verified); fix all confirmed findings.
5. `lint` / `typecheck` / `test` / `build` green → push → PR → merge → Pages deploy.

**Definition of done for a stage**: all listed features shipped and documented, no regression in the data-safety checklist, review findings closed, and the roadmap table in this file updated.

## 7. Sequencing summary

```
now ──> v2.4 Insights ──> v2.5 Doors open ──> v2.6 你好 (zh-CN) ──> v2.7 Live depth ──> v3.0 Passport Pro
        on-device        importers, ics,      i18n + translation   worker growth       achievements, E2EE sync,
        analytics, maps  deep links           (human review gate)  (human deploy gate)  Apple login (human gates)
```

The order is deliberate: A and B compound the value of data users already have; C widens the audience; D and E are gated on human credentials/decisions, so they sit last — by the time we reach them, everything autonomous is already shipped.

---

*Maintained by the FlightLog development loop. Update the status tables here in the same commit as each release's README notes.*
