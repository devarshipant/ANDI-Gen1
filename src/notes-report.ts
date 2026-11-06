/**
 * ANDI-Gen1 — localStorage Fly-in Notes, DOM Node Screenshotter & Defect Report Engine
 * - Persists notes in `window.localStorage` with exact DOM coordinates, browser info, and timestamp
 * - Captures annotated high-contrast PNG screenshots of the DOM node with note, coordinates & browser metadata
 * - Generates Defect Reports for ANDI-detected defects (`rec.alerts.length > 0`) PLUS any tester notes (`rec.note !== null`)
 */

import {
  AlertLevel,
  AndiAlert,
  AndiMode,
  AndiNote,
  BrowserEnvironmentInfo,
  DefectReport,
  DefectReportItem,
  DomNodeCoordinates,
  InspectedElementRecord
} from './types';

export const ATTR_NOTE_TEXT = 'data-andi-note';
export const ATTR_NOTE_SEVERITY = 'data-andi-note-severity';
export const ATTR_NOTE_UPDATED = 'data-andi-note-updated';
const STORAGE_KEY_NOTES = 'ANDI_GEN1_NOTES_STORE_V1';

/**
 * Computes exact viewport and document/page coordinates for a DOM element.
 */
export function getElementCoordinates(el: Element): DomNodeCoordinates {
  const rect = el.getBoundingClientRect();
  const win = el.ownerDocument?.defaultView || window;
  const x = Math.round(rect.left);
  const y = Math.round(rect.top);
  const pageX = Math.round(rect.left + (win.scrollX || win.pageXOffset || 0));
  const pageY = Math.round(rect.top + (win.scrollY || win.pageYOffset || 0));
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  return {
    x,
    y,
    pageX,
    pageY,
    width,
    height,
    formatted: `x:${x}px, y:${y}px (page:${pageX}px, ${pageY}px) · ${width}×${height}px`
  };
}

/**
 * Returns structured browser, OS/platform, and viewport details for notes and defect reports.
 */
export function getBrowserEnvironmentInfo(): BrowserEnvironmentInfo {
  const ua = navigator.userAgent || 'Unknown UA';
  let browserName = 'Browser';
  if (ua.includes('Edg/')) {
    const m = ua.match(/Edg\/([\d.]+)/);
    browserName = `Edge ${m ? m[1] : ''}`.trim();
  } else if (ua.includes('Chrome/') && !ua.includes('Edg/')) {
    const m = ua.match(/Chrome\/([\d.]+)/);
    browserName = `Chrome ${m ? m[1] : ''}`.trim();
  } else if (ua.includes('Firefox/')) {
    const m = ua.match(/Firefox\/([\d.]+)/);
    browserName = `Firefox ${m ? m[1] : ''}`.trim();
  } else if (ua.includes('Safari/') && !ua.includes('Chrome/')) {
    const m = ua.match(/Version\/([\d.]+)/);
    browserName = `Safari ${m ? m[1] : ''}`.trim();
  }

  const platform = navigator.platform || 'Unknown OS';
  const viewport = `${window.innerWidth}×${window.innerHeight}px`;
  const devicePixelRatio = Math.round((window.devicePixelRatio || 1) * 100) / 100;

  return {
    browserName: `${browserName} (${platform})`,
    userAgent: ua,
    platform,
    viewport,
    devicePixelRatio
  };
}

function getPageOriginPrefix(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

function getStorageKeyForSelector(selector: string, frameContext = 'Top Document'): string {
  return `${getPageOriginPrefix()}::${frameContext}::${selector}`;
}

function loadNotesStore(): Record<string, AndiNote> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_NOTES);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as Record<string, AndiNote>;
  } catch {
    return {};
  }
}

function saveNotesStore(store: Record<string, AndiNote>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY_NOTES, JSON.stringify(store));
  } catch {
    // Quota or private mode fallback: DOM attributes still hold the note
  }
}

/**
 * Reads a persisted note for a DOM element from `localStorage` first,
 * falling back to `data-andi-note*` attributes on the element itself.
 */
export function readElementNote(
  el: Element,
  selector: string,
  frameContext = 'Top Document'
): AndiNote | null {
  const store = loadNotesStore();
  const key = getStorageKeyForSelector(selector, frameContext);
  const legacyTopKey = getStorageKeyForSelector(selector, 'top');
  const stored = store[key] || store[legacyTopKey];

  const coords = getElementCoordinates(el);
  const env = getBrowserEnvironmentInfo();

  if (stored && stored.text.trim() !== '') {
    stored.coordinates = coords;
    stored.frameContext = frameContext;
    stored.tagName = el.tagName.toLowerCase();
    if (!stored.browserInfo) {
      stored.browserInfo = `${env.browserName} · Viewport ${env.viewport}`;
    }
    if (el.getAttribute(ATTR_NOTE_TEXT) !== stored.text) {
      el.setAttribute(ATTR_NOTE_TEXT, stored.text);
      el.setAttribute(ATTR_NOTE_SEVERITY, stored.severity);
      el.setAttribute(ATTR_NOTE_UPDATED, stored.updatedAt);
    }
    return stored;
  }

  // Fallback: check if element already has data-andi-note in markup
  const domText = el.getAttribute(ATTR_NOTE_TEXT);
  if (!domText || domText.trim() === '') {
    return null;
  }
  const rawSeverity = el.getAttribute(ATTR_NOTE_SEVERITY);
  const severity: AlertLevel =
    rawSeverity === 'danger' || rawSeverity === 'warning' || rawSeverity === 'caution'
      ? rawSeverity
      : 'warning';
  const updatedAt = el.getAttribute(ATTR_NOTE_UPDATED) || new Date().toISOString();

  const note: AndiNote = {
    text: domText.trim(),
    severity,
    updatedAt,
    selector,
    frameContext,
    tagName: el.tagName.toLowerCase(),
    coordinates: coords,
    browserInfo: `${env.browserName} · Viewport ${env.viewport}`
  };
  store[key] = note;
  saveNotesStore(store);
  return note;
}

/**
 * Saves an on-demand note for the selected DOM element into `localStorage`
 * with exact DOM coordinates, browser info, timestamp, and optional screenshot.
 */
export function writeElementNote(
  el: HTMLElement,
  selector: string,
  text: string,
  severity: AlertLevel = 'warning',
  screenshotDataUrl?: string,
  frameContext = 'Top Document'
): AndiNote | null {
  const trimmed = text.trim();
  if (!trimmed) {
    clearElementNote(el, selector, frameContext);
    return null;
  }
  const updatedAt = new Date().toISOString();
  el.setAttribute(ATTR_NOTE_TEXT, trimmed);
  el.setAttribute(ATTR_NOTE_SEVERITY, severity);
  el.setAttribute(ATTR_NOTE_UPDATED, updatedAt);

  const store = loadNotesStore();
  const key = getStorageKeyForSelector(selector, frameContext);
  const existing = store[key];
  const coords = getElementCoordinates(el);
  const env = getBrowserEnvironmentInfo();

  const note: AndiNote = {
    text: trimmed,
    severity,
    updatedAt,
    selector,
    frameContext,
    tagName: el.tagName.toLowerCase(),
    coordinates: coords,
    browserInfo: `${env.browserName} · Viewport ${env.viewport}`,
    screenshotDataUrl:
      screenshotDataUrl !== undefined ? screenshotDataUrl : existing?.screenshotDataUrl
  };

  store[key] = note;
  saveNotesStore(store);
  return note;
}

/**
 * Removes a note from both `localStorage` and the DOM element.
 */
export function clearElementNote(
  el: HTMLElement,
  selector: string,
  frameContext = 'Top Document'
): void {
  el.removeAttribute(ATTR_NOTE_TEXT);
  el.removeAttribute(ATTR_NOTE_SEVERITY);
  el.removeAttribute(ATTR_NOTE_UPDATED);

  const store = loadNotesStore();
  delete store[getStorageKeyForSelector(selector, frameContext)];
  delete store[getStorageKeyForSelector(selector, 'top')];
  saveNotesStore(store);
}

/**
 * Captures a high-contrast visual PNG screenshot of the DOM node along with its
 * exact coordinates, browser/time details, accessibility alert status, and the tester's note.
 */
export function captureNodeScreenshotWithNote(
  el: HTMLElement,
  selector: string,
  tagName: string,
  accName: string,
  noteText: string,
  severity: AlertLevel,
  alerts: AndiAlert[]
): string {
  const win = el.ownerDocument?.defaultView || window;
  const style = win.getComputedStyle(el);
  const coords = getElementCoordinates(el);
  const env = getBrowserEnvironmentInfo();
  const timestampStr = new Date().toLocaleString();

  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = 660;
  const height = 330;
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '';
  }
  ctx.scale(dpr, dpr);

  // 1. High-Contrast Dark Card Background
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, width, height);

  // 2. Top Header Banner (Element Identity, Coordinates & Browser Metadata)
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, 54);
  ctx.fillStyle = '#7dd3fc';
  ctx.font = 'bold 13.5px system-ui, -apple-system, sans-serif';
  ctx.fillText(`ANDI-Gen1 DOM Snapshot: <${tagName}> — ${selector.slice(0, 44)}`, 14, 22);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '11.5px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(
    `Coords: ${coords.formatted} | ${env.browserName} | ${timestampStr}`,
    14,
    43
  );

  // 3. Simulated Live DOM Control Preview Box
  const previewX = 16;
  const previewY = 66;
  const previewW = width - 32;
  const previewH = 100;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(previewX, previewY, previewW, previewH);

  const nodeBoxW = Math.min(Math.max(coords.width || 240, 160), previewW - 36);
  const nodeBoxH = Math.min(Math.max(coords.height || 38, 36), 64);
  const nodeBoxX = previewX + 18;
  const nodeBoxY = previewY + Math.round((previewH - nodeBoxH) / 2);

  const bg =
    style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
      ? style.backgroundColor
      : '#ffffff';
  ctx.fillStyle = bg;
  ctx.fillRect(nodeBoxX, nodeBoxY, nodeBoxW, nodeBoxH);

  // High-contrast Alert Highlight Border around the DOM node
  ctx.strokeStyle =
    severity === 'danger' ? '#b91c1c' : severity === 'warning' ? '#b45309' : '#0369a1';
  ctx.lineWidth = 3;
  ctx.strokeRect(nodeBoxX, nodeBoxY, nodeBoxW, nodeBoxH);

  // Render element visible text / input value / placeholder inside the node box
  const rawNodeText =
    (el as HTMLInputElement).value ||
    el.getAttribute('placeholder') ||
    (el.textContent || '').replace(/\s+/g, ' ').trim() ||
    `<${tagName}> (AccName: ${accName || 'NONE'})`;

  ctx.fillStyle = '#020617';
  ctx.font = 'bold 13.5px system-ui, -apple-system, sans-serif';
  ctx.fillText(rawNodeText.slice(0, 56), nodeBoxX + 12, nodeBoxY + Math.round(nodeBoxH / 2) + 5);

  // 4. Primary Alert Strip
  const alertMsg =
    alerts.length > 0
      ? `! ANDI Alert [${alerts[0].module}ANDI]: ${alerts[0].message}`
      : 'Manual Tester Defect Observation on DOM Node';
  ctx.fillStyle = '#fca5a5';
  ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
  ctx.fillText(alertMsg.slice(0, 88), 16, 188);

  // 5. High-Contrast Tester Note Overlay Box (Bottom Section)
  const noteBoxY = 200;
  const noteBoxH = 114;
  ctx.fillStyle = '#1e1b4b';
  ctx.fillRect(16, noteBoxY, width - 32, noteBoxH);
  ctx.strokeStyle = '#c084fc';
  ctx.lineWidth = 2;
  ctx.strokeRect(16, noteBoxY, width - 32, noteBoxH);

  ctx.fillStyle = '#f3e8ff';
  ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
  ctx.fillText(
    `📝 Tester Note [${severity.toUpperCase()}] · Coords (${coords.x}, ${coords.y}) · ${timestampStr}:`,
    28,
    noteBoxY + 22
  );

  ctx.fillStyle = '#ffffff';
  ctx.font = '13px system-ui, -apple-system, sans-serif';
  const wrappedLines = wrapCanvasText(noteText || '(No text note entered)', 80);
  wrappedLines.slice(0, 3).forEach((ln, idx) => {
    ctx.fillText(ln, 28, noteBoxY + 46 + idx * 20);
  });

  return canvas.toDataURL('image/png');
}

function wrapCanvasText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxCharsPerLine) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Triggers a direct browser download of a single node's PNG screenshot.
 */
export function downloadScreenshotPng(dataUrl: string, index: number, selector: string): void {
  if (!dataUrl) {
    return;
  }
  const safeSlug = selector.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `andi-gen1-node-${index}-${safeSlug}.png`;
  a.click();
}

/**
 * Builds the Defect Report containing:
 * - Only defects detected by ANDI (`rec.alerts.length > 0`)
 * - PLUS any notes taken by the tester (`rec.note !== null`),
 * enriched with exact DOM node coordinates, browser details, timestamps, and screenshots.
 */
export function buildDefectReport(
  records: InspectedElementRecord[],
  modeRun: AndiMode,
  frameContext = 'Top Document'
): DefectReport {
  let totalAlerts = 0;
  let totalAlertedElements = 0;
  let totalNotesIncluded = 0;
  let totalScreenshotsIncluded = 0;
  const items: DefectReportItem[] = [];
  const browserEnvironment = getBrowserEnvironmentInfo();
  const now = new Date();

  for (const rec of records) {
    rec.coordinates = getElementCoordinates(rec.element);
    rec.note = readElementNote(rec.element, rec.selector, frameContext);

    const hasAndiDefects = rec.alerts.length > 0;
    const hasTesterNote = rec.note !== null;

    // Requirement #4: Only show defects detected by ANDI plus any notes taken
    if (!hasAndiDefects && !hasTesterNote) {
      continue;
    }

    if (hasAndiDefects) {
      totalAlertedElements += 1;
      totalAlerts += rec.alerts.length;
    }
    if (rec.note) {
      totalNotesIncluded += 1;
      if (rec.note.screenshotDataUrl) {
        totalScreenshotsIncluded += 1;
      }
    }

    items.push({
      index: rec.index,
      selector: rec.selector,
      tagAndRole: rec.role ? `<${rec.tagName} role="${rec.role}">` : `<${rec.tagName}>`,
      frameContext,
      coordinates: rec.coordinates,
      modules: rec.modulesMatched,
      accessibleName: rec.accName || '(none)',
      accessibleDescription: rec.accDesc || '(none)',
      screenReaderOutput: rec.screenReaderOutput || '(silent)',
      alerts: rec.alerts.map((a) => ({
        level: a.level,
        code: a.code,
        module: `${a.module}ANDI`,
        message: a.message
      })),
      note: rec.note,
      htmlSnippet: getSafeOuterHtmlSnippet(rec.element)
    });
  }

  return {
    generatedAt: now.toISOString(),
    generatedAtLocal: now.toLocaleString(),
    browserEnvironment,
    pageUrl: window.location.href,
    pageTitle: document.title || '(Untitled Page)',
    frameContext,
    modeRun,
    totalElementsInspected: records.length,
    totalDefectItems: items.length,
    totalAlertedElements,
    totalAlerts,
    totalNotesIncluded,
    totalScreenshotsIncluded,
    items
  };
}

/**
 * Formats the DefectReport as Markdown (including coordinates, browser info, and screenshot references).
 */
export function formatReportAsMarkdown(report: DefectReport): string {
  const env = report.browserEnvironment;
  const lines: string[] = [
    `# ANDI-Gen1 Accessibility Defect & Notes Report`,
    ``,
    `- **Page Title**: ${report.pageTitle}`,
    `- **Page URL**: ${report.pageUrl}`,
    `- **Frame Context**: \`${report.frameContext}\``,
    `- **Generated At**: ${report.generatedAtLocal} (\`${report.generatedAt}\`)`,
    `- **Browser & OS**: ${env.browserName} | Viewport: \`${env.viewport}\` (DPR: ${env.devicePixelRatio})`,
    `- **User-Agent**: \`${env.userAgent}\``,
    `- **Mode Executed**: \`${report.modeRun === 'all' ? 'ALL (Comprehensive Suite)' : report.modeRun + 'ANDI'}\``,
    `- **Elements Inspected**: ${report.totalElementsInspected}`,
    `- **Reported Defect / Note Items**: ${report.totalDefectItems} (${report.totalAlertedElements} with ANDI alerts, ${report.totalNotesIncluded} with tester notes, ${report.totalScreenshotsIncluded} with screenshots)`,
    ``,
    `---`,
    ``
  ];

  if (report.items.length === 0) {
    lines.push(`_No page accessibility alerts or tester notes recorded._`);
    return lines.join('\n');
  }

  for (const item of report.items) {
    lines.push(`## [#${item.index}] \`${item.tagAndRole}\` — \`${item.selector}\``);
    lines.push(`- **DOM Coordinates**: \`${item.coordinates.formatted}\``);
    lines.push(`- **Frame**: \`${item.frameContext}\``);
    lines.push(`- **Modules**: ${item.modules.map((m) => `\`${m}ANDI\``).join(', ')}`);
    lines.push(`- **Accessible Name**: \`${item.accessibleName}\``);
    lines.push(`- **Accessible Description**: \`${item.accessibleDescription}\``);
    lines.push(`- **Screen Reader Output**: \`${item.screenReaderOutput}\``);

    if (item.alerts.length > 0) {
      lines.push(`- **ANDI Accessibility Alerts (${item.alerts.length})**:`);
      for (const alert of item.alerts) {
        lines.push(
          `  - **[${alert.level.toUpperCase()}]** (\`${alert.module}\` / \`${alert.code}\`): ${alert.message}`
        );
      }
    } else {
      lines.push(`- **ANDI Accessibility Alerts**: _None (Included via Manual Tester Note)_`);
    }

    if (item.note) {
      lines.push(
        `- **Tester Note (\`${item.note.severity.toUpperCase()}\` @ ${new Date(item.note.updatedAt).toLocaleString()})**: ${item.note.text}`
      );
      lines.push(
        `  - **Note Coordinates**: \`${item.note.coordinates?.formatted || item.coordinates.formatted}\``
      );
      lines.push(
        `  - **Note Browser Environment**: \`${item.note.browserInfo || env.browserName}\``
      );
      if (item.note.screenshotDataUrl) {
        lines.push(
          `  - **Captured Node Screenshot**: Embedded in HTML Report & downloadable (\`andi-gen1-node-${item.index}.png\`)`
        );
      }
    }

    lines.push(`- **HTML Markup**:`);
    lines.push('```html');
    lines.push(item.htmlSnippet);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Formats the DefectReport as a self-contained HTML document with embedded PNG screenshots,
 * exact DOM coordinates, and browser/time metadata.
 */
export function formatReportAsHtml(report: DefectReport): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const env = report.browserEnvironment;
  const cards = report.items
    .map((item) => {
      const alertsHtml =
        item.alerts.length > 0
          ? item.alerts
              .map(
                (a) =>
                  `<li><strong>[${esc(a.level.toUpperCase())} - ${esc(a.module)}]</strong> ${esc(a.message)}</li>`
              )
              .join('')
          : '<li><em>No automated ANDI alert on this element (logged via Tester Note).</em></li>';

      const noteHtml = item.note
        ? `<div class="note-box">
             <div><strong>📝 Tester Note [${esc(item.note.severity.toUpperCase())}]</strong> — Recorded: ${esc(new Date(item.note.updatedAt).toLocaleString())}</div>
             <div class="meta-line"><strong>DOM Coordinates:</strong> <code>${esc(item.note.coordinates?.formatted || item.coordinates.formatted)}</code> | <strong>Browser:</strong> ${esc(item.note.browserInfo || env.browserName)}</div>
             <p>${esc(item.note.text)}</p>
             ${
               item.note.screenshotDataUrl
                 ? `<div class="shot">
                      <div><strong>📸 Annotated DOM Node Screenshot:</strong></div>
                      <img src="${item.note.screenshotDataUrl}" alt="Annotated screenshot for element #${item.index}" />
                    </div>`
                 : ''
             }
           </div>`
        : '';

      return `<section class="defect-card">
        <h2>[#${item.index}] <code>${esc(item.tagAndRole)}</code> — <code>${esc(item.selector)}</code></h2>
        <p class="meta-line">
          <strong>Exact DOM Coordinates:</strong> <code>${esc(item.coordinates.formatted)}</code> |
          <strong>Frame:</strong> <code>${esc(item.frameContext)}</code>
        </p>
        <p>
          <strong>Accessible Name:</strong> <code>${esc(item.accessibleName)}</code> |
          <strong>Screen Reader Output:</strong> <code>${esc(item.screenReaderOutput)}</code>
        </p>
        <h3>ANDI Detected Alerts (${item.alerts.length})</h3>
        <ul>${alertsHtml}</ul>
        ${noteHtml}
        <pre><code>${esc(item.htmlSnippet)}</code></pre>
      </section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>ANDI-Gen1 Defect Report — ${esc(report.pageTitle)}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f1f5f9; color: #020617; padding: 2rem; max-width: 1000px; margin: 0 auto; line-height: 1.5; }
    .meta-banner { background: #0f172a; color: #ffffff; padding: 1rem 1.25rem; border-radius: 10px; margin-bottom: 1.5rem; }
    .meta-banner code { color: #7dd3fc; }
    .defect-card { background: #ffffff; border: 2px solid #475569; border-radius: 10px; padding: 1.25rem; margin-bottom: 1.25rem; }
    .meta-line { font-size: 0.9rem; color: #1e293b; margin: 0.35rem 0; }
    .note-box { background: #faf5ff; border: 2px solid #7e22ce; border-left: 6px solid #6b21a8; padding: 0.85rem 1rem; margin: 0.85rem 0; border-radius: 6px; color: #020617; }
    .shot { margin-top: 0.75rem; }
    .shot img { max-width: 100%; border-radius: 6px; border: 2px solid #334155; margin-top: 0.35rem; display: block; }
    pre { background: #020617; color: #f8fafc; padding: 0.75rem; border-radius: 6px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>ANDI-Gen1 Accessibility Defect &amp; Notes Report</h1>
  <div class="meta-banner">
    <div><strong>Page:</strong> ${esc(report.pageTitle)} (<code>${esc(report.pageUrl)}</code>)</div>
    <div><strong>Generated Time:</strong> ${esc(report.generatedAtLocal)} | <strong>Browser:</strong> ${esc(env.browserName)} | <strong>Viewport:</strong> <code>${esc(env.viewport)}</code></div>
    <div><strong>Summary:</strong> ${report.totalDefectItems} Defect/Note Items (${report.totalAlerts} ANDI Alerts, ${report.totalNotesIncluded} Notes, ${report.totalScreenshotsIncluded} Screenshots)</div>
  </div>
  ${cards || '<p>No page accessibility alerts or tester notes recorded.</p>'}
</body>
</html>`;
}

/**
 * Formats the DefectReport as CSV (including exact coordinates, browser info, and timestamp).
 */
export function formatReportAsCsv(report: DefectReport): string {
  const headers = [
    'Element Index',
    'Frame Context',
    'CSS Selector',
    'Tag & Role',
    'DOM Coordinates (x, y, pageX, pageY, w, h)',
    'Browser & OS',
    'Report Timestamp',
    'Modules',
    'Accessible Name',
    'Screen Reader Output',
    'Alert Count',
    'Alerts Summary',
    'Tester Note Severity',
    'Tester Note Timestamp',
    'Tester Note Text',
    'Screenshot Attached',
    'HTML Snippet'
  ];

  const escapeCsv = (val: string): string => `"${val.replace(/"/g, '""')}"`;
  const rows: string[] = [headers.map(escapeCsv).join(',')];

  for (const item of report.items) {
    const alertSummary = item.alerts
      .map((a) => `[${a.level.toUpperCase()} ${a.module}] ${a.message}`)
      .join(' | ');
    rows.push(
      [
        String(item.index),
        item.frameContext,
        item.selector,
        item.tagAndRole,
        item.coordinates.formatted,
        item.note?.browserInfo || report.browserEnvironment.browserName,
        report.generatedAtLocal,
        item.modules.join(', '),
        item.accessibleName,
        item.screenReaderOutput,
        String(item.alerts.length),
        alertSummary,
        item.note ? item.note.severity : '',
        item.note ? item.note.updatedAt : '',
        item.note ? item.note.text : '',
        item.note?.screenshotDataUrl ? 'YES (PNG)' : 'NO',
        item.htmlSnippet
      ]
        .map(escapeCsv)
        .join(',')
    );
  }

  return rows.join('\n');
}

function getSafeOuterHtmlSnippet(el: HTMLElement): string {
  const clone = el.cloneNode(false) as HTMLElement;
  clone.removeAttribute('data-andi508-index');
  const outer = clone.outerHTML;
  const innerPreview = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!innerPreview) {
    return outer;
  }
  const closeTagMatch = outer.match(/(<\/[a-zA-Z0-9-]+>)$/);
  if (closeTagMatch) {
    const openTag = outer.slice(0, outer.length - closeTagMatch[0].length);
    return `${openTag}${innerPreview}${closeTagMatch[0]}`;
  }
  return outer;
}
