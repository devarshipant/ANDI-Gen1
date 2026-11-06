/**
 * ANDI-Gen1 — Shadow DOM UI Controller
 * Implements:
 * 1. On-demand Fly-in Note Drawer saved in `localStorage` (freeing main panel space)
 * 2. Iframe detection & Step-In / Step-Out inspection
 * 3. Page Alerts panel positioned immediately after Screen Reader Spoken & Elements panel
 * 4. `ALL` mode placed as the last item in the Mode droplist
 * 5. Built-in CSP detection & resolution (`CspGuard`)
 * 6. Defect report strictly based on Page Accessibility Alerts + on-demand notes
 * 7. Pin/Dock to Top, Bottom, Left, Right, or DOM Inline (like DOM Explorer)
 * 8. User themes for Dark and Light layouts
 * 9. DOM Node Screenshot with Tester Note burned in & downloaded with the report
 */

import {
  AlertLevel,
  AndiMode,
  DockPosition,
  InspectedElementRecord,
  ThemeMode
} from './types';
import {
  ANDI_HOST_ID,
  ANDI_LASER_ID,
  buildPageIndex,
  canStepIntoIframe
} from './dom-index';
import { analyzePage } from './analyzers';
import {
  buildDefectReport,
  captureNodeScreenshotWithNote,
  clearElementNote,
  downloadScreenshotPng,
  formatReportAsCsv,
  formatReportAsHtml,
  formatReportAsMarkdown,
  readElementNote,
  writeElementNote
} from './notes-report';
import { CspGuard } from './csp-guard';

const PAGE_HIGHLIGHT_STYLE_ID = 'andi-gen1-page-highlights-css';
const STORAGE_KEY_THEME = 'ANDI_GEN1_THEME';
const STORAGE_KEY_DOCK = 'ANDI_GEN1_DOCK';

// Requirement #4: Move ALL mode as the last item in droplist
const DROPLIST_MODES_ORDER: AndiMode[] = ['f', 'g', 'l', 't', 's', 'c', 'h', 'i', 'all'];

const MODULE_LABELS: Record<AndiMode, string> = {
  f: 'fANDI — Focusable Elements',
  g: 'gANDI — Graphics / Images',
  l: 'lANDI — Links / Buttons',
  t: 'tANDI — Tables',
  s: 'sANDI — Structures & Headings',
  c: 'cANDI — Color Contrast (WCAG AA)',
  h: 'hANDI — Hidden Content',
  i: 'iANDI — Iframes',
  all: 'ALL — Run All Accessibility Tests'
};

export class AndiGen1Controller {
  private mode: AndiMode;
  private records: InspectedElementRecord[] = [];
  private elementToRecord = new WeakMap<HTMLElement, InspectedElementRecord>();
  private activeIndex = 0;
  private highlightsEnabled = true;
  private laserEnabled = true;

  // Theme & Dock settings (#7, #8)
  private theme: ThemeMode = 'dark';
  private dock: DockPosition = 'top';

  // Iframe Step-In state (#2)
  private activeDocument: Document = document;
  private activeFrameLabel = 'Top Document';
  private steppedInIframe: HTMLIFrameElement | null = null;
  private detectedIframes: HTMLIFrameElement[] = [];

  // CSP Detector & Resolver (#5)
  private cspGuard = new CspGuard();

  private hostEl: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private barEl!: HTMLElement;
  private laserSvg: SVGSVGElement | null = null;
  private laserLine: SVGLineElement | null = null;

  // UI Element References inside Shadow DOM
  private summaryBadgeEl!: HTMLElement;
  private iframeStepperSelect!: HTMLSelectElement;
  private stepOutBtn!: HTMLButtonElement;
  private elementHeaderEl!: HTMLElement;
  private srOutputEl!: HTMLElement;
  private componentsTbodyEl!: HTMLElement;
  private elementAlertsListEl!: HTMLElement;
  private pageAlertsListEl!: HTMLElement;

  // Fly-in Note Drawer References (#1, #9)
  private noteDrawerEl!: HTMLElement;
  private noteTextarea!: HTMLTextAreaElement;
  private noteSeveritySelect!: HTMLSelectElement;
  private noteStatusEl!: HTMLElement;
  private screenshotPreviewImg!: HTMLImageElement;
  private screenshotWrapEl!: HTMLElement;
  private currentScreenshotDataUrl = '';

  // Modals (#5, #6)
  private reportModalEl!: HTMLElement;
  private reportTextarea!: HTMLTextAreaElement;
  private reportFormatSelect!: HTMLSelectElement;
  private cspModalEl!: HTMLElement;
  private cspBodyEl!: HTMLElement;

  // Bound delegated handlers
  private boundMouseOver: (e: MouseEvent) => void;
  private boundFocusIn: (e: FocusEvent) => void;
  private boundKeyDown: (e: KeyboardEvent) => void;

  constructor(initialMode: AndiMode = 'f') {
    this.mode = initialMode;
    this.loadPreferences();
    this.boundMouseOver = this.handleDocumentMouseOver.bind(this);
    this.boundFocusIn = this.handleDocumentFocusIn.bind(this);
    this.boundKeyDown = this.handleDocumentKeyDown.bind(this);
  }

  private loadPreferences(): void {
    try {
      const savedTheme = window.localStorage.getItem(STORAGE_KEY_THEME) as ThemeMode | null;
      if (savedTheme === 'dark' || savedTheme === 'light') {
        this.theme = savedTheme;
      }
      const savedDock = window.localStorage.getItem(STORAGE_KEY_DOCK) as DockPosition | null;
      if (savedDock && ['top', 'bottom', 'left', 'right', 'dom'].includes(savedDock)) {
        this.dock = savedDock;
      }
    } catch {
      // Ignore storage errors
    }
  }

  public launch(mode?: AndiMode): void {
    if (mode) {
      this.mode = mode;
    }
    this.destroy();
    this.cspGuard.attach(document);
    this.injectPageHighlightStyles(document);
    this.mountShadowUI();
    this.mountLaserSvg();
    this.attachDelegatedEvents(document);
    this.applyDockAndTheme();
    this.runScan();
  }

  public setMode(mode: AndiMode): void {
    this.mode = mode;
    const selectEl = this.shadow?.getElementById('andi-module-select') as HTMLSelectElement | null;
    if (selectEl && selectEl.value !== mode) {
      selectEl.value = mode;
    }
    this.runScan();
  }

  public destroy(): void {
    this.detachDelegatedEvents(this.activeDocument);
    this.detachDelegatedEvents(document);
    this.cspGuard.detach(document);

    this.clearPageElementMarkers(this.activeDocument);
    this.clearPageElementMarkers(document);

    document.getElementById(ANDI_HOST_ID)?.remove();
    document.getElementById(ANDI_LASER_ID)?.remove();
    document.getElementById(PAGE_HIGHLIGHT_STYLE_ID)?.remove();
    this.activeDocument.getElementById(PAGE_HIGHLIGHT_STYLE_ID)?.remove();
    this.resetBodyMargins();

    this.hostEl = null;
    this.shadow = null;
    this.laserSvg = null;
    this.laserLine = null;
  }

  /**
   * Feature #2: Step into a same-origin <iframe> to inspect its internal DOM.
   */
  public stepIntoIframe(iframe: HTMLIFrameElement): void {
    if (!canStepIntoIframe(iframe) || !iframe.contentDocument) {
      window.alert(
        'Cannot step into this <iframe> due to cross-origin security restrictions, or its document is not loaded.'
      );
      return;
    }
    this.detachDelegatedEvents(this.activeDocument);
    this.clearPageElementMarkers(this.activeDocument);

    this.steppedInIframe = iframe;
    this.activeDocument = iframe.contentDocument;
    const iframeId = iframe.id ? `#${iframe.id}` : iframe.getAttribute('name') || iframe.src || 'iframe';
    this.activeFrameLabel = `Iframe (${iframeId})`;

    this.injectPageHighlightStyles(this.activeDocument);
    this.attachDelegatedEvents(this.activeDocument);
    this.stepOutBtn.style.display = 'inline-block';
    this.runScan();
  }

  /**
   * Feature #2: Step back out from an <iframe> to the parent document.
   */
  public stepOutOfIframe(): void {
    if (!this.steppedInIframe) {
      return;
    }
    this.detachDelegatedEvents(this.activeDocument);
    this.clearPageElementMarkers(this.activeDocument);
    this.activeDocument.getElementById(PAGE_HIGHLIGHT_STYLE_ID)?.remove();

    this.steppedInIframe = null;
    this.activeDocument = document;
    this.activeFrameLabel = 'Top Document';
    this.stepOutBtn.style.display = 'none';

    this.attachDelegatedEvents(document);
    this.runScan();
  }

  private runScan(): void {
    this.clearPageElementMarkers(this.activeDocument);
    const pageIndex = buildPageIndex(this.activeDocument.body);
    this.detectedIframes = pageIndex.iframes;
    this.records = analyzePage(pageIndex, this.mode, this.activeFrameLabel);
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

    this.populateIframeStepperDropdown();
    this.renderPageSummaryAndAlerts();

    if (this.records.length > 0) {
      this.inspectByIndex(1, false);
    } else {
      this.activeIndex = 0;
      this.renderEmptyActiveElement();
    }
  }

  private populateIframeStepperDropdown(): void {
    if (!this.iframeStepperSelect) {
      return;
    }
    this.iframeStepperSelect.textContent = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = `🖼 Iframes (${this.detectedIframes.length}) — Step In...`;
    this.iframeStepperSelect.appendChild(defaultOpt);

    this.detectedIframes.forEach((ifr, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      const accessible = canStepIntoIframe(ifr);
      const label = ifr.id
        ? `#${ifr.id}`
        : ifr.getAttribute('title') || ifr.getAttribute('src') || `iframe #${idx + 1}`;
      opt.textContent = `${accessible ? '↪ Step into' : '🔒 Cross-Origin'}: ${label}`;
      this.iframeStepperSelect.appendChild(opt);
    });
  }

  private clearPageElementMarkers(doc: Document): void {
    const marked = doc.querySelectorAll('[data-andi508-index], [data-andi-active], [data-andi-highlight]');
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

    rec.note = readElementNote(rec.element, rec.selector, this.activeFrameLabel);
    this.renderActiveElementInspection(rec);
    this.syncNoteDrawerForRecord(rec);
    this.positionDomInlineDock(rec.element);
    this.drawLaserToElement(rec.element);
  }

  private handleDocumentMouseOver(e: MouseEvent): void {
    if (e.shiftKey) {
      return;
    }
    const target = e.target as HTMLElement | null;
    if (!target || target.id === ANDI_HOST_ID || target.closest(`#${ANDI_HOST_ID}`)) {
      return;
    }
    let curr: HTMLElement | null = target;
    while (curr && curr !== this.activeDocument.body) {
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

  private injectPageHighlightStyles(doc: Document): void {
    if (doc.getElementById(PAGE_HIGHLIGHT_STYLE_ID)) {
      return;
    }
    const css = `
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
    const style = doc.createElement('style');
    style.id = PAGE_HIGHLIGHT_STYLE_ID;
    style.textContent = css;
    doc.head.appendChild(style);
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
    let toRect = targetEl.getBoundingClientRect();

    // If stepped inside an iframe, offset coordinates by the iframe's bounding rect in the top window
    if (this.steppedInIframe) {
      const iframeRect = this.steppedInIframe.getBoundingClientRect();
      toRect = new DOMRect(
        iframeRect.left + toRect.left,
        iframeRect.top + toRect.top,
        toRect.width,
        toRect.height
      );
    }

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

  private attachDelegatedEvents(doc: Document): void {
    doc.addEventListener('mouseover', this.boundMouseOver, true);
    doc.addEventListener('focusin', this.boundFocusIn, true);
    doc.addEventListener('keydown', this.boundKeyDown, true);
  }

  private detachDelegatedEvents(doc: Document): void {
    doc.removeEventListener('mouseover', this.boundMouseOver, true);
    doc.removeEventListener('focusin', this.boundFocusIn, true);
    doc.removeEventListener('keydown', this.boundKeyDown, true);
  }

  /**
   * Features #7 & #8: Applies Dock position (top, bottom, left, right, dom) and Theme (dark, light).
   */
  private applyDockAndTheme(): void {
    if (!this.barEl || !this.hostEl) {
      return;
    }
    this.barEl.setAttribute('data-theme', this.theme);
    this.barEl.setAttribute('data-dock', this.dock);
    this.hostEl.setAttribute('data-dock', this.dock);

    this.resetBodyMargins();
    if (this.dock === 'top') {
      document.body.style.marginTop = '255px';
      this.hostEl.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483646;';
    } else if (this.dock === 'bottom') {
      document.body.style.marginBottom = '255px';
      this.hostEl.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483646;';
    } else if (this.dock === 'left') {
      document.body.style.marginLeft = '420px';
      this.hostEl.style.cssText = 'position:fixed;top:0;bottom:0;left:0;width:420px;z-index:2147483646;';
    } else if (this.dock === 'right') {
      document.body.style.marginRight = '420px';
      this.hostEl.style.cssText = 'position:fixed;top:0;bottom:0;right:0;width:420px;z-index:2147483646;';
    } else if (this.dock === 'dom') {
      const activeRec = this.records[this.activeIndex - 1];
      if (activeRec) {
        this.positionDomInlineDock(activeRec.element);
      } else {
        this.hostEl.style.cssText = 'position:fixed;bottom:16px;right:16px;width:540px;z-index:2147483646;';
      }
    }
  }

  private positionDomInlineDock(targetEl: HTMLElement): void {
    if (this.dock !== 'dom' || !this.hostEl) {
      return;
    }
    let rect = targetEl.getBoundingClientRect();
    if (this.steppedInIframe) {
      const ifrRect = this.steppedInIframe.getBoundingClientRect();
      rect = new DOMRect(ifrRect.left + rect.left, ifrRect.top + rect.top, rect.width, rect.height);
    }
    const topPos = Math.min(Math.max(rect.bottom + 10, 12), window.innerHeight - 280);
    const leftPos = Math.min(Math.max(rect.left, 12), Math.max(window.innerWidth - 580, 12));
    this.hostEl.style.cssText = `position:fixed;top:${Math.round(topPos)}px;left:${Math.round(leftPos)}px;width:560px;z-index:2147483646;`;
  }

  private resetBodyMargins(): void {
    document.body.style.removeProperty('margin-top');
    document.body.style.removeProperty('margin-bottom');
    document.body.style.removeProperty('margin-left');
    document.body.style.removeProperty('margin-right');
  }

  private mountShadowUI(): void {
    const host = document.createElement('div');
    host.id = ANDI_HOST_ID;
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'ANDI-Gen1 Accessibility Inspector');
    document.body.prepend(host);

    const shadow = host.attachShadow({ mode: 'open' });
    this.hostEl = host;
    this.shadow = shadow;

    // Feature #5: Apply styles via CspGuard (uses Constructable Stylesheets first)
    this.cspGuard.applySafeStyles(shadow, this.getShadowStyles());

    const bar = document.createElement('section');
    bar.className = 'andi-bar';
    this.barEl = bar;

    // 1. Top Toolbar Header
    const header = document.createElement('header');
    header.className = 'andi-header';

    const brand = document.createElement('div');
    brand.className = 'andi-brand';
    const brandBadge = document.createElement('span');
    brandBadge.className = 'andi-logo';
    brandBadge.textContent = 'ANDI-Gen1';
    const versionSpan = document.createElement('span');
    versionSpan.className = 'andi-version';
    versionSpan.textContent = 'v31.0 TS';
    brand.append(brandBadge, versionSpan);

    // Feature #4: Mode Selector with ALL as the LAST option
    const moduleWrap = document.createElement('div');
    moduleWrap.className = 'andi-module-wrap';
    const moduleLabel = document.createElement('label');
    moduleLabel.htmlFor = 'andi-module-select';
    moduleLabel.textContent = 'Mode:';
    const moduleSelect = document.createElement('select');
    moduleSelect.id = 'andi-module-select';
    DROPLIST_MODES_ORDER.forEach((m) => {
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

    // Feature #2: Iframe Detection & Step-In Dropdown + Step Out button
    const iframeWrap = document.createElement('div');
    iframeWrap.className = 'andi-iframe-wrap';
    this.iframeStepperSelect = document.createElement('select');
    this.iframeStepperSelect.setAttribute('aria-label', 'Step into detected iframe');
    this.iframeStepperSelect.addEventListener('change', () => {
      const idx = Number(this.iframeStepperSelect.value);
      if (!Number.isNaN(idx) && this.detectedIframes[idx]) {
        this.stepIntoIframe(this.detectedIframes[idx]);
      }
      this.iframeStepperSelect.value = '';
    });

    this.stepOutBtn = this.createButton('↩ Step Out of Iframe', 'Return to Top Document', () => {
      this.stepOutOfIframe();
    });
    this.stepOutBtn.classList.add('btn-warning');
    this.stepOutBtn.style.display = 'none';
    iframeWrap.append(this.iframeStepperSelect, this.stepOutBtn);

    this.summaryBadgeEl = document.createElement('div');
    this.summaryBadgeEl.className = 'andi-summary-pills';

    // Toolbar Controls (Prev, Next, Fly-in Note toggle, Dock selector, Theme toggle, CSP, Report, Close)
    const actions = document.createElement('div');
    actions.className = 'andi-actions';

    const prevBtn = this.createButton('◀ Prev', 'Previous Element (Alt + ,)', () => this.stepElement(-1));
    const nextBtn = this.createButton('Next ▶', 'Next Element (Alt + .)', () => this.stepElement(1));

    // Feature #1: On-Demand Fly-in Note Drawer Trigger
    const noteFlyinBtn = this.createButton('📝 Note', 'Open on-demand Fly-in Note & Screenshot Drawer', () => {
      this.toggleNoteDrawer();
    });
    noteFlyinBtn.classList.add('btn-note');

    // Feature #7: Pin / Dock Position Selector
    const dockSelect = document.createElement('select');
    dockSelect.setAttribute('aria-label', 'Pin ANDI-Gen1 Position');
    const dockOptions: Array<{ value: DockPosition; label: string }> = [
      { value: 'top', label: '📌 Pin: Top' },
      { value: 'bottom', label: '📌 Pin: Bottom' },
      { value: 'left', label: '📌 Pin: Left Explorer' },
      { value: 'right', label: '📌 Pin: Right Explorer' },
      { value: 'dom', label: '📌 Pin: DOM Inline' }
    ];
    dockOptions.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.value;
      opt.textContent = d.label;
      if (d.value === this.dock) {
        opt.selected = true;
      }
      dockSelect.appendChild(opt);
    });
    dockSelect.addEventListener('change', () => {
      this.dock = dockSelect.value as DockPosition;
      try {
        window.localStorage.setItem(STORAGE_KEY_DOCK, this.dock);
      } catch {
        // ignore
      }
      this.applyDockAndTheme();
    });

    // Feature #8: Dark / Light Theme Toggle
    const themeBtn = this.createButton(
      this.theme === 'dark' ? '☀️ Light' : '🌙 Dark',
      'Switch between Dark and Light layout themes',
      () => {
        this.theme = this.theme === 'dark' ? 'light' : 'dark';
        themeBtn.textContent = this.theme === 'dark' ? '☀️ Light' : '🌙 Dark';
        try {
          window.localStorage.setItem(STORAGE_KEY_THEME, this.theme);
        } catch {
          // ignore
        }
        this.applyDockAndTheme();
      }
    );

    // Feature #5: Built-in CSP Detector & Resolver Button
    const cspBtn = this.createButton('🛡️ CSP', 'Inspect & Resolve Content Security Policy', () => {
      this.openCspModal();
    });

    // Feature #6: Defect Report (strictly based on Page Accessibility Alerts + on-demand notes)
    const reportBtn = this.createButton('📋 Defect Report', 'Export Page Alerts & On-Demand Notes Report', () => {
      this.openReportModal();
    });
    reportBtn.classList.add('btn-primary');

    const closeBtn = this.createButton('✕', 'Close ANDI-Gen1', () => this.destroy());
    closeBtn.classList.add('btn-danger');

    actions.append(prevBtn, nextBtn, noteFlyinBtn, dockSelect, themeBtn, cspBtn, reportBtn, closeBtn);
    header.append(brand, moduleWrap, iframeWrap, this.summaryBadgeEl, actions);
    bar.appendChild(header);

    // 2. Main 2-Panel Layout (#3: Screen Reader Spoken & Elements panel FIRST, followed by Page Alerts panel)
    const grid = document.createElement('div');
    grid.className = 'andi-grid';

    // Panel 1: Screen Reader Spoken Output & Active Element Components
    const colInspect = document.createElement('div');
    colInspect.className = 'andi-panel';
    this.elementHeaderEl = document.createElement('div');
    this.elementHeaderEl.className = 'element-header';

    const srBox = document.createElement('div');
    srBox.className = 'sr-box';
    const srTitle = document.createElement('div');
    srTitle.className = 'sr-title';
    srTitle.textContent = '🔊 Screen Reader Spoken Output:';
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

    // Panel 2 (#3): Page Accessibility Alerts Panel (immediately after Screen Reader Spoken & Elements panel)
    const colAlerts = document.createElement('div');
    colAlerts.className = 'andi-panel';
    const alertsHeading = document.createElement('h2');
    alertsHeading.className = 'panel-title';
    alertsHeading.textContent = '🔴 Page Accessibility Alerts (Click to Focus)';

    this.pageAlertsListEl = document.createElement('ul');
    this.pageAlertsListEl.className = 'alert-list page-alert-list';
    colAlerts.append(alertsHeading, this.pageAlertsListEl);

    grid.append(colInspect, colAlerts);
    bar.appendChild(grid);

    // 3. On-Demand Fly-in Note & Screenshot Drawer (#1, #9)
    this.noteDrawerEl = this.buildFlyinNoteDrawer();
    bar.appendChild(this.noteDrawerEl);

    // 4. Modals (#5 CSP Resolver, #6 Defect Report)
    this.cspModalEl = this.buildCspModal();
    this.reportModalEl = this.buildReportModal();
    bar.append(this.cspModalEl, this.reportModalEl);

    shadow.appendChild(bar);
  }

  /**
   * Features #1 & #9: On-Demand Fly-in Note Drawer that saves to `localStorage`
   * and captures annotated DOM Node Screenshots with the tester's note.
   */
  private buildFlyinNoteDrawer(): HTMLElement {
    const drawer = document.createElement('aside');
    drawer.className = 'flyin-note-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'On-Demand Control Note and Screenshot');

    const topRow = document.createElement('div');
    topRow.className = 'flyin-header';
    const title = document.createElement('h3');
    title.textContent = '📝 On-Demand Control Note & Node Screenshot';
    const closeDrawerBtn = this.createButton('✕ Close', 'Close Note Drawer', () => {
      drawer.classList.remove('open');
    });
    topRow.append(title, closeDrawerBtn);

    const sub = document.createElement('p');
    sub.className = 'panel-sub';
    sub.textContent =
      'Saved in localStorage for the selected DOM node. Included in the Defect Report along with the annotated node screenshot.';

    this.noteTextarea = document.createElement('textarea');
    this.noteTextarea.className = 'note-textarea';
    this.noteTextarea.placeholder = 'Enter accessibility defect note for this control...';

    const controlsRow = document.createElement('div');
    controlsRow.className = 'note-controls';

    this.noteSeveritySelect = document.createElement('select');
    (['danger', 'warning', 'caution'] as AlertLevel[]).forEach((lvl) => {
      const opt = document.createElement('option');
      opt.value = lvl;
      opt.textContent = `Severity: ${lvl.toUpperCase()}`;
      this.noteSeveritySelect.appendChild(opt);
    });

    const saveBtn = this.createButton('💾 Save Note (localStorage)', 'Save note to localStorage', () => {
      this.saveActiveElementNote(false);
    });
    saveBtn.classList.add('btn-primary');

    // Feature #9: Screenshot DOM Node with Tester Note
    const shotBtn = this.createButton(
      '📸 Screenshot Node + Note',
      'Capture PNG screenshot of this DOM node with your text note burned in',
      () => {
        this.saveActiveElementNote(true);
      }
    );
    shotBtn.classList.add('btn-note');

    const clearBtn = this.createButton('Clear', 'Delete stored note & screenshot', () => {
      this.clearActiveElementNote();
    });

    controlsRow.append(this.noteSeveritySelect, saveBtn, shotBtn, clearBtn);

    this.noteStatusEl = document.createElement('div');
    this.noteStatusEl.className = 'note-status';
    this.noteStatusEl.setAttribute('role', 'status');
    this.noteStatusEl.setAttribute('aria-live', 'polite');

    // Screenshot Thumbnail Preview & Download (#9)
    this.screenshotWrapEl = document.createElement('div');
    this.screenshotWrapEl.className = 'shot-preview-wrap';
    this.screenshotWrapEl.style.display = 'none';

    this.screenshotPreviewImg = document.createElement('img');
    this.screenshotPreviewImg.className = 'shot-preview-img';
    this.screenshotPreviewImg.alt = 'Captured DOM node screenshot with tester note';

    const downloadShotBtn = this.createButton(
      '⬇ Download Node Screenshot (.png)',
      'Download annotated PNG screenshot',
      () => {
        const rec = this.records[this.activeIndex - 1];
        if (rec && this.currentScreenshotDataUrl) {
          downloadScreenshotPng(this.currentScreenshotDataUrl, rec.index, rec.selector);
        }
      }
    );

    this.screenshotWrapEl.append(this.screenshotPreviewImg, downloadShotBtn);

    drawer.append(topRow, sub, this.noteTextarea, controlsRow, this.noteStatusEl, this.screenshotWrapEl);
    return drawer;
  }

  private toggleNoteDrawer(forceOpen?: boolean): void {
    const isOpen = this.noteDrawerEl.classList.contains('open');
    const nextState = forceOpen !== undefined ? forceOpen : !isOpen;
    if (nextState) {
      this.noteDrawerEl.classList.add('open');
      this.noteTextarea.focus();
    } else {
      this.noteDrawerEl.classList.remove('open');
    }
  }

  private syncNoteDrawerForRecord(rec: InspectedElementRecord): void {
    if (!this.noteTextarea) {
      return;
    }
    if (rec.note) {
      this.noteTextarea.value = rec.note.text;
      this.noteSeveritySelect.value = rec.note.severity;
      this.noteStatusEl.textContent = `Loaded from localStorage for ${rec.selector}`;
      if (rec.note.screenshotDataUrl) {
        this.currentScreenshotDataUrl = rec.note.screenshotDataUrl;
        this.screenshotPreviewImg.src = rec.note.screenshotDataUrl;
        this.screenshotWrapEl.style.display = 'flex';
      } else {
        this.currentScreenshotDataUrl = '';
        this.screenshotWrapEl.style.display = 'none';
      }
    } else {
      this.noteTextarea.value = '';
      this.noteSeveritySelect.value = 'warning';
      this.noteStatusEl.textContent = `Selected: ${rec.selector} (No saved note in localStorage)`;
      this.currentScreenshotDataUrl = '';
      this.screenshotWrapEl.style.display = 'none';
    }
  }

  private saveActiveElementNote(withScreenshot: boolean): void {
    const rec = this.records[this.activeIndex - 1];
    if (!rec) {
      return;
    }
    const text = this.noteTextarea.value.trim() || (withScreenshot ? 'Annotated DOM Node Snapshot' : '');
    if (!text) {
      this.clearActiveElementNote();
      return;
    }
    this.noteTextarea.value = text;
    const severity = this.noteSeveritySelect.value as AlertLevel;

    let shotUrl = this.currentScreenshotDataUrl || undefined;
    if (withScreenshot) {
      shotUrl = captureNodeScreenshotWithNote(
        rec.element,
        rec.selector,
        rec.tagName,
        rec.accName,
        text,
        severity,
        rec.alerts
      );
      this.currentScreenshotDataUrl = shotUrl;
      this.screenshotPreviewImg.src = shotUrl;
      this.screenshotWrapEl.style.display = 'flex';
    }

    rec.note = writeElementNote(
      rec.element,
      rec.selector,
      text,
      severity,
      shotUrl,
      this.activeFrameLabel
    );
    this.noteStatusEl.textContent = withScreenshot
      ? `✓ Saved note + annotated PNG screenshot to localStorage for ${rec.selector}`
      : `✓ Saved note to localStorage for ${rec.selector}`;

    this.renderActiveElementInspection(rec);
    this.renderPageSummaryAndAlerts();
  }

  private clearActiveElementNote(): void {
    const rec = this.records[this.activeIndex - 1];
    if (!rec) {
      return;
    }
    clearElementNote(rec.element, rec.selector, this.activeFrameLabel);
    rec.note = null;
    this.noteTextarea.value = '';
    this.currentScreenshotDataUrl = '';
    this.screenshotWrapEl.style.display = 'none';
    this.noteStatusEl.textContent = `Removed note from localStorage for ${rec.selector}`;
    this.renderActiveElementInspection(rec);
    this.renderPageSummaryAndAlerts();
  }

  private renderPageSummaryAndAlerts(): void {
    this.summaryBadgeEl.textContent = '';

    const totalAlerts = this.records.reduce((acc, r) => acc + r.alerts.length, 0);
    const totalNotes = this.records.filter((r) => r.note !== null).length;

    const pillFrame = document.createElement('span');
    pillFrame.className = 'pill pill-frame';
    pillFrame.textContent = this.activeFrameLabel;

    const pillElements = document.createElement('span');
    pillElements.className = 'pill pill-info';
    pillElements.textContent = `Elements: ${this.records.length}`;

    const pillAlerts = document.createElement('span');
    pillAlerts.className = `pill ${totalAlerts > 0 ? 'pill-danger' : 'pill-ok'}`;
    pillAlerts.textContent = `Alerts: ${totalAlerts}`;

    const pillNotes = document.createElement('span');
    pillNotes.className = 'pill pill-note';
    pillNotes.textContent = `Notes: ${totalNotes}`;

    this.summaryBadgeEl.append(pillFrame, pillElements, pillAlerts, pillNotes);

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
        link.textContent = `[#${rec.index} ${alert.module}ANDI] ${alert.message}${rec.note ? ' 📝' : ''}`;
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
      emptyLi.textContent = 'No page accessibility alerts detected in this mode.';
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

    // On-demand Fly-in Note trigger button right on the active element header (#1)
    const noteBadgeBtn = this.createButton(
      rec.note ? '📝 Edit Note (Saved)' : '+ Add Note',
      'Open Fly-in Note & Screenshot Drawer for this element',
      () => this.toggleNoteDrawer(true)
    );
    if (rec.note) {
      noteBadgeBtn.classList.add('btn-note');
    }

    this.elementHeaderEl.append(indexBadge, tagCode, modulesSpan, noteBadgeBtn);

    // Feature #2: If active element is an <iframe>, offer direct "↪ Step Into Iframe" button
    if (rec.isIframe) {
      const stepInBtn = this.createButton(
        rec.iframeAccessible ? '↪ Step Into This Iframe' : '🔒 Cross-Origin Iframe',
        'Inspect DOM inside this iframe',
        () => {
          this.stepIntoIframe(rec.element as HTMLIFrameElement);
        }
      );
      stepInBtn.classList.add('btn-primary');
      this.elementHeaderEl.appendChild(stepInBtn);
    }

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
  }

  private renderEmptyActiveElement(): void {
    this.elementHeaderEl.textContent = 'No inspectable elements found for this mode.';
    this.srOutputEl.textContent = '—';
    this.componentsTbodyEl.textContent = '';
    this.elementAlertsListEl.textContent = '';
  }

  /**
   * Feature #5: Built-in CSP Detection & Resolution Modal.
   */
  private buildCspModal(): HTMLElement {
    const modal = document.createElement('div');
    modal.className = 'report-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Content Security Policy Detector and Resolver');

    const card = document.createElement('div');
    card.className = 'report-card';

    const topRow = document.createElement('div');
    topRow.className = 'report-header';
    const title = document.createElement('h2');
    title.textContent = '🛡️ Built-in CSP Detection & Resolution';

    const controls = document.createElement('div');
    controls.className = 'report-controls';

    const resolveBtn = this.createButton(
      '⚡ Neutralize Meta CSP Rules',
      'Neutralize restrictive <meta http-equiv="Content-Security-Policy"> tags on this page',
      () => {
        const count = this.cspGuard.resolveMetaCsp(this.activeDocument);
        this.refreshCspModal();
        resolveBtn.textContent = `✓ Resolved (${count} Meta CSP tag${count === 1 ? '' : 's'})`;
      }
    );
    resolveBtn.classList.add('btn-primary');

    const restoreBtn = this.createButton('Restore Original Meta CSP', 'Restore original meta CSP tags', () => {
      this.cspGuard.restoreMetaCsp(this.activeDocument);
      this.refreshCspModal();
    });

    const closeBtn = this.createButton('✕ Close', 'Close CSP modal', () => {
      modal.classList.remove('open');
    });

    controls.append(resolveBtn, restoreBtn, closeBtn);
    topRow.append(title, controls);

    this.cspBodyEl = document.createElement('div');
    this.cspBodyEl.className = 'csp-body';

    card.append(topRow, this.cspBodyEl);
    modal.appendChild(card);
    return modal;
  }

  private openCspModal(): void {
    this.refreshCspModal();
    this.cspModalEl.classList.add('open');
  }

  private refreshCspModal(): void {
    const state = this.cspGuard.getReport(this.activeDocument);
    this.cspBodyEl.textContent = '';

    const items = [
      `Constructable Stylesheets (Shadow DOM style-src bypass): ${state.adoptedStyleSheetsActive ? 'ACTIVE ✓' : 'Fallback <style>'}`,
      `Detected <meta http-equiv="Content-Security-Policy"> tags: ${state.metaTagCount}`,
      `Meta CSP Resolution Status: ${state.metaResolved ? 'NEUTRALIZED (Unrestricted local inspection)' : 'Original Page Policy Active'}`,
      `Recorded Runtime CSP Violations: ${state.violations.length}`
    ];

    const ul = document.createElement('ul');
    for (const line of items) {
      const li = document.createElement('li');
      li.textContent = line;
      ul.appendChild(li);
    }
    this.cspBodyEl.appendChild(ul);

    if (state.metaPolicies.length > 0) {
      const p = document.createElement('p');
      p.textContent = `Detected Policy Directives: ${state.metaPolicies.join(' | ')}`;
      this.cspBodyEl.appendChild(p);
    }

    if (state.violations.length > 0) {
      const vHeader = document.createElement('h3');
      vHeader.textContent = 'Blocked CSP Directives Detected:';
      const vList = document.createElement('ul');
      for (const v of state.violations) {
        const li = document.createElement('li');
        li.textContent = `[${v.timestamp}] Directive "${v.violatedDirective}" blocked URI: ${v.blockedURI}`;
        vList.appendChild(li);
      }
      this.cspBodyEl.append(vHeader, vList);
    }
  }

  /**
   * Features #6 & #9: Defect Report Modal (strictly based on Page Accessibility Alerts + on-demand notes & screenshots).
   */
  private buildReportModal(): HTMLElement {
    const modal = document.createElement('div');
    modal.className = 'report-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'ANDI-Gen1 Accessibility Defect Report');

    const card = document.createElement('div');
    card.className = 'report-card';

    const topRow = document.createElement('div');
    topRow.className = 'report-header';

    const title = document.createElement('h2');
    title.textContent = '📋 Page Accessibility Alerts & On-Demand Notes Defect Report';

    const controls = document.createElement('div');
    controls.className = 'report-controls';

    this.reportFormatSelect = document.createElement('select');
    (['html', 'markdown', 'json', 'csv'] as const).forEach((fmt) => {
      const opt = document.createElement('option');
      opt.value = fmt;
      opt.textContent =
        fmt === 'html' ? 'Format: HTML (with Embedded Screenshots)' : `Format: ${fmt.toUpperCase()}`;
      this.reportFormatSelect.appendChild(opt);
    });
    this.reportFormatSelect.addEventListener('change', () => this.refreshReportContent());

    const copyBtn = this.createButton('Copy Report', 'Copy report text to clipboard', () => {
      navigator.clipboard?.writeText(this.reportTextarea.value);
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy Report';
      }, 1500);
    });
    copyBtn.classList.add('btn-primary');

    const downloadBtn = this.createButton(
      '⬇ Download Report + Screenshots',
      'Download Defect Report and any captured DOM node PNG screenshots',
      () => {
        this.downloadReportAndScreenshots();
      }
    );
    downloadBtn.classList.add('btn-note');

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
    const report = buildDefectReport(this.records, this.mode, this.activeFrameLabel);
    const fmt = this.reportFormatSelect.value;
    if (fmt === 'json') {
      this.reportTextarea.value = JSON.stringify(report, null, 2);
    } else if (fmt === 'csv') {
      this.reportTextarea.value = formatReportAsCsv(report);
    } else if (fmt === 'html') {
      this.reportTextarea.value = formatReportAsHtml(report);
    } else {
      this.reportTextarea.value = formatReportAsMarkdown(report);
    }
  }

  private downloadReportAndScreenshots(): void {
    const report = buildDefectReport(this.records, this.mode, this.activeFrameLabel);
    const fmt = this.reportFormatSelect.value;
    const ext = fmt === 'json' ? 'json' : fmt === 'csv' ? 'csv' : fmt === 'html' ? 'html' : 'md';
    const mime =
      fmt === 'json'
        ? 'application/json'
        : fmt === 'csv'
          ? 'text/csv'
          : fmt === 'html'
            ? 'text/html'
            : 'text/markdown';

    const blob = new Blob([this.reportTextarea.value], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `andi-gen1-defect-report.${ext}`;
    a.click();
    URL.revokeObjectURL(url);

    // Requirement #9: Also download individual PNG screenshots for any alerted elements that have a captured screenshot
    for (const item of report.items) {
      if (item.note?.screenshotDataUrl) {
        downloadScreenshotPng(item.note.screenshotDataUrl, item.index, item.selector);
      }
    }
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
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      * { box-sizing: border-box; }

      /* Theme Variables (#8: Dark and Light User Themes) */
      .andi-bar {
        --bg-main: #0f172a;
        --bg-panel: #1e293b;
        --bg-sub: #0f172a;
        --text-main: #f8fafc;
        --text-muted: #94a3b8;
        --border-color: #334155;
        --accent: #38bdf8;
        --btn-bg: #334155;
        --btn-text: #f8fafc;
        background: var(--bg-main);
        color: var(--text-main);
        border-bottom: 3px solid var(--accent);
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
        font-size: 13px;
        position: relative;
      }
      .andi-bar[data-theme="light"] {
        --bg-main: #f8fafc;
        --bg-panel: #ffffff;
        --bg-sub: #f1f5f9;
        --text-main: #0f172a;
        --text-muted: #475569;
        --border-color: #cbd5e1;
        --accent: #0284c7;
        --btn-bg: #e2e8f0;
        --btn-text: #0f172a;
        box-shadow: 0 6px 24px rgba(15, 23, 42, 0.15);
      }

      /* Dock Layouts (#7: Left / Right / Top / Bottom / DOM Explorer) */
      .andi-bar[data-dock="left"],
      .andi-bar[data-dock="right"] {
        height: 100vh;
        display: flex;
        flex-direction: column;
        border-bottom: none;
        border-right: 3px solid var(--accent);
      }
      .andi-bar[data-dock="left"] .andi-grid,
      .andi-bar[data-dock="right"] .andi-grid {
        grid-template-columns: 1fr;
        max-height: calc(100vh - 110px);
        flex: 1;
      }
      .andi-bar[data-dock="left"] .andi-panel,
      .andi-bar[data-dock="right"] .andi-panel {
        max-height: 42vh;
      }
      .andi-bar[data-dock="dom"] {
        border: 2px solid var(--accent);
        border-radius: 10px;
        overflow: hidden;
      }

      .andi-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 7px 12px;
        background: var(--bg-panel);
        border-bottom: 1px solid var(--border-color);
      }
      .andi-brand {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .andi-logo {
        font-weight: 800;
        font-size: 14.5px;
        color: var(--accent);
      }
      .andi-version {
        font-size: 11px;
        background: var(--btn-bg);
        color: var(--text-muted);
        padding: 2px 6px;
        border-radius: 4px;
      }
      .andi-module-wrap, .andi-iframe-wrap {
        display: flex;
        align-items: center;
        gap: 5px;
        font-weight: 600;
      }
      select {
        background: var(--bg-sub);
        color: var(--text-main);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 4px 7px;
        font-size: 12px;
        font-weight: 600;
      }
      .andi-summary-pills {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
      }
      .pill {
        padding: 2px 7px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
      }
      .pill-frame { background: #0f766e; color: #ccfbf1; }
      .pill-info { background: #1e3a8a; color: #bfdbfe; }
      .pill-danger { background: #991b1b; color: #fecaca; }
      .pill-ok { background: #065f46; color: #a7f3d0; }
      .pill-note { background: #5b21b6; color: #ddd6fe; }
      .andi-actions {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
        align-items: center;
      }
      .andi-btn {
        background: var(--btn-bg);
        color: var(--btn-text);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 4px 9px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .andi-btn:hover, .andi-btn:focus-visible {
        outline: 2px solid var(--accent);
      }
      .btn-primary { background: #2563eb; color: #fff; border-color: #3b82f6; }
      .btn-note { background: #6d28d9; color: #fff; border-color: #8b5cf6; }
      .btn-warning { background: #d97706; color: #fff; border-color: #f59e0b; }
      .btn-danger { background: #991b1b; color: #fff; border-color: #dc2626; }

      /* 2-Column Main Panel Grid (#3: Screen Reader Spoken & Elements first, Page Alerts second) */
      .andi-grid {
        display: grid;
        grid-template-columns: 1.25fr 1fr;
        gap: 10px;
        padding: 8px 12px;
        max-height: 195px;
      }
      .andi-panel {
        background: var(--bg-panel);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 8px 10px;
        overflow-y: auto;
        max-height: 178px;
      }
      .panel-title {
        margin: 0 0 5px;
        font-size: 12.5px;
        font-weight: 700;
      }
      .panel-sub {
        margin: 0 0 6px;
        font-size: 11px;
        color: var(--text-muted);
      }
      .element-header {
        display: flex;
        align-items: center;
        gap: 6px;
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
        color: var(--accent);
        font-weight: 700;
      }
      .el-modules {
        font-size: 11px;
        color: var(--text-muted);
      }
      .sr-box {
        background: var(--bg-sub);
        border-left: 3px solid var(--accent);
        padding: 5px 8px;
        border-radius: 4px;
        margin-bottom: 6px;
      }
      .sr-title {
        font-size: 10px;
        color: var(--text-muted);
        text-transform: uppercase;
      }
      .sr-output {
        font-weight: 700;
        margin-top: 2px;
      }
      .sr-missing { color: #ef4444; }
      .comp-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11.5px;
        margin-bottom: 5px;
      }
      .comp-table th, .comp-table td {
        border-bottom: 1px solid var(--border-color);
        padding: 2px 4px;
        text-align: left;
      }
      .comp-table th {
        color: var(--accent);
        width: 30%;
      }

      /* On-Demand Fly-in Note Drawer (#1, #9) */
      .flyin-note-drawer {
        position: fixed;
        top: 48px;
        right: -460px;
        width: 440px;
        max-height: calc(100vh - 64px);
        overflow-y: auto;
        background: var(--bg-panel);
        color: var(--text-main);
        border: 2px solid #8b5cf6;
        border-radius: 10px 0 0 10px;
        padding: 12px;
        box-shadow: -8px 8px 30px rgba(0, 0, 0, 0.5);
        transition: right 0.22s ease-in-out;
        z-index: 2147483647;
      }
      .flyin-note-drawer.open {
        right: 0;
      }
      .flyin-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
      }
      .flyin-header h3 {
        margin: 0;
        font-size: 13.5px;
      }
      .note-textarea {
        width: 100%;
        min-height: 68px;
        background: var(--bg-sub);
        color: var(--text-main);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 6px;
        font-family: inherit;
        font-size: 12px;
      }
      .note-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
      }
      .note-status {
        margin-top: 6px;
        font-size: 11px;
        color: var(--accent);
      }
      .shot-preview-wrap {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid var(--border-color);
      }
      .shot-preview-img {
        width: 100%;
        border-radius: 6px;
        border: 1px solid #8b5cf6;
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
        border-bottom: 1px solid var(--border-color);
      }
      .alert-item a {
        color: var(--text-main);
        text-decoration: underline;
        cursor: pointer;
      }
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
      .empty-msg { color: var(--text-muted); font-style: italic; font-size: 12px; }

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
        background: var(--bg-panel);
        color: var(--text-main);
        border: 2px solid var(--accent);
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
        flex-wrap: wrap;
      }
      .report-header h2 {
        margin: 0;
        font-size: 15px;
      }
      .report-controls {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .report-output {
        width: 100%;
        height: 360px;
        background: var(--bg-sub);
        color: var(--text-main);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
      }
      .csp-body {
        font-size: 13px;
        line-height: 1.6;
      }
    `;
  }
}
