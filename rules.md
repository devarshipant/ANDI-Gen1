# ANDI Next — Architectural Rules & Summary of Updates from Legacy SSA ANDI

This document records the architectural updates, performance optimizations, security hardening, and new capabilities introduced in **ANDI Next** compared to the original SSA ANDI (`v29.2.2`), along with the engineering rules governing future development.

---

## 1. Language & Build Modernization

| Area | Original SSA ANDI (`andi/`) | Updated ANDI Next (`src/` & `dist/`) |
| :--- | :--- | :--- |
| **Language** | Untyped ES5 JavaScript (`var`, global functions, IE7/IE8 shims) | Strict **TypeScript (`ES2022`)** (`strict: true`, `noImplicitAny: true`, `strictNullChecks: true` in `tsconfig.json`) |
| **External Dependencies** | Dynamically downloads **jQuery (`3.7.1` / `1.9.1`)** from Google's CDN (`ajax.googleapis.com`) | **Zero external dependencies** — 100% native browser DOM APIs |
| **Module Loading** | Injects separate `<script>` (`*andi.js`) and `<link>` (`*andi.css`) network requests on every module switch | Self-contained single-file IIFE bundle (`dist/andi-next.js`) + Bookmarklet (`dist/bookmarklet.txt`) + Manifest V3 Browser Extension (`dist/extension/`) |
| **Legacy Browser Shims** | Included IE7/IE8 CSS (`ie7.css`, `ie8.css`) and Sizzle custom pseudos (`:shown`, `:focusable`, `:tabbable`) | Removed legacy IE shims in favor of modern standards-compliant DOM and CSS APIs |

---

## 2. Security Hardening

1. **Elimination of DOM XSS Vectors**:
   - **Original**: Built UI markup and alert lists by concatenating raw page attributes (`id`, `title`, `href`, `alt`, `role`) into HTML strings passed to jQuery `.html()` and `.append()`.
   - **Updated**: All UI elements in `src/ui-shadow.ts` are constructed using `document.createElement()`, `element.textContent`, and `element.setAttribute()`. Untrusted page strings are never parsed as HTML.
2. **Elimination of Third-Party CDN Supply-Chain Risk**:
   - **Original**: Injected an external `<script>` tag from `https://ajax.googleapis.com/ajax/libs/jquery/...` into the host page, which fails under strict Content Security Policies (CSP) and introduces third-party script execution risk.
   - **Updated**: Runs completely offline/self-contained with zero external network requests.
3. **Shadow DOM Isolation (`#andi-next-host`)**:
   - **Original**: Reparented the entire host `<body>` inside `<div id="ANDI508-testPage">` via `$(body).wrapInner(...)` and injected global CSS (`andi.css`), which could break Single-Page Application (React/Angular/Vue) root nodes and leak styles.
   - **Updated**: Mounts the inspector inside an isolated **Shadow DOM** root (`attachShadow({ mode: 'open' })`) without reparenting or mutating the host page's `<body>` tree.

---

## 3. Performance & Efficiency Improvements

1. **`O(1)` Map/Set Lookups Instead of `O(N²)` DOM Scans**:
   - **Original**: Scanned `testPageData.allIds` and `testPageData.allFors` in nested loops for every element with an `id` or `<label for>` reference.
   - **Updated (`src/dom-index.ts`)**: `buildPageIndex()` indexes all IDs (`idMap: Map<string, HTMLElement[]>`) and explicit labels (`labelForMap: Map<string, HTMLLabelElement[]>`) in a single pass for `O(1)` duplicate and association lookups.
2. **Single-Pass `TreeWalker` & `WeakMap` Computed Style Cache**:
   - **Original**: Ran `$("#ANDI508-testPage *").filter(":shown,canvas *")`, walking ancestor chains repeatedly via `.parents().addBack()` and calling `window.getComputedStyle` multiple times per node during text alternative calculation (`getPseudoContent`, `isBlockElement`).
   - **Updated (`src/dom-index.ts`, `src/acc-name.ts`)**: Traverses the DOM once via `document.createTreeWalker`, caches `window.getComputedStyle(el)` in a `WeakMap<Element, CSSStyleDeclaration>`, checks static block tag names in a `ReadonlySet<string>` in `O(1)` before reading layout styles, and queries `::before` / `::after` pseudo-styles only once per element.
3. **`O(1)` Event Delegation**:
   - **Original**: Bound individual `focus` and `mouseenter` listeners onto every inspectable element and bound 4 listeners per overlay, requiring an `O(N)` teardown loop on module switch.
   - **Updated (`src/ui-shadow.ts`)**: Uses a single set of delegated listeners (`mouseover`, `focusin`, `keydown`) on `document` mapped via a `WeakMap<HTMLElement, InspectedElementRecord>`.

---

## 4. New Features Added

### A. Unified `'all'` Mode (`ALL — Run All Accessibility Tests`)
- **Capability**: Users can select **ALL — Run All Accessibility Tests** in the toolbar dropdown (or invoke `window.AndiNext.runAll()` / set `window.ANDI_INITIAL_MODE = 'all'`).
- **Behavior (`src/analyzers.ts`)**: Executes all 8 accessibility inspection suites in a single pass without re-walking the DOM or recomputing Accessible Names:
  - `fANDI` — Focusable Elements
  - `gANDI` — Graphics / Images
  - `lANDI` — Links / Buttons
  - `tANDI` — Data Tables
  - `sANDI` — Structures, Headings & Landmarks
  - `cANDI` — WCAG AA Color Contrast
  - `hANDI` — Hidden Content (`aria-hidden`, hidden focusables)
  - `iANDI` — Iframes

### B. Persistent DOM Control Notes (`data-andi-note`)
- **Capability**: Testers can record custom observations, remediation guidance, and severity levels (`danger`, `warning`, `caution`) on any impacted or inaccessible element.
- **DOM Persistence (`src/notes-report.ts`)**:
  - Notes are written directly to the target DOM element via:
    - `data-andi-note`: The tester's note text
    - `data-andi-note-severity`: Severity classification (`danger` | `warning` | `caution`)
    - `data-andi-note-updated`: ISO-8601 timestamp
  - Annotated elements display a visual `📝 Note` badge on the page and persist across module switches, rescans, and DOM snapshots.

### C. Integrated Defect Report Exporter (Markdown, JSON, CSV)
- **Capability (`src/notes-report.ts`, `src/ui-shadow.ts`)**:
  - Aggregates all elements with detected accessibility alerts and/or persistent tester DOM notes into a structured defect report.
  - Includes page metadata, element CSS selector, tag/role, matched modules, calculated Accessible Name & Description, synthesized Screen Reader Output, Red-Ball Alerts, Tester DOM Notes, and HTML snippets.
  - Supports live preview, 1-click **Copy to Clipboard**, and **File Download** in **Markdown (`.md`)**, **JSON (`.json`)**, and **CSV (`.csv`)** formats.

---

## 5. Ongoing Development Rules for Agents & Contributors

1. **Zero Untrusted `innerHTML`**: Never use `innerHTML`, `outerHTML`, or `insertAdjacentHTML` with values read from the host page. Always use `document.createElement` and `textContent`.
2. **Zero External Runtime Dependencies**: Keep the runtime bundle (`dist/andi-next.js`) 100% self-contained without external CDN requests.
3. **Preserve `O(1)` Lookups & Style Caching**: Any new analyzer rule in `src/analyzers.ts` must read computed styles through `pageIndex.getStyle(el)` and use `pageIndex.idMap` / `pageIndex.labelForMap` rather than querying the DOM inside loops.
4. **Top-of-Panel "Red Ball" Alert Summary**: Present alerts in the top summary panel with visual Red-Ball severity indicators and clickable links that focus and scroll directly to the target control.
5. **Rebuild Bundle After Editing `src/*.ts`**: Always run `/usr/bin/python3 scripts/build.py` after modifying any TypeScript file under `src/` so `dist/andi-next.js` and `dist/extension/andi-next.js` stay in sync.
