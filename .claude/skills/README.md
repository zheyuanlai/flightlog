# Vendored skills — design engineering (animation & motion)

These are **third-party Claude Code / agent skills**, not FlightLog's own code. They encode
Emil Kowalski's design-engineering philosophy (animation decisions, easing, timing, the invisible
details that make UI feel right) so an agent working on this repo makes better motion decisions.

- **Source**: https://github.com/emilkowalski/skills
- **Author**: Emil Kowalski ([emilkowal.ski](https://emilkowal.ski/), [animations.dev](https://animations.dev/))
- **License**: MIT © Emil Kowalski — see [`LICENSE`](LICENSE) in this directory. FlightLog's own
  MIT license (repo root) does not cover this vendored content; the copyright here stays with Emil.

## What's here

| Skill | Purpose |
| --- | --- |
| `emil-design-eng/` | Core philosophy: animation decision framework, easing curves, durations, component principles |
| `improve-animations/` | Audit a codebase's motion and produce prioritized findings + plans (`AUDIT.md`, `PLAN-TEMPLATE.md`) |
| `review-animations/` | Strict review of a motion diff against a fixed standard (`STANDARDS.md`) |
| `find-animation-opportunities/` | Spot places that should animate but don't |
| `animation-vocabulary/` | Shared language for talking about motion with an agent |
| `apple-design/` | Apple's interface & motion principles adapted for the web |

## How FlightLog used them

FlightLog's **v5.4 "Motion"** pass (see `README.md` and `docs/ROADMAP.md`) applied the
`improve-animations` audit and the `emil-design-eng` / `review-animations` standards to the app —
pure CSS, no new runtime dependencies, honoring the project's "no heavy dependencies"
non-negotiable. The result: motion tokens, press feedback, `prefers-reduced-motion` handling,
hover gating, and subtle `@starting-style` enter animations, all reviewed against the standard
above.

To update these skills, re-pull from the upstream repo rather than editing them here.
