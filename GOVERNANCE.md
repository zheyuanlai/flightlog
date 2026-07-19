# Governance

FlightLog is currently maintained by a single person ([@zheyuanlai](https://github.com/zheyuanlai)),
who makes final decisions on scope, design direction, and what gets merged. This is a description
of how the project actually runs today, not a permanent commitment to staying this way.

## How decisions get made

- **Day-to-day**: bug fixes and small, clearly-scoped changes are reviewed and merged directly by
  the maintainer.
- **New features or larger changes**: discussed in an issue first (see
  [`CONTRIBUTING.md`](CONTRIBUTING.md)) before significant implementation work, so a proposal can
  be checked against the project's non-negotiables (documented in
  [`docs/ROADMAP.md`](docs/ROADMAP.md) §1) before anyone invests time in it.
- **Disagreements**: the maintainer has final say. This is a small, opinionated personal project,
  not a design-by-committee effort — the [product plan](docs/ROADMAP.md) lays out the intended
  direction so contributors can see where a proposal does or doesn't fit before opening a PR.

## If the project grows

There's no maintainer team today because there's no track record of sustained outside
contribution yet. If that changes — a contributor sends multiple substantial, well-reviewed PRs
over time — the natural next step is inviting them to a co-maintainer role with merge access,
rather than adopting a formal committee/voting structure prematurely. Any such change, along with
anything else that touches this document, would be recorded in `docs/ROADMAP.md`'s decision
ledger (§10), the same place every other constraint-affecting decision in this project is tracked.

## Code of conduct

FlightLog follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Report concerns as described
there.
