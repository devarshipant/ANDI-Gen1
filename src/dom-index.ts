/**
 * ANDI-Gen1 — High-Performance DOM Indexer & Iframe Context Support
 * Supports indexing the top-level document OR any stepped-into <iframe> document
 * with a single-pass TreeWalker, WeakMap style cache, and O(1) Map/Set lookups.
 */

import { PageIndex } from './types';

export const ANDI_HOST_ID = 'andi-gen1-host';
export const ANDI_LASER_ID = 'andi-gen1-laser-svg';

export const VALID_ARIA_ROLES: ReadonlySet<string> = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'button',
  'cell', 'checkbox', 'columnheader', 'combobox', 'complementary',
  'contentinfo', 'definition', 'dialog', 'directory', 'document', 'feed',
  'figure', 'form', 'grid', 'gridcell', 'group', 'heading', 'img', 'link',
  'list', 'listbox', 'listitem', 'log', 'main', 'marquee', 'math', 'menu',
  'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation',
  'none', 'note', 'option', 'presentation', 'progressbar', 'radio',
  'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar',
  'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status',
  'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox',
  'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem'
]);

export const BLOCK_TAG_NAMES: ReadonlySet<string> = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'div',
  'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'header', 'legend', 'li', 'main', 'nav', 'ol',
  'output', 'p', 'pre', 'section', 'table', 'td', 'tfoot', 'th', 'tr', 'ul'
]);

const NATIVELY_FOCUSABLE_TAGS: ReadonlySet<string> = new Set([
  'input', 'select', 'textarea', 'button', 'iframe', 'summary'
]);

/**
 * Builds a single-pass index of the target document or iframe body while skipping ANDI's UI.
 */
export function buildPageIndex(root: HTMLElement = document.body): PageIndex {
  const doc = root.ownerDocument || document;
  const win = doc.defaultView || window;
  const allElements: HTMLElement[] = [];
  const visibleElements: HTMLElement[] = [];
  const iframes: HTMLIFrameElement[] = [];
  const idMap = new Map<string, HTMLElement[]>();
  const labelForMap = new Map<string, HTMLLabelElement[]>();
  const styleCache = new WeakMap<Element, CSSStyleDeclaration>();

  const getStyle = (el: Element): CSSStyleDeclaration => {
    let cached = styleCache.get(el);
    if (!cached) {
      cached = win.getComputedStyle(el);
      styleCache.set(el, cached);
    }
    return cached;
  };

  const walker = doc.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node: Node): number {
        const el = node as HTMLElement;
        if (el.id === ANDI_HOST_ID || el.id === ANDI_LASER_ID) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let current = walker.nextNode() as HTMLElement | null;
  while (current) {
    allElements.push(current);

    if (current.id) {
      const existing = idMap.get(current.id);
      if (existing) {
        existing.push(current);
      } else {
        idMap.set(current.id, [current]);
      }
    }

    if (isElementVisible(current, getStyle)) {
      visibleElements.push(current);

      if (current.tagName === 'IFRAME') {
        iframes.push(current as HTMLIFrameElement);
      }

      if (current.tagName === 'LABEL') {
        const labelEl = current as HTMLLabelElement;
        const forVal = labelEl.getAttribute('for')?.trim();
        if (forVal) {
          const list = labelForMap.get(forVal);
          if (list) {
            list.push(labelEl);
          } else {
            labelForMap.set(forVal, [labelEl]);
          }
        }
      }
    }

    current = walker.nextNode() as HTMLElement | null;
  }

  return {
    doc,
    win,
    root,
    allElements,
    visibleElements,
    iframes,
    idMap,
    labelForMap,
    styleCache,
    getStyle
  };
}

/**
 * Checks whether an element and its ancestor chain are visually rendered.
 */
export function isElementVisible(
  el: HTMLElement,
  getStyle: (el: Element) => CSSStyleDeclaration
): boolean {
  if (el.hasAttribute('hidden')) {
    return false;
  }
  const style = getStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
    return false;
  }
  const doc = el.ownerDocument || document;
  let parent = el.parentElement;
  while (parent && parent !== doc.body && parent !== doc.documentElement) {
    if (parent.hasAttribute('hidden') || getStyle(parent).display === 'none') {
      return false;
    }
    parent = parent.parentElement;
  }
  return true;
}

/**
 * Extracts the first valid ARIA role from the element's `role` attribute.
 */
export function getValidRole(el: Element): string {
  const rawRole = el.getAttribute('role');
  if (!rawRole) {
    return '';
  }
  const tokens = rawRole.trim().toLowerCase().split(/\s+/);
  for (const token of tokens) {
    if (VALID_ARIA_ROLES.has(token)) {
      return token;
    }
  }
  return '';
}

/**
 * Checks whether an element is focusable and/or in the sequential keyboard tab order.
 */
export function getFocusability(el: HTMLElement): {
  isFocusable: boolean;
  isTabbable: boolean;
  tabIndexValue: number | null;
} {
  const tag = el.tagName.toLowerCase();
  const rawTabIndex = el.getAttribute('tabindex');
  let tabIndexValue: number | null = null;
  let hasNumericTabIndex = false;

  if (rawTabIndex !== null && rawTabIndex.trim() !== '') {
    const parsed = Number(rawTabIndex.trim());
    if (!Number.isNaN(parsed)) {
      tabIndexValue = parsed;
      hasNumericTabIndex = true;
    }
  }

  const isDisabled = (el as HTMLInputElement | HTMLButtonElement).disabled === true;
  if (isDisabled) {
    return { isFocusable: false, isTabbable: false, tabIndexValue };
  }

  if (tag === 'input' && (el as HTMLInputElement).type.toLowerCase() === 'hidden') {
    return { isFocusable: false, isTabbable: false, tabIndexValue };
  }

  let isFocusable = false;
  if (NATIVELY_FOCUSABLE_TAGS.has(tag)) {
    isFocusable = true;
  } else if (tag === 'a' || tag === 'area') {
    isFocusable = el.hasAttribute('href') || hasNumericTabIndex;
  } else if (
    el.getAttribute('contenteditable') === 'true' ||
    el.getAttribute('contenteditable') === ''
  ) {
    isFocusable = true;
  } else if (hasNumericTabIndex) {
    isFocusable = true;
  }

  const isTabbable = isFocusable && (tabIndexValue === null || tabIndexValue >= 0);
  return { isFocusable, isTabbable, tabIndexValue };
}

/**
 * Fast block-level check: checks tag name Set in O(1) first before touching computed styles.
 */
export function isBlockLevel(
  el: Element,
  getStyle: (el: Element) => CSSStyleDeclaration
): boolean {
  if (BLOCK_TAG_NAMES.has(el.tagName.toLowerCase())) {
    return true;
  }
  const style = getStyle(el);
  return (
    style.display === 'block' ||
    style.display === 'flex' ||
    style.display === 'grid' ||
    style.display === 'table' ||
    style.display === 'list-item'
  );
}

/**
 * Checks whether an element or any of its ancestors up to body has aria-hidden="true".
 */
export function isAriaHiddenInTree(el: Element): boolean {
  const doc = el.ownerDocument || document;
  let curr: Element | null = el;
  while (curr && curr !== doc.body && curr !== doc.documentElement) {
    if (curr.getAttribute('aria-hidden') === 'true') {
      return true;
    }
    curr = curr.parentElement;
  }
  return false;
}

/**
 * Checks whether an iframe's contentDocument is accessible under Same-Origin Policy.
 */
export function canStepIntoIframe(iframe: HTMLIFrameElement): boolean {
  try {
    return Boolean(iframe.contentDocument && iframe.contentDocument.body);
  } catch {
    return false;
  }
}

/**
 * Generates a concise, human-readable and unique CSS selector for defect reporting and localStorage keys.
 */
export function getElementSelector(el: Element): string {
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }
  const doc = el.ownerDocument || document;
  const parts: string[] = [];
  let curr: Element | null = el;
  while (curr && curr !== doc.body && curr !== doc.documentElement) {
    let part = curr.tagName.toLowerCase();
    if (curr.id) {
      parts.unshift(`#${CSS.escape(curr.id)}`);
      break;
    }
    const nameAttr = curr.getAttribute('name');
    if (nameAttr) {
      part += `[name="${CSS.escape(nameAttr)}"]`;
    } else if (curr.parentElement) {
      const siblings = Array.from(curr.parentElement.children).filter(
        (s) => s.tagName === curr!.tagName
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(curr) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(part);
    curr = curr.parentElement;
  }
  return parts.join(' > ');
}

/**
 * Formats an element's tag and type/role into a readable descriptor like `input[type="text"]`.
 */
export function formatTagName(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return `input[type="${type}"]`;
  }
  return tag;
}
