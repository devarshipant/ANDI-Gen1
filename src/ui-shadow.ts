/**
 * ANDI Next — Shadow DOM Isolated UI & Defect Report Controller
 * Built with 100% safe DOM node construction (no untrusted innerHTML)
 * and O(1) delegated event listeners on `document`.
 */

import {
  AlertLevel,
  AndiMode,
  InspectedElementRecord
} from './types';
import { ANDI_HOST_ID, ANDI_LASER_ID, buildPageIndex } from './dom-index';
import { analyzePage } from './analyzers';
import {
  buildDefectReport,
  clearElementNote,
  formatReportAsCsv,
  formatReportAsMarkdown,
  readElementNote,
  writeElementNote
} from './notes-report';

const PAGE_HIGHLIGHT_STYLE_ID = 'andi-next-page-highlights-css';

const MODULE_LABELS: Record<AndiMode, string> = {
  all: 'ALL — Run All Accessibility Tests',
  f: 'fANDI — Focusable Elements',
  g: 'gANDI — Graphics / Images',
  l: 'lANDI — Links / Buttons',
  t: 'tANDI — Tables',
  s: 'sANDI — Structures & Headings',
  c: 'cANDI — Color Contrast (WCAG AA)',
  h: 'hANDI — Hidden Content',
  i: 'iANDI — Iframes'
};

export class AndiNextController {
  private mode: AndiMode;
  private records: InspectedElementRecord[] = [];
  private elementToRecord = new WeakMap<HTMLElement, InspectedElementRecord>();
  private activeIndex = 0; // 1-based index into records, 0 = none selected
  private highlightsEnabled = true;
  private laserEnabled = true;

  private hostEl: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private laserSvg: SVGSVGElement | null = null;
  private laserLine: SVGLineElement | null = null;

  // UI Element References inside Shadow DOM
  private summaryBadgeEl!: HTMLElement;
  private elementHeaderEl!: HTMLElement;
  private srOutputEl!: HTMLElement;
  private componentsTbodyEl!: HTMLElement;
  private elementAlertsListEl!: HTMLElement;
  private pageAlertsListEl!: HTMLElement;
  private noteTextarea!: HTMLTextAreaElement;
  private noteSeveritySelect!: HTMLSelectElement;
  private noteStatusEl!: HTMLElement;
  private reportModalEl!: HTMLElement;
  private reportTextarea!: HTMLTextAreaElement;
  private reportFormatSelect!: HTMLSelectElement;

  // Bound delegated handlers for clean teardown
  private boundMouseOver: (e: MouseEvent) => void;
  private boundFocusIn: (e: FocusEvent) => void;
  private boundKeyDown: (e: KeyboardEvent) => void;

  constructor(initialMode: AndiMode = 'f') {
    this.mode = initialMode;
    this.boundMouseOver = this.handleDocumentMouseOver.bind(this);
    this.boundFocusIn = this.handleDocumentFocusIn.bind(this);
    this.boundKeyDown = this.handleDocumentKeyDown.bind(this);
  }

  public launch(mode?: AndiMode): void {
    if (mode) {
      this.mode = mode;
    }
    this.destroy();
    this.injectPageHighlightStyles();
    this.mountShadowUI();
    this.mountLaserSvg();
    this.attachDelegatedEvents();
    this.runScan();
  }

  public setMode(mode: AndiMode): void {
    this.mode = mode;
    this.runScan();
  }

  public destroy(): void {
    document.removeEventListener('mouseover', this.boundMouseOver, true);
    document.removeEventListener('focusin', this.boundFocusIn, true);
    document.removeEventListener('keydown', this.boundKeyDown, true);

    this.clearPageElementMarkers();

    document.getElementById(ANDI_HOST_ID)?.remove();
    document.getElementById(ANDI_LASER_ID)?.remove();
    document.getElementById(PAGE_HIGHLIGHT_STYLE_ID)?.remove();
    document.body.style.removeProperty('margin-top');

    this.hostEl = null;
    this.shadow = null;
    this.laserSvg = null;
    this.laserLine = null;
  }

  private runScan(): void {
    this.clearPageElementMarkers();
    const pageIndex = buildPageIndex(document.body);
    this.records = analyzePage(pageIndex, this.mode);
    this.elementToRecord = new WeakMap<HTMLElement, InspectedElementRecord>();

    for (const rec of this.records) {
      this.elementToRecord.set(rec.element, rec);
      rec.element.setAttribute('data-andi508-index', String(rec.index));
      if (this.highlightsEnabled) {
        rec.element.setAttribute('data-andi-highlight', 'true');
      }
      if (rec.alerts.some((a) => a.level === 'danger')) {
        rec.element.setAttribute('data-andi-alert-level', 'danger');
      } else if (rec.alerts.some((a) => a.level === 'warning')) {
        rec.element.setAttribute('data-andi-alert-level', 'warning');
      }
    }

    this.renderPageSummaryAndAlerts();

    if (this.records.length > 0) {
      this.inspectByIndex(1, false);
    } else {
      this.activeIndex = 0;
      this.renderEmptyActiveElement();
    }
  }

  private clearPageElementMarkers(): void {
    const marked = document.querySelectorAll('[data-andi508-index], [data-andi-active], [data-andi-highlight]');
    marked.forEach((el) => {
      el.removeAttribute('data-andi508-index');
      el.removeAttribute('data-andi-active');
      el.removeAttribute('data-andi-highlight');
      el.removeAttribute('data-andi-alert-level');
    });
    this.eraseLaser();
  }

  public inspectByIndex(index: number, moveFocus = false): void {
    const rec = this.records[index - 1];
    if (!rec) {
      return;
    }

    if (this.activeIndex > 0 && this.records[this.activeIndex - 1]) {
      this.records[this.activeIndex - 1].element.removeAttribute('data-andi-active');
    }

    this.activeIndex = index;
    rec.element.setAttribute('data-andi-active', 'true');

    if (moveFocus) {
      rec.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (rec.isFocusable) {
        rec.element.focus({ preventScroll: true });
      } else {
        rec.element.setAttribute('tabindex', '-1');
        rec.element.focus({ preventScroll: true });
        rec.element.removeAttribute('tabindex');
      }
    }

    // Refresh note from DOM in case it was modified externally
    rec.note = readElementNote(rec.element);

    this.renderActiveElementInspection(rec);
    this.drawLaserToElement(rec.element);
  }

  private handleDocumentMouseOver(e: MouseEvent): void {
    if (e.shiftKey) {
      return; // Shift key locks hover inspection (Hover Lock)
    }
    const target = e.target as HTMLElement | null;
    if (!target || target.id === ANDI_HOST_ID || target.closest(`#${ANDI_HOST_ID}`)) {
      return;
    }
    let curr: HTMLElement | null = target;
    while (curr && curr !== document.body) {
      const rec = this.elementToRecord.get(curr);
      if (rec) {
        if (this.activeIndex !== rec.index) {
          this.inspectByIndex(rec.index, false);
        }
        return;
      }
      curr = curr.parentElement;
    }
  }

  private handleDocumentFocusIn(e: FocusEvent): void {
    const target = e.target as HTMLElement | null;
    if (!target || target.id === ANDI_HOST_ID || target.closest(`#${ANDI_HOST_ID}`)) {
      return;
    }
    const rec = this.elementToRecord.get(target);
    if (rec && this.activeIndex !== rec.index) {
      this.inspectByIndex(rec.index, false);
    }
  }

  private handleDocumentKeyDown(e: KeyboardEvent): void {
    if (e.altKey && e.key === '.') {
      e.preventDefault();
      this.stepElement(1);
    } else if (e.altKey && e.key === ',') {
      e.preventDefault();
      this.stepElement(-1);
    }
  }

  private stepElement(delta: number): void {
    if (this.records.length === 0) {
      return;
    }
    let next = this.activeIndex + delta;
    if (next > this.records.length) {
      next = 1;
    } else if (next < 1) {
      next = this.records.length;
    }
    this.inspectByIndex(next, true);
  }

  private injectPageHighlightStyles(): void {
    const style = document.createElement('style');
    style.id = PAGE_HIGHLIGHT_STYLE_ID;
    style.textContent = `
      [data-andi-highlight="true"] {
        outline: 2px dashed #0284c7 !important;
        outline-offset: 2px !important;
      }
      [data-andi-highlight="true"][data-andi-alert-level="danger"] {
        outline: 2px solid #dc2626 !important;
      }
      [data-andi-highlight="true"][data-andi-alert-level="warning"] {
        outline: 2px dashed #d97706 !important;
      }
      [data-andi-active="true"] {
        outline: 3px solid #ec4899 !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 4px rgba(236, 72, 153, 0.25) !important;
      }
      [data-andi-note] {
        position: relative;
      }
      [data-andi-note]::after {
        content: "📝 Note" !important;
        position: absolute !important;
        top: -12px !important;
        right: -4px !important;
        background: #7c3aed !important;
        color: #ffffff !important;
        font: 700 10px/1.2 system-ui, sans-serif !important;
        padding: 2px 5px !important;
        border-radius: 4px !important;
        z-index: 2147483640 !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  private mountLaserSvg(): void {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.id = ANDI_LASER_ID;
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText =
      'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645;display:none;';
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('stroke', '#ec4899');
    line.setAttribute('stroke-width', '2.5');
    line.setAttribute('stroke-dasharray', '5,3');
    svg.appendChild(line);
    document.body.appendChild(svg);
    this.laserSvg = svg;
    this.laserLine = line;
  }

  private drawLaserToElement(targetEl: HTMLElement): void {
    if (!this.laserEnabled || !this.laserSvg || !this.laserLine || !this.elementHeaderEl) {
      this.eraseLaser();
      return;
    }
    const fromRect = this.elementHeaderEl.getBoundingClientRect();
    const toRect = targetEl.getBoundingClientRect();
    if (toRect.width === 0 && toRect.height === 0) {
      this.eraseLaser();
      return;
    }
    this.laserLine.setAttribute('x1', String(fromRect.left + fromRect.width / 2));
    this.laserLine.setAttribute('y1', String(fromRect.bottom));
    this.laserLine.setAttribute('x2', String(toRect.left + toRect.width / 2));
    this.laserLine.setAttribute('y2', String(toRect.top));
    this.laserSvg.style.display = 'block';
  }

  private eraseLaser(): void {
    if (this.laserSvg) {
      this.laserSvg.style.display = 'none';
    }
  }

  private attachDelegatedEvents(): void {
    document.addEventListener('mouseover', this.boundMouseOver, true);
    document.addEventListener('focusin', this.boundFocusIn, true);
    document.addEventListener('keydown', this.boundKeyDown, true);
  }

  private mountShadowUI(): void {
    const host = document.createElement('div');
    host.id = ANDI_HOST_ID;
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'ANDI Accessibility Inspector');
    document.body.prepend(host);
    document.body.style.marginTop = '270px';

    const shadow = host.attachShadow({ mode: 'open' });
    this.hostEl = host;
    this.shadow = shadow;

    const styleEl = document.createElement('style');
    styleEl.textContent = this.getShadowStyles();
    shadow.appendChild(styleEl);

    const bar = document.createElement('section');
    bar.className = 'andi-bar';

    // 1. Top Toolbar Header
    const header = document.createElement('header');
    header.className = 'andi-header';

    const brand = document.createElement('div');
    brand.className = 'andi-brand';
    const brandBadge = document.createElement('span');
    brandBadge.className = 'andi-logo';
    brandBadge.textContent = 'ANDI Next';
    const versionSpan = document.createElement('span');
    versionSpan.className = 'andi-version';
    versionSpan.textContent = 'TS 30.0 (Zero-Dep)';
    brand.append(brandBadge, versionSpan);

    // Module Selector (with 'all' mode)
    const moduleWrap = document.createElement('div');
    moduleWrap.className = 'andi-module-wrap';
    const moduleLabel = document.createElement('label');
    moduleLabel.htmlFor = 'andi-module-select';
    moduleLabel.textContent = 'Mode:';
    const moduleSelect = document.createElement('select');
    moduleSelect.id = 'andi-module-select';
    (Object.keys(MODULE_LABELS) as AndiMode[]).forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = MODULE_LABELS[m];
      if (m === this.mode) {
        opt.selected = true;
      }
      moduleSelect.appendChild(opt);
    });
    moduleSelect.addEventListener('change', () => {
      this.setMode(moduleSelect.value as AndiMode);
    });
    moduleWrap.append(moduleLabel, moduleSelect);

    this.summaryBadgeEl = document.createElement('div');
    this.summaryBadgeEl.className = 'andi-summary-pills';

    // Toolbar Actions
    const actions = document.createElement('div');
    actions.className = 'andi-actions';

    const prevBtn = this.createButton('◀ Prev', 'Previous Element (Alt + ,)', () => this.stepElement(-1));
    const nextBtn = this.createButton('Next ▶', 'Next Element (Alt + .)', () => this.stepElement(1));

    const highlightBtn = this.createButton('Highlights: ON', 'Toggle element outlines', () => {
      this.highlightsEnabled = !this.highlightsEnabled;
      highlightBtn.textContent = `Highlights: ${this.highlightsEnabled ? 'ON' : 'OFF'}`;
      this.records.forEach((r) => {
        if (this.highlightsEnabled) {
          r.element.setAttribute('data-andi-highlight', 'true');
        } else {
          r.element.removeAttribute('data-andi-highlight');
        }
      });
    });

    const reportBtn = this.createButton('📋 Defect Report', 'Open Defect Report & DOM Notes Export', () => {
      this.openReportModal();
    });
    reportBtn.classList.add('btn-primary');

    const rescanBtn = this.createButton('↻ Rescan', 'Rescan page DOM', () => this.runScan());
    const closeBtn = this.createButton('✕ Close', 'Close ANDI Next', () => this.destroy());
    closeBtn.classList.add('btn-danger');

    actions.append(prevBtn, nextBtn, highlightBtn, reportBtn, rescanBtn, closeBtn);
    header.append(brand, moduleWrap, this.summaryBadgeEl, actions);
    bar.appendChild(header);

    // 2. Main 3-Column Body: (1) Active Element & Output, (2) Persistent DOM Notes, (3) Red-Ball Alerts Summary
    const grid = document.createElement('div');
    grid.className = 'andi-grid';

    // Column 1: Active Element Inspection
    const colInspect = document.createElement('div');
    colInspect.className = 'andi-panel';
    this.elementHeaderEl = document.createElement('div');
    this.elementHeaderEl.className = 'element-header';

    const srBox = document.createElement('div');
    srBox.className = 'sr-box';
    const srTitle = document.createElement('div');
    srTitle.className = 'sr-title';
    srTitle.textContent = '🔊 ANDI Output (Screen Reader Preview):';
    this.srOutputEl = document.createElement('div');
    this.srOutputEl.className = 'sr-output';
    srBox.append(srTitle, this.srOutputEl);

    const compTable = document.createElement('table');
    compTable.className = 'comp-table';
    this.componentsTbodyEl = document.createElement('tbody');
    compTable.appendChild(this.componentsTbodyEl);

    this.elementAlertsListEl = document.createElement('ul');
    this.elementAlertsListEl.className = 'alert-list';

    colInspect.append(this.elementHeaderEl, srBox, compTable, this.elementAlertsListEl);

    // Column 2: Persistent Control Notes (stored in DOM via data-andi-note)
    const colNotes = document.createElement('div');
    colNotes.className = 'andi-panel';
    const notesHeading = document.createElement('h2');
    notesHeading.className = 'panel-title';
    notesHeading.textContent = '📝 Control Note (Persists in DOM)';

    const notesSub = document.createElement('p');
    notesSub.className = 'panel-sub';
    notesSub.textContent = 'Saved directly on the element via [data-andi-note] and included in Defect Reports.';

    this.noteTextarea = document.createElement('textarea');
    this.noteTextarea.className = 'note-textarea';
    this.noteTextarea.placeholder = 'Add accessibility observation or remediation note for this control...';
    this.noteTextarea.setAttribute('aria-label', 'Accessibility note for active control');

    const noteControls = document.createElement('div');
    noteControls.className = 'note-controls';

    this.noteSeveritySelect = document.createElement('select');
    this.noteSeveritySelect.className = 'note-severity';
    this.noteSeveritySelect.setAttribute('aria-label', 'Note Severity');
    (['danger', 'warning', 'caution'] as AlertLevel[]).forEach((lvl) => {
      const opt = document.createElement('option');
      opt.value = lvl;
      opt.textContent = `Severity: ${lvl.toUpperCase()}`;
      this.noteSeveritySelect.appendChild(opt);
    });

    const saveNoteBtn = this.createButton('Save Note to DOM', 'Persist note on DOM element', () => {
      this.saveActiveElementNote();
    });
    saveNoteBtn.classList.add('btn-primary');

    const clearNoteBtn = this.createButton('Clear', 'Remove note from DOM element', () => {
      this.clearActiveElementNote();
    });

    this.noteStatusEl = document.createElement('div');
    this.noteStatusEl.className = 'note-status';
    this.noteStatusEl.setAttribute('role', 'status');
    this.noteStatusEl.setAttribute('aria-live', 'polite');

    noteControls.append(this.noteSeveritySelect, saveNoteBtn, clearNoteBtn);
    colNotes.append(notesHeading, notesSub, this.noteTextarea, noteControls, this.noteStatusEl);

    // Column 3: Page-Wide "Red Ball" Error / Alert Summary
    const colAlerts = document.createElement('div');
    colAlerts.className = 'andi-panel';
    const alertsHeading = document.createElement('h2');
    alertsHeading.className = 'panel-title';
    alertsHeading.textContent = '🔴 Page Accessibility Alerts & Notes';

    this.pageAlertsListEl = document.createElement('ul');
    this.pageAlertsListEl.className = 'alert-list page-alert-list';
    colAlerts.append(alertsHeading, this.pageAlertsListEl);

    grid.append(colInspect, colNotes, colAlerts);
    bar.appendChild(grid);

    // 3. Defect Report Modal
    this.reportModalEl = this.buildReportModal();
    bar.appendChild(this.reportModalEl);

    shadow.appendChild(bar);
  }

  private renderPageSummaryAndAlerts(): void {
    this.summaryBadgeEl.textContent = '';

    const totalAlerts = this.records.reduce((acc, r) => acc + r.alerts.length, 0);
    const totalNotes = this.records.filter((r) => r.note !== null).length;

    const pillElements = document.createElement('span');
    pillElements.className = 'pill pill-info';
    pillElements.textContent = `Elements: ${this.records.length}`;

    const pillAlerts = document.createElement('span');
    pillAlerts.className = `pill ${totalAlerts > 0 ? 'pill-danger' : 'pill-ok'}`;
    pillAlerts.textContent = `Alerts: ${totalAlerts}`;

    const pillNotes = document.createElement('span');
    pillNotes.className = 'pill pill-note';
    pillNotes.textContent = `DOM Notes: ${totalNotes}`;

    this.summaryBadgeEl.append(pillElements, pillAlerts, pillNotes);

    // Populate Page Alerts & Annotated Elements list
    this.pageAlertsListEl.textContent = '';

    for (const rec of this.records) {
      for (const alert of rec.alerts) {
        const li = document.createElement('li');
        li.className = `alert-item alert-${alert.level}`;

        const ball = document.createElement('span');
        ball.className = `red-ball ball-${alert.level}`;
        ball.setAttribute('aria-hidden', 'true');
        ball.textContent = alert.level === 'danger' ? '!' : alert.level === 'warning' ? '▲' : '•';

        const link = document.createElement('a');
        link.href = `#andi-el-${rec.index}`;
        link.textContent = `[#${rec.index} ${alert.module}ANDI] ${alert.message}`;
        link.addEventListener('click', (e) => {
          e.preventDefault();
          this.inspectByIndex(rec.index, true);
        });

        li.append(ball, link);
        this.pageAlertsListEl.appendChild(li);
      }

      if (rec.note) {
        const li = document.createElement('li');
        li.className = 'alert-item alert-note';

        const ball = document.createElement('span');
        ball.className = 'red-ball ball-note';
        ball.setAttribute('aria-hidden', 'true');
        ball.textContent = '📝';

        const link = document.createElement('a');
        link.href = `#andi-el-${rec.index}`;
        link.textContent = `[#${rec.index} Note] ${rec.note.text}`;
        link.addEventListener('click', (e) => {
          e.preventDefault();
          this.inspectByIndex(rec.index, true);
        });

        li.append(ball, link);
        this.pageAlertsListEl.appendChild(li);
      }
    }

    if (this.pageAlertsListEl.children.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'empty-msg';
      emptyLi.textContent = 'No accessibility alerts or notes detected in this mode.';
      this.pageAlertsListEl.appendChild(emptyLi);
    }
  }

  private renderActiveElementInspection(rec: InspectedElementRecord): void {
    this.elementHeaderEl.textContent = '';

    const indexBadge = document.createElement('span');
    indexBadge.className = 'el-index';
    indexBadge.textContent = `#${rec.index} of ${this.records.length}`;

    const tagCode = document.createElement('code');
    tagCode.className = 'el-tag';
    tagCode.textContent = `<${rec.tagName}${rec.role ? ` role="${rec.role}"` : ''}>`;

    const modulesSpan = document.createElement('span');
    modulesSpan.className = 'el-modules';
    modulesSpan.textContent = rec.modulesMatched.map((m) => `${m}ANDI`).join(' · ');

    this.elementHeaderEl.append(indexBadge, tagCode, modulesSpan);

    // Screen Reader Output
    this.srOutputEl.textContent = rec.screenReaderOutput || '⚠ No Accessible Name / Silent Output';
    this.srOutputEl.className = rec.accName ? 'sr-output' : 'sr-output sr-missing';

    // Components table
    this.componentsTbodyEl.textContent = '';
    const entries = Object.entries(rec.components).filter(([, val]) => val !== undefined && val !== '');
    for (const [key, val] of entries) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = key;
      const td = document.createElement('td');
      td.textContent = String(val);
      tr.append(th, td);
      this.componentsTbodyEl.appendChild(tr);
    }
    for (const [propKey, propVal] of Object.entries(rec.addOnProps)) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = propKey;
      const td = document.createElement('td');
      td.textContent = propVal;
      tr.append(th, td);
      this.componentsTbodyEl.appendChild(tr);
    }
    if (this.componentsTbodyEl.children.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = 'No accessibility markup found on this element.';
      tr.appendChild(td);
      this.componentsTbodyEl.appendChild(tr);
    }

    // Active element alerts
    this.elementAlertsListEl.textContent = '';
    for (const alert of rec.alerts) {
      const li = document.createElement('li');
      li.className = `alert-item alert-${alert.level}`;
      const ball = document.createElement('span');
      ball.className = `red-ball ball-${alert.level}`;
      ball.textContent = alert.level === 'danger' ? '!' : '▲';
      const txt = document.createElement('span');
      txt.textContent = `[${alert.module}ANDI] ${alert.message}`;
      li.append(ball, txt);
      this.elementAlertsListEl.appendChild(li);
    }

    // Populate Note Editor from DOM
    if (rec.note) {
      this.noteTextarea.value = rec.note.text;
      this.noteSeveritySelect.value = rec.note.severity;
      this.noteStatusEl.textContent = `Persisted on DOM (${rec.selector}) [data-andi-note]`;
    } else {
      this.noteTextarea.value = '';
      this.noteSeveritySelect.value = 'warning';
      this.noteStatusEl.textContent = `Target: ${rec.selector} (No DOM note attached)`;
    }
  }

  private renderEmptyActiveElement(): void {
    this.elementHeaderEl.textContent = 'No inspectable elements found for this mode.';
    this.srOutputEl.textContent = '—';
    this.componentsTbodyEl.textContent = '';
    this.elementAlertsListEl.textContent = '';
    this.noteTextarea.value = '';
    this.noteStatusEl.textContent = '';
  }

  private saveActiveElementNote(): void {
    const rec = this.records[this.activeIndex - 1];
    if (!rec) {
      return;
    }
    const text = this.noteTextarea.value;
    const severity = this.noteSeveritySelect.value as AlertLevel;
    rec.note = writeElementNote(rec.element, text, severity);
    this.noteStatusEl.textContent = rec.note
      ? `✓ Saved to DOM attribute [data-andi-note] on ${rec.selector}`
      : `Cleared [data-andi-note] from ${rec.selector}`;
    this.renderPageSummaryAndAlerts();
  }

  private clearActiveElementNote(): void {
    const rec = this.records[this.activeIndex - 1];
    if (!rec) {
      return;
    }
    clearElementNote(rec.element);
    rec.note = null;
    this.noteTextarea.value = '';
    this.noteStatusEl.textContent = `Removed [data-andi-note] from ${rec.selector}`;
    this.renderPageSummaryAndAlerts();
  }

  private buildReportModal(): HTMLElement {
    const modal = document.createElement('div');
    modal.className = 'report-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'ANDI Accessibility Defect Report');

    const card = document.createElement('div');
    card.className = 'report-card';

    const topRow = document.createElement('div');
    topRow.className = 'report-header';

    const title = document.createElement('h2');
    title.textContent = '📋 Accessibility Defect & DOM Notes Report';

    const controls = document.createElement('div');
    controls.className = 'report-controls';

    this.reportFormatSelect = document.createElement('select');
    (['markdown', 'json', 'csv'] as const).forEach((fmt) => {
      const opt = document.createElement('option');
      opt.value = fmt;
      opt.textContent = `Format: ${fmt.toUpperCase()}`;
      this.reportFormatSelect.appendChild(opt);
    });
    this.reportFormatSelect.addEventListener('change', () => this.refreshReportContent());

    const copyBtn = this.createButton('Copy Report', 'Copy report to clipboard', () => {
      navigator.clipboard?.writeText(this.reportTextarea.value);
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy Report';
      }, 1500);
    });
    copyBtn.classList.add('btn-primary');

    const downloadBtn = this.createButton('⬇ Download', 'Download report file', () => {
      this.downloadReportFile();
    });

    const closeBtn = this.createButton('✕ Close', 'Close report modal', () => {
      modal.classList.remove('open');
    });

    controls.append(this.reportFormatSelect, copyBtn, downloadBtn, closeBtn);
    topRow.append(title, controls);

    this.reportTextarea = document.createElement('textarea');
    this.reportTextarea.className = 'report-output';
    this.reportTextarea.readOnly = true;
    this.reportTextarea.setAttribute('aria-label', 'Generated Defect Report');

    card.append(topRow, this.reportTextarea);
    modal.appendChild(card);
    return modal;
  }

  private openReportModal(): void {
    this.refreshReportContent();
    this.reportModalEl.classList.add('open');
    this.reportTextarea.focus();
  }

  private refreshReportContent(): void {
    const report = buildDefectReport(this.records, this.mode);
    const fmt = this.reportFormatSelect.value;
    if (fmt === 'json') {
      this.reportTextarea.value = JSON.stringify(report, null, 2);
    } else if (fmt === 'csv') {
      this.reportTextarea.value = formatReportAsCsv(report);
    } else {
      this.reportTextarea.value = formatReportAsMarkdown(report);
    }
  }

  private downloadReportFile(): void {
    const fmt = this.reportFormatSelect.value;
    const ext = fmt === 'json' ? 'json' : fmt === 'csv' ? 'csv' : 'md';
    const mime =
      fmt === 'json' ? 'application/json' : fmt === 'csv' ? 'text/csv' : 'text/markdown';
    const blob = new Blob([this.reportTextarea.value], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `andi-defect-report.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private createButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'andi-btn';
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private getShadowStyles(): string {
    return `
      :host {
        all: initial;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2147483646;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #f8fafc;
      }
      * { box-sizing: border-box; }
      .andi-bar {
        background: #0f172a;
        border-bottom: 3px solid #38bdf8;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
        font-size: 13px;
      }
      .andi-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 14px;
        background: #1e293b;
        border-bottom: 1px solid #334155;
      }
      .andi-brand {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .andi-logo {
        font-weight: 800;
        font-size: 15px;
        color: #38bdf8;
        letter-spacing: 0.4px;
      }
      .andi-version {
        font-size: 11px;
        background: #334155;
        color: #cbd5e1;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .andi-module-wrap {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 600;
      }
      select {
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid #475569;
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 12.5px;
        font-weight: 600;
      }
      .andi-summary-pills {
        display: flex;
        gap: 6px;
      }
      .pill {
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 11.5px;
        font-weight: 700;
      }
      .pill-info { background: #1e3a8a; color: #bfdbfe; }
      .pill-danger { background: #991b1b; color: #fecaca; }
      .pill-ok { background: #065f46; color: #a7f3d0; }
      .pill-note { background: #5b21b6; color: #ddd6fe; }
      .andi-actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .andi-btn {
        background: #334155;
        color: #f8fafc;
        border: 1px solid #475569;
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .andi-btn:hover, .andi-btn:focus-visible {
        background: #475569;
        outline: 2px solid #38bdf8;
      }
      .btn-primary {
        background: #2563eb;
        border-color: #3b82f6;
      }
      .btn-primary:hover { background: #1d4ed8; }
      .btn-danger {
        background: #991b1b;
        border-color: #dc2626;
      }
      .andi-grid {
        display: grid;
        grid-template-columns: 1.35fr 1fr 1.25fr;
        gap: 10px;
        padding: 10px 14px;
        max-height: 215px;
      }
      .andi-panel {
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 8px 10px;
        overflow-y: auto;
        max-height: 195px;
      }
      .panel-title {
        margin: 0 0 4px;
        font-size: 12.5px;
        font-weight: 700;
        color: #e2e8f0;
      }
      .panel-sub {
        margin: 0 0 6px;
        font-size: 11px;
        color: #94a3b8;
      }
      .element-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
        flex-wrap: wrap;
      }
      .el-index {
        background: #ec4899;
        color: #fff;
        font-weight: 700;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .el-tag {
        color: #38bdf8;
        font-weight: 700;
      }
      .el-modules {
        font-size: 11px;
        color: #94a3b8;
      }
      .sr-box {
        background: #0f172a;
        border-left: 3px solid #38bdf8;
        padding: 5px 8px;
        border-radius: 4px;
        margin-bottom: 6px;
      }
      .sr-title {
        font-size: 10.5px;
        color: #94a3b8;
        text-transform: uppercase;
      }
      .sr-output {
        font-weight: 700;
        color: #f8fafc;
        margin-top: 2px;
      }
      .sr-missing { color: #f87171; }
      .comp-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11.5px;
        margin-bottom: 6px;
      }
      .comp-table th, .comp-table td {
        border-bottom: 1px solid #334155;
        padding: 2px 4px;
        text-align: left;
      }
      .comp-table th {
        color: #93c5fd;
        width: 32%;
      }
      .note-textarea {
        width: 100%;
        min-height: 58px;
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid #475569;
        border-radius: 6px;
        padding: 6px;
        font-family: inherit;
        font-size: 12px;
        resize: vertical;
      }
      .note-controls {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
      }
      .note-status {
        margin-top: 4px;
        font-size: 11px;
        color: #c4b5fd;
      }
      .alert-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .alert-item {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        padding: 3px 0;
        font-size: 12px;
        border-bottom: 1px solid rgba(51, 65, 85, 0.5);
      }
      .alert-item a {
        color: #fca5a5;
        text-decoration: underline;
        cursor: pointer;
      }
      .alert-warning a { color: #fde68a; }
      .alert-caution a { color: #bae6fd; }
      .alert-note a { color: #ddd6fe; }
      .red-ball {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        min-width: 16px;
        border-radius: 50%;
        font-size: 10px;
        font-weight: 800;
        color: #fff;
      }
      .ball-danger { background: #dc2626; }
      .ball-warning { background: #d97706; }
      .ball-caution { background: #0284c7; }
      .ball-note { background: #7c3aed; }
      .empty-msg { color: #94a3b8; font-style: italic; font-size: 12px; }
      .report-modal {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.8);
        place-items: center;
        padding: 24px;
        z-index: 2147483647;
      }
      .report-modal.open {
        display: grid;
      }
      .report-card {
        width: 100%;
        max-width: 880px;
        background: #1e293b;
        border: 2px solid #38bdf8;
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
      }
      .report-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }
      .report-header h2 {
        margin: 0;
        font-size: 16px;
      }
      .report-controls {
        display: flex;
        gap: 8px;
      }
      .report-output {
        width: 100%;
        height: 380px;
        background: #0f172a;
        color: #e2e8f0;
        border: 1px solid #475569;
        border-radius: 8px;
        padding: 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
      }
    `;
  }
}

