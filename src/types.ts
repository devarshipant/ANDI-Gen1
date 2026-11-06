/**
 * ANDI-Gen1 — Core Type Definitions
 * Strict, zero-dependency TypeScript types for accessibility inspection,
 * localStorage fly-in notes, DOM node screenshots, coordinates, browser metadata,
 * iframe step-in, CSP resolution, dockable layouts, and high-contrast themes.
 */

export type AndiMode = 'f' | 'g' | 'l' | 't' | 's' | 'c' | 'h' | 'i' | 'all';

export type AlertLevel = 'danger' | 'warning' | 'caution';

export type DockPosition = 'top' | 'bottom' | 'left' | 'right' | 'dom';

export type ThemeMode = 'dark' | 'light';

export interface DomNodeCoordinates {
  x: number;
  y: number;
  pageX: number;
  pageY: number;
  width: number;
  height: number;
  formatted: string;
}

export interface BrowserEnvironmentInfo {
  browserName: string;
  userAgent: string;
  platform: string;
  viewport: string;
  devicePixelRatio: number;
}

export interface AndiAlert {
  id: string;
  code: string;
  level: AlertLevel;
  module: Exclude<AndiMode, 'all'>;
  message: string;
}

export interface AndiNote {
  text: string;
  severity: AlertLevel;
  updatedAt: string;
  selector: string;
  frameContext?: string;
  tagName?: string;
  coordinates?: DomNodeCoordinates;
  browserInfo?: string;
  screenshotDataUrl?: string;
}

export interface CspViolationRecord {
  violatedDirective: string;
  blockedURI: string;
  timestamp: string;
}

export interface CspReportState {
  metaTagCount: number;
  metaPolicies: string[];
  adoptedStyleSheetsActive: boolean;
  metaResolved: boolean;
  violations: CspViolationRecord[];
}

export interface AccessibleComponents {
  ariaLabelledby?: string;
  ariaLabel?: string;
  ariaDescribedby?: string;
  ariaDescription?: string;
  nativeLabel?: string;
  alt?: string;
  value?: string;
  innerText?: string;
  title?: string;
  placeholder?: string;
  legend?: string;
  caption?: string;
  figcaption?: string;
  pseudoBefore?: string;
  pseudoAfter?: string;
  subtreeSummary?: string;
}

export interface InspectedElementRecord {
  index: number;
  element: HTMLElement;
  selector: string;
  tagName: string;
  role: string;
  isFocusable: boolean;
  isTabbable: boolean;
  tabIndexValue: number | null;
  accessKey: string | null;
  accName: string;
  accDesc: string;
  accGroup: string;
  screenReaderOutput: string;
  addOnProps: Record<string, string>;
  components: AccessibleComponents;
  alerts: AndiAlert[];
  modulesMatched: Array<Exclude<AndiMode, 'all'>>;
  note: AndiNote | null;
  coordinates: DomNodeCoordinates;
  isIframe: boolean;
  iframeAccessible: boolean;
  iframeSrc: string;
}

export interface PageIndex {
  doc: Document;
  win: Window;
  root: HTMLElement;
  allElements: HTMLElement[];
  visibleElements: HTMLElement[];
  iframes: HTMLIFrameElement[];
  idMap: Map<string, HTMLElement[]>;
  labelForMap: Map<string, HTMLLabelElement[]>;
  styleCache: WeakMap<Element, CSSStyleDeclaration>;
  getStyle: (el: Element) => CSSStyleDeclaration;
}

export interface DefectReportItem {
  index: number;
  selector: string;
  tagAndRole: string;
  frameContext: string;
  coordinates: DomNodeCoordinates;
  modules: string[];
  accessibleName: string;
  accessibleDescription: string;
  screenReaderOutput: string;
  alerts: Array<{
    level: AlertLevel;
    code: string;
    module: string;
    message: string;
  }>;
  note: AndiNote | null;
  htmlSnippet: string;
}

export interface DefectReport {
  generatedAt: string;
  generatedAtLocal: string;
  browserEnvironment: BrowserEnvironmentInfo;
  pageUrl: string;
  pageTitle: string;
  frameContext: string;
  modeRun: AndiMode;
  totalElementsInspected: number;
  totalDefectItems: number;
  totalAlertedElements: number;
  totalAlerts: number;
  totalNotesIncluded: number;
  totalScreenshotsIncluded: number;
  items: DefectReportItem[];
}
