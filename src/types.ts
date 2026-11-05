/**
 * ANDI Next — Core Type Definitions
 * Strict, zero-dependency TypeScript types for accessibility inspection,
 * persistent DOM notes, and multi-module ("All") defect reporting.
 */

export type AndiMode = 'all' | 'f' | 'g' | 'l' | 't' | 's' | 'c' | 'h' | 'i';

export type AlertLevel = 'danger' | 'warning' | 'caution';

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
}

export interface PageIndex {
  root: HTMLElement;
  allElements: HTMLElement[];
  visibleElements: HTMLElement[];
  idMap: Map<string, HTMLElement[]>;
  labelForMap: Map<string, HTMLLabelElement[]>;
  styleCache: WeakMap<Element, CSSStyleDeclaration>;
  getStyle: (el: Element) => CSSStyleDeclaration;
}

export interface DefectReportItem {
  index: number;
  selector: string;
  tagAndRole: string;
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
  pageUrl: string;
  pageTitle: string;
  modeRun: AndiMode;
  totalElementsInspected: number;
  totalAlerts: number;
  totalNotes: number;
  items: DefectReportItem[];
}

