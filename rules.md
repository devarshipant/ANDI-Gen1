# ANDI-Gen1 — Architectural Rules, Usability Refactoring & List of Updates

This document catalogs the architectural enhancements, feature updates, usability refactoring, and full TypeScript conversion implemented in **ANDI-Gen1** (`v31.1`) on top of the original Social Security Administration (SSA) **ANDI (Accessible Name & Description Inspector)** and its first TypeScript iteration (`ANDI Next`).

---

## 1. Summary of Core Features in ANDI-Gen1

### Feature #1: Actionable `Notes (x)` Pill & On-Demand Fly-In Note Drawer (`localStorage`)
- **Actionable `📝 Notes (x)` Button**: The `Notes (x)` badge in the top telemetry bar is an interactive button (`button.pill-actionable`) that opens the **Fly-In Notes Drawer** and displays **all saved notes on the page** alongside the active element note editor.
- **No Redundant Note Controls**: Removed duplicate global toolbar `+Add Note` / `Note` buttons so there are only two clear, non-overlapping controls:
  1. **`📝 Notes (x)`** in the Top Telemetry Bar (opens the drawer and scrolls to the list of all saved page notes).
  2. **`📝 Note` / `📝 Note ✓`** inside the Active Element Navigator header (opens the drawer focused on the active element's note editor).
- **Rich Note Metadata in `localStorage`**: Each note saved in `ANDI_GEN1_NOTES_STORE_V1` records the element's **exact DOM coordinates** (`x`, `y`, `pageX`, `pageY`, `width × height`), **Browser & OS environment**, **ISO & local timestamps**, severity level, and annotated PNG screenshot.

### Feature #2: Iframe Detection & Step-In / Step-Out Function
- Automatically detects all `<iframe>` elements on the page and tests whether their `contentDocument` is same-origin accessible (`canStepIntoIframe`).
- Provides an **Iframe Step-In selector** in Zone 1 of the top bar (automatically disabled when `0` iframes exist on the page) plus an inline **↪ Step Into Iframe** button whenever an `<iframe>` element is inspected, and a prominent **↩ Step Out of Iframe** button when inside an embedded document.

### Feature #3: Page Accessibility Alerts Panel Positioned After Screen Reader Spoken & Elements Panel
- Re-architected the main workspace into a 2-column grid where the **Page Accessibility Alerts** panel sits immediately after the **Active Element Navigator & Screen Reader Spoken Output** panel.

### Feature #4: Move `ALL` Mode to the Last Item in the Mode Droplist
- Reordered `DROPLIST_MODES_ORDER` to `['f', 'g', 'l', 't', 's', 'c', 'h', 'i', 'all']` so **`ALL — Run All Accessibility Tests` is the last option** in the mode droplist.

### Feature #5: Built-In Content Security Policy (CSP) Detection & Resolution
- [`CspGuard`](./src/csp-guard.ts) listens for real-time `SecurityPolicyViolationEvent`s, scans `<meta http-equiv="Content-Security-Policy">` tags, injects styles via **Constructable Stylesheets (`adoptedStyleSheets`)** to bypass `style-src` inline blocks, and offers one-click **Neutralize Meta CSP Rules** / **Restore Original Meta CSP** actions.

### Feature #6: Defect Report Scoped to ANDI-Detected Defects + Tester Notes with Coordinates, Browser, Time & Screenshots
- **Strict Defect + Note Filtering**: `buildDefectReport()` only includes elements that have **ANDI-detected accessibility defects (`rec.alerts.length > 0`) PLUS any elements with tester notes (`rec.note !== null`)**.
- **Visual Defect Report with Embedded Screenshots**: Opening **📋 Defect Report** defaults to **`View: Visual Report (with Screenshots)`**, rendering interactive defect cards with:
  - **Exact DOM Node Coordinates**: `x, y (page: pageX, pageY) · width×height px`
  - **Browser & Environment Details**: Browser name/version, OS platform, User-Agent, Viewport dimensions, and Device Pixel Ratio
  - **Timestamps**: Exact report generation time and individual note timestamp
  - **Embedded Annotated PNG Screenshots (`<img>`)** captured from the Fly-In Notes drawer (and auto-generated for any note missing a snapshot when the report opens)
  - Full export & copy support for **HTML (with embedded screenshots)**, **Markdown**, **JSON**, and **CSV**.

### Feature #7: Pin / Dock to Left, Right, Top, Bottom, or DOM Inline (Like DOM Explorer)
- Supports 5 docking modes persisted in `localStorage` (`ANDI_GEN1_DOCK`): **📌 Dock: Top**, **📌 Dock: Bottom**, **📌 Dock: Left Explorer**, **📌 Dock: Right Explorer**, and **📌 Dock: DOM Inline**.

### Feature #8: High-Contrast WCAG AAA User Themes for Dark and Light Layouts
- Upgraded both **🌙 Dark** and **☀️ Light** themes to exceed **WCAG AAA (7:1 to 20.1:1)** contrast ratios:
  - **Dark Theme**: Pure white `#ffffff` (`17.4:1`) and crisp slate `#e2e8f0` (`14.6:1`) text on deep `#020617` / `#0f172a` surfaces, with `#7dd3fc` (`11.4:1`) accents and `#fef08a`-on-`#020617` (`17.8:1`) warning badges.
  - **Light Theme**: Ink black `#020617` (`20.1:1`) and deep slate `#1e293b` (`14.2:1`) text on `#ffffff` / `#f8fafc` surfaces, with `#0c4a6e` (`9.9:1`) accents and `#334155` (`10.3:1`) high-visibility borders.

### Feature #9: DOM Node Screenshot with Tester Note, Coordinates & Browser Metadata
- In the Fly-In Notes drawer, clicking **📸 Save Note + Screenshot** renders a high-DPI HTML5 Canvas PNG card burning in the element's visual box, `<tag>`, selector, **exact DOM coordinates (`x, y, pageX, pageY, width × height`)**, **Browser/OS**, **timestamp**, ANDI alert status, and the tester's note.

---

## 2. Usability Analysis & 3-Zone Ergonomic Workflow Redesign

### Usability Problems Identified & Resolved
1. **Unactionable `Notes (x)` Pill & Missing All-Notes View**: Previously, `Notes: x` was a static `<span>` and the drawer only showed the current element's note. Fixed by turning **`📝 Notes (x)`** into an actionable button that opens the drawer and lists **all saved notes on the page** with one-click **`🎯 Inspect Node`** jump buttons and thumbnail previews.
2. **Redundant `+Add Note` and `Note` Buttons**: Previously, a global `📝 Note` button in the right toolbar competed with `+ Add Note` in the element header. Fixed by removing the duplicate toolbar button so **`📝 Notes (x)`** in the telemetry bar manages all notes while a single **`📝 Note`** button in the element header edits the active element.
3. **Disconnected `◀ Prev` / `Next ▶` Controls**: Previously, `Prev` and `Next` were far away on the right side of the top bar while the `#1 of 8 <input>` badge was on the left of Panel 1. Fixed by moving **`◀ Prev` · `#1 of 8` · `Next ▶`** directly into the **Active Element Navigator Bar** at the top of Panel 1 alongside the element's tag, exact coordinates `📍 (x, y) w×h`, and contextual `📝 Note` button.
4. **3-Zone Top Command Bar**:
   - **Zone 1 (Scope & Frame)**: Brand + Mode Selector (`ALL` last) + Iframe Step-In/Out.
   - **Zone 2 (Live Audit Telemetry & Triage)**: `Elements: N` + `Alerts: N` + Actionable **`📝 Notes (N)`** + Actionable **`📋 Defect Report (N)`**.
   - **Zone 3 (Workspace Chrome)**: `🛡️ CSP` + `📌 Dock` + `☀️/🌙 Theme` + `✕ Close`.

---

## 3. Full TypeScript Refactoring of `andi/` Module Files

All legacy `.js` files in the [`andi/`](./andi/) directory have been refactored into strict, zero-dependency TypeScript (`.ts`) modules and the legacy `.js` files removed:

| Legacy File (Removed) | Refactored TypeScript Module | Purpose |
| :--- | :--- | :--- |
| `andi/andi.js` | [`andi/andi.ts`](./andi/andi.ts) | Core ANDI-Gen1 module registry & launcher (`launchAndiGen1`) |
| `andi/fandi.js` | [`andi/fandi.ts`](./andi/fandi.ts) | Focusable elements accessibility evaluator (`evaluateFocusableElement`) |
| `andi/gandi.js` | [`andi/gandi.ts`](./andi/gandi.ts) | Graphics & images accessibility evaluator (`evaluateGraphicElement`) |
| `andi/landi.js` | [`andi/landi.ts`](./andi/landi.ts) | Links & buttons accessibility evaluator (`evaluateLinkOrButtonElement`) |
| `andi/tandi.js` | [`andi/tandi.ts`](./andi/tandi.ts) | Data tables accessibility evaluator (`evaluateTableElement`) |
| `andi/sandi.js` | [`andi/sandi.ts`](./andi/sandi.ts) | Structures & headings hierarchy evaluator (`evaluateStructureElement`) |
| `andi/candi.js` | [`andi/candi.ts`](./andi/candi.ts) | WCAG 2.1 AA color contrast evaluator (`evaluateColorContrastElement`) |
| `andi/handi.js` | [`andi/handi.ts`](./andi/handi.ts) | Hidden content & focusable `aria-hidden` evaluator (`evaluateHiddenElement`) |
| `andi/iandi.js` | [`andi/iandi.ts`](./andi/iandi.ts) | Iframe detection & Step-In readiness evaluator (`evaluateIframeElement`) |
| `andi/help/help.js` | [`andi/help/help.ts`](./andi/help/help.ts) | Help documentation table-of-contents & smooth-scroll controller (`AndiHelpController`) |
