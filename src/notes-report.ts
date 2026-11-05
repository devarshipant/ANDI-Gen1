/**
 * ANDI Next — Persistent DOM Notes & Defect Report Generator
 * Stores tester notes directly on the live DOM node via `data-andi-note*` attributes
 * so notes persist across scans, DOM serialization, and defect report exports.
 */

import {
  AlertLevel,
  AndiMode,
  AndiNote,
  DefectReport,
  DefectReportItem,
  InspectedElementRecord
} from './types';

export const ATTR_NOTE_TEXT = 'data-andi-note';
export const ATTR_NOTE_SEVERITY = 'data-andi-note-severity';
export const ATTR_NOTE_UPDATED = 'data-andi-note-updated';

/**
 * Reads a persisted note directly from a DOM element's `data-andi-note*` attributes.
 */
export function readElementNote(el: Element): AndiNote | null {
  const text = el.getAttribute(ATTR_NOTE_TEXT);
  if (!text || text.trim() === '') {
    return null;
  }
  const rawSeverity = el.getAttribute(ATTR_NOTE_SEVERITY);
  const severity: AlertLevel =
    rawSeverity === 'danger' || rawSeverity === 'warning' || rawSeverity === 'caution'
      ? rawSeverity
      : 'warning';
  const updatedAt = el.getAttribute(ATTR_NOTE_UPDATED) || new Date().toISOString();

  return {
    text: text.trim(),
    severity,
    updatedAt
  };
}

/**
 * Persists a note directly onto a DOM element via `data-andi-note*` attributes.
 */
export function writeElementNote(
  el: HTMLElement,
  text: string,
  severity: AlertLevel = 'warning'
): AndiNote | null {
  const trimmed = text.trim();
  if (!trimmed) {
    clearElementNote(el);
    return null;
  }
  const updatedAt = new Date().toISOString();
  el.setAttribute(ATTR_NOTE_TEXT, trimmed);
  el.setAttribute(ATTR_NOTE_SEVERITY, severity);
  el.setAttribute(ATTR_NOTE_UPDATED, updatedAt);

  return {
    text: trimmed,
    severity,
    updatedAt
  };
}

/**
 * Removes a note from the DOM element.
 */
export function clearElementNote(el: HTMLElement): void {
  el.removeAttribute(ATTR_NOTE_TEXT);
  el.removeAttribute(ATTR_NOTE_SEVERITY);
  el.removeAttribute(ATTR_NOTE_UPDATED);
}

/**
 * Generates a structured DefectReport from all inspected elements that have
 * either detected accessibility alerts or tester DOM notes.
 */
export function buildDefectReport(
  records: InspectedElementRecord[],
  modeRun: AndiMode
): DefectReport {
  let totalAlerts = 0;
  let totalNotes = 0;
  const items: DefectReportItem[] = [];

  for (const rec of records) {
    // Sync latest DOM note state in case it was edited via DevTools or UI
    rec.note = readElementNote(rec.element);

    const hasAlerts = rec.alerts.length > 0;
    const hasNote = rec.note !== null;

    if (hasAlerts) {
      totalAlerts += rec.alerts.length;
    }
    if (hasNote) {
      totalNotes += 1;
    }

    if (hasAlerts || hasNote) {
      items.push({
        index: rec.index,
        selector: rec.selector,
        tagAndRole: rec.role ? `<${rec.tagName} role="${rec.role}">` : `<${rec.tagName}>`,
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
  }

  return {
    generatedAt: new Date().toISOString(),
    pageUrl: window.location.href,
    pageTitle: document.title || '(Untitled Page)',
    modeRun,
    totalElementsInspected: records.length,
    totalAlerts,
    totalNotes,
    items
  };
}

/**
 * Formats the DefectReport as a clean, shareable Markdown document.
 */
export function formatReportAsMarkdown(report: DefectReport): string {
  const lines: string[] = [
    `# ANDI Accessibility Defect Report`,
    ``,
    `- **Page Title**: ${report.pageTitle}`,
    `- **Page URL**: ${report.pageUrl}`,
    `- **Generated At**: ${report.generatedAt}`,
    `- **Mode Executed**: \`${report.modeRun === 'all' ? 'ALL (Comprehensive Suite)' : report.modeRun + 'ANDI'}\``,
    `- **Elements Inspected**: ${report.totalElementsInspected}`,
    `- **Total Accessibility Alerts**: ${report.totalAlerts}`,
    `- **Total Tester Notes (DOM Persisted)**: ${report.totalNotes}`,
    ``,
    `---`,
    ``
  ];

  if (report.items.length === 0) {
    lines.push(`_No accessibility defects or tester notes recorded._`);
    return lines.join('\n');
  }

  for (const item of report.items) {
    lines.push(`## [#${item.index}] \`${item.tagAndRole}\` — \`${item.selector}\``);
    lines.push(`- **Modules**: ${item.modules.map((m) => `\`${m}ANDI\``).join(', ')}`);
    lines.push(`- **Accessible Name**: \`${item.accessibleName}\``);
    lines.push(`- **Accessible Description**: \`${item.accessibleDescription}\``);
    lines.push(`- **Screen Reader Output**: \`${item.screenReaderOutput}\``);

    if (item.note) {
      lines.push(
        `- **Tester Note (\`${item.note.severity.toUpperCase()}\` @ ${item.note.updatedAt})**: ${item.note.text}`
      );
    }

    if (item.alerts.length > 0) {
      lines.push(`- **Detected Alerts (${item.alerts.length})**:`);
      for (const alert of item.alerts) {
        lines.push(
          `  - **[${alert.level.toUpperCase()}]** (\`${alert.module}\` / \`${alert.code}\`): ${alert.message}`
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
 * Formats the DefectReport as a CSV string for Excel / Jira / issue tracker import.
 */
export function formatReportAsCsv(report: DefectReport): string {
  const headers = [
    'Element Index',
    'CSS Selector',
    'Tag & Role',
    'Modules',
    'Accessible Name',
    'Accessible Description',
    'Screen Reader Output',
    'Alert Count',
    'Alerts Summary',
    'Tester Note Severity',
    'Tester Note (data-andi-note)',
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
        item.selector,
        item.tagAndRole,
        item.modules.join(', '),
        item.accessibleName,
        item.accessibleDescription,
        item.screenReaderOutput,
        String(item.alerts.length),
        alertSummary,
        item.note ? item.note.severity : '',
        item.note ? item.note.text : '',
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

