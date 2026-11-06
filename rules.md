# ANDI-Gen1 — Architectural Rules & List of Updates

This document catalogs the architectural enhancements, feature updates, and full TypeScript refactoring implemented in **ANDI-Gen1** (`v31.0.0`) on top of the original Social Security Administration (SSA) **ANDI (Accessible Name & Description Inspector)** and its first TypeScript iteration (`ANDI Next`).

---

## 1. Summary of Updates in ANDI-Gen1

### Feature #1: On-Demand Fly-In Note Alert & `localStorage` Persistence
- **Previous Behavior (`ANDI Next`)**: The Defect Note & Report panel permanently occupied a middle column in the main inspection bar, consuming horizontal space even when the tester was not actively writing a note.
- **ANDI-Gen1 Update ([`src/ui-shadow.ts`](./src/ui-shadow.ts), [`src/notes-report.ts`](./src/notes-report.ts))**:
  - Removed the permanent middle note column from the main bar, freeing up 50% of the horizontal workspace for the **Screen Reader Spoken & Elements** panel and the **Page Accessibility Alerts** panel.
  - Added an on-demand **📝 Note** button in the toolbar that slides open a **Fly-In Note Drawer (`role="dialog"`)** when needed.
  - Notes are automatically keyed by page origin/pathname, frame context, and DOM selector and saved in `window.localStorage` (`ANDI_GEN1_NOTES_STORE_V1`) while also stamping `data-andi-note*` attributes on the live DOM node.

### Feature #2: Iframe Detection & Step-In / Step-Out Function
- **Previous Behavior**: `iANDI` flagged `<iframe>` elements missing a `title` attribute, but testers could not step inside an embedded `<iframe>` document to inspect its internal controls.
- **ANDI-Gen1 Update ([`src/dom-index.ts`](./src/dom-index.ts), [`andi/iandi.ts`](./andi/iandi.ts), [`src/ui-shadow.ts`](./src/ui-shadow.ts))**:
  - Automatically detects all `<iframe>` elements on the page and tests whether their `contentDocument` is same-origin accessible (`canStepIntoIframe`).
  - Adds an **Iframe Step-In selector** in the top toolbar plus an inline **Step Into Iframe ⤵** button whenever an `<iframe>` element is inspected.
  - Stepping into an iframe switches the `DomIndexer`, accessibility analyzers, element highlights, and delegated hover/focus listeners directly into the iframe's `contentDocument`, with a one-click **⤴ Step Out** button to return to the top document.

### Feature #3: Page Accessibility Alerts Panel Positioned After Screen Reader Spoken & Elements Panel
- **Previous Behavior**: The main body used a 3-column grid (`Screen Reader Spoken & Elements` -> `Element Defect Note` -> `Page Accessibility Alerts`).
- **ANDI-Gen1 Update ([`src/ui-shadow.ts`](./src/ui-shadow.ts))**:
  - Re-architected the main body into a clean 2-panel layout where the **Page Accessibility Alerts** panel sits immediately after the **Screen Reader Spoken Output & Accessibility Components** panel.

### Feature #4: Move `ALL` Mode to the Last Item in the Mode Droplist
- **Previous Behavior**: `ALL — Run All Accessibility Tests` appeared as the first item in the mode `<select>` droplist.
- **ANDI-Gen1 Update ([`src/ui-shadow.ts`](./src/ui-shadow.ts))**:
  - Reordered `DROPLIST_MODES_ORDER` to `['f', 'g', 'l', 't', 's', 'c', 'h', 'i', 'all']` so **`ALL — Run All Accessibility Tests` is the last option** in the mode droplist.

### Feature #5: Built-In Content Security Policy (CSP) Detection & Resolution
- **Previous Behavior**: Strict host page Content Security Policies (`style-src`, `img-src`, or `<meta http-equiv="Content-Security-Policy">`) could block bookmarklet styles or canvas data URLs without warning.
- **ANDI-Gen1 Update ([`src/csp-guard.ts`](./src/csp-guard.ts))**:
  - Added [`CspGuard`](./src/csp-guard.ts), which listens for real-time `SecurityPolicyViolationEvent`s and scans `<meta http-equiv="Content-Security-Policy">` tags in the host document.
  - Uses **Constructable Stylesheets (`CSSStyleSheet.replaceSync` + `adoptedStyleSheets`)** inside the Shadow DOM and host document to bypass `style-src` inline `<style>` tag restrictions.
  - Provides a **🛡️ CSP** status button and modal with one-click **Resolve Meta CSP** and **Restore Original Meta CSP** actions for local testing environments.

### Feature #6: Defect Report Strictly Scoped to Page Accessibility Alerts + On-Demand Notes
- **Previous Behavior**: Defect reports included elements that had a manual note even if they had zero accessibility alerts.
- **ANDI-Gen1 Update ([`src/notes-report.ts`](./src/notes-report.ts))**:
  - Updated `buildDefectReport()` so that the exported Defect Report is **strictly based on elements that triggered one or more Page Accessibility Alerts (`rec.alerts.length > 0`)**, automatically attaching any on-demand tester notes (from Feature #1) and node screenshots (from Feature #9) recorded for those alerted elements.

### Feature #7: Pin / Dock to Left, Right, Top, Bottom, or DOM Inline (Like DOM Explorer)
- **Previous Behavior**: The toolbar could only be docked to the top or bottom of the viewport.
- **ANDI-Gen1 Update ([`src/ui-shadow.ts`](./src/ui-shadow.ts), [`src/types.ts`](./src/types.ts))**:
  - Added 5 docking modes selectable from the toolbar and persisted in `localStorage` (`ANDI_GEN1_DOCK`):
    1. **📌 Pin: Top** (`top`)
    2. **📌 Pin: Bottom** (`bottom`)
    3. **📌 Pin: Left Explorer** (`left` — vertical split-pane like DevTools DOM Explorer, pushing page margin-left)
    4. **📌 Pin: Right Explorer** (`right` — vertical split-pane like DevTools DOM Explorer, pushing page margin-right)
    5. **📌 Pin: DOM Inline** (`dom` — floating inspector card positioned directly beside the active DOM element)

### Feature #8: User Themes for Dark and Light Layouts
- **Previous Behavior**: The Shadow DOM UI only supported a single dark color scheme.
- **ANDI-Gen1 Update ([`src/ui-shadow.ts`](./src/ui-shadow.ts))**:
  - Added full CSS custom property theming for **🌙 Dark** and **☀️ Light** layouts, toggled via the toolbar button (`themeToggleBtn`) and saved in `localStorage` (`ANDI_GEN1_THEME`).

### Feature #9: DOM Node Screenshot with Tester Note Burned In & Downloaded with Report
- **Previous Behavior**: Defect reports were text-only (Markdown/CSV) without visual snapshots of the offending DOM node.
- **ANDI-Gen1 Update ([`src/notes-report.ts`](./src/notes-report.ts), [`src/ui-shadow.ts`](./src/ui-shadow.ts))**:
  - In the Fly-In Notes drawer, testers can click **📸 Capture Node + Note Screenshot** to generate a high-DPI HTML5 Canvas PNG card showing:
    - The element's visual appearance (`backgroundColor`, `border`, `color`, `font`, dimensions, and visible text/label),
    - The element's selector, tag/role, and computed Screen Reader Output,
    - The tester's custom defect note and severity badge burned directly onto the image.
  - The screenshot is previewed inside the Fly-In Notes drawer, saved with the note in `localStorage`, downloadable as a standalone `.png`, and embedded directly in the **HTML Defect Report (`formatReportAsHtml`)** and **Download Report + Screenshots** action.

---

## 2. Full TypeScript Refactoring of `andi/` Module Files

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

---

## 3. Building & Verifying ANDI-Gen1

```bash
python3 scripts/build.py
```

Outputs:
- [`dist/andi-gen1.js`](./dist/andi-gen1.js) — Self-contained IIFE bundle for bookmarklet or script injection
- [`dist/andi-next.js`](./dist/andi-next.js) — Backwards-compatible bundle alias
- [`dist/bookmarklet.txt`](./dist/bookmarklet.txt) — Ready-to-paste bookmarklet URL
- [`dist/extension/`](./dist/extension/) — Chrome/Edge Manifest V3 unpacked extension
