# Contributing to FlightLog

Thanks for considering a contribution. This document covers the mechanics of contributing —
local setup, checks, and the PR process. It does not (yet) cover licensing or governance; see the
**Legal and governance status** section below before you invest significant time.

## Before you start

- **Bug or small fix**: open a PR directly, or an issue first if you'd like feedback on approach.
- **New feature or larger change**: please open an issue first. FlightLog has a small set of
  deliberate non-negotiables (local-first storage, no ads/tracking, free to run, no
  server dependency for core features) documented in [`docs/ROADMAP.md`](docs/ROADMAP.md) — an
  issue is the place to check a proposal against those before writing code.
- **Adding a language**: see [`docs/LOCALIZATION.md`](docs/LOCALIZATION.md) for the specific steps.
- **Changing the on-device or backup data format**: read
  [`docs/DATA_FORMAT.md`](docs/DATA_FORMAT.md) first — the migration guarantee it describes
  (an old backup always imports in a newer version) is load-bearing for anyone's real flight
  history, so changes there get extra scrutiny.

## Local setup

```sh
npm install
npm run dev
```

## Checks

```sh
npm run lint
npm run typecheck
npm run test
npm run build
npm run size
```

All of these run in CI on every PR (`.github/workflows/ci.yml`); a clean local run is a strong
signal the PR will pass. `npm run size` checks the production bundle against the budgets in
`.size-limit.json` — see [`README.md`](README.md#v50-built-to-last) for the reasoning.

## Pull requests

Opening a PR fills in a template (`.github/pull_request_template.md`) with a short checklist:
tests passing locally, new/changed logic covered by a test in `src/utils/`, UI changes checked in
both light and dark mode and at a mobile width, and a note on bundle size for new dependencies.
It's a checklist, not a gate — if something doesn't apply, say why in the PR description rather
than leaving it unchecked with no context.

## Code style

There's no separate style guide beyond what `npm run lint` (ESLint) enforces. In general: prefer
editing existing files over adding new ones, avoid introducing abstractions a change doesn't need,
and keep comments to the "why," not the "what" (identifiers should already say what code does).

## Legal and governance status

FlightLog does not yet have a LICENSE file, a formal governance model, or a code of conduct — these
are open items tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md#9-what-genuinely-needs-a-human) (§9,
items 9–10) as decisions only the project's owner can make, not something a contribution session
can resolve on its own. Until a LICENSE is added, the source is visible on GitHub but no license is
granted for reuse beyond what's needed to review and contribute back to this repository. If you're
considering a contribution that depends on knowing the license terms (e.g. redistributing, forking
for a separate product), please check the current status in `docs/ROADMAP.md` or ask in an issue
first — this section will be updated once those decisions are made.
