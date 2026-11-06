# ANDI-Gen1 (Accessible Name & Description Inspector)

## What is ANDI?
ANDI (Accessible Name & Description Inspector) is an open-source accessibility testing tool originally created by the Accessible Solutions Branch of the Social Security Administration (SSA). It is a "favelet" or "bookmarklet" used to inspect web content for accessibility compliance (Section 508 and WCAG 2.1).

## What is ANDI-Gen1?
**ANDI-Gen1** builds upon the original SSA ANDI and the **ANDI Next** TypeScript rewrite. Every module in both [`src/`](./src/) and [`andi/`](./andi/) is written strictly in zero-dependency **TypeScript** (`fandi.ts`, `gandi.ts`, `landi.ts`, `tandi.ts`, `sandi.ts`, `candi.ts`, `handi.ts`, `iandi.ts`, `andi.ts`, and `help/help.ts`), compiled into a self-contained Shadow DOM bundle ([`dist/andi-gen1.js`](./dist/andi-gen1.js)).

### What Did ANDI-Gen1 Add?
1. **On-Demand Fly-In Note Drawer (`localStorage`)**: Saves tester defect notes per DOM node in `window.localStorage` (`ANDI_GEN1_NOTES_STORE_V1`) and on the element's `data-andi-note*` attributes via a slide-out drawer (`📝 Note`), freeing up horizontal space in the main inspection panel.
2. **Iframe Detection & Step-In / Step-Out**: Detects all `<iframe>` elements on the page and lets testers **Step Into (`⤵`)** and **Step Out (`⤴`)** of same-origin iframes directly from the toolbar or the element header.
3. **Streamlined 2-Column Main Panel Layout**: Moves the **Page Accessibility Alerts** panel immediately after the **Screen Reader Spoken & Elements** panel.
4. **`ALL` Mode Placed Last in the Mode Droplist**: Orders the module selector as `f`, `g`, `l`, `t`, `s`, `c`, `h`, `i`, and **`ALL — Run All Accessibility Tests`** as the final item in the droplist.
5. **Built-In CSP Detection & Resolution (`🛡️ CSP`)**: Detects active Content Security Policy `<meta>` tags and runtime `securitypolicyviolation` events, adopts Constructable Stylesheets (`adoptedStyleSheets`) to avoid inline style blocks, and offers one-click Meta CSP resolution for testing.
6. **Alert-Driven Defect Reports with On-Demand Notes**: Generates Defect Reports strictly from elements that have **Page Accessibility Alerts**, enriched with any on-demand Fly-In Notes and DOM node screenshots.
7. **5-Way Pinning / Docking (Like DOM Explorer)**: Pin ANDI-Gen1 to **Top**, **Bottom**, **Left Explorer**, **Right Explorer**, or **DOM Inline** (floating next to the inspected element).
8. **User Themes for Dark & Light Layouts**: Switch between **🌙 Dark** and **☀️ Light** themes at any time, automatically persisted in `localStorage`.
9. **DOM Node + Tester Note Screenshots**: Capture a high-DPI PNG snapshot of the selected DOM node with the tester's note burned onto the image, preview it inside the Fly-In Note drawer, and download it as part of the HTML/Markdown/CSV Defect Report.

*(For a complete technical breakdown of all updates, see [rules.md](./rules.md).)*

---

## How do I install or run ANDI-Gen1?

### Option 1: Bookmarklet (Favelet)
Create a new bookmark in your browser's Bookmarks Bar named **ANDI-Gen1** and paste the following URL:

```javascript
javascript:(function(){window.ANDI_INITIAL_MODE='f';var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/gh/devarshipant/ANDI-Gen1@feat/andi-updates/dist/andi-gen1.js';document.head.appendChild(s);})();
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
