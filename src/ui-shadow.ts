/**
 * ANDI-Gen1 — Shadow DOM UI Controller (High-Contrast WCAG AAA & Ergonomic 3-Zone Workflow)
 * Implements:
 * 1. Actionable `Notes (x)` pill that opens the Fly-In Notes Drawer with ALL saved notes + active note editor
 * 2. Eliminates redundant `+Add Note` / toolbar `Note` duplication (single global `Notes (x)` + contextual `📝 Note` on element)
 * 3. Visual Defect Report Modal that renders embedded PNG screenshots (`<img>`), plus HTML/MD/JSON/CSV export
 * 4. Defect Report strictly shows ANDI-detected defects (`alerts.length > 0`) PLUS any tester notes (`note !== null`)
 *    with exact DOM coordinates (`x, y, pageX, pageY, width × height`), browser/OS info, and timestamps
 * 5. WCAG AAA (7:1 to 20:1) high-contrast Dark & Light themes
 * 6. Ergonomic 3-Zone control placement (Scope -> Telemetry/Triage -> Workspace Chrome, with Prev/Next in Element Navigator)
 */

import {
  AlertLevel,
  AndiMode,
  DefectReport,
  DockPosition,
  InspectedElementRecord,
  InventoryCategory,
  InventoryItem,
  ThemeMode
} from './types';
import {
  ANDI_HOST_ID,
  ANDI_LASER_ID,
  buildPageIndex,
  canStepIntoIframe
} from './dom-index';
import { analyzePage, buildPageInventory } from './analyzers';
import {
  buildDefectReport,
  captureNodeScreenshotWithNote,
  clearElementNote,
  downloadScreenshotPng,
  formatReportAsCsv,
  formatReportAsHtml,
  formatReportAsMarkdown,
  getBrowserEnvironmentInfo,
  getElementCoordinates,
  readElementNote,
  writeElementNote
} from './notes-report';
import { CspGuard } from './csp-guard';
import { buildTestHarnessHtml, getCleanDomCode, getHarnessFileName } from './test-harness';

const PAGE_HIGHLIGHT_STYLE_ID = 'andi-gen1-page-highlights-css';
const STORAGE_KEY_THEME = 'ANDI_GEN1_THEME';
const STORAGE_KEY_DOCK = 'ANDI_GEN1_DOCK';

// Requirement: Move ALL mode as the last item in droplist
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
  private inventoryItems: InventoryItem[] = [];
  private elementToRecord = new WeakMap<HTMLElement, InspectedElementRecord>();
  private activeIndex = 0;
  private laserEnabled = true;
  private highlightedIdRefEl: HTMLElement | null = null;

  // Theme & Dock settings
  private theme: ThemeMode = 'dark';
  private dock: DockPosition = 'top';

  // Iframe Step-In state
  private activeDocument: Document = document;
  private activeFrameLabel = 'Top Document';
  private steppedInIframe: HTMLIFrameElement | null = null;
  private detectedIframes: HTMLIFrameElement[] = [];

  // CSP Detector & Resolver
  private cspGuard = new CspGuard();

  private hostEl: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private barEl!: HTMLElement;
  private laserSvg: SVGSVGElement | null = null;
  private laserLine: SVGLineElement | null = null;

  // UI Element References inside Shadow DOM
  private summaryBadgeEl!: HTMLElement;
  private reportTriggerBtn!: HTMLButtonElement;
  private iframeStepperSelect!: HTMLSelectElement;
  private stepOutBtn!: HTMLButtonElement;
  private elementHeaderEl!: HTMLElement;
  private srOutputEl!: HTMLElement;
  private srDomNodeBarEl!: HTMLElement;
  private srIdRefsBarEl!: HTMLElement;
  private srSemanticAssocBarEl!: HTMLElement;
  private componentsTbodyEl!: HTMLElement;
  private elementAlertsListEl!: HTMLElement;
  private pageAlertsListEl!: HTMLElement;

  // Fly-in Note Drawer References
  private noteDrawerEl!: HTMLElement;
  private activeNoteMetaEl!: HTMLElement;
  private noteTextarea!: HTMLTextAreaElement;
  private noteSeveritySelect!: HTMLSelectElement;
  private noteStatusEl!: HTMLElement;
  private screenshotPreviewImg!: HTMLImageElement;
  private screenshotWrapEl!: HTMLElement;
  private allNotesCountHeadingEl!: HTMLElement;
  private allNotesListEl!: HTMLElement;
  private currentScreenshotDataUrl = '';

  // Fly-in Element Inventory Drawer References
  private inventoryDrawerEl!: HTMLElement;
  private inventoryTitleEl!: HTMLElement;
  private inventoryCategoryBarEl!: HTMLElement;
  private inventorySearchInput!: HTMLInputElement;
  private inventoryCountHeadingEl!: HTMLElement;
  private inventoryListEl!: HTMLElement;
  private activeInventoryCategory: InventoryCategory | 'all' = 'all';
  private inventorySearchQuery = '';

  // Modals (CSP Resolver & Visual/Code Defect Report)
  private reportModalEl!: HTMLElement;
  private reportVisualContainer!: HTMLElement;
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

  public setTheme(theme: ThemeMode): void {
    this.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY_THEME, this.theme);
    } catch {
      // ignore
    }
    const themeBtn = this.shadow?.getElementById('andi-theme-btn') as HTMLButtonElement | null;
    if (themeBtn) {
      themeBtn.textContent = this.theme === 'dark' ? '☀️ Light Theme' : '🌙 Dark Theme';
    }
    this.applyDockAndTheme();
  }

  public setDock(dock: DockPosition): void {
    this.dock = dock;
    try {
      window.localStorage.setItem(STORAGE_KEY_DOCK, this.dock);
    } catch {
      // ignore
    }
    const dockSelect = this.shadow?.getElementById('andi-dock-select') as HTMLSelectElement | null;
    if (dockSelect && dockSelect.value !== dock) {
      dockSelect.value = dock;
    }
    this.applyDockAndTheme();
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
    this.resetBodyMargins();
  }

  /**
   * Steps into a same-origin `<iframe>` document and runs the full ANDI-Gen1 suite inside it.
   */
  public stepIntoIframe(iframeEl: HTMLIFrameElement): void {
    if (!canStepIntoIframe(iframeEl) || !iframeEl.contentDocument) {
      return;
    }
    this.detachDelegatedEvents(this.activeDocument);
    this.clearPageElementMarkers(this.activeDocument);

    this.steppedInIframe = iframeEl;
    this.activeDocument = iframeEl.contentDocument;
    const frameId =
      iframeEl.id ||
      iframeEl.getAttribute('name') ||
      iframeEl.getAttribute('title') ||
      iframeEl.getAttribute('src') ||
      'inline-iframe';
    this.activeFrameLabel = `Iframe (${frameId})`;

    this.injectPageHighlightStyles(this.activeDocument);
    this.attachDelegatedEvents(this.activeDocument);
    this.stepOutBtn.style.display = 'inline-flex';
    this.runScan();
  }

  /**
   * Steps back out of an `<iframe>` to the top-level `document`.
   */
  public stepOutOfIframe(): void {
    if (!this.steppedInIframe) {
      return;
    }
    this.detachDelegatedEvents(this.activeDocument);
    this.clearPageElementMarkers(this.activeDocument);

    this.steppedInIframe = null;
    this.activeDocument = document;
    this.activeFrameLabel = 'Top Document';
    this.stepOutBtn.style.display = 'none';

    this.attachDelegatedEvents(document);
    this.runScan();
  }

  public runScan(): void {
    this.clearPageElementMarkers(this.activeDocument);
    this.elementToRecord = new WeakMap<HTMLElement, InspectedElementRecord>();

    const pageIndex = buildPageIndex(this.activeDocument.body);
    this.detectedIframes = pageIndex.iframes;
    this.populateIframeStepperDropdown();

    this.records = analyzePage(pageIndex, this.mode, this.activeFrameLabel);
    this.inventoryItems = buildPageInventory(pageIndex, this.records, this.mode);

    for (const rec of this.records) {
      this.elementToRecord.set(rec.element, rec);
      rec.element.setAttribute('data-andi508-index', String(rec.index));
      rec.element.setAttribute('data-andi-highlight', 'true');
      if (rec.alerts.some((a) => a.level === 'danger')) {
        rec.element.setAttribute('data-andi-alert-level', 'danger');
      } else if (rec.alerts.some((a) => a.level === 'warning')) {
        rec.element.setAttribute('data-andi-alert-level', 'warning');
      }
    }

    this.renderPageSummaryAndAlerts();
    this.renderAllNotesListInDrawer();
    this.renderInventoryDrawer();

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
    defaultOpt.textContent =
      this.detectedIframes.length > 0
        ? `🖼 Iframes (${this.detectedIframes.length}) — Step In...`
        : `🖼 Iframes (0 detected)`;
    this.iframeStepperSelect.appendChild(defaultOpt);
    this.iframeStepperSelect.disabled = this.detectedIframes.length === 0;

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
    const marked = doc.querySelectorAll(
      '[data-andi508-index], [data-andi-active], [data-andi-highlight], [data-andi-idref-target], [data-andi-pulse-target]'
    );
    marked.forEach((el) => {
      el.removeAttribute('data-andi508-index');
      el.removeAttribute('data-andi-active');
      el.removeAttribute('data-andi-highlight');
      el.removeAttribute('data-andi-alert-level');
      el.removeAttribute('data-andi-idref-target');
      el.removeAttribute('data-andi-pulse-target');
    });
    this.highlightedIdRefEl = null;
    this.eraseLaser();
  }

  /**
   * Navigates directly to any DOM element on the page (from the Screen Reader Output DOM Node link,
   * an IDREF link such as aria-labelledby/aria-describedby, or the Element Inventory Fly-In Drawer).
   * Scrolls the element smoothly into view, focuses it, pulses its outline, draws the SVG laser beam,
   * and exposes `window.$andiActiveNode` for instant DevTools inspection.
   */
  public navigateToDomElement(targetEl: HTMLElement): void {
    if (this.highlightedIdRefEl && this.highlightedIdRefEl !== targetEl) {
      this.highlightedIdRefEl.removeAttribute('data-andi-idref-target');
      this.highlightedIdRefEl.removeAttribute('data-andi-pulse-target');
    }

    (window as unknown as Record<string, unknown>).$andiActiveNode = targetEl;

    const existingRec = this.elementToRecord.get(targetEl);
    if (existingRec) {
      this.inspectByIndex(existingRec.index, true);
    } else {
      targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const hadTabindex = targetEl.hasAttribute('tabindex');
      if (!hadTabindex) {
        targetEl.setAttribute('tabindex', '-1');
      }
      targetEl.focus({ preventScroll: true });
      if (!hadTabindex) {
        targetEl.removeAttribute('tabindex');
      }
      targetEl.setAttribute('data-andi-idref-target', 'true');
      this.highlightedIdRefEl = targetEl;
      this.drawLaserToElement(targetEl);
    }

    targetEl.setAttribute('data-andi-pulse-target', 'true');
    setTimeout(() => {
      targetEl.removeAttribute('data-andi-pulse-target');
    }, 1800);
  }

  public inspectByIndex(index: number, moveFocus = false): void {
    const rec = this.records[index - 1];
    if (!rec) {
      return;
    }

    if (this.highlightedIdRefEl) {
      this.highlightedIdRefEl.removeAttribute('data-andi-idref-target');
      this.highlightedIdRefEl = null;
    }

    if (this.activeIndex > 0 && this.records[this.activeIndex - 1]) {
      this.records[this.activeIndex - 1].element.removeAttribute('data-andi-active');
    }

    this.activeIndex = index;
    rec.element.setAttribute('data-andi-active', 'true');
    (window as unknown as Record<string, unknown>).$andiActiveNode = rec.element;
    rec.coordinates = getElementCoordinates(rec.element);

    if (moveFocus) {
      rec.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (rec.isFocusable) {
        rec.element.focus({ preventScroll: true });
      } else {
        rec.element.setAttribute('tabindex', '-1');
        rec.element.focus({ preventScroll: true });
        rec.element.removeAttribute('tabindex');
      }
      rec.coordinates = getElementCoordinates(rec.element);
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
        outline: 2px dashed #0369a1 !important;
        outline-offset: 2px !important;
      }
      [data-andi-highlight="true"][data-andi-alert-level="danger"] {
        outline: 2.5px solid #b91c1c !important;
      }
      [data-andi-highlight="true"][data-andi-alert-level="warning"] {
        outline: 2.5px dashed #b45309 !important;
      }
      [data-andi-active="true"] {
        outline: 3.5px solid #be185d !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 4px rgba(190, 24, 93, 0.28) !important;
      }
      [data-andi-idref-target="true"] {
        outline: 3.5px solid #0284c7 !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 5px rgba(2, 132, 199, 0.35) !important;
      }
      @keyframes andiNodePulse {
        0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.85); }
        70% { box-shadow: 0 0 0 12px rgba(16, 185, 129, 0); }
        100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
      }
      [data-andi-pulse-target="true"] {
        animation: andiNodePulse 0.9s ease-out 2 !important;
      }
      [data-andi-note] {
        position: relative;
      }
      [data-andi-note]::after {
        content: "📝 Note" !important;
        position: absolute !important;
        top: -14px !important;
        right: -4px !important;
        background: #4c1d95 !important;
        color: #ffffff !important;
        border: 1px solid #e9d5ff !important;
        font: 700 10.5px/1.2 system-ui, sans-serif !important;
        padding: 2px 6px !important;
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
    line.setAttribute('stroke', '#db2777');
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

  private applyDockAndTheme(): void {
    if (!this.barEl || !this.hostEl) {
      return;
    }
    this.barEl.setAttribute('data-theme', this.theme);
    this.barEl.setAttribute('data-dock', this.dock);
    this.hostEl.setAttribute('data-dock', this.dock);

    this.resetBodyMargins();
    if (this.dock === 'top') {
      document.body.style.marginTop = '265px';
      this.hostEl.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483646;';
    } else if (this.dock === 'bottom') {
      document.body.style.marginBottom = '265px';
      this.hostEl.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483646;';
    } else if (this.dock === 'left') {
      document.body.style.marginLeft = '440px';
      this.hostEl.style.cssText =
        'position:fixed;top:0;bottom:0;left:0;width:440px;z-index:2147483646;';
    } else if (this.dock === 'right') {
      document.body.style.marginRight = '440px';
      this.hostEl.style.cssText =
        'position:fixed;top:0;bottom:0;right:0;width:440px;z-index:2147483646;';
    } else if (this.dock === 'dom') {
      const activeRec = this.records[this.activeIndex - 1];
      if (activeRec) {
        this.positionDomInlineDock(activeRec.element);
      } else {
        this.hostEl.style.cssText =
          'position:fixed;bottom:16px;right:16px;width:580px;z-index:2147483646;';
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
      rect = new DOMRect(
        ifrRect.left + rect.left,
        ifrRect.top + rect.top,
        rect.width,
        rect.height
      );
    }
    const topPos = Math.min(Math.max(rect.bottom + 10, 12), window.innerHeight - 290);
    const leftPos = Math.min(Math.max(rect.left, 12), Math.max(window.innerWidth - 600, 12));
    this.hostEl.style.cssText = `position:fixed;top:${Math.round(topPos)}px;left:${Math.round(leftPos)}px;width:580px;z-index:2147483646;`;
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

    this.cspGuard.applySafeStyles(shadow, this.getShadowStyles());

    const bar = document.createElement('section');
    bar.className = 'andi-bar';
    this.barEl = bar;

    // =========================================================================
    // TOP COMMAND BAR — Redesigned into 3 Ergonomic Functional Zones
    // Zone 1 (Left): Brand + Mode Selector + Iframe Context
    // Zone 2 (Center): Live Audit Telemetry (`Elements`, `Alerts`, Actionable `Notes (x)`, `Defect Report`)
    // Zone 3 (Right): Environment & Window Chrome (`CSP`, `Dock`, `Theme`, `Close`)
    // =========================================================================
    const header = document.createElement('header');
    header.className = 'andi-header';

    // --- ZONE 1: Inspection Scope (Brand + Mode + Iframe Step-In) ---
    const zoneScope = document.createElement('div');
    zoneScope.className = 'toolbar-zone zone-scope';

    const brand = document.createElement('div');
    brand.className = 'andi-brand';
    const brandBadge = document.createElement('span');
    brandBadge.className = 'andi-logo';
    brandBadge.textContent = 'ANDI-Gen1';
    const versionSpan = document.createElement('span');
    versionSpan.className = 'andi-version';
    versionSpan.textContent = 'v31.3 TS';
    brand.append(brandBadge, versionSpan);

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

    zoneScope.append(brand, moduleWrap, iframeWrap);

    // --- ZONE 2: Audit Telemetry & Triage (`Elements`, `Alerts`, Actionable `Notes (x)`, `Defect Report`) ---
    const zoneTelemetry = document.createElement('div');
    zoneTelemetry.className = 'toolbar-zone zone-telemetry';

    this.summaryBadgeEl = document.createElement('div');
    this.summaryBadgeEl.className = 'andi-summary-pills';

    this.reportTriggerBtn = this.createButton(
      '📋 Defect Report',
      'Open Visual & Exportable Defect Report (ANDI Alerts + Notes with Coordinates & Screenshots)',
      () => {
        this.openReportModal();
      }
    );
    this.reportTriggerBtn.classList.add('btn-primary');

    zoneTelemetry.append(this.summaryBadgeEl, this.reportTriggerBtn);

    // --- ZONE 3: Workspace & Environment Utilities (`CSP`, `Dock`, `Theme`, `Close`) ---
    const zoneChrome = document.createElement('div');
    zoneChrome.className = 'toolbar-zone zone-chrome';

    const cspBtn = this.createButton(
      '🛡️ CSP',
      'Inspect & Resolve Content Security Policy',
      () => {
        this.openCspModal();
      }
    );

    const dockSelect = document.createElement('select');
    dockSelect.id = 'andi-dock-select';
    dockSelect.setAttribute('aria-label', 'Pin ANDI-Gen1 Position');
    const dockOptions: Array<{ value: DockPosition; label: string }> = [
      { value: 'top', label: '📌 Dock: Top' },
      { value: 'bottom', label: '📌 Dock: Bottom' },
      { value: 'left', label: '📌 Dock: Left Explorer' },
      { value: 'right', label: '📌 Dock: Right Explorer' },
      { value: 'dom', label: '📌 Dock: DOM Inline' }
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
      this.setDock(dockSelect.value as DockPosition);
    });

    const themeBtn = this.createButton(
      this.theme === 'dark' ? '☀️ Light Theme' : '🌙 Dark Theme',
      'Switch between High-Contrast Dark and Light layout themes',
      () => {
        this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
      }
    );
    themeBtn.id = 'andi-theme-btn';

    const closeBtn = this.createButton('✕ Close', 'Close ANDI-Gen1', () => this.destroy());
    closeBtn.classList.add('btn-danger');

    zoneChrome.append(cspBtn, dockSelect, themeBtn, closeBtn);
    header.append(zoneScope, zoneTelemetry, zoneChrome);
    bar.appendChild(header);

    // =========================================================================
    // MAIN 2-PANEL WORKSPACE
    // Panel 1: Active Element Navigator (with integrated Prev/Next), Spoken Output & Components
    // Panel 2: Page Accessibility Alerts (immediately after Panel 1)
    // =========================================================================
    const grid = document.createElement('div');
    grid.className = 'andi-grid';

    // Panel 1: Active Element Navigator & Screen Reader Spoken Output
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

    // Requirement #1: Extracted DOM Node under Screen Reader Output (click to navigate to DOM node)
    this.srDomNodeBarEl = document.createElement('div');
    this.srDomNodeBarEl.className = 'sr-dom-node-bar';

    // Requirement #3 (Part B): IDREF attributes (aria-labelledby, aria-describedby, headers, label[for]) with clickable target links
    this.srIdRefsBarEl = document.createElement('div');
    this.srIdRefsBarEl.className = 'sr-idrefs-bar';

    // Requirement #2: Semantic association bar (e.g. role="table" / role="grid" header associations)
    this.srSemanticAssocBarEl = document.createElement('div');
    this.srSemanticAssocBarEl.className = 'sr-semantic-bar';

    srBox.append(
      srTitle,
      this.srOutputEl,
      this.srDomNodeBarEl,
      this.srIdRefsBarEl,
      this.srSemanticAssocBarEl
    );

    const compTable = document.createElement('table');
    compTable.className = 'comp-table';
    this.componentsTbodyEl = document.createElement('tbody');
    compTable.appendChild(this.componentsTbodyEl);

    this.elementAlertsListEl = document.createElement('ul');
    this.elementAlertsListEl.className = 'alert-list';

    colInspect.append(this.elementHeaderEl, srBox, compTable, this.elementAlertsListEl);

    // Panel 2: Page Accessibility Alerts Panel
    const colAlerts = document.createElement('div');
    colAlerts.className = 'andi-panel';
    const alertsHeading = document.createElement('h2');
    alertsHeading.className = 'panel-title';
    alertsHeading.textContent = '🔴 Page Accessibility Alerts (Click Any Alert to Focus Element)';

    this.pageAlertsListEl = document.createElement('ul');
    this.pageAlertsListEl.className = 'alert-list page-alert-list';
    colAlerts.append(alertsHeading, this.pageAlertsListEl);

    grid.append(colInspect, colAlerts);
    bar.appendChild(grid);

    // 3. On-Demand Fly-in Notes & All Saved Notes Drawer (#1, #2, #9)
    this.noteDrawerEl = this.buildFlyinNoteDrawer();
    bar.appendChild(this.noteDrawerEl);

    // 4. On-Demand Fly-in Element Inventory Drawer (Requirement #3: Array of tables, links, buttons, landmarks, headings, etc.)
    this.inventoryDrawerEl = this.buildFlyinInventoryDrawer();
    bar.appendChild(this.inventoryDrawerEl);

    // 5. Modals (#5 CSP Resolver, #3/#4/#6 Visual + Code Defect Report)
    this.cspModalEl = this.buildCspModal();
    this.reportModalEl = this.buildReportModal();
    bar.append(this.cspModalEl, this.reportModalEl);

    shadow.appendChild(bar);
  }

  /**
   * Builds the On-Demand Fly-in Notes Drawer containing:
   * 1. Active Element Note & Automatic Screenshot Editor (with exact DOM coordinates)
   * 2. Complete interactive list of ALL saved notes on the page (`Notes (x)`)
   */
  private buildFlyinNoteDrawer(): HTMLElement {
    const drawer = document.createElement('aside');
    drawer.className = 'flyin-note-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Tester Notes and DOM Node Screenshots Panel');

    const topRow = document.createElement('div');
    topRow.className = 'flyin-header';
    const title = document.createElement('h3');
    title.textContent = '📝 Tester Notes & DOM Node Screenshots';
    const closeDrawerBtn = this.createButton('✕ Close', 'Close Notes Panel', () => {
      drawer.classList.remove('open');
    });
    topRow.append(title, closeDrawerBtn);

    // Section 1: Active Element Note Editor
    const activeSection = document.createElement('div');
    activeSection.className = 'flyin-section';

    this.activeNoteMetaEl = document.createElement('div');
    this.activeNoteMetaEl.className = 'active-note-meta';

    this.noteTextarea = document.createElement('textarea');
    this.noteTextarea.className = 'note-textarea';
    this.noteTextarea.placeholder =
      'Describe the accessibility observation or defect for this DOM node...';

    const controlsRow = document.createElement('div');
    controlsRow.className = 'note-controls';

    this.noteSeveritySelect = document.createElement('select');
    this.noteSeveritySelect.setAttribute('aria-label', 'Note Severity');
    (['danger', 'warning', 'caution'] as AlertLevel[]).forEach((lvl) => {
      const opt = document.createElement('option');
      opt.value = lvl;
      opt.textContent = `Severity: ${lvl.toUpperCase()}`;
      this.noteSeveritySelect.appendChild(opt);
    });

    // Primary Unified Action: Saves note AND captures the annotated DOM node screenshot so Defect Reports always have the screenshot!
    const saveWithShotBtn = this.createButton(
      '📸 Save Note + Screenshot',
      'Save note to localStorage and capture annotated DOM node screenshot with coordinates for the Defect Report',
      () => {
        this.saveActiveElementNote(true);
      }
    );
    saveWithShotBtn.classList.add('btn-primary');

    const saveTextOnlyBtn = this.createButton(
      '💾 Save Text Only',
      'Save note text to localStorage without updating screenshot',
      () => {
        this.saveActiveElementNote(false);
      }
    );

    const clearBtn = this.createButton('🗑 Delete Note', 'Remove note & screenshot for this element', () => {
      this.clearActiveElementNote();
    });
    clearBtn.classList.add('btn-danger');

    controlsRow.append(this.noteSeveritySelect, saveWithShotBtn, saveTextOnlyBtn, clearBtn);

    this.noteStatusEl = document.createElement('div');
    this.noteStatusEl.className = 'note-status';
    this.noteStatusEl.setAttribute('role', 'status');
    this.noteStatusEl.setAttribute('aria-live', 'polite');

    // Screenshot Thumbnail Preview & Download
    this.screenshotWrapEl = document.createElement('div');
    this.screenshotWrapEl.className = 'shot-preview-wrap';
    this.screenshotWrapEl.style.display = 'none';

    this.screenshotPreviewImg = document.createElement('img');
    this.screenshotPreviewImg.className = 'shot-preview-img';
    this.screenshotPreviewImg.alt = 'Captured DOM node screenshot with tester note and coordinates';

    const downloadShotBtn = this.createButton(
      '⬇ Download Node Screenshot (.png)',
      'Download annotated PNG screenshot for this DOM element',
      () => {
        const rec = this.records[this.activeIndex - 1];
        if (rec && this.currentScreenshotDataUrl) {
          downloadScreenshotPng(this.currentScreenshotDataUrl, rec.index, rec.selector);
        }
      }
    );

    this.screenshotWrapEl.append(this.screenshotPreviewImg, downloadShotBtn);
    activeSection.append(
      this.activeNoteMetaEl,
      this.noteTextarea,
      controlsRow,
      this.noteStatusEl,
      this.screenshotWrapEl
    );

    // Section 2: All Saved Notes List (#1: Clicking `Notes (x)` opens panel with all notes)
    const allNotesSection = document.createElement('div');
    allNotesSection.className = 'flyin-section all-notes-section';

    this.allNotesCountHeadingEl = document.createElement('h4');
    this.allNotesCountHeadingEl.className = 'all-notes-heading';
    this.allNotesCountHeadingEl.textContent = 'All Saved Notes on Page (0)';

    this.allNotesListEl = document.createElement('ul');
    this.allNotesListEl.className = 'all-notes-list';

    allNotesSection.append(this.allNotesCountHeadingEl, this.allNotesListEl);

    drawer.append(topRow, activeSection, allNotesSection);
    return drawer;
  }

  public openNoteDrawer(focusTarget: 'editor' | 'list' = 'editor'): void {
    this.renderAllNotesListInDrawer();
    this.noteDrawerEl.classList.add('open');
    if (focusTarget === 'list') {
      this.allNotesCountHeadingEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      this.noteTextarea.focus();
    }
  }

  private syncNoteDrawerForRecord(rec: InspectedElementRecord): void {
    if (!this.noteTextarea || !this.activeNoteMetaEl) {
      return;
    }
    const env = getBrowserEnvironmentInfo();
    this.activeNoteMetaEl.textContent = '';

    const line1 = document.createElement('div');
    line1.innerHTML = `<strong>Active Element #${rec.index}:</strong> <code>&lt;${rec.tagName}&gt;</code> — <code>${rec.selector}</code>`;
    const line2 = document.createElement('div');
    line2.textContent = `📍 Exact DOM Coords: ${rec.coordinates.formatted} | 🌐 ${env.browserName}`;
    this.activeNoteMetaEl.append(line1, line2);

    if (rec.note) {
      this.noteTextarea.value = rec.note.text;
      this.noteSeveritySelect.value = rec.note.severity;
      this.noteStatusEl.textContent = `✓ Saved note loaded (${new Date(rec.note.updatedAt).toLocaleString()})`;
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
      this.noteStatusEl.textContent = `No saved note yet for ${rec.selector}. Click "📸 Save Note + Screenshot" to record.`;
      this.currentScreenshotDataUrl = '';
      this.screenshotWrapEl.style.display = 'none';
    }
  }

  private renderAllNotesListInDrawer(): void {
    if (!this.allNotesListEl || !this.allNotesCountHeadingEl) {
      return;
    }
    this.allNotesListEl.textContent = '';

    const notedRecords = this.records.filter((r) => r.note !== null);
    this.allNotesCountHeadingEl.textContent = `🗂 All Saved Notes on Page (${notedRecords.length})`;

    if (notedRecords.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'empty-msg';
      emptyLi.textContent = 'No notes saved on this page yet.';
      this.allNotesListEl.appendChild(emptyLi);
      return;
    }

    for (const rec of notedRecords) {
      if (!rec.note) {
        continue;
      }
      const note = rec.note;
      const li = document.createElement('li');
      li.className = 'saved-note-card';

      const headerRow = document.createElement('div');
      headerRow.className = 'saved-note-header';

      const badge = document.createElement('span');
      badge.className = `pill ${note.severity === 'danger' ? 'pill-danger' : 'pill-note'}`;
      badge.textContent = `#${rec.index} <${rec.tagName}> [${note.severity.toUpperCase()}]`;

      const btnGroup = document.createElement('div');
      btnGroup.className = 'saved-note-actions';

      const jumpBtn = this.createButton('🎯 Inspect Node', 'Jump to and highlight this DOM node', () => {
        this.inspectByIndex(rec.index, true);
      });
      jumpBtn.classList.add('btn-primary');

      const delBtn = this.createButton('🗑', 'Delete this note', () => {
        clearElementNote(rec.element, rec.selector, this.activeFrameLabel);
        rec.note = null;
        if (this.activeIndex === rec.index) {
          this.syncNoteDrawerForRecord(rec);
          this.renderActiveElementInspection(rec);
        }
        this.renderPageSummaryAndAlerts();
        this.renderAllNotesListInDrawer();
      });
      delBtn.classList.add('btn-danger');

      btnGroup.append(jumpBtn, delBtn);
      headerRow.append(badge, btnGroup);

      const metaLine = document.createElement('div');
      metaLine.className = 'saved-note-meta';
      const coordsText = note.coordinates?.formatted || rec.coordinates.formatted;
      metaLine.textContent = `📍 ${coordsText} · 🕒 ${new Date(note.updatedAt).toLocaleString()} · 🌐 ${note.browserInfo || getBrowserEnvironmentInfo().browserName}`;

      const bodyText = document.createElement('div');
      bodyText.className = 'saved-note-text';
      bodyText.textContent = note.text;

      li.append(headerRow, metaLine, bodyText);

      if (note.screenshotDataUrl) {
        const thumb = document.createElement('img');
        thumb.src = note.screenshotDataUrl;
        thumb.alt = `Screenshot for #${rec.index} ${rec.selector}`;
        thumb.className = 'saved-note-thumb';
        li.appendChild(thumb);
      }

      this.allNotesListEl.appendChild(li);
    }
  }

  private saveActiveElementNote(withScreenshot: boolean): void {
    const rec = this.records[this.activeIndex - 1];
    if (!rec) {
      return;
    }
    const text =
      this.noteTextarea.value.trim() || (withScreenshot ? 'Annotated DOM Node Defect Snapshot' : '');
    if (!text) {
      this.clearActiveElementNote();
      return;
    }
    this.noteTextarea.value = text;
    const severity = this.noteSeveritySelect.value as AlertLevel;
    rec.coordinates = getElementCoordinates(rec.element);

    let shotUrl = this.currentScreenshotDataUrl || undefined;
    if (withScreenshot || !shotUrl) {
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
    this.noteStatusEl.textContent = `✓ Saved note & screenshot (${rec.coordinates.formatted}) to localStorage`;

    this.renderActiveElementInspection(rec);
    this.renderPageSummaryAndAlerts();
    this.renderAllNotesListInDrawer();
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
    this.renderAllNotesListInDrawer();
  }

  private renderPageSummaryAndAlerts(): void {
    this.summaryBadgeEl.textContent = '';

    const totalAlerts = this.records.reduce((acc, r) => acc + r.alerts.length, 0);
    const totalNotes = this.records.filter((r) => r.note !== null).length;
    const totalDefectReportItems = this.records.filter(
      (r) => r.alerts.length > 0 || r.note !== null
    ).length;

    if (this.reportTriggerBtn) {
      this.reportTriggerBtn.textContent = `📋 Defect Report (${totalDefectReportItems})`;
    }

    // The frame pill only has a function when stepped into an iframe (it tells the tester which document is being audited).
    // On the top document it carried no information, so it is not rendered.
    const pillFrame = document.createElement('span');
    pillFrame.className = 'pill pill-frame';
    pillFrame.textContent = `🌐 ${this.activeFrameLabel}`;

    const pillElements = document.createElement('span');
    pillElements.className = 'pill pill-info';
    pillElements.textContent = `Elements: ${this.records.length}`;

    const pillAlerts = document.createElement('span');
    pillAlerts.className = `pill ${totalAlerts > 0 ? 'pill-danger' : 'pill-ok'}`;
    pillAlerts.textContent = `Alerts: ${totalAlerts}`;

    // Requirement #1 & #2: Actionable `Notes (x)` button that opens the Notes panel with all saved notes!
    const pillNotesBtn = document.createElement('button');
    pillNotesBtn.type = 'button';
    pillNotesBtn.className = 'pill pill-note pill-actionable';
    pillNotesBtn.textContent = `📝 Notes (${totalNotes})`;
    pillNotesBtn.title = 'Click to open the Notes Panel and view all saved notes on this page';
    pillNotesBtn.addEventListener('click', () => {
      this.inventoryDrawerEl?.classList.remove('open');
      this.openNoteDrawer('list');
    });

    // Requirement #3 (Part A): Actionable `Inventory (x)` button that opens the Element Inventory Fly-In Drawer!
    const pillInventoryBtn = document.createElement('button');
    pillInventoryBtn.type = 'button';
    pillInventoryBtn.className = 'pill pill-inventory pill-actionable';
    pillInventoryBtn.textContent = `🗂 Inventory (${this.inventoryItems.length})`;
    pillInventoryBtn.title = `Open the Element Inventory for the selected mode (${MODULE_LABELS[this.mode]}) — ${this.inventoryItems.length} element${this.inventoryItems.length === 1 ? '' : 's'}`;
    pillInventoryBtn.addEventListener('click', () => {
      this.openInventoryDrawer();
    });

    if (this.steppedInIframe) {
      this.summaryBadgeEl.append(pillFrame);
    }
    this.summaryBadgeEl.append(pillElements, pillAlerts, pillNotesBtn, pillInventoryBtn);

    this.pageAlertsListEl.textContent = '';

    for (const rec of this.records) {
      for (const alert of rec.alerts) {
        const li = document.createElement('li');
        li.className = `alert-item alert-${alert.level}`;

        const ball = document.createElement('span');
        ball.className = `red-ball ball-${alert.level}`;
        ball.setAttribute('aria-hidden', 'true');
        ball.textContent =
          alert.level === 'danger' ? '!' : alert.level === 'warning' ? '▲' : 'i';

        const link = document.createElement('a');
        link.href = `#andi-el-${rec.index}`;
        link.textContent = `[#${rec.index} ${alert.module}ANDI] ${alert.message}${rec.note ? ' (📝 Note Attached)' : ''}`;
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

  /**
   * Renders Panel 1's Active Element Navigator (with integrated Prev/Next buttons,
   * element `#index`, tag/role, exact DOM coordinates, and contextual `📝 Note` button).
   */
  private renderActiveElementInspection(rec: InspectedElementRecord): void {
    this.elementHeaderEl.textContent = '';

    const navGroup = document.createElement('div');
    navGroup.className = 'el-nav-group';

    const prevBtn = this.createButton('◀ Prev', 'Previous Element (Alt + ,)', () =>
      this.stepElement(-1)
    );
    const indexBadge = document.createElement('span');
    indexBadge.className = 'el-index';
    indexBadge.textContent = `#${rec.index} of ${this.records.length}`;
    const nextBtn = this.createButton('Next ▶', 'Next Element (Alt + .)', () =>
      this.stepElement(1)
    );

    const tagCode = document.createElement('code');
    tagCode.className = 'el-tag';
    tagCode.textContent = `<${rec.tagName}${rec.role ? ` role="${rec.role}"` : ''}>`;

    const coordsSpan = document.createElement('span');
    coordsSpan.className = 'el-coords';
    coordsSpan.textContent = `📍 (${rec.coordinates.x}, ${rec.coordinates.y}) ${rec.coordinates.width}×${rec.coordinates.height}px`;

    // Show only the module(s) actually being run. In a single-module mode an element can still *qualify* for other
    // modules (e.g. a hidden element that also has text qualifies for both hANDI and cANDI) but those are not run, so listing
    // them was misleading. In ALL mode every module the element qualified for is shown.
    const modulesSpan = document.createElement('span');
    modulesSpan.className = 'el-modules';
    const shownModules =
      this.mode === 'all' ? rec.modulesMatched : rec.modulesMatched.filter((m) => m === this.mode);
    modulesSpan.textContent =
      shownModules.length > 0 ? shownModules.map((m) => `${m}ANDI`).join(' · ') : '📝 note only';

    navGroup.append(prevBtn, indexBadge, nextBtn, tagCode, coordsSpan, modulesSpan);

    const contextActions = document.createElement('div');
    contextActions.className = 'el-context-actions';

    // Single contextual note button on the active element header (no duplicate toolbar button)
    const noteBadgeBtn = this.createButton(
      rec.note ? '📝 Note ✓' : '📝 Note',
      'Open Note & Screenshot Drawer for this element',
      () => {
        this.inventoryDrawerEl?.classList.remove('open');
        this.openNoteDrawer('editor');
      }
    );
    if (rec.note) {
      noteBadgeBtn.classList.add('btn-note');
    }

    contextActions.appendChild(noteBadgeBtn);

    if (rec.isIframe) {
      const stepInBtn = this.createButton(
        rec.iframeAccessible ? '↪ Step Into Iframe' : '🔒 Cross-Origin Iframe',
        'Inspect DOM inside this iframe',
        () => {
          this.stepIntoIframe(rec.element as HTMLIFrameElement);
        }
      );
      stepInBtn.classList.add('btn-primary');
      contextActions.appendChild(stepInBtn);
    }

    this.elementHeaderEl.append(navGroup, contextActions);

    // Screen Reader Spoken Output
    this.srOutputEl.textContent =
      rec.screenReaderOutput || '⚠ No Accessible Name / Silent Output';
    this.srOutputEl.className = rec.accName ? 'sr-output' : 'sr-output sr-missing';

    // Extracted DOM Node under Screen Reader Output: copy the full DOM code or a ready-to-run local test harness
    this.srDomNodeBarEl.textContent = '';
    const domLabel = document.createElement('span');
    domLabel.className = 'sr-sub-label';
    domLabel.textContent = '🧬 Extracted DOM Node:';

    const domCode = document.createElement('code');
    domCode.className = 'sr-dom-code';
    domCode.textContent = rec.domSnippet;
    domCode.title = `${rec.selector} — use Copy DOM Code for the complete markup`;

    const domActions = document.createElement('div');
    domActions.className = 'sr-dom-actions';

    const domStatus = document.createElement('span');
    domStatus.className = 'sr-dom-status';
    domStatus.setAttribute('role', 'status');
    domStatus.setAttribute('aria-live', 'polite');

    const copyDomBtn = this.createButton(
      '📋 Copy DOM Code',
      'Copy the inspected element’s full HTML (ANDI markers removed) to the clipboard',
      () => {
        this.runDomAction(domStatus, 'DOM code copied', () => {
          this.copyTextToClipboard(getCleanDomCode(rec.element), domStatus, 'DOM code copied');
        });
      }
    );
    const copyHarnessBtn = this.createButton(
      '🧪 Copy Test Harness',
      'Copy a standalone HTML test file (element + context, IDREF targets, CSS, event handlers and dialogs) to the clipboard',
      () => {
        this.runDomAction(domStatus, 'Test harness copied', () => {
          this.copyTextToClipboard(
            buildTestHarnessHtml(rec, this.mode, MODULE_LABELS[this.mode], this.activeFrameLabel),
            domStatus,
            'Test harness HTML copied — save it as .html and open it locally'
          );
        });
      }
    );
    const downloadHarnessBtn = this.createButton(
      '⬇ Download Test Harness',
      'Download the standalone HTML test harness file for local testing',
      () => {
        this.runDomAction(domStatus, 'Test harness downloaded', () => {
          const html = buildTestHarnessHtml(rec, this.mode, MODULE_LABELS[this.mode], this.activeFrameLabel);
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = getHarnessFileName(rec);
          a.click();
          URL.revokeObjectURL(url);
          domStatus.textContent = `✓ Downloaded ${getHarnessFileName(rec)}`;
        });
      }
    );
    copyDomBtn.classList.add('btn-primary');
    domActions.append(copyDomBtn, copyHarnessBtn, downloadHarnessBtn, domStatus);
    this.srDomNodeBarEl.append(domLabel, domCode, domActions);

    // Requirement #3 (Part B): IDREF Attributes (aria-labelledby, aria-describedby, headers, label[for]) & Clickable Linked Targets
    this.srIdRefsBarEl.textContent = '';
    if (rec.idRefGroups.length > 0) {
      this.srIdRefsBarEl.style.display = 'flex';
      for (const group of rec.idRefGroups) {
        const groupRow = document.createElement('div');
        groupRow.className = 'sr-idref-group';

        const attrBadge = document.createElement('code');
        attrBadge.className = 'sr-idref-attr';
        attrBadge.textContent = `${group.attribute}="${group.rawValue}"`;
        groupRow.appendChild(attrBadge);

        for (const item of group.items) {
          if (item.exists && item.targetElement) {
            const targetEl = item.targetElement;
            const linkBtn = document.createElement('a');
            linkBtn.href = `#${item.id}`;
            linkBtn.className = 'sr-idref-target-link';
            const previewTxt =
              item.text.length > 42 ? `${item.text.slice(0, 39)}...` : item.text || '(empty)';
            linkBtn.textContent = `🔗 #${item.id} → <${item.targetTag}> "${previewTxt}"`;
            linkBtn.title = `Click to navigate to referenced DOM node ${item.targetSelector} (<${item.targetTag} id="${item.id}">)`;
            linkBtn.addEventListener('click', (e) => {
              e.preventDefault();
              this.navigateToDomElement(targetEl);
            });
            groupRow.appendChild(linkBtn);
          } else {
            const missingBadge = document.createElement('span');
            missingBadge.className = 'sr-idref-missing';
            missingBadge.textContent = `⚠️ #${item.id} (Missing ID Target)`;
            groupRow.appendChild(missingBadge);
          }
        }
        this.srIdRefsBarEl.appendChild(groupRow);
      }
    } else {
      this.srIdRefsBarEl.style.display = 'none';
    }

    // Requirement #2: Semantic Table / Role Association Bar inside Screen Reader Output
    this.srSemanticAssocBarEl.textContent = '';
    if (rec.tableAssociation) {
      this.srSemanticAssocBarEl.style.display = 'flex';
      const ta = rec.tableAssociation;
      const assocText = document.createElement('span');
      assocText.className = 'sr-semantic-badge';
      const parts: string[] = [
        `📊 Semantic [${ta.tableRole}] Association:`
      ];
      if (ta.tableName) {
        parts.push(`Table "${ta.tableName}"`);
      }
      if (ta.rowIndex !== null && ta.colIndex !== null) {
        parts.push(`Cell (Row ${ta.rowIndex}/${ta.rowCount}, Col ${ta.colIndex}/${ta.colCount})`);
      } else {
        parts.push(`Grid Size (${ta.rowCount} rows × ${ta.colCount} cols)`);
      }
      if (ta.columnHeaders.length > 0) {
        parts.push(`Col Header(s): "${ta.columnHeaders.join(' | ')}"`);
      }
      if (ta.rowHeaders.length > 0) {
        parts.push(`Row Header(s): "${ta.rowHeaders.join(' | ')}"`);
      }
      assocText.textContent = parts.join(' • ');
      this.srSemanticAssocBarEl.appendChild(assocText);
    } else {
      this.srSemanticAssocBarEl.style.display = 'none';
    }

    // Components table
    this.componentsTbodyEl.textContent = '';
    const entries = Object.entries(rec.components).filter(
      ([, val]) => val !== undefined && val !== ''
    );
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

  /**
   * Runs a DOM-copy / harness action and reports failures (e.g. cross-origin CSS, blocked clipboard) inline.
   */
  private runDomAction(statusEl: HTMLElement, label: string, action: () => void): void {
    try {
      action();
    } catch (err) {
      statusEl.textContent = `⚠ ${label} failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * Copies text to the clipboard, falling back to a hidden textarea + `execCommand('copy')`
   * for pages whose permissions policy blocks the async Clipboard API.
   */
  private copyTextToClipboard(text: string, statusEl: HTMLElement, okMessage: string): void {
    const done = (): void => {
      statusEl.textContent = `✓ ${okMessage}`;
    };
    const fallback = (): void => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
      statusEl.textContent = ok
        ? `✓ ${okMessage}`
        : '⚠ Clipboard blocked by the browser — use Download Test Harness instead';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  private renderEmptyActiveElement(): void {
    this.elementHeaderEl.textContent = 'No inspectable elements found for this mode.';
    this.srOutputEl.textContent = '—';
    this.srDomNodeBarEl.textContent = '';
    this.srIdRefsBarEl.textContent = '';
    this.srIdRefsBarEl.style.display = 'none';
    this.srSemanticAssocBarEl.textContent = '';
    this.srSemanticAssocBarEl.style.display = 'none';
    this.componentsTbodyEl.textContent = '';
    this.elementAlertsListEl.textContent = '';
  }

  /**
   * Requirement #3 (Part A): Builds the Fly-In Element Inventory Drawer (similar to Note Drawer),
   * listing all page interface elements in an interactive array categorized by:
   * Tables, Links, Buttons, Form Controls, Landmarks, Headings, Graphics, Dialogs/Live, and Iframes.
   */
  private buildFlyinInventoryDrawer(): HTMLElement {
    const drawer = document.createElement('aside');
    drawer.className = 'flyin-note-drawer flyin-inventory-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Page Element Inventory Fly-In Drawer');

    const topRow = document.createElement('div');
    topRow.className = 'flyin-header';
    const title = document.createElement('h3');
    title.textContent = '🗂 Element Inventory';
    this.inventoryTitleEl = title;

    const topActions = document.createElement('div');
    topActions.className = 'saved-note-actions';

    const copyInvBtn = this.createButton(
      '📋 Copy Inventory JSON',
      'Copy the current filtered Element Inventory Array as JSON to clipboard',
      () => {
        const exportArray = this.getFilteredInventoryItems().map((it) => ({
          id: it.id,
          category: it.category,
          inspectedIndex: it.inspectedIndex,
          tagName: it.tagName,
          role: it.role,
          semanticRole: it.semanticRole,
          domSnippet: it.domSnippet,
          selector: it.selector,
          accName: it.accName,
          accDesc: it.accDesc,
          details: it.details,
          alertCount: it.alertCount,
          coordinates: it.coordinates.formatted
        }));
        navigator.clipboard?.writeText(JSON.stringify(exportArray, null, 2));
        copyInvBtn.textContent = '✓ Copied Array!';
        setTimeout(() => {
          copyInvBtn.textContent = '📋 Copy Inventory JSON';
        }, 1500);
      }
    );
    copyInvBtn.classList.add('btn-primary');

    const closeBtn = this.createButton('✕ Close', 'Close Element Inventory Panel', () => {
      drawer.classList.remove('open');
    });

    topActions.append(copyInvBtn, closeBtn);
    topRow.append(title, topActions);

    // Category filter bar
    this.inventoryCategoryBarEl = document.createElement('div');
    this.inventoryCategoryBarEl.className = 'inv-category-bar';

    // Search input
    const searchWrap = document.createElement('div');
    searchWrap.className = 'inv-search-wrap';
    this.inventorySearchInput = document.createElement('input');
    this.inventorySearchInput.type = 'search';
    this.inventorySearchInput.className = 'inv-search-input';
    this.inventorySearchInput.placeholder =
      'Filter inventory array by accessible name, tag, role, DOM snippet, or selector...';
    this.inventorySearchInput.setAttribute('aria-label', 'Filter Element Inventory');
    this.inventorySearchInput.addEventListener('input', () => {
      this.inventorySearchQuery = this.inventorySearchInput.value.trim().toLowerCase();
      this.renderInventoryDrawer();
    });
    searchWrap.appendChild(this.inventorySearchInput);

    this.inventoryCountHeadingEl = document.createElement('h4');
    this.inventoryCountHeadingEl.className = 'all-notes-heading';

    this.inventoryListEl = document.createElement('ul');
    this.inventoryListEl.className = 'all-notes-list inv-array-list';

    drawer.append(
      topRow,
      this.inventoryCategoryBarEl,
      searchWrap,
      this.inventoryCountHeadingEl,
      this.inventoryListEl
    );
    return drawer;
  }

  public openInventoryDrawer(category?: InventoryCategory | 'all'): void {
    this.noteDrawerEl?.classList.remove('open');
    if (category) {
      this.activeInventoryCategory = category;
    }
    this.renderInventoryDrawer();
    this.inventoryDrawerEl.classList.add('open');
    this.inventorySearchInput.focus();
  }

  private getFilteredInventoryItems(): InventoryItem[] {
    return this.inventoryItems.filter((item) => {
      if (
        this.activeInventoryCategory !== 'all' &&
        item.category !== this.activeInventoryCategory
      ) {
        return false;
      }
      if (!this.inventorySearchQuery) {
        return true;
      }
      const haystack = `${item.accName} ${item.accDesc} ${item.tagName} ${item.role} ${item.semanticRole} ${item.domSnippet} ${item.selector} ${item.details}`.toLowerCase();
      return haystack.includes(this.inventorySearchQuery);
    });
  }

  private renderInventoryDrawer(): void {
    if (!this.inventoryCategoryBarEl || !this.inventoryListEl || !this.inventoryCountHeadingEl) {
      return;
    }

    const categoryMeta: Array<{ key: InventoryCategory | 'all'; label: string; icon: string }> = [
      { key: 'all', label: 'All', icon: '🗂' },
      { key: 'tables', label: 'Tables', icon: '📊' },
      { key: 'links', label: 'Links', icon: '🔗' },
      { key: 'buttons', label: 'Buttons', icon: '🔘' },
      { key: 'formControls', label: 'Form Controls', icon: '⌨️' },
      { key: 'landmarks', label: 'Landmarks', icon: '🧭' },
      { key: 'headings', label: 'Headings', icon: '📑' },
      { key: 'graphics', label: 'Graphics', icon: '🖼' },
      { key: 'dialogsLive', label: 'Dialogs/Live', icon: '💬' },
      { key: 'iframes', label: 'Iframes', icon: '🪟' },
      { key: 'other', label: 'Other', icon: '▫️' }
    ];

    if (this.inventoryTitleEl) {
      this.inventoryTitleEl.textContent = `🗂 Element Inventory — ${MODULE_LABELS[this.mode]}`;
    }

    // Only show categories that contain elements for the selected mode; fall back to "All" if the active one emptied out.
    const visibleCategories = categoryMeta.filter(
      (cat) => cat.key === 'all' || this.inventoryItems.some((i) => i.category === cat.key)
    );
    if (!visibleCategories.some((cat) => cat.key === this.activeInventoryCategory)) {
      this.activeInventoryCategory = 'all';
    }

    this.inventoryCategoryBarEl.textContent = '';
    for (const cat of visibleCategories) {
      const count =
        cat.key === 'all'
          ? this.inventoryItems.length
          : this.inventoryItems.filter((i) => i.category === cat.key).length;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `inv-cat-btn ${this.activeInventoryCategory === cat.key ? 'active' : ''}`;
      btn.textContent = `${cat.icon} ${cat.label} (${count})`;
      btn.addEventListener('click', () => {
        this.activeInventoryCategory = cat.key;
        this.renderInventoryDrawer();
      });
      this.inventoryCategoryBarEl.appendChild(btn);
    }

    const filtered = this.getFilteredInventoryItems();
    this.inventoryCountHeadingEl.textContent = `${filtered.length} shown of ${this.inventoryItems.length} element${this.inventoryItems.length === 1 ? '' : 's'} for ${MODULE_LABELS[this.mode]}`;

    this.inventoryListEl.textContent = '';
    if (filtered.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'empty-msg';
      emptyLi.textContent = 'No elements match this mode, category or filter.';
      this.inventoryListEl.appendChild(emptyLi);
      return;
    }

    filtered.forEach((item, arrayIdx) => {
      const li = document.createElement('li');
      li.className = 'saved-note-card inv-item-card';

      const headerRow = document.createElement('div');
      headerRow.className = 'saved-note-header';

      const leftBadges = document.createElement('div');
      leftBadges.className = 'inv-badges';

      const arrIdxBadge = document.createElement('span');
      arrIdxBadge.className = 'pill pill-info';
      arrIdxBadge.textContent = `[${arrayIdx}] ${item.category.toUpperCase()}`;

      const roleBadge = document.createElement('code');
      roleBadge.className = 'el-tag';
      roleBadge.textContent = `<${item.tagName}${item.role ? ` role="${item.role}"` : ''}> (${item.semanticRole})`;

      leftBadges.append(arrIdxBadge, roleBadge);

      if (item.alertCount > 0) {
        const alertBadge = document.createElement('span');
        alertBadge.className = 'pill pill-danger';
        alertBadge.textContent = `⚠ ${item.alertCount} Alert${item.alertCount === 1 ? '' : 's'}`;
        leftBadges.appendChild(alertBadge);
      }

      const jumpBtn = this.createButton(
        item.inspectedIndex ? `🎯 Navigate (#${item.inspectedIndex})` : '🎯 Navigate to Node',
        `Scroll to, focus, and highlight ${item.selector}`,
        () => {
          this.navigateToDomElement(item.element);
        }
      );
      jumpBtn.classList.add('btn-primary');

      headerRow.append(leftBadges, jumpBtn);

      const nameRow = document.createElement('div');
      nameRow.className = 'saved-note-text';
      nameRow.textContent = `🔊 Accessible Name: "${item.accName || '(No Accessible Name)'}"${item.accDesc ? ` | Desc: "${item.accDesc}"` : ''}`;

      const detailsRow = document.createElement('div');
      detailsRow.className = 'saved-note-meta';
      detailsRow.textContent = `${item.details} · 📍 ${item.coordinates.formatted}`;

      const domRow = document.createElement('div');
      domRow.className = 'inv-dom-row';
      const domCode = document.createElement('code');
      domCode.className = 'sr-dom-code';
      domCode.textContent = item.domSnippet;
      const copyStatus = document.createElement('span');
      copyStatus.className = 'sr-dom-status';
      copyStatus.setAttribute('role', 'status');
      const copyBtn = this.createButton('📋 Copy DOM', `Copy the full HTML of ${item.selector}`, () => {
        this.runDomAction(copyStatus, 'Copy', () => {
          this.copyTextToClipboard(getCleanDomCode(item.element), copyStatus, 'Copied');
        });
      });
      domRow.append(domCode, copyBtn, copyStatus);

      li.append(headerRow, nameRow, detailsRow, domRow);
      this.inventoryListEl.appendChild(li);
    });
  }

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

    const restoreBtn = this.createButton(
      'Restore Original Meta CSP',
      'Restore original meta CSP tags',
      () => {
        this.cspGuard.restoreMetaCsp(this.activeDocument);
        this.refreshCspModal();
      }
    );

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
   * Requirements #3 & #4: Defect Report Modal with Visual Preview (displaying embedded screenshots,
   * exact DOM coordinates, browser info, and timestamps) + Raw HTML/MD/JSON/CSV export.
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
    title.textContent =
      '📋 Defect Report (ANDI Alerts + Tester Notes, Coordinates & Screenshots)';

    const controls = document.createElement('div');
    controls.className = 'report-controls';

    this.reportFormatSelect = document.createElement('select');
    this.reportFormatSelect.setAttribute('aria-label', 'Report View and Export Format');
    (['visual', 'html', 'markdown', 'json', 'csv'] as const).forEach((fmt) => {
      const opt = document.createElement('option');
      opt.value = fmt;
      opt.textContent =
        fmt === 'visual'
          ? 'View: Visual Report (with Screenshots)'
          : fmt === 'html'
            ? 'Code: HTML (with Embedded Screenshots)'
            : `Code: ${fmt.toUpperCase()}`;
      this.reportFormatSelect.appendChild(opt);
    });
    this.reportFormatSelect.addEventListener('change', () => this.refreshReportContent());

    const copyBtn = this.createButton('Copy Report Code', 'Copy report source to clipboard', () => {
      navigator.clipboard?.writeText(this.reportTextarea.value);
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy Report Code';
      }, 1500);
    });
    copyBtn.classList.add('btn-primary');

    const downloadBtn = this.createButton(
      '⬇ Download Report + Screenshots',
      'Download Defect Report and captured DOM node PNG screenshots',
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

    this.reportVisualContainer = document.createElement('div');
    this.reportVisualContainer.className = 'report-visual-container';

    this.reportTextarea = document.createElement('textarea');
    this.reportTextarea.className = 'report-output';
    this.reportTextarea.readOnly = true;
    this.reportTextarea.style.display = 'none';
    this.reportTextarea.setAttribute('aria-label', 'Generated Defect Report Code');

    card.append(topRow, this.reportVisualContainer, this.reportTextarea);
    modal.appendChild(card);
    return modal;
  }

  private openReportModal(): void {
    // Ensure any noted element that doesn't yet have a screenshot gets one generated automatically so screenshots always show in the report
    for (const rec of this.records) {
      rec.note = readElementNote(rec.element, rec.selector, this.activeFrameLabel);
      if (rec.note && !rec.note.screenshotDataUrl) {
        const autoShot = captureNodeScreenshotWithNote(
          rec.element,
          rec.selector,
          rec.tagName,
          rec.accName,
          rec.note.text,
          rec.note.severity,
          rec.alerts
        );
        rec.note = writeElementNote(
          rec.element,
          rec.selector,
          rec.note.text,
          rec.note.severity,
          autoShot,
          this.activeFrameLabel
        );
      }
    }
    this.refreshReportContent();
    this.reportModalEl.classList.add('open');
  }

  private refreshReportContent(): void {
    const report = buildDefectReport(this.records, this.mode, this.activeFrameLabel);
    const fmt = this.reportFormatSelect.value;

    // Always keep reportTextarea populated for Copy / Download
    if (fmt === 'json') {
      this.reportTextarea.value = JSON.stringify(report, null, 2);
    } else if (fmt === 'csv') {
      this.reportTextarea.value = formatReportAsCsv(report);
    } else if (fmt === 'markdown') {
      this.reportTextarea.value = formatReportAsMarkdown(report);
    } else {
      this.reportTextarea.value = formatReportAsHtml(report);
    }

    if (fmt === 'visual') {
      this.reportVisualContainer.style.display = 'block';
      this.reportTextarea.style.display = 'none';
      this.renderVisualReportPreview(report);
    } else {
      this.reportVisualContainer.style.display = 'none';
      this.reportTextarea.style.display = 'block';
    }
  }

  /**
   * Renders the interactive Visual Defect Report inside the modal so the user immediately sees:
   * - Environment details (Browser, OS, Viewport, Timestamp)
   * - Only ANDI-detected defects + Tester Notes
   * - Exact DOM coordinates (`x, y, pageX, pageY, width × height`)
   * - Embedded PNG screenshots taken via the Fly-In Note Drawer
   */
  private renderVisualReportPreview(report: DefectReport): void {
    this.reportVisualContainer.textContent = '';

    const metaBox = document.createElement('div');
    metaBox.className = 'visual-report-meta';
    const env = report.browserEnvironment;
    metaBox.innerHTML = `
      <div><strong>Page:</strong> ${report.pageTitle} (<code>${report.pageUrl}</code>) | <strong>Frame:</strong> <code>${report.frameContext}</code></div>
      <div><strong>Generated At:</strong> ${report.generatedAtLocal} | <strong>Browser &amp; OS:</strong> ${env.browserName} | <strong>Viewport:</strong> <code>${env.viewport}</code> (DPR ${env.devicePixelRatio})</div>
      <div><strong>Scope:</strong> Showing <strong>${report.totalDefectItems}</strong> defect/note items (<strong>${report.totalAlerts}</strong> ANDI alerts across <strong>${report.totalAlertedElements}</strong> elements, <strong>${report.totalNotesIncluded}</strong> tester notes, <strong>${report.totalScreenshotsIncluded}</strong> DOM node screenshots)</div>
    `;
    this.reportVisualContainer.appendChild(metaBox);

    if (report.items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-msg';
      empty.textContent = 'No ANDI accessibility defects or tester notes found on this page.';
      this.reportVisualContainer.appendChild(empty);
      return;
    }

    for (const item of report.items) {
      const card = document.createElement('article');
      card.className = 'visual-defect-card';

      const cardHeader = document.createElement('div');
      cardHeader.className = 'visual-defect-header';

      const h3 = document.createElement('h3');
      h3.textContent = `[#${item.index}] ${item.tagAndRole} — ${item.selector}`;

      const coordsBadge = document.createElement('span');
      coordsBadge.className = 'pill pill-info';
      coordsBadge.textContent = `📍 DOM Coords: ${item.coordinates.formatted}`;

      cardHeader.append(h3, coordsBadge);

      const srLine = document.createElement('div');
      srLine.className = 'visual-defect-sr';
      srLine.textContent = `🔊 Screen Reader Output: "${item.screenReaderOutput}" | Accessible Name: "${item.accessibleName}"`;

      card.append(cardHeader, srLine);

      if (item.alerts.length > 0) {
        const alertTitle = document.createElement('div');
        alertTitle.className = 'visual-subhead';
        alertTitle.textContent = `🔴 ANDI Detected Alerts (${item.alerts.length}):`;
        const ul = document.createElement('ul');
        ul.className = 'alert-list';
        for (const a of item.alerts) {
          const li = document.createElement('li');
          li.className = `alert-item alert-${a.level}`;
          const ball = document.createElement('span');
          ball.className = `red-ball ball-${a.level}`;
          ball.textContent = a.level === 'danger' ? '!' : '▲';
          const txt = document.createElement('span');
          txt.textContent = `[${a.level.toUpperCase()} · ${a.module}] ${a.message}`;
          li.append(ball, txt);
          ul.appendChild(li);
        }
        card.append(alertTitle, ul);
      }

      if (item.note) {
        const noteBox = document.createElement('div');
        noteBox.className = 'visual-note-box';

        const noteHead = document.createElement('div');
        noteHead.className = 'visual-note-head';
        const noteTime = new Date(item.note.updatedAt).toLocaleString();
        const noteCoords = item.note.coordinates?.formatted || item.coordinates.formatted;
        const noteBrowser = item.note.browserInfo || env.browserName;
        noteHead.textContent = `📝 Tester Note [${item.note.severity.toUpperCase()}] · Coords: ${noteCoords} · Browser: ${noteBrowser} · Time: ${noteTime}`;

        const noteP = document.createElement('p');
        noteP.className = 'visual-note-text';
        noteP.textContent = item.note.text;

        noteBox.append(noteHead, noteP);

        if (item.note.screenshotDataUrl) {
          const shotWrap = document.createElement('div');
          shotWrap.className = 'visual-shot-wrap';
          const shotLabel = document.createElement('div');
          shotLabel.className = 'visual-shot-label';
          shotLabel.textContent = '📸 Captured DOM Node Screenshot with Tester Note:';
          const img = document.createElement('img');
          img.src = item.note.screenshotDataUrl;
          img.alt = `Annotated DOM node screenshot for #${item.index} ${item.selector}`;
          img.className = 'visual-shot-img';
          shotWrap.append(shotLabel, img);
          noteBox.appendChild(shotWrap);
        }

        card.appendChild(noteBox);
      }

      this.reportVisualContainer.appendChild(card);
    }
  }

  private downloadReportAndScreenshots(): void {
    const report = buildDefectReport(this.records, this.mode, this.activeFrameLabel);
    const rawFmt = this.reportFormatSelect.value;
    const fmt = rawFmt === 'visual' ? 'html' : rawFmt;
    const ext = fmt === 'json' ? 'json' : fmt === 'csv' ? 'csv' : fmt === 'html' ? 'html' : 'md';
    const mime =
      fmt === 'json'
        ? 'application/json'
        : fmt === 'csv'
          ? 'text/csv'
          : fmt === 'html'
            ? 'text/html'
            : 'text/markdown';

    const content =
      fmt === 'html' ? formatReportAsHtml(report) : this.reportTextarea.value;
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `andi-gen1-defect-report.${ext}`;
    a.click();
    URL.revokeObjectURL(url);

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

  /**
   * Requirement #5: High-Contrast WCAG AAA Color Palettes for both Dark and Light Themes.
   * - Dark Theme: #ffffff & #e2e8f0 text on #020617 / #0f172a backgrounds (14.6:1 to 19.3:1 contrast)
   * - Light Theme: #020617 & #1e293b text on #ffffff / #f8fafc backgrounds (14.2:1 to 20.1:1 contrast)
   */
  private getShadowStyles(): string {
    return `
      :host {
        all: initial;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      * { box-sizing: border-box; }

      /* High-Contrast Dark Theme (Default — WCAG AAA 14:1+ text contrast) */
      .andi-bar {
        --bg-main: #020617;
        --bg-panel: #0f172a;
        --bg-sub: #020617;
        --text-main: #ffffff;
        --text-muted: #e2e8f0;
        --border-color: #94a3b8;
        --accent: #7dd3fc;
        --btn-bg: #1e293b;
        --btn-text: #ffffff;
        --sr-missing-color: #fca5a5;
        background: var(--bg-main);
        color: var(--text-main);
        border-bottom: 3px solid var(--accent);
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.65);
        font-size: 13px;
        position: relative;
      }

      /* High-Contrast Light Theme (WCAG AAA 14:1+ text contrast) */
      .andi-bar[data-theme="light"] {
        --bg-main: #e2e8f0;
        --bg-panel: #ffffff;
        --bg-sub: #f8fafc;
        --text-main: #020617;
        --text-muted: #1e293b;
        --border-color: #334155;
        --accent: #0c4a6e;
        --btn-bg: #f1f5f9;
        --btn-text: #020617;
        --sr-missing-color: #991b1b;
        box-shadow: 0 8px 28px rgba(2, 6, 23, 0.22);
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
        max-height: calc(100vh - 120px);
        flex: 1;
      }
      .andi-bar[data-dock="left"] .andi-panel,
      .andi-bar[data-dock="right"] .andi-panel {
        max-height: 43vh;
      }
      .andi-bar[data-dock="dom"] {
        border: 2.5px solid var(--accent);
        border-radius: 10px;
        overflow: hidden;
      }

      /* 3-Zone Ergonomic Top Command Bar */
      .andi-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 7px 12px;
        background: var(--bg-panel);
        border-bottom: 1.5px solid var(--border-color);
      }
      .toolbar-zone {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .zone-telemetry {
        padding: 0 10px;
        border-left: 1.5px solid var(--border-color);
        border-right: 1.5px solid var(--border-color);
      }
      .andi-brand {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .andi-logo {
        font-weight: 900;
        font-size: 14.5px;
        color: var(--accent);
      }
      .andi-version {
        font-size: 11px;
        font-weight: 700;
        background: var(--btn-bg);
        color: var(--text-main);
        border: 1px solid var(--border-color);
        padding: 1px 6px;
        border-radius: 4px;
      }
      .andi-module-wrap, .andi-iframe-wrap {
        display: flex;
        align-items: center;
        gap: 5px;
        font-weight: 700;
      }
      select {
        background: var(--bg-sub);
        color: var(--text-main);
        border: 1.5px solid var(--border-color);
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 12px;
        font-weight: 700;
      }
      select:disabled {
        opacity: 0.75;
      }
      .andi-summary-pills {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        align-items: center;
      }
      .pill {
        padding: 3px 9px;
        border-radius: 999px;
        font-size: 11.5px;
        font-weight: 800;
        border: 1.5px solid transparent;
      }
      .pill-frame { background: #064e3b; color: #ffffff; border-color: #6ee7b7; }
      .pill-info { background: #1e3a8a; color: #ffffff; border-color: #93c5fd; }
      .pill-danger { background: #7f1d1d; color: #ffffff; border-color: #fca5a5; }
      .pill-ok { background: #065f46; color: #ffffff; border-color: #6ee7b7; }
      .pill-note { background: #4c1d95; color: #ffffff; border-color: #d8b4fe; }
      .pill-inventory { background: #0c4a6e; color: #ffffff; border-color: #7dd3fc; }
      .pill-actionable {
        cursor: pointer;
        text-decoration: underline;
        transition: transform 0.1s ease;
      }
      .pill-actionable:hover, .pill-actionable:focus-visible {
        outline: 2.5px solid var(--accent);
        transform: translateY(-1px);
      }

      .andi-btn {
        background: var(--btn-bg);
        color: var(--btn-text);
        border: 1.5px solid var(--border-color);
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      .andi-btn:hover, .andi-btn:focus-visible {
        outline: 2.5px solid var(--accent);
        outline-offset: 1px;
      }
      .btn-primary { background: #1d4ed8; color: #ffffff; border-color: #93c5fd; }
      .btn-note { background: #5b21b6; color: #ffffff; border-color: #d8b4fe; }
      .btn-warning { background: #fef08a; color: #020617; border-color: #ca8a04; }
      .btn-danger { background: #991b1b; color: #ffffff; border-color: #fca5a5; }

      /* 2-Column Main Panel Grid */
      .andi-grid {
        display: grid;
        grid-template-columns: 1.3fr 1fr;
        gap: 10px;
        padding: 8px 12px;
        max-height: 205px;
      }
      .andi-panel {
        background: var(--bg-panel);
        border: 1.5px solid var(--border-color);
        border-radius: 8px;
        padding: 8px 10px;
        overflow-y: auto;
        max-height: 188px;
      }
      .panel-title {
        margin: 0 0 6px;
        font-size: 13px;
        font-weight: 800;
        color: var(--text-main);
      }

      /* Integrated Active Element Navigator Bar in Panel 1 */
      .element-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 6px;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--border-color);
        flex-wrap: wrap;
      }
      .el-nav-group, .el-context-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .el-index {
        background: #9d174d;
        color: #ffffff;
        border: 1px solid #f9a8d4;
        font-weight: 800;
        font-size: 11.5px;
        padding: 2px 7px;
        border-radius: 4px;
      }
      .el-tag {
        color: var(--accent);
        font-weight: 800;
        font-size: 12.5px;
      }
      .el-coords {
        font-size: 11px;
        font-weight: 700;
        color: var(--text-muted);
        background: var(--bg-sub);
        border: 1px solid var(--border-color);
        padding: 1px 6px;
        border-radius: 4px;
      }
      .el-modules {
        font-size: 11px;
        font-weight: 700;
        color: var(--text-muted);
      }

      .sr-box {
        background: var(--bg-sub);
        border: 1px solid var(--border-color);
        border-left: 4px solid var(--accent);
        padding: 5px 8px;
        border-radius: 4px;
        margin-bottom: 6px;
      }
      .sr-title {
        font-size: 10.5px;
        font-weight: 800;
        color: var(--text-muted);
        text-transform: uppercase;
      }
      .sr-output {
        font-weight: 800;
        font-size: 13px;
        margin-top: 2px;
        color: var(--text-main);
      }
      .sr-missing { color: var(--sr-missing-color); }

      /* Requirement #1: Extracted DOM Node Bar under Screen Reader Output */
      .sr-dom-node-bar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 5px;
        padding-top: 5px;
        border-top: 1px dashed var(--border-color);
      }
      .sr-sub-label {
        font-size: 11px;
        font-weight: 800;
        color: var(--text-muted);
      }
      .sr-dom-code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11.5px;
        font-weight: 700;
        color: var(--text-main);
        background: var(--bg-panel);
        border: 1.5px solid var(--border-color);
        border-radius: 5px;
        padding: 3px 8px;
        max-width: 100%;
        overflow-wrap: anywhere;
      }
      .sr-dom-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        width: 100%;
      }
      .sr-dom-status {
        font-size: 11px;
        font-weight: 800;
        color: var(--accent);
      }
      .inv-dom-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
      }

      /* Requirement #3 (Part B): IDREF Attributes & Linked Items in Screen Reader Output */
      .sr-idrefs-bar {
        display: none;
        flex-direction: column;
        gap: 4px;
        margin-top: 5px;
        padding-top: 5px;
        border-top: 1px dashed var(--border-color);
      }
      .sr-idref-group {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
      }
      .sr-idref-attr {
        background: #312e81;
        color: #ffffff;
        border: 1px solid #a5b4fc;
        border-radius: 4px;
        padding: 2px 6px;
        font-size: 11px;
        font-weight: 800;
      }
      .sr-idref-target-link {
        display: inline-flex;
        align-items: center;
        background: #0c4a6e;
        color: #ffffff;
        border: 1px solid #7dd3fc;
        border-radius: 4px;
        padding: 2px 7px;
        font-size: 11px;
        font-weight: 700;
        text-decoration: underline;
        cursor: pointer;
      }
      .sr-idref-target-link:hover, .sr-idref-target-link:focus-visible {
        outline: 2.5px solid #ffffff;
        background: #0369a1;
      }
      .sr-idref-missing {
        display: inline-flex;
        align-items: center;
        background: #7f1d1d;
        color: #ffffff;
        border: 1px solid #fca5a5;
        border-radius: 4px;
        padding: 2px 7px;
        font-size: 11px;
        font-weight: 800;
      }

      /* Requirement #2: Semantic Table / Role Association Bar */
      .sr-semantic-bar {
        display: none;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 5px;
        padding-top: 5px;
        border-top: 1px dashed var(--border-color);
      }
      .sr-semantic-badge {
        background: #064e3b;
        color: #ffffff;
        border: 1px solid #6ee7b7;
        border-radius: 4px;
        padding: 2px 7px;
        font-size: 11px;
        font-weight: 800;
      }

      /* Requirement #3 (Part A): Element Inventory Fly-In Drawer */
      .flyin-inventory-drawer {
        width: 560px;
        right: -580px;
      }
      .flyin-inventory-drawer.open {
        right: 0;
      }
      .inv-category-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-bottom: 8px;
      }
      .inv-cat-btn {
        background: var(--bg-sub);
        color: var(--text-main);
        border: 1.5px solid var(--border-color);
        border-radius: 999px;
        padding: 3px 9px;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
      }
      .inv-cat-btn.active {
        background: #1d4ed8;
        color: #ffffff;
        border-color: #93c5fd;
      }
      .inv-search-wrap {
        margin-bottom: 8px;
      }
      .inv-search-input {
        width: 100%;
        background: var(--bg-sub);
        color: var(--text-main);
        border: 1.5px solid var(--border-color);
        border-radius: 6px;
        padding: 6px 9px;
        font-size: 12px;
        font-weight: 600;
      }
      .inv-badges {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
      }

      .comp-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        margin-bottom: 5px;
      }
      .comp-table th, .comp-table td {
        border-bottom: 1px solid var(--border-color);
        padding: 3px 5px;
        text-align: left;
      }
      .comp-table th {
        color: var(--accent);
        font-weight: 800;
        width: 30%;
      }

      /* Fly-in Notes & All Saved Notes Drawer */
      .flyin-note-drawer {
        position: fixed;
        top: 46px;
        right: -520px;
        width: 500px;
        max-height: calc(100vh - 58px);
        overflow-y: auto;
        background: var(--bg-panel);
        color: var(--text-main);
        border: 2.5px solid var(--accent);
        border-radius: 10px 0 0 10px;
        padding: 14px;
        box-shadow: -10px 10px 36px rgba(0, 0, 0, 0.7);
        transition: right 0.2s ease-in-out;
        z-index: 2147483647;
      }
      .flyin-note-drawer.open {
        right: 0;
      }
      .flyin-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1.5px solid var(--border-color);
      }
      .flyin-header h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 800;
      }
      .flyin-section {
        margin-bottom: 12px;
      }
      .active-note-meta {
        font-size: 11.5px;
        background: var(--bg-sub);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 6px 8px;
        margin-bottom: 8px;
        line-height: 1.45;
      }
      .note-textarea {
        width: 100%;
        min-height: 70px;
        background: var(--bg-sub);
        color: var(--text-main);
        border: 1.5px solid var(--border-color);
        border-radius: 6px;
        padding: 7px;
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 600;
      }
      .note-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
      }
      .note-status {
        margin-top: 6px;
        font-size: 11.5px;
        font-weight: 700;
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
        border: 2px solid var(--border-color);
      }

      /* All Saved Notes List inside Drawer */
      .all-notes-section {
        border-top: 2px solid var(--border-color);
        padding-top: 10px;
      }
      .all-notes-heading {
        margin: 0 0 8px;
        font-size: 13px;
        font-weight: 800;
        color: var(--accent);
      }
      .all-notes-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .saved-note-card {
        background: var(--bg-sub);
        border: 1.5px solid var(--border-color);
        border-radius: 8px;
        padding: 8px 10px;
      }
      .saved-note-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin-bottom: 4px;
      }
      .saved-note-actions {
        display: flex;
        gap: 5px;
      }
      .saved-note-meta {
        font-size: 11px;
        color: var(--text-muted);
        margin-bottom: 4px;
      }
      .saved-note-text {
        font-size: 12.5px;
        font-weight: 700;
        margin-bottom: 6px;
      }
      .saved-note-thumb {
        width: 100%;
        border-radius: 6px;
        border: 1px solid var(--border-color);
      }

      /* Alerts List */
      .alert-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .alert-item {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        padding: 4px 0;
        font-size: 12px;
        font-weight: 600;
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
        width: 18px;
        height: 18px;
        min-width: 18px;
        border-radius: 50%;
        font-size: 11px;
        font-weight: 900;
      }
      .ball-danger { background: #991b1b; color: #ffffff; border: 1px solid #fca5a5; }
      .ball-warning { background: #fef08a; color: #020617; border: 1px solid #ca8a04; }
      .ball-caution { background: #075985; color: #ffffff; border: 1px solid #7dd3fc; }
      .empty-msg { color: var(--text-muted); font-style: italic; font-size: 12px; }

      /* Report & CSP Modals */
      .report-modal {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(2, 6, 23, 0.85);
        place-items: center;
        padding: 20px;
        z-index: 2147483647;
      }
      .report-modal.open {
        display: grid;
      }
      .report-card {
        width: 100%;
        max-width: 960px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        background: var(--bg-panel);
        color: var(--text-main);
        border: 2.5px solid var(--accent);
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.75);
      }
      .report-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1.5px solid var(--border-color);
        flex-wrap: wrap;
      }
      .report-header h2 {
        margin: 0;
        font-size: 15px;
        font-weight: 800;
      }
      .report-controls {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .report-visual-container {
        overflow-y: auto;
        max-height: 72vh;
        padding-right: 4px;
      }
      .visual-report-meta {
        background: var(--bg-sub);
        border: 1.5px solid var(--border-color);
        border-radius: 8px;
        padding: 10px 12px;
        margin-bottom: 12px;
        font-size: 12px;
        line-height: 1.55;
      }
      .visual-defect-card {
        background: var(--bg-sub);
        border: 1.5px solid var(--border-color);
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 12px;
      }
      .visual-defect-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 6px;
      }
      .visual-defect-header h3 {
        margin: 0;
        font-size: 13.5px;
        color: var(--accent);
      }
      .visual-defect-sr {
        font-size: 12px;
        font-weight: 700;
        margin-bottom: 8px;
      }
      .visual-subhead {
        font-size: 12px;
        font-weight: 800;
        margin-bottom: 4px;
      }
      .visual-note-box {
        margin-top: 8px;
        padding: 10px;
        background: var(--bg-panel);
        border: 1.5px solid #a855f7;
        border-left: 5px solid #9333ea;
        border-radius: 6px;
      }
      .visual-note-head {
        font-size: 11.5px;
        font-weight: 800;
        color: var(--accent);
        margin-bottom: 4px;
      }
      .visual-note-text {
        margin: 4px 0 8px;
        font-size: 13px;
        font-weight: 700;
      }
      .visual-shot-wrap {
        margin-top: 8px;
      }
      .visual-shot-label {
        font-size: 11.5px;
        font-weight: 800;
        margin-bottom: 4px;
      }
      .visual-shot-img {
        max-width: 100%;
        border-radius: 6px;
        border: 2px solid var(--border-color);
        display: block;
      }
      .report-output {
        width: 100%;
        height: 420px;
        background: var(--bg-sub);
        color: var(--text-main);
        border: 1.5px solid var(--border-color);
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
