# Adding a language to FlightLog

FlightLog's localization layer is a small, dependency-free `t(key)` dictionary — no i18n framework,
no build step, no external translation service. Adding a language is a self-contained code change
that touches four files.

English (`en`) is the source of truth. Every other language is validated against it in
`src/tests/i18n.test.ts`: a locale that's missing a key, or carries a key English doesn't have,
fails the test suite. A locale is allowed to be incomplete during development — untranslated keys
fall back to English at runtime — but it must not fail those two coverage tests before merging.

## What's translated today

Coverage is intentionally partial: navigation, the mobile "More" menu, the Add-flight action, the
footer, and the language setting itself. The long tail of in-app strings (form labels, empty
states, toasts, achievement copy, ...) is still English-only and gets keyed progressively — this is
exactly the kind of incremental work a new contributor can pick up alongside adding a language.

## Steps to add a language

1. **`src/types.ts`** — add the new code to the `LanguageSetting` union
   (e.g. `'system' | 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko'`).
2. **`src/utils/settings.ts`** — add the same code to the `languages` Set so it's accepted as a
   valid stored setting.
3. **`src/utils/i18n.ts`**:
   - Add the code to the `Language` type and the `supportedLanguages` array.
   - Add a `{ value, label }` entry to `languageOptions` — `label` is the language's own name for
     itself in its own script (e.g. `'한국어'`, not `'Korean'`), which is how the other four
     languages are labeled.
   - Add a new dictionary object with **every** key from `messageKeys` (copy the `en` object as a
     starting point and translate each value — do not skip keys; use your best judgment for any
     that don't translate cleanly, rather than leaving them in English, so the coverage test in
     step 4 passes).
   - Add the new dictionary to the `dictionaries` record.
   - If the language should be detected from the browser's language automatically (the `'system'`
     setting), extend `resolveLanguage` — see how it already disambiguates Simplified vs.
     Traditional Chinese using script/region subtags for a model of how to handle a language with
     script or regional variants.
4. **`src/tests/i18n.test.ts`** — add the new language to any test that iterates a fixed list of
   languages by name (most tests already iterate `supportedLanguages`, so this is often a no-op);
   add a translation spot-check or two for the new language.

Run `npx vitest run` — the two coverage tests in `i18n.test.ts` (`defines every English key`,
`does not carry keys a locale defines that English does not`) will fail loudly if a key was missed
or a stray key was added, so a clean test run is a strong signal the dictionary is structurally
correct. It does not check translation *quality* — that still needs a native or fluent speaker
to review before it's presented as reviewed in the README (see the note below).

## Review status matters

`zh-CN`, `zh-TW`, and `ja` are marked in `README.md` as reviewed and approved by the maintainer
(recorded in `docs/ROADMAP.md` §10). A new language's translations should get the same explicit
human review before that language is presented as complete — open the PR with translations, but
expect a review pass (from the maintainer, or ideally a native speaker of that language) before the
in-app "pending review" caveat is lifted for it, matching how earlier languages were handled.
