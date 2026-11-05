# ANDI Next - Accessible Name and Description Inspector (TypeScript Edition)

> **Derivative Work & Attribution Notice (Apache License 2.0)**:  
> **ANDI Next** (`devarshipant/andi-next`) is an independent, modified derivative work based on [ANDI (Accessible Name & Description Inspector)](https://github.com/SSAgov/ANDI), originally created and maintained by the **Accessible Solutions Branch at the U.S. Social Security Administration (SSA)**. Licensed under the [Apache License, Version 2.0](./LICENSE.md). This fork is not affiliated with or endorsed by the SSA.

ANDI is a web accessibility testing tool.

## What does ANDI do?
1. Automatically detects accessibility issues
2. Suggests ways to improve accessibility
3. Reveals what a screen reader should say for interactive elements
4. **(New in ANDI Next)** Runs all inspection modules at once via **`ALL` mode** and lets testers attach **persistent DOM notes** directly to inaccessible controls for instant **Defect Report** export

## What problem does ANDI solve?

For many web developers, accessibility is an unfamiliar and complex territory and therefore often neglected. ANDI bridges the gap between developers and end users by revealing where accessibility issues occur on the page. To accomplish this, it analyzes the HTML of the web page being tested and extracts accessibility related markup.

#### Developers like ANDI because:
* It's easy to install, quick to run, and helps satisfy accessibility requirements.

#### Testers like ANDI because:
* It saves them time by automatically finding potential defects, offering solutions, and recording persistent control notes directly into a downloadable Defect Report.

#### End Users Ultimately Benefit:
* When web pages are accessible, everyone can efficiently perceive, understand, navigate, and interact with the Web.

## What did ANDI Next update?

**ANDI Next** (`src/` and `dist/`) introduces a modern, zero-dependency **TypeScript** rewrite alongside the original codebase (`andi/`):

* **Zero-Dependency TypeScript Engine**: Rewritten in strict TypeScript (`ES2022`) using native browser DOM APIs—removing the external Google CDN jQuery dependency and legacy IE7/IE8 shims.
* **Faster Single-Pass DOM Analysis**: Replaces repeated $O(N^2)$ DOM queries and layout thrashing with a single-pass `TreeWalker`, `WeakMap` computed-style caching, $O(1)$ `Map`/`Set` lookups for duplicate `id` and `<label for>` checks, and $O(1)$ delegated event listeners.
* **Hardened Security & Shadow DOM Isolation**: Renders the inspector UI inside an isolated **Shadow DOM** host (`#andi-next-host`) without reparenting `<body>`, and constructs all UI nodes via `document.createElement` and `textContent` (zero untrusted `innerHTML` injection).
* **`ALL` Mode (Run All Tests at Once)**: Adds an **`ALL`** mode (`window.AndiNext.runAll()`) that executes all 8 accessibility inspection suites (`fANDI`, `gANDI`, `lANDI`, `tANDI`, `sANDI`, `cANDI`, `hANDI`, `iANDI`) in a single unified pass.
* **Persistent DOM Control Notes & Defect Reports**: Allows testers to attach notes and severity ratings directly onto live DOM elements (`data-andi-note`, `data-andi-note-severity`, `data-andi-note-updated`) and export a complete **Defect Report** in **Markdown (`.md`)**, **JSON (`.json`)**, or **CSV (`.csv`)**.

See [rules.md](./rules.md) for the complete technical breakdown of updates and contributor guidelines.

## Sounds handy! How do I install ANDI?

ANDI is a browser-based "favelet" (bookmarklet) that installs with a drag and drop and launches with the click of a button:

* **ANDI Next (TypeScript Edition)**:
  * **Bookmarklet**: Copy the snippet from [`dist/bookmarklet.txt`](./dist/bookmarklet.txt) into a browser bookmark URL, or open [`demo.html`](./demo.html) and drag the **ANDI Next (ALL)** button to your Bookmarks Bar.
  * **Browser Extension (Manifest V3)**: Load [`dist/extension`](./dist/extension) as an unpacked extension in Chrome or Edge (`chrome://extensions` → **Load unpacked**).
* **Original SSA ANDI**:
  * Visit the [SSA ANDI installation page](https://www.ssa.gov/accessibility/andi/help/install.html) for official browser installation instructions (includes keyboard accessible instructions) and [alternate hosting instructions](https://www.ssa.gov/accessibility/andi/help/install.html#github).

## How can I make ANDI better?

If you would like to contribute to ANDI's development, some background knowledge of accessibility would certainly be helpful.
* **ANDI Next (`src/`)** is written in strict **TypeScript**, native DOM APIs, and Shadow DOM CSS, compiled via `python3 scripts/build.py`.
* **Legacy ANDI (`andi/`)** is written in JavaScript, jQuery, HTML, and CSS.

Knowledge of JavaScript/TypeScript optimization and DOM manipulation is crucial to maintaining ANDI's quick agility.

## What areas of accessibility does ANDI cover?

ANDI offers the ability to inspect focusable elements (`fANDI`), images/graphics (`gANDI`), links and buttons (`lANDI`), data tables (`tANDI`), page structure (`sANDI`), color contrast (`cANDI`), hidden content (`hANDI`), and iframes (`iANDI`)—either individually or all at once using **ANDI Next's `ALL` mode**.

## Who maintains ANDI?

* **Original ANDI**: Created and maintained by the **Accessible Solutions Branch at the U.S. Social Security Administration (SSA)** ([SSAgov/ANDI](https://github.com/SSAgov/ANDI)).
* **ANDI Next Fork**: Maintained in [devarshipant/andi-next](https://github.com/devarshipant/andi-next) under the terms of the [Apache License 2.0](./LICENSE.md).

## Security note

ANDI runs within the browser context of the page being inspected. When testing untrusted, public, externally supplied, or user-authored content, use a separate browser profile and do not use that profile for privileged or sensitive authenticated work. A separate tab is not sufficient.
