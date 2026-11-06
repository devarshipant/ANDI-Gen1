/**
 * ANDI-Gen1 — localStorage Fly-in Notes, DOM Node Screenshotter & Defect Report Engine
 * - Persists notes in `window.localStorage` (and mirrors `data-andi-note` on DOM) (#1)
 * - Generates Defect Reports strictly from Page Accessibility Alerts + attached on-demand notes (#6)
 * - Captures annotated PNG screenshots of the DOM node with the tester's note rendered on it (#9)
 */

import {
  AlertLevel,
  AndiAlert,
  AndiMode,
  AndiNote,
  DefectReport,
  DefectReportItem,
  InspectedElementRecord
} from './types';

export const ATTR_NOTE_TEXT = 'data-andi-note';
export const ATTR_NOTE_SEVERITY = 'data-andi-note-severity';
export const ATTR_NOTE_UPDATED = 'data-andi-note-updated';
const STORAGE_KEY_NOTES = 'ANDI_GEN1_NOTES_STORE_V1';

function getStorageKeyForSelector(selector: string, frameContext = 'top'): string {
  const pageKey = `${window.location.origin}${window.location.pathname}`;
  return `${pageKey}::${frameContext}::${selector}`;
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
  frameContext = 'top'
): AndiNote | null {
  const store = loadNotesStore();
  const key = getStorageKeyForSelector(selector, frameContext);
  const stored = store[key];
  if (stored && stored.text.trim() !== '') {
    // Ensure DOM badge attribute is synced
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
    selector
  };
  store[key] = note;
  saveNotesStore(store);
  return note;
}

/**
 * Saves an on-demand note for the selected DOM element into `localStorage`
 * and mirrors `data-andi-note` on the element for live badge rendering.
 */
export function writeElementNote(
  el: HTMLElement,
  selector: string,
  text: string,
  severity: AlertLevel = 'warning',
  screenshotDataUrl?: string,
  frameContext = 'top'
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

  const note: AndiNote = {
    text: trimmed,
    severity,
    updatedAt,
    selector,
    screenshotDataUrl: screenshotDataUrl !== undefined ? screenshotDataUrl : existing?.screenshotDataUrl
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
  frameContext = 'top'
): void {
  el.removeAttribute(ATTR_NOTE_TEXT);
  el.removeAttribute(ATTR_NOTE_SEVERITY);
  el.removeAttribute(ATTR_NOTE_UPDATED);

  const store = loadNotesStore();
  const key = getStorageKeyForSelector(selector, frameContext);
  delete store[key];
  saveNotesStore(store);
}

/**
 * Feature #9: Captures a visual PNG screenshot of the DOM node along with its computed styles,
 * accessibility alert status, and the tester's text note burned into the image.
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
  const rect = el.getBoundingClientRect();

  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = 620;
  const height = 300;
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '';
  }
  ctx.scale(dpr, dpr);

  // 1. Card Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  // 2. Top Header Banner (Element Identity & Dimensions)
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, width, 40);
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
  ctx.fillText(`ANDI-Gen1 Node Snapshot: <${tagName}>`, 14, 25);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
  const dimText = `${ selector.slice(0, 38) } (${Math.round(rect.width)}×${Math.round(rect.height)}px)`;
  ctx.fillText(dimText, 300, 25);

  // 3. Simulated Live DOM Control Preview Box
  const previewX = 18;
  const previewY = 54;
  const previewW = width - 36;
  const previewH = 104;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(previewX, previewY, previewW, previewH);

  // Draw the actual element's computed box inside the preview area
  const nodeBoxW = Math.min(Math.max(rect.width || 220, 140), previewW - 40);
  const nodeBoxH = Math.min(Math.max(rect.height || 38, 34), 64);
  const nodeBoxX = previewX + 20;
  const nodeBoxY = previewY + Math.round((previewH - nodeBoxH) / 2);

  const bg = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
    ? style.backgroundColor
    : '#ffffff';
  ctx.fillStyle = bg;
  ctx.fillRect(nodeBoxX, nodeBoxY, nodeBoxW, nodeBoxH);

  // Red Alert Highlight Border around the DOM node
  ctx.strokeStyle = severity === 'danger' ? '#dc2626' : severity === 'warning' ? '#d97706' : '#0284c7';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(nodeBoxX, nodeBoxY, nodeBoxW, nodeBoxH);

  // Render element visible text / input value / placeholder inside the node box
  const rawNodeText =
    (el as HTMLInputElement).value ||
    el.getAttribute('placeholder') ||
    (el.textContent || '').replace(/\s+/g, ' ').trim() ||
    `[${tagName}] (AccName: ${accName || 'NONE'})`;

  ctx.fillStyle = style.color || '#0f172a';
  ctx.font = '14px system-ui, -apple-system, sans-serif';
  ctx.fillText(rawNodeText.slice(0, 52), nodeBoxX + 12, nodeBoxY + Math.round(nodeBoxH / 2) + 5);

  // 4. Primary Alert Strip
  const alertMsg = alerts.length > 0
    ? `! Alert [${alerts[0].module}ANDI]: ${alerts[0].message}`
    : 'No automated alert on this node (Manual Tester Observation)';
  ctx.fillStyle = '#fecaca';
  ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
  ctx.fillText(alertMsg.slice(0, 82), 18, 180);

  // 5. Tester Note Overlay Box (Bottom Section)
  const noteBoxY = 194;
  const noteBoxH = 92;
  ctx.fillStyle = '#2e1065';
  ctx.fillRect(18, noteBoxY, width - 36, noteBoxH);
  ctx.strokeStyle = '#a855f7';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(18, noteBoxY, width - 36, noteBoxH);

  ctx.fillStyle = '#e9d5ff';
  ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
  ctx.fillText(
    `📝 Tester Note [${severity.toUpperCase()}] — ${new Date().toLocaleTimeString()}:`,
    30,
    noteBoxY + 22
  );

  ctx.fillStyle = '#ffffff';
  ctx.font = '12.5px system-ui, -apple-system, sans-serif';
  const wrappedLines = wrapCanvasText(noteText || '(No text note entered)', 76);
  wrappedLines.slice(0, 3).forEach((ln, idx) => {
    ctx.fillText(ln, 30, noteBoxY + 44 + idx * 18);
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
 * Feature #6: Builds the Defect Report strictly based on Page Accessibility Alerts
 * (`rec.alerts.length > 0`) and includes any on-demand Fly-in Notes & Screenshots.
 */
export function buildDefectReport(
  records: InspectedElementRecord[],
  modeRun: AndiMode,
  frameContext = 'Top Document'
): DefectReport {
  let totalAlerts = 0;
  let totalNotesIncluded = 0;
  let totalScreenshotsIncluded = 0;
  const items: DefectReportItem[] = [];

  for (const rec of records) {
    // Sync latest note from localStorage
    rec.note = readElementNote(rec.element, rec.selector, frameContext);

    // Requirement #6: Defect report is strictly based on page accessibility alerts
    // and includes on-demand notes attached to those alerted controls
    if (rec.alerts.length === 0) {
      continue;
    }

    totalAlerts += rec.alerts.length;
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
    generatedAt: new Date().toISOString(),
    pageUrl: window.location.href,
    pageTitle: document.title || '(Untitled Page)',
    frameContext,
    modeRun,
    totalElementsInspected: records.length,
    totalAlertedElements: items.length,
    totalAlerts,
    totalNotesIncluded,
    totalScreenshotsIncluded,
    items
  };
}

/**
 * Formats the DefectReport as Markdown (including embedded screenshot references).
 */
export function formatReportAsMarkdown(report: DefectReport): string {
  const lines: string[] = [
    `# ANDI-Gen1 Accessibility Defect Report`,
    ``,
    `- **Page Title**: ${report.pageTitle}`,
    `- **Page URL**: ${report.pageUrl}`,
    `- **Frame Context**: \`${report.frameContext}\``,
    `- **Generated At**: ${report.generatedAt}`,
    `- **Mode Executed**: \`${report.modeRun === 'all' ? 'ALL (Comprehensive Suite)' : report.modeRun + 'ANDI'}\``,
    `- **Elements Inspected**: ${report.totalElementsInspected}`,
    `- **Elements with Page Accessibility Alerts**: ${report.totalAlertedElements}`,
    `- **Total Page Accessibility Alerts**: ${report.totalAlerts}`,
    `- **On-Demand Fly-in Notes Included**: ${report.totalNotesIncluded}`,
    `- **Annotated DOM Node Screenshots**: ${report.totalScreenshotsIncluded}`,
    ``,
    `---`,
    ``
  ];

  if (report.items.length === 0) {
    lines.push(`_No page accessibility alerts detected._`);
    return lines.join('\n');
  }

  for (const item of report.items) {
    lines.push(`## [#${item.index}] \`${item.tagAndRole}\` — \`${item.selector}\``);
    lines.push(`- **Frame**: \`${item.frameContext}\``);
    lines.push(`- **Modules**: ${item.modules.map((m) => `\`${m}ANDI\``).join(', ')}`);
    lines.push(`- **Accessible Name**: \`${item.accessibleName}\``);
    lines.push(`- **Accessible Description**: \`${item.accessibleDescription}\``);
    lines.push(`- **Screen Reader Output**: \`${item.screenReaderOutput}\``);

    lines.push(`- **Page Accessibility Alerts (${item.alerts.length})**:`);
    for (const alert of item.alerts) {
      lines.push(
        `  - **[${alert.level.toUpperCase()}]** (\`${alert.module}\` / \`${alert.code}\`): ${alert.message}`
      );
    }

    if (item.note) {
      lines.push(
        `- **On-Demand Tester Note (\`${item.note.severity.toUpperCase()}\` @ ${item.note.updatedAt})**: ${item.note.text}`
      );
      if (item.note.screenshotDataUrl) {
        lines.push(`- **Captured Node Screenshot**: Included in report bundle (\`andi-gen1-node-${item.index}.png\`)`);
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
 * Formats the DefectReport as a self-contained HTML document with embedded PNG screenshots (#9).
 */
export function formatReportAsHtml(report: DefectReport): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const cards = report.items
    .map((item) => {
      const alertsHtml = item.alerts
        .map(
          (a) =>
            `<li><strong>[${esc(a.level.toUpperCase())} - ${esc(a.module)}]</strong> ${esc(a.message)}</li>`
        )
        .join('');
      const noteHtml = item.note
        ? `<div class="note-box">
             <strong>📝 On-Demand Tester Note (${esc(item.note.severity.toUpperCase())}):</strong>
             <p>${esc(item.note.text)}</p>
             ${
               item.note.screenshotDataUrl
                 ? `<div class="shot"><img src="${item.note.screenshotDataUrl}" alt="Annotated screenshot for element #${item.index}" /></div>`
                 : ''
             }
           </div>`
        : '';

      return `<section class="defect-card">
        <h2>[#${item.index}] <code>${esc(item.tagAndRole)}</code> — <code>${esc(item.selector)}</code></h2>
        <p><strong>Accessible Name:</strong> <code>${esc(item.accessibleName)}</code> | <strong>Screen Reader Output:</strong> <code>${esc(item.screenReaderOutput)}</code></p>
        <h3>Page Accessibility Alerts (${item.alerts.length})</h3>
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
    body { font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; padding: 2rem; max-width: 960px; margin: 0 auto; }
    .defect-card { background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 1.25rem; margin-bottom: 1.25rem; }
    .note-box { background: #f5f3ff; border-left: 4px solid #7c3aed; padding: 0.75rem 1rem; margin: 0.75rem 0; border-radius: 6px; }
    .shot img { max-width: 100%; border-radius: 6px; border: 1px solid #94a3b8; margin-top: 0.5rem; }
    pre { background: #0f172a; color: #e2e8f0; padding: 0.75rem; border-radius: 6px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>ANDI-Gen1 Accessibility Defect Report</h1>
  <p><strong>Page:</strong> ${esc(report.pageTitle)} (${esc(report.pageUrl)}) | <strong>Frame:</strong> ${esc(report.frameContext)} | <strong>Alerts:</strong> ${report.totalAlerts} | <strong>Notes:</strong> ${report.totalNotesIncluded}</p>
  ${cards || '<p>No page accessibility alerts detected.</p>'}
</body>
</html>`;
}

/**
 * Formats the DefectReport as CSV.
 */
export function formatReportAsCsv(report: DefectReport): string {
  const headers = [
    'Element Index',
    'Frame Context',
    'CSS Selector',
    'Tag & Role',
    'Modules',
    'Accessible Name',
    'Screen Reader Output',
    'Alert Count',
    'Alerts Summary',
    'Tester Note Severity',
    'Tester Note (localStorage)',
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
        item.modules.join(', '),
        item.accessibleName,
        item.screenReaderOutput,
        String(item.alerts.length),
        alertSummary,
        item.note ? item.note.severity : '',
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
