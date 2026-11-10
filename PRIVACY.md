# Privacy Policy for ANDI-Gen1 (Accessible Name & Description Inspector)

**Last Updated:** November 5, 2026

## 1. Overview
**ANDI-Gen1** is an open-source web accessibility inspection browser extension and bookmarklet used to audit web pages for Section 508 and WCAG 2.1 compliance.

## 2. Data Collection & Usage
- **No Personal Data Collected:** ANDI-Gen1 does **not** collect, store, transmit, or share any personally identifiable information (PII), browsing history, authentication credentials, or analytics data.
- **No External Network Requests:** All accessibility calculations, DOM inspections, color contrast evaluations, and screenshot generations run 100% locally inside your browser tab. No data ever leaves your device.
- **Local Storage Only:** Any tester notes, theme preferences (`light`/`dark`), or docking preferences (`top`/`left`/`right`/`dom`) created while using ANDI-Gen1 are saved exclusively in your local browser's `window.localStorage` on your device and can be cleared at any time.

## 3. Permissions Used
- **`activeTab`**: Used solely to inspect the DOM of the currently active tab when the user explicitly clicks the ANDI-Gen1 extension icon.
- **`scripting`**: Used solely to inject the local, self-contained `andi-gen1.js` accessibility inspector interface into the active tab upon user invocation.

## 4. Third-Party Sharing
Because ANDI-Gen1 does not collect or transmit any user data, no data is ever sold, transferred, or disclosed to third parties.

## 5. Contact
For questions or issues regarding this privacy policy, please open an issue at:
https://github.com/devarshipant/ANDI-Gen1/issues

