## Summary

<!-- What changed and why. Lead with the user-visible behaviour, not the implementation. -->

## Motivation

<!-- The problem this solves. Link the issue or describe the tester-facing pain point. -->

## Changes

<!-- Group by area. Keep each bullet to one reviewable idea. -->

| Area | Change |
| --- | --- |
|  |  |

## Reviewing this PR

> [!IMPORTANT]
> **`dist/` is generated output — do not review it line by line.** It is committed so the
> bookmarklet and unpacked extension stay loadable without a build step, but it is produced
> verbatim by `python scripts/build.py`. Review the `src/`, `scripts/` and docs changes, then
> confirm `dist/` was regenerated from them.

Reviewable surface for this PR:

- [ ] `src/` — <!-- list the files that carry real logic -->
- [ ] `scripts/build.py` — <!-- note any new type construct added to the stripper allowlists -->
- [ ] `readme.md` / `rules.md` — docs kept in step with behaviour

## How to test

> [!WARNING]
> **The bookmarklet in `dist/bookmarklet.txt` cannot validate a feature branch.** It loads from
> jsDelivr pinned to `@main`, so clicking it serves the **old** build and the changes below will
> appear to be missing. Use one of the two methods here instead.

**Option A — zero setup:** open `demo.html` directly from disk (`file:///.../ANDI-Gen1/demo.html`).
It loads `./dist/andi-gen1.js` by relative path, so no web server is required.

**Option B — real sites:** `chrome://extensions` → enable Developer mode → **Load unpacked** →
select `dist/extension`.

Then exercise:

1. <!-- step -->

## Verification

- [ ] `python scripts/build.py` succeeds
- [ ] `node --check dist/andi-gen1.js` and `node --check dist/extension/andi-gen1.js` both pass
      (the build script is a regex type-stripper, not `tsc`, so leaked TypeScript only shows up here)
- [ ] `tsc --noEmit` introduces no errors beyond the known pre-existing baseline
- [ ] Changes verified in a browser, not just by reading the diff
- [ ] Keyboard and screen-reader behaviour checked for any new interactive control

## Accessibility impact

<!-- ANDI-Gen1 is an accessibility tool, so its own UI is held to the same bar it enforces.
     Note any new control's role, name, keyboard operation and contrast. Write "none" if the
     change adds no UI. -->

## Screenshots

<!-- Before / after for UI changes. -->
