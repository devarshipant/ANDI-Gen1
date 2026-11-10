# ANDI-Gen1 (Accessible Name & Description Inspector)

## What is ANDI?
ANDI (Accessible Name & Description Inspector) is an open-source accessibility testing tool originally created by the Accessible Solutions Branch of the Social Security Administration (SSA). It is a "favelet" or "bookmarklet" used to inspect web content for accessibility compliance (Section 508 and WCAG 2.1).

## What is ANDI-Gen1?
**ANDI-Gen1** builds upon the original SSA ANDI and the **ANDI Next** TypeScript rewrite. Every module in both [`src/`](./src/) and [`andi/`](./andi/) is written strictly in zero-dependency **TypeScript** (`fandi.ts`, `gandi.ts`, `landi.ts`, `tandi.ts`, `sandi.ts`, `candi.ts`, `handi.ts`, `iandi.ts`, `andi.ts`, and `help/help.ts`), compiled into a self-contained Shadow DOM bundle ([`dist/andi-gen1.js`](./dist/andi-gen1.js)).

### What Did ANDI-Gen1 Add?
1. **Actionable `Notes (x)` Pill & On-Demand Fly-In Note Drawer (`localStorage`)**:
   - Clicking **`Notes (x)`** in the top telemetry bar opens the Fly-In Notes panel displaying **all saved notes on the page** (with one-click **`Inspect Node`** jump buttons and screenshot thumbnails) alongside the active element's note editor.
   - Eliminates redundant `+Add Note` / toolbar `Note` controls in favor of the global **`Notes (x)`** pill and a single contextual **`Note`** button inside the Active Element Navigator.
2. **Iframe Detection & Step-In / Step-Out**: Detects all `<iframe>` elements on the page and lets testers **Step Into (`↪`)** and **Step Out (`↩`)** of same-origin iframes directly from the toolbar or the element header.
3. **Ergonomic 3-Zone Top Bar & Adaptive Main Workspace**:
   - Groups the top bar into **Scope (Mode + Iframes)**, **Telemetry & Triage (`Elements`, `Alerts`, `Notes (x)`, `Defect Report (x)`)**, and **Workspace Chrome (`Dock`, `Theme`, `✕ Close`)**.
   - Integrates **`◀ Prev` · `#1 of N` · `Next ▶`** directly into the Active Element Navigator header in Panel 1, with the **Page Accessibility Alerts** panel shown beside it **only when the page has alerts** — when the page is clean, Panel 1 expands to the full width for easier analysis.
4. **`ALL` Mode Placed Last in the Mode Droplist**: Orders the module selector as `f`, `g`, `l`, `t`, `s`, `c`, `h`, `i`, and **`ALL — Run All Accessibility Tests`** as the final item in the droplist.
5. **CSP-Safe Style Injection**: [`CspGuard`](./src/csp-guard.ts) adopts Constructable Stylesheets (`adoptedStyleSheets`) for the Shadow DOM so ANDI-Gen1's styles load even on pages whose Content Security Policy blocks inline `<style>` blocks.
6. **Visual & Exportable Defect Report (ANDI Alerts + Notes with Exact DOM Coordinates, Browser, Time & Screenshots)**:
   - Displays **only defects detected by ANDI (`alerts.length > 0`) plus any tester notes (`note !== null`)**.
   - Includes a live **Visual Report View** inside the modal that renders **embedded PNG screenshots (`<img>`)**, **exact DOM node coordinates** (`x, y, pageX, pageY, width × height`), **browser/OS & viewport details**, and **timestamps**, plus HTML, Markdown, JSON, and CSV exports.
7. **3-Way Pinning / Docking (Like DOM Explorer)**: Pin ANDI-Gen1 to **Top**, **Left**, or **Right**. When docked to the top, the page is pushed down by the inspector's measured height so top-level page content stays visible without scrolling. A **draggable resize edge** lets testers set how much screen the inspector takes — **height** when docked top, **width** when docked left/right — so more of the page under test stays visible. The handle is a keyboard-operable `role="separator"` (arrow keys to resize, `Home` or double-click to reset), and the chosen size is persisted in `localStorage` (`ANDI_GEN1_SIZE_TOP` / `ANDI_GEN1_SIZE_SIDE`). Until it is dragged, the top dock stays content-sized, so a sparse page still gets a compact inspector.
8. **WCAG AAA High-Contrast Light & Dark Themes**: **Light** (`14.2:1`–`20.1:1` contrast) is the default; switch to **Dark** (`14.6:1`–`19.3:1` contrast) at any time, automatically persisted in `localStorage`.
9. **DOM Node + Tester Note Screenshots**: Clicking **Save Note + Screenshot** captures a high-DPI PNG snapshot of the selected DOM node with its exact coordinates, browser/time metadata, and the tester's note burned onto the image.
10. **Unified Element Details, Extracted Code & Copy DOM Code**: Inside the Screen Reader Spoken Output box, a single **Element Details** table lists the element's ARIA attributes, `idref` associations and computed values directly below the spoken output, followed by **Extracted Code** (the inspected element's full HTML with ANDI markers removed) and a **Copy DOM Code** button. Each fact appears exactly once: an attribute such as `aria-labelledby` is shown on one row carrying its raw value, the resolved accessible text, and clickable jump links to every target ID (flagging any that are missing), instead of being repeated across a separate IDREF bar, semantic-association bar, and components table.
11. **Semantic Detection & Associations for Alternative ARIA Attributes/Roles**: Detects and computes associations when ARIA roles are used instead of native HTML tags — for example, when `role="table"`, `role="grid"`, or `role="treegrid"` is used with `role="row"`, `role="columnheader"`, `role="rowheader"`, and `role="cell"`/`role="gridcell"`, ANDI-Gen1 computes header-to-cell associations (`[Col: ... | Row: ...]`) and grid coordinates just like native `<table>` elements, alongside semantic parity for lists, headings, landmarks, links, buttons, and form controls.
12. **Mode-Scoped Element Inventory (`Inventory (N)`) & Clickable `idref` Target Links**:
    - The Inventory Fly-In Drawer lists only the elements the **selected ANDI mode** inspects (all categorized elements in `ALL` mode), grouped as **Tables**, **Links**, **Buttons**, **Form Controls**, **Landmarks**, **Headings**, **Graphics**, **Dialogs/Live**, **Iframes** and **Other**, with search, JSON export, per-item **Copy DOM** and **Navigate**.
    - When `aria-labelledby`, `aria-describedby`, `headers`, or `<label for>` are used on an inspected element, the Screen Reader Spoken Output box displays the `idref` attributes and renders clickable links (`#id → <tag> "Text"`) that navigate to and highlight each referenced DOM node.

*(For a complete technical breakdown of all updates and the usability analysis, see [rules.md](./rules.md).)*

---

## How do I install or run ANDI-Gen1?

### Option 1: Bookmarklet (Favelet)
Create a new bookmark in your browser's Bookmarks Bar named **ANDI-Gen1** and paste the following URL:

```javascript
javascript:(function(){window.ANDI_INITIAL_MODE='f';var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/gh/devarshipant/ANDI-Gen1@main/dist/andi-gen1.js?v='+Date.now();document.head.appendChild(s);})();
```

### Option 2: Local Interactive Test Page (`demo.html`)
```bash
python3 -m http.server 8090
```
Then open `http://localhost:8090/demo.html` in your browser.

### Option 3: Chrome / Edge Unpacked Extension (Bypasses All Host CSPs)
1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the [`dist/extension/`](./dist/extension/) directory.

---

## How do I build ANDI-Gen1 from TypeScript source?
Run the zero-dependency build script:
```bash
python3 scripts/build.py
```
This compiles all TypeScript modules in [`src/`](./src/) and [`andi/`](./andi/) into [`dist/andi-gen1.js`](./dist/andi-gen1.js), [`dist/bookmarklet.txt`](./dist/bookmarklet.txt), and [`dist/extension/`](./dist/extension/).

---

## License & Attribution
Original ANDI work is developed by the Social Security Administration (SSA) and licensed under the [Apache License, Version 2.0](./LICENSE).
ANDI-Gen1 preserves all original Apache 2.0 license terms and attributions while refactoring the codebase into strict TypeScript (`src/*.ts` and `andi/*.ts`).
