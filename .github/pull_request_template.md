## Summary

<!-- What does this PR change, and why? -->

## Related issue

<!-- Link an existing issue if there is one. For anything beyond a small fix, opening an issue first is
     appreciated so the approach can be discussed before you put time into a PR. -->

## Checklist

- [ ] `npm run lint`, `npm run typecheck` (or `npm run build`), and `npx vitest run` all pass locally
- [ ] Added/updated tests for any new or changed logic in `src/utils/`
- [ ] UI changes checked in both light and dark mode, and at a mobile width (≤ 800px)
- [ ] No new dependency was added without a quick look at its size and maintenance status — this project tracks a bundle-size budget (`npm run size`)
- [ ] Docs updated if this changes behavior described in `README.md` or `docs/DATA_FORMAT.md`

## Non-negotiables

<!-- FlightLog's docs/ROADMAP.md lists a small set of deliberate constraints: local-first storage,
     no ads/tracking, free to run, and no server dependency for core features. If this PR
     touches any of those, please say how/why in a sentence or two. -->
