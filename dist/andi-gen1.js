/*! ANDI-Gen1 v31.4.0 (2026-11-10) — Zero-Dependency TypeScript Rewrite (SSA ANDI) */
(function() {
  'use strict';

  // === Module: src\csp-guard.ts ===
/**
 * ANDI-Gen1 — Built-in Content Security Policy (CSP) Detector & Resolver
 * Detects <meta http-equiv="Content-Security-Policy"> rules and runtime
 * SecurityPolicyViolationEvents, applies Constructable Stylesheets to bypass
 * inline style-src blocks, and can neutralize restrictive meta CSPs on demand.
 */


class CspGuard {
  violations = [];
  adoptedStyleSheetsActive = false;
  metaResolved = false;

  constructor() {
    this.boundViolationHandler = this.handleViolation.bind(this);
  }

  attach(doc = document) {
    doc.addEventListener('securitypolicyviolation', this.boundViolationHandler);
  }

  detach(doc = document) {
    doc.removeEventListener('securitypolicyviolation', this.boundViolationHandler);
    this.restoreMetaCsp(doc);
  }

  handleViolation(e) {
    this.violations.push({
      violatedDirective: e.violatedDirective || e.effectiveDirective || 'unknown-directive',
      blockedURI: e.blockedURI || 'inline',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Applies CSS to a ShadowRoot or Document using Constructable Stylesheets first
   * (which bypasses CSP `style-src` inline <style> restrictions), with fallback to <style>.
   */
  applySafeStyles(
    target,
    cssText,
    fallbackId
  ) {
    try {
      if ('adoptedStyleSheets' in target && typeof CSSStyleSheet !== 'undefined') {
        const sheet = new CSSStyleSheet();
        if (typeof sheet.replaceSync === 'function') {
          sheet.replaceSync(cssText);
          target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
          this.adoptedStyleSheetsActive = true;
          return;
        }
      }
    } catch {
      // Fallback to <style> element below
    }

    const doc = target instanceof Document ? target : target.ownerDocument;
    const styleEl = doc.createElement('style');
    if (fallbackId) {
      styleEl.id = fallbackId;
    }
    styleEl.textContent = cssText;
    if (target instanceof Document) {
      target.head.appendChild(styleEl);
    } else {
      target.appendChild(styleEl);
    }
  }

  /**
   * Inspects the document for <meta http-equiv="Content-Security-Policy"> tags
   * and returns the current CSP status & resolution report.
   */
  getReport(doc = document) {
    const metaTags = Array.from(
      doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i], meta[data-andi-orig-csp]')
    );
    const metaPolicies = metaTags.map(
      (m) => m.getAttribute('content') || m.getAttribute('data-andi-orig-csp') || '(empty)'
    );

    return {
      metaTagCount: metaTags.length,
      metaPolicies,
      adoptedStyleSheetsActive: this.adoptedStyleSheetsActive,
      metaResolved: this.metaResolved,
      violations: [...this.violations]
    };
  }

  /**
   * Neutralizes restrictive <meta http-equiv="Content-Security-Policy"> tags in the
   * active document (storing original policies in `data-andi-orig-csp`) so screenshots,
   * data URLs, and dynamic inspection run without meta-CSP blocks.
   */
  resolveMetaCsp(doc = document) {
    const metaTags = Array.from(
      doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]')
    );
    let count = 0;
    for (const meta of metaTags) {
      const orig = meta.getAttribute('content') || '';
      meta.setAttribute('data-andi-orig-csp', orig);
      meta.removeAttribute('http-equiv');
      meta.removeAttribute('content');
      count += 1;
    }
    this.metaResolved = true;
    return count;
  }

  /**
   * Restores any neutralized <meta http-equiv="Content-Security-Policy"> tags.
   */
  restoreMetaCsp(doc = document) {
    const restored = Array.from(doc.querySelectorAll('meta[data-andi-orig-csp]'));
    for (const meta of restored) {
      const orig = meta.getAttribute('data-andi-orig-csp') || '';
      meta.setAttribute('http-equiv', 'Content-Security-Policy');
      meta.setAttribute('content', orig);
      meta.removeAttribute('data-andi-orig-csp');
    }
    this.metaResolved = false;
  }
}

  // === Module: src\dom-index.ts ===
/**
 * ANDI-Gen1 — High-Performance DOM Indexer & Iframe Context Support
 * Supports indexing the top-level document OR any stepped-into <iframe> document
 * with a single-pass TreeWalker, WeakMap style cache, and O(1) Map/Set lookups.
 */


const ANDI_HOST_ID = 'andi-gen1-host';
const ANDI_LASER_ID = 'andi-gen1-laser-svg';

const VALID_ARIA_ROLES = new Set([
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

const BLOCK_TAG_NAMES = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'div',
  'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'header', 'legend', 'li', 'main', 'nav', 'ol',
  'output', 'p', 'pre', 'section', 'table', 'td', 'tfoot', 'th', 'tr', 'ul'
]);

const NATIVELY_FOCUSABLE_TAGS = new Set([
  'input', 'select', 'textarea', 'button', 'iframe', 'summary'
]);

/**
 * Builds a single-pass index of the target document or iframe body while skipping ANDI's UI.
 */
function buildPageIndex(root = document.body) {
  const doc = root.ownerDocument || document;
  const win = doc.defaultView || window;
  const allElements = [];
  const visibleElements = [];
  const iframes = [];
  const idMap = new Map();
  const labelForMap = new Map();
  const styleCache = new WeakMap();

  const getStyle = (el) => {
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
      acceptNode(node) {
        const el = node;
        if (el.id === ANDI_HOST_ID || el.id === ANDI_LASER_ID) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let current = walker.nextNode();
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
        iframes.push(current);
      }

      if (current.tagName === 'LABEL') {
        const labelEl = current;
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

    current = walker.nextNode();
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
function isElementVisible(
  el,
  getStyle
) {
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
function getValidRole(el) {
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
function getFocusability(el) {
  const tag = el.tagName.toLowerCase();
  const rawTabIndex = el.getAttribute('tabindex');
  let tabIndexValue = null;
  let hasNumericTabIndex = false;

  if (rawTabIndex !== null && rawTabIndex.trim() !== '') {
    const parsed = Number(rawTabIndex.trim());
    if (!Number.isNaN(parsed)) {
      tabIndexValue = parsed;
      hasNumericTabIndex = true;
    }
  }

  const isDisabled = (el).disabled === true;
  if (isDisabled) {
    return { isFocusable: false, isTabbable: false, tabIndexValue };
  }

  if (tag === 'input' && (el).type.toLowerCase() === 'hidden') {
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
function isBlockLevel(
  el,
  getStyle
) {
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
function isAriaHiddenInTree(el) {
  const doc = el.ownerDocument || document;
  let curr = el;
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
function canStepIntoIframe(iframe) {
  try {
    return Boolean(iframe.contentDocument && iframe.contentDocument.body);
  } catch {
    return false;
  }
}

/**
 * Generates a concise, human-readable and unique CSS selector for defect reporting and localStorage keys.
 */
function getElementSelector(el) {
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }
  const doc = el.ownerDocument || document;
  const parts = [];
  let curr = el;
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
        (s) => s.tagName === curr.tagName
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
function formatTagName(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return `input[type="${type}"]`;
  }
  return tag;
}

/**
 * Extracts a clean, representative HTML DOM node snippet of the inspected element
 * (excluding internal data-andi-* instrumentation attributes) for display in the Screen Reader Output
 * and Element Inventory drawer.
 */
function extractDomNodeSnippet(el) {
  const tag = el.tagName.toLowerCase();
  const attrParts = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    if (attr.name.startsWith('data-andi-')) {
      continue;
    }
    const val = attr.value.replace(/\s+/g, ' ').trim();
    const truncatedVal = val.length > 70 ? `${val.slice(0, 67)}...` : val;
    if (truncatedVal === '') {
      attrParts.push(attr.name);
    } else {
      attrParts.push(`${attr.name}="${truncatedVal}"`);
    }
  }
  const openTag = attrParts.length > 0 ? `<${tag} ${attrParts.join(' ')}>` : `<${tag}>`;
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  if (voidTags.has(tag)) {
    return openTag;
  }
  const rawText = (el.textContent || '').replace(/\s+/g, ' ').trim();
  const childElemCount = el.children.length;
  if (!rawText && childElemCount === 0) {
    return `${openTag}</${tag}>`;
  }
  const previewText = rawText.length > 48 ? `${rawText.slice(0, 45)}...` : rawText;
  if (childElemCount > 0 && !previewText) {
    return `${openTag}… (${childElemCount} child node${childElemCount === 1 ? '' : 's'})</${tag}>`;
  }
  return `${openTag}${previewText}</${tag}>`;
}

  // === Module: src\acc-name.ts ===
/**
 * ANDI-Gen1 — W3C Accessible Name, Description, IDREF & Semantic Association Engine
 * Implements the Accessible Name and Description Computation 1.2 specification
 * with O(1) label/ID resolution, interactive IDREF target extraction, and semantic
 * association computation across native HTML and ARIA roles (e.g. role="table", role="grid",
 * role="row", role="columnheader", role="rowheader", role="cell", role="gridcell").
 */


const NAME_FROM_CONTENT_ROLES = new Set([
  'button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link',
  'listitem', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'row',
  'rowgroup', 'rowheader', 'switch', 'tab', 'term', 'tooltip', 'tree', 'treeitem'
]);

const NAME_FROM_CONTENT_TAGS = new Set([
  'a', 'button', 'caption', 'dd', 'dt', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'label', 'legend', 'li', 'option', 'summary', 'td', 'th'
]);

const LABELABLE_TAGS = new Set([
  'input', 'select', 'textarea', 'meter', 'output', 'progress'
]);

const LABELABLE_ROLES = new Set([
  'textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'slider', 'spinbutton', 'switch'
]);


function computeAccessibleData(
  el,
  pageIndex
) {
  const components = {};
  const missingLabelledbyIds = [];
  const missingDescribedbyIds = [];
  const idRefGroups = [];
  const tag = el.tagName.toLowerCase();
  const role = getValidRole(el);
  const semanticRole = role || getImplicitRoleLabel(el);

  // 1. Gather raw accessible components & IDREF resolution groups on the element
  const ariaLabelledby = el.getAttribute('aria-labelledby');
  if (ariaLabelledby !== null) {
    const group = buildIdRefGroup('aria-labelledby', ariaLabelledby, pageIndex, missingLabelledbyIds);
    idRefGroups.push(group);
    const resolved = group.items
      .filter((item) => item.exists && item.text)
      .map((item) => item.text)
      .join(' ');
    components.ariaLabelledby = resolved || '"" (empty/unresolved)';
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel !== null) {
    components.ariaLabel = ariaLabel.trim() || '""';
  }

  const ariaDescribedby = el.getAttribute('aria-describedby');
  if (ariaDescribedby !== null) {
    const group = buildIdRefGroup('aria-describedby', ariaDescribedby, pageIndex, missingDescribedbyIds);
    idRefGroups.push(group);
    const resolved = group.items
      .filter((item) => item.exists && item.text)
      .map((item) => item.text)
      .join(' ');
    components.ariaDescribedby = resolved || '"" (empty/unresolved)';
  }

  const ariaDescription = el.getAttribute('aria-description');
  if (ariaDescription !== null) {
    components.ariaDescription = ariaDescription.trim() || '""';
  }

  // Additional IDREF attributes (headers, aria-errormessage, aria-controls, aria-details)
  for (const extraAttr of ['headers', 'aria-errormessage', 'aria-controls', 'aria-details']) {
    const rawVal = el.getAttribute(extraAttr);
    if (rawVal !== null && rawVal.trim() !== '') {
      const group = buildIdRefGroup(extraAttr, rawVal, pageIndex, []);
      idRefGroups.push(group);
    }
  }

  // Native <label> (explicit via for="" in O(1) or implicit ancestor <label>)
  if (LABELABLE_TAGS.has(tag) || LABELABLE_ROLES.has(role)) {
    const labelText = resolveNativeLabel(el, pageIndex, idRefGroups);
    if (labelText !== null) {
      components.nativeLabel = labelText.trim() || '""';
    }
  }

  // Native alt attribute
  const altAttr = el.getAttribute('alt');
  if (altAttr !== null) {
    components.alt = altAttr === '' ? '""' : altAttr.trim();
  }

  // Input value for button-like inputs
  if (tag === 'input') {
    const inputType = (el.getAttribute('type') || 'text').toLowerCase();
    if (['button', 'submit', 'reset', 'image'].includes(inputType)) {
      const val = el.getAttribute('value');
      if (val !== null && val.trim() !== '') {
        components.value = val.trim();
      } else if (inputType === 'submit') {
        components.value = 'Submit (default)';
      } else if (inputType === 'reset') {
        components.value = 'Reset (default)';
      }
    }
  }

  // Table <caption> / [role="caption"], Fieldset <legend>, Figure <figcaption>
  if (tag === 'table' || role === 'table' || role === 'grid' || role === 'treegrid') {
    const caption = el.querySelector(':scope > caption, :scope > [role="caption"]');
    if (caption) {
      components.caption = extractVisibleText(caption, pageIndex).trim();
    }
  } else if (tag === 'fieldset' || role === 'group' || role === 'radiogroup') {
    const legend = el.querySelector(':scope > legend');
    if (legend) {
      components.legend = extractVisibleText(legend, pageIndex).trim();
    }
  } else if (tag === 'figure' || role === 'figure') {
    const figcaption = el.querySelector(':scope > figcaption');
    if (figcaption) {
      components.figcaption = extractVisibleText(figcaption, pageIndex).trim();
    }
  }

  // CSS ::before and ::after pseudo content
  const beforeText = getPseudoElementText(el, '::before');
  if (beforeText) {
    components.pseudoBefore = beforeText;
  }
  const afterText = getPseudoElementText(el, '::after');
  if (afterText) {
    components.pseudoAfter = afterText;
  }

  // Inner text for name-from-content elements (both native tags and semantic ARIA roles)
  if (NAME_FROM_CONTENT_ROLES.has(role) || NAME_FROM_CONTENT_TAGS.has(tag)) {
    const inner = extractVisibleText(el, pageIndex).trim();
    if (inner) {
      components.innerText = inner;
    }
  }

  // Title & Placeholder
  const titleAttr = el.getAttribute('title');
  if (titleAttr !== null) {
    components.title = titleAttr.trim() || '""';
  }
  const placeholderAttr = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder');
  if (placeholderAttr !== null) {
    components.placeholder = placeholderAttr.trim() || '""';
  }

  // 2. Compute Primary Accessible Name according to W3C precedence
  let accName = '';
  let usedTitleForName = false;

  if (ariaLabelledby !== null && components.ariaLabelledby && components.ariaLabelledby !== '"" (empty/unresolved)') {
    accName = components.ariaLabelledby;
  } else if (ariaLabel !== null && ariaLabel.trim() !== '') {
    accName = ariaLabel.trim();
  } else if (components.nativeLabel && components.nativeLabel !== '""') {
    accName = components.nativeLabel;
  } else if (
    (tag === 'img' || tag === 'area' || role === 'img' || (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'image')) &&
    altAttr !== null &&
    altAttr.trim() !== ''
  ) {
    accName = altAttr.trim();
  } else if (components.value) {
    accName = components.value.replace(/ \(default\)$/, '');
  } else if (components.caption) {
    accName = components.caption;
  } else if (components.legend) {
    accName = components.legend;
  } else if (components.figcaption) {
    accName = components.figcaption;
  } else if (components.innerText) {
    accName = [components.pseudoBefore, components.innerText, components.pseudoAfter]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  } else if (titleAttr !== null && titleAttr.trim() !== '') {
    accName = titleAttr.trim();
    usedTitleForName = true;
  } else if (placeholderAttr !== null && placeholderAttr.trim() !== '') {
    accName = placeholderAttr.trim();
  }

  // 3. Compute Accessible Description
  let accDesc = '';
  if (ariaDescribedby !== null && components.ariaDescribedby && components.ariaDescribedby !== '"" (empty/unresolved)') {
    accDesc = components.ariaDescribedby;
  } else if (ariaDescription !== null && ariaDescription.trim() !== '') {
    accDesc = ariaDescription.trim();
  } else if (!usedTitleForName && titleAttr !== null && titleAttr.trim() !== '' && titleAttr.trim() !== accName) {
    accDesc = titleAttr.trim();
  }

  // 4. Compute Grouping Context (<fieldset><legend> or role="group"/"radiogroup")
  let accGroup = '';
  if (tag !== 'fieldset' && role !== 'group' && role !== 'radiogroup') {
    const closestGroup = el.closest('fieldset, [role="radiogroup"], [role="group"]');
    if (closestGroup) {
      if (closestGroup.tagName.toLowerCase() === 'fieldset') {
        const legend = closestGroup.querySelector(':scope > legend');
        if (legend) {
          accGroup = extractVisibleText(legend, pageIndex).trim();
        }
      } else {
        const groupLabelledby = closestGroup.getAttribute('aria-labelledby');
        const groupLabel = closestGroup.getAttribute('aria-label');
        if (groupLabelledby) {
          accGroup = resolveIdReferences(groupLabelledby, pageIndex, []);
        } else if (groupLabel) {
          accGroup = groupLabel.trim();
        } else {
          const groupLegend = closestGroup.querySelector(':scope > legend');
          if (groupLegend) {
            accGroup = extractVisibleText(groupLegend, pageIndex).trim();
          }
        }
      }
    }
  }

  // 5. Semantic Table / Grid Association Computation (native <table> AND role="table"|"grid"|"treegrid")
  const tableAssociation = computeTableSemanticAssociation(el, tag, role, pageIndex);
  if (tableAssociation) {
    if (tableAssociation.columnHeaders.length > 0) {
      components.tableColumnHeaders = tableAssociation.columnHeaders.join(' | ');
    }
    if (tableAssociation.rowHeaders.length > 0) {
      components.tableRowHeaders = tableAssociation.rowHeaders.join(' | ');
    }
    const tableTitle = tableAssociation.tableName ? `"${tableAssociation.tableName}"` : `<${tableAssociation.tableRole}>`;
    if (tableAssociation.rowIndex !== null && tableAssociation.colIndex !== null) {
      components.tableContext = `${tableTitle} (Row ${tableAssociation.rowIndex} of ${tableAssociation.rowCount}, Col ${tableAssociation.colIndex} of ${tableAssociation.colCount})`;
    } else {
      components.tableContext = `${tableTitle} (${tableAssociation.rowCount} rows × ${tableAssociation.colCount} cols)`;
    }
  }

  // 6. Add-on Properties & States (including semantic ARIA states & list item context)
  const addOnProps = collectAddOnProperties(el, role, pageIndex);
  const stateOutput = Object.values(addOnProps).filter(Boolean).join(', ');

  // 7. Synthesize Screen Reader Output Preview
  const outputParts = [];
  if (accGroup) {
    outputParts.push(`[Group: ${accGroup}]`);
  }
  if (tableAssociation && (tableAssociation.columnHeaders.length > 0 || tableAssociation.rowHeaders.length > 0)) {
    const hdrParts = [];
    if (tableAssociation.columnHeaders.length > 0) {
      hdrParts.push(`Col: ${tableAssociation.columnHeaders.join(', ')}`);
    }
    if (tableAssociation.rowHeaders.length > 0) {
      hdrParts.push(`Row: ${tableAssociation.rowHeaders.join(', ')}`);
    }
    outputParts.push(`[${hdrParts.join(' | ')}]`);
  }
  if (accName) {
    outputParts.push(accName);
  }
  if (accDesc && accDesc !== accName) {
    outputParts.push(accDesc);
  }
  if (semanticRole) {
    outputParts.push(`(${semanticRole})`);
  }
  if (stateOutput) {
    outputParts.push(stateOutput);
  }

  return {
    accName,
    accDesc,
    accGroup,
    semanticRole,
    screenReaderOutput: outputParts.join(' '),
    components,
    addOnProps,
    missingLabelledbyIds,
    missingDescribedbyIds,
    idRefGroups,
    tableAssociation
  };
}

/**
 * Builds a structured IDREF resolution group for attributes such as
 * `aria-labelledby`, `aria-describedby`, `headers`, `aria-errormessage`, `aria-controls`, etc.
 */
function buildIdRefGroup(
  attribute,
  rawValue,
  pageIndex,
  missingIdsOut
) {
  const ids = rawValue.trim().split(/\s+/).filter(Boolean);
  const items = [];
  const seen = new Set();

  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const matches = pageIndex.idMap.get(id);
    if (!matches || matches.length === 0) {
      missingIdsOut.push(id);
      items.push({
        id,
        attribute,
        text: '',
        exists: false,
        targetSelector: null,
        targetTag: null,
        targetElement: null
      });
      continue;
    }
    const target = matches[0];
    const targetLabel = target.getAttribute('aria-label')?.trim();
    const text = targetLabel || (target.textContent || '').replace(/\s+/g, ' ').trim();
    items.push({
      id,
      attribute,
      text,
      exists: true,
      targetSelector: getElementSelector(target),
      targetTag: formatTagName(target),
      targetElement: target
    });
  }

  return {
    attribute,
    rawValue: rawValue.trim(),
    items
  };
}

function resolveIdReferences(
  idListStr,
  pageIndex,
  missingIdsOut
) {
  const group = buildIdRefGroup('idref', idListStr, pageIndex, missingIdsOut);
  return group.items
    .filter((item) => item.exists && item.text)
    .map((item) => item.text)
    .join(' ');
}

function resolveNativeLabel(
  el,
  pageIndex,
  idRefGroupsOut
) {
  const parts = [];

  // 1. Explicit <label for="id"> via O(1) Map lookup
  if (el.id) {
    const labels = pageIndex.labelForMap.get(el.id);
    if (labels && labels.length > 0) {
      const labelItems = [];
      for (const lbl of labels) {
        const txt = extractVisibleText(lbl, pageIndex, el).trim();
        if (txt) {
          parts.push(txt);
        }
        labelItems.push({
          id: el.id,
          attribute: 'label[for]',
          text: txt,
          exists: true,
          targetSelector: getElementSelector(lbl),
          targetTag: formatTagName(lbl),
          targetElement: lbl
        });
      }
      if (labelItems.length > 0) {
        idRefGroupsOut.push({
          attribute: 'label[for]',
          rawValue: el.id,
          items: labelItems
        });
      }
    }
  }

  // 2. Implicit ancestor <label>
  const parentLabel = el.closest('label');
  if (parentLabel) {
    const forAttr = parentLabel.getAttribute('for');
    if (!forAttr || forAttr === el.id) {
      const txt = extractVisibleText(parentLabel, pageIndex, el).trim();
      if (txt && !parts.includes(txt)) {
        parts.push(txt);
      }
    }
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Semantic Table / Grid Association Engine (Requirement #2):
 * Detects table semantics and computes header-to-cell associations when either native
 * `<table>`/`<tr>`/`<th>`/`<td>` tags OR ARIA `role="table"`/`role="grid"`/`role="treegrid"`,
 * `role="row"`, `role="columnheader"`, `role="rowheader"`, `role="cell"`, `role="gridcell"`
 * attributes are used.
 */
function computeTableSemanticAssociation(
  el,
  tag,
  role,
  pageIndex
) {
  const isTableContainer =
    (tag === 'table' && role !== 'presentation' && role !== 'none') ||
    role === 'table' ||
    role === 'grid' ||
    role === 'treegrid';

  const isCellOrHeader =
    tag === 'td' ||
    tag === 'th' ||
    role === 'cell' ||
    role === 'gridcell' ||
    role === 'columnheader' ||
    role === 'rowheader';

  if (!isTableContainer && !isCellOrHeader) {
    return null;
  }

  const tableEl = isTableContainer
    ? el
    : (el.closest('table, [role="table"], [role="grid"], [role="treegrid"]'));

  if (!tableEl) {
    return null;
  }

  const tableExplicitRole = getValidRole(tableEl);
  if (tableExplicitRole === 'presentation' || tableExplicitRole === 'none') {
    return null;
  }

  const tableRole = tableExplicitRole === 'grid'
      ? 'grid'
      : tableExplicitRole === 'treegrid'
        ? 'treegrid'
        : 'table';

  // Resolve table accessible name (aria-labelledby, aria-label, caption, [role="caption"])
  let tableName = '';
  const tLby = tableEl.getAttribute('aria-labelledby');
  const tLbl = tableEl.getAttribute('aria-label');
  const tCaption = tableEl.querySelector(':scope > caption, :scope > [role="caption"]');
  if (tLby) {
    tableName = resolveIdReferences(tLby, pageIndex, []);
  } else if (tLbl) {
    tableName = tLbl.trim();
  } else if (tCaption) {
    tableName = extractVisibleText(tCaption, pageIndex).trim();
  }

  // Gather semantic rows belonging directly to this table/grid
  const allRows = Array.from(tableEl.querySelectorAll('tr, [role="row"]')).filter(
    (r) => r.closest('table, [role="table"], [role="grid"], [role="treegrid"]') === tableEl
  );

  const rowMatrix = [];
  for (const r of allRows) {
    const cells = Array.from(
      r.querySelectorAll('th, td, [role="columnheader"], [role="rowheader"], [role="cell"], [role="gridcell"]')
    ).filter((c) => c.closest('tr, [role="row"]') === r);
    if (cells.length > 0) {
      rowMatrix.push(cells);
    }
  }

  const rowCount = Number(tableEl.getAttribute('aria-rowcount')) || rowMatrix.length;
  const maxCols = rowMatrix.reduce((max, r) => Math.max(max, r.length), 0);
  const colCount = Number(tableEl.getAttribute('aria-colcount')) || maxCols;

  const isColHeaderCell = (cell) => {
    const cRole = getValidRole(cell);
    const cTag = cell.tagName.toLowerCase();
    const scope = (cell.getAttribute('scope') || '').toLowerCase();
    if (cRole === 'columnheader') return true;
    if (cRole === 'rowheader' || cRole === 'cell' || cRole === 'gridcell') return false;
    if (cTag === 'th') {
      return scope !== 'row' && scope !== 'rowgroup';
    }
    return false;
  };

  const isRowHeaderCell = (cell) => {
    const cRole = getValidRole(cell);
    const cTag = cell.tagName.toLowerCase();
    const scope = (cell.getAttribute('scope') || '').toLowerCase();
    if (cRole === 'rowheader') return true;
    if (cRole === 'columnheader') return false;
    if (cTag === 'th' && (scope === 'row' || scope === 'rowgroup')) return true;
    return false;
  };

  // If inspecting the table container itself, summarize all column & row headers in the table
  if (isTableContainer) {
    const colHeaderTexts = [];
    const rowHeaderTexts = [];
    for (const row of rowMatrix) {
      for (const cell of row) {
        const txt = extractCellHeaderText(cell, pageIndex);
        if (!txt) continue;
        if (isColHeaderCell(cell) && !colHeaderTexts.includes(txt)) {
          colHeaderTexts.push(txt);
        } else if (isRowHeaderCell(cell) && !rowHeaderTexts.includes(txt)) {
          rowHeaderTexts.push(txt);
        }
      }
    }
    return {
      tableRole,
      tableName,
      columnHeaders: colHeaderTexts,
      rowHeaders: rowHeaderTexts,
      rowIndex: null,
      colIndex: null,
      rowCount,
      colCount
    };
  }

  // Otherwise, inspecting a specific cell or header cell: find its row & column coordinates
  let targetRowIdx = -1;
  let targetColIdx = -1;
  for (let rIdx = 0; rIdx < rowMatrix.length; rIdx++) {
    const cIdx = rowMatrix[rIdx].indexOf(el);
    if (cIdx !== -1) {
      targetRowIdx = rIdx;
      targetColIdx = cIdx;
      break;
    }
  }

  const columnHeaders = [];
  const rowHeaders = [];

  // 1. Check explicit `headers="id1 id2"` attribute first
  const explicitHeadersAttr = el.getAttribute('headers');
  if (explicitHeadersAttr && explicitHeadersAttr.trim()) {
    const ids = explicitHeadersAttr.trim().split(/\s+/).filter(Boolean);
    for (const id of ids) {
      const matches = pageIndex.idMap.get(id);
      if (matches && matches.length > 0) {
        const hdrEl = matches[0];
        const txt = extractCellHeaderText(hdrEl, pageIndex);
        if (txt) {
          if (isRowHeaderCell(hdrEl)) {
            rowHeaders.push(txt);
          } else {
            columnHeaders.push(txt);
          }
        }
      }
    }
  }

  // 2. Positional column header resolution (works for both <th> and [role="columnheader"])
  if (columnHeaders.length === 0 && targetColIdx !== -1) {
    const explicitColIndex = el.getAttribute('aria-colindex');
    for (let rIdx = 0; rIdx < rowMatrix.length; rIdx++) {
      if (rIdx === targetRowIdx) continue;
      const row = rowMatrix[rIdx];
      let matchedHeader = null;
      if (explicitColIndex) {
        matchedHeader =
          row.find((c) => c.getAttribute('aria-colindex') === explicitColIndex && isColHeaderCell(c)) || null;
      }
      if (!matchedHeader && targetColIdx < row.length) {
        const candidate = row[targetColIdx];
        if (candidate && isColHeaderCell(candidate)) {
          matchedHeader = candidate;
        }
      }
      if (matchedHeader && matchedHeader !== el) {
        const txt = extractCellHeaderText(matchedHeader, pageIndex);
        if (txt && !columnHeaders.includes(txt)) {
          columnHeaders.push(txt);
        }
      }
    }
  }

  // 3. Positional row header resolution (works for <th scope="row"> and [role="rowheader"])
  if (rowHeaders.length === 0 && targetRowIdx !== -1) {
    const currentRow = rowMatrix[targetRowIdx];
    for (let cIdx = 0; cIdx < currentRow.length; cIdx++) {
      const candidate = currentRow[cIdx];
      if (candidate === el) continue;
      const isFirstColTh =
        cIdx === 0 &&
        candidate.tagName.toLowerCase() === 'th' &&
        (candidate.getAttribute('scope') || '').toLowerCase() !== 'col' &&
        !currentRow.every((cell) => isColHeaderCell(cell));
      if (isRowHeaderCell(candidate) || isFirstColTh) {
        const txt = extractCellHeaderText(candidate, pageIndex);
        if (txt && !rowHeaders.includes(txt)) {
          rowHeaders.push(txt);
        }
      }
    }
  }

  const ariaRowIdx = Number(el.getAttribute('aria-rowindex') || el.closest('[role="row"], tr')?.getAttribute('aria-rowindex'));
  const ariaColIdx = Number(el.getAttribute('aria-colindex'));

  return {
    tableRole,
    tableName,
    columnHeaders,
    rowHeaders,
    rowIndex: ariaRowIdx || (targetRowIdx !== -1 ? targetRowIdx + 1 : null),
    colIndex: ariaColIdx || (targetColIdx !== -1 ? targetColIdx + 1 : null),
    rowCount,
    colCount
  };
}

function extractCellHeaderText(cell, pageIndex) {
  const ariaLbl = cell.getAttribute('aria-label')?.trim();
  if (ariaLbl) return ariaLbl;
  const ariaLby = cell.getAttribute('aria-labelledby');
  if (ariaLby) {
    const resolved = resolveIdReferences(ariaLby, pageIndex, []);
    if (resolved) return resolved;
  }
  return extractVisibleText(cell, pageIndex).trim();
}

/**
 * Extracts visible text from an element subtree while skipping hidden children
 * and avoiding the root control itself when computing an enclosing <label>.
 */
function extractVisibleText(
  root,
  pageIndex,
  excludeElement
) {
  const chunks = [];

  const visit = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const val = node.nodeValue?.replace(/\s+/g, ' ');
      if (val) {
        chunks.push(val);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    const el = node;
    if (el === excludeElement) {
      return;
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript') {
      return;
    }
    if (el.getAttribute('aria-hidden') === 'true' || !isElementVisible(el, pageIndex.getStyle)) {
      return;
    }
    if (tag === 'img' || tag === 'area' || getValidRole(el) === 'img') {
      const alt = el.getAttribute('alt') || el.getAttribute('aria-label');
      if (alt) {
        chunks.push(` ${alt.trim()} `);
      }
      return;
    }

    for (let i = 0; i < el.childNodes.length; i++) {
      visit(el.childNodes[i]);
    }

    if (isBlockLevel(el, pageIndex.getStyle)) {
      chunks.push(' ');
    }
  };

  visit(root);
  return chunks.join('').replace(/\s+/g, ' ').trim();
}

/**
 * Queries `window.getComputedStyle(el, pseudo)` only once per pseudo-element.
 */
function getPseudoElementText(el, pseudo) {
  const style = window.getComputedStyle(el, pseudo);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return '';
  }
  const raw = style.content;
  if (!raw || raw === 'none' || raw === 'normal' || raw === '""' || raw === "''") {
    return '';
  }
  if (/^(url|counter|counters|linear-gradient)\(/i.test(raw)) {
    return '';
  }
  return raw.replace(/^["']|["']$/g, '').trim();
}

function collectAddOnProperties(
  el,
  role,
  pageIndex
) {
  const props = {};
  const tag = el.tagName.toLowerCase();

  if (el.hasAttribute('required') || el.getAttribute('aria-required') === 'true') {
    props['required'] = 'required';
  }
  if (el.getAttribute('aria-invalid') === 'true') {
    props['aria-invalid'] = 'invalid entry';
  }
  if (el.hasAttribute('readonly') || el.getAttribute('aria-readonly') === 'true') {
    props['readonly'] = 'read-only';
  }
  if ((el).disabled || el.getAttribute('aria-disabled') === 'true') {
    props['disabled'] = 'unavailable';
  }
  const ariaExpanded = el.getAttribute('aria-expanded');
  if (ariaExpanded === 'true' || ariaExpanded === 'false') {
    props['aria-expanded'] = ariaExpanded === 'true' ? 'expanded' : 'collapsed';
  }
  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked) {
    props['aria-checked'] =
      ariaChecked === 'true' ? 'checked' : ariaChecked === 'mixed' ? 'partially checked' : 'not checked';
  } else if (tag === 'input') {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      props['checked'] = (el).checked ? 'checked' : 'not checked';
    }
  }
  const ariaPressed = el.getAttribute('aria-pressed');
  if (ariaPressed === 'true' || ariaPressed === 'false' || ariaPressed === 'mixed') {
    props['aria-pressed'] =
      ariaPressed === 'true' ? 'pressed' : ariaPressed === 'mixed' ? 'partially pressed' : 'not pressed';
  }
  const ariaSelected = el.getAttribute('aria-selected');
  if (ariaSelected === 'true' || ariaSelected === 'false') {
    props['aria-selected'] = ariaSelected === 'true' ? 'selected' : 'not selected';
  }
  const ariaCurrent = el.getAttribute('aria-current');
  if (ariaCurrent && ariaCurrent !== 'false') {
    props['aria-current'] = `current ${ariaCurrent}`;
  }
  if (role === 'heading' || /^h[1-6]$/.test(tag)) {
    const level = el.getAttribute('aria-level') || (tag.startsWith('h') ? tag.charAt(1) : '2');
    props['heading-level'] = `heading level ${level}`;
  }
  if (tag === 'li' || role === 'listitem') {
    const listContainer = el.closest('ul, ol, menu, [role="list"]');
    if (listContainer) {
      const items = Array.from(listContainer.querySelectorAll('li, [role="listitem"]')).filter(
        (item) => item.closest('ul, ol, menu, [role="list"]') === listContainer
      );
      const pos = items.indexOf(el);
      if (pos !== -1) {
        props['list-position'] = `${pos + 1} of ${items.length}`;
      }
    }
  }
  void pageIndex;
  return props;
}

function getImplicitRoleLabel(el) {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'a':
      return el.hasAttribute('href') ? 'link' : '';
    case 'button':
    case 'summary':
      return 'button';
    case 'select':
      return 'combobox';
    case 'textarea':
      return 'textbox';
    case 'img':
      return 'graphic';
    case 'svg':
      return 'graphic';
    case 'table':
      return 'table';
    case 'th': {
      const scope = (el.getAttribute('scope') || '').toLowerCase();
      return scope === 'row' || scope === 'rowgroup' ? 'rowheader' : 'columnheader';
    }
    case 'td':
      return 'cell';
    case 'tr':
      return 'row';
    case 'ul':
    case 'ol':
    case 'menu':
      return 'list';
    case 'li':
      return 'listitem';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'main':
      return 'main';
    case 'nav':
      return 'navigation';
    case 'aside':
      return 'complementary';
    case 'header':
      return 'banner';
    case 'footer':
      return 'contentinfo';
    case 'form':
      return 'form';
    case 'search':
      return 'search';
    case 'section':
      return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : '';
    case 'dialog':
      return 'dialog';
    case 'fieldset':
      return 'group';
    case 'figure':
      return 'figure';
    case 'iframe':
      return 'iframe';
    case 'input': {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio button';
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button';
      if (t === 'search') return 'searchbox';
      if (t === 'range') return 'slider';
      if (t === 'number') return 'spinbutton';
      return 'textbox';
    }
    default:
      return '';
  }
}

  // === Module: src\notes-report.ts ===
/**
 * ANDI-Gen1 — localStorage Fly-in Notes, DOM Node Screenshotter & Defect Report Engine
 * - Persists notes in `window.localStorage` with exact DOM coordinates, browser info, and timestamp
 * - Captures annotated high-contrast PNG screenshots of the DOM node with note, coordinates & browser metadata
 * - Generates Defect Reports for ANDI-detected defects (`rec.alerts.length > 0`) PLUS any tester notes (`rec.note !== null`)
 */


const ATTR_NOTE_TEXT = 'data-andi-note';
const ATTR_NOTE_SEVERITY = 'data-andi-note-severity';
const ATTR_NOTE_UPDATED = 'data-andi-note-updated';
const STORAGE_KEY_NOTES = 'ANDI_GEN1_NOTES_STORE_V1';

/**
 * Computes exact viewport and document/page coordinates for a DOM element.
 */
function getElementCoordinates(el) {
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
function getBrowserEnvironmentInfo() {
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

function getPageOriginPrefix() {
  return `${window.location.origin}${window.location.pathname}`;
}

function getStorageKeyForSelector(selector, frameContext = 'Top Document') {
  return `${getPageOriginPrefix()}::${frameContext}::${selector}`;
}

function loadNotesStore() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_NOTES);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveNotesStore(store) {
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
function readElementNote(
  el,
  selector,
  frameContext = 'Top Document'
) {
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
  const severity = rawSeverity === 'danger' || rawSeverity === 'warning' || rawSeverity === 'caution'
      ? rawSeverity
      : 'warning';
  const updatedAt = el.getAttribute(ATTR_NOTE_UPDATED) || new Date().toISOString();

  const note = {
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
function writeElementNote(
  el,
  selector,
  text,
  severity = 'warning',
  screenshotDataUrl,
  frameContext = 'Top Document'
) {
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

  const note = {
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
function clearElementNote(
  el,
  selector,
  frameContext = 'Top Document'
) {
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
function captureNodeScreenshotWithNote(
  el,
  selector,
  tagName,
  accName,
  noteText,
  severity,
  alerts
) {
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
    (el).value ||
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

function wrapCanvasText(text, maxCharsPerLine) {
  const words = text.split(/\s+/);
  const lines = [];
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
function downloadScreenshotPng(dataUrl, index, selector) {
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
function buildDefectReport(
  records,
  modeRun,
  frameContext = 'Top Document'
) {
  let totalAlerts = 0;
  let totalAlertedElements = 0;
  let totalNotesIncluded = 0;
  let totalScreenshotsIncluded = 0;
  const items = [];
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
function formatReportAsMarkdown(report) {
  const env = report.browserEnvironment;
  const lines = [
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
function formatReportAsHtml(report) {
  const esc = (s) =>
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
function formatReportAsCsv(report) {
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

  const escapeCsv = (val) => `"${val.replace(/"/g, '""')}"`;
  const rows = [headers.map(escapeCsv).join(',')];

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

function getSafeOuterHtmlSnippet(el) {
  const clone = el.cloneNode(false);
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

  // === Module: src\harness-runtime.ts ===
/**
 * ANDI-Gen1 — Test Harness Browser Runtime
 *
 * `harnessRuntime()` is NOT executed inside the inspected page. Its source is serialized
 * (`Function.prototype.toString`) into every generated test-harness `.html` file by
 * `buildTestHarnessHtml()` and runs there, standalone, with no dependency on the rest of ANDI-Gen1.
 *
 * It attaches the event handlers, widget state logic, dialogs and logging a tester needs to
 * exercise a copied DOM fragment locally. It is deliberately typed loosely (`any`) because it only
 * ever manipulates arbitrary third-party DOM.
 */

function harnessRuntime() {
  const metaNode = document.getElementById('hx-meta');
  let meta = {};
  try {
    meta = JSON.parse((metaNode && metaNode.textContent) || '{}');
  } catch (err) {
    meta = {};
  }

  const state = { dialog: null, trap: false, opener: null, simulateKeys: true };

  // ---------------------------------------------------------------------------
  // Harness chrome lives in a Shadow DOM so page CSS never leaks in and so that
  // ANDI-Gen1 (or any DOM walker) run on this file inspects only the copied fragment.
  // ---------------------------------------------------------------------------
  const host = document.createElement('div');
  host.id = 'andi-harness-chrome';
  host.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = [
    '<style>',
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.panel{font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#020617;color:#fff;border-top:3px solid #7dd3fc;max-height:44vh;display:flex;flex-direction:column}',
    '.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #475569}',
    '.grow{flex:1}',
    'button{font:inherit;font-weight:700;background:#1e293b;color:#fff;border:1.5px solid #94a3b8;border-radius:6px;padding:3px 9px;cursor:pointer}',
    'button.primary{background:#1d4ed8;border-color:#93c5fd}',
    'button:focus-visible,input:focus-visible,summary:focus-visible{outline:2.5px solid #7dd3fc;outline-offset:1px}',
    'input[type=text]{font:inherit;background:#0f172a;color:#fff;border:1.5px solid #94a3b8;border-radius:6px;padding:3px 6px}',
    'code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#7dd3fc}',
    '.body{display:flex;flex-direction:column;min-height:0;overflow:hidden}',
    '.findings{padding:4px 10px;border-bottom:1px solid #475569;max-height:140px;overflow:auto}',
    '.findings div{margin:2px 0}',
    '.log{list-style:none;margin:0;padding:6px 10px;overflow:auto;flex:1;min-height:70px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}',
    '.log li{border-bottom:1px solid #1e293b;white-space:pre-wrap;word-break:break-word}',
    '.k-click{color:#7dd3fc}.k-key{color:#fde68a}.k-dialog{color:#f0abfc}.k-error{color:#fca5a5}.k-info{color:#86efac}.k-form{color:#fdba74}',
    '.overlay{position:fixed;pointer-events:none;border:3px dashed #f472b6;border-radius:4px;box-shadow:0 0 0 2px rgba(2,6,23,.6)}',
    '</style>',
    '<div class="overlay" id="overlay" hidden></div>',
    '<section class="panel" aria-label="ANDI-Gen1 test harness controls">',
    '<div class="row">',
    '<strong>🧪 ANDI-Gen1 Test Harness</strong><code id="sel"></code><span class="grow"></span>',
    '<label>ANDI script <input type="text" id="src" size="40"></label>',
    '<button class="primary" id="launch" type="button">▶ Launch ANDI-Gen1 on this harness</button>',
    '<button id="collapse" type="button" aria-expanded="true">▾ Collapse</button>',
    '</div>',
    '<div class="body" id="body">',
    '<details class="findings" open><summary>Findings captured from the source page</summary><div id="findings"></div></details>',
    '<div class="row">',
    '<label><input type="checkbox" id="keys" checked> Simulate keyboard activation (Enter / Space / arrows / Esc) on ARIA widgets</label>',
    '<label><input type="checkbox" id="hl" checked> Highlight inspected element</label>',
    '<span id="dialogs"></span><span id="lives"></span>',
    '<span class="grow"></span><button id="clear" type="button">Clear log</button>',
    '</div>',
    '<ul class="log" id="log" aria-label="Harness event log"></ul>',
    '</div>',
    '</section>'
  ].join('');

  const $ = (id) => shadow.getElementById(id);
  const logEl = $('log');
  const overlay = $('overlay');

  function log(kind, msg) {
    const li = document.createElement('li');
    li.className = 'k-' + kind;
    li.textContent = new Date().toLocaleTimeString() + '  ' + msg;
    logEl.appendChild(li);
    while (logEl.children.length > 300) {
      const first = logEl.firstElementChild;
      if (!first) break;
      logEl.removeChild(first);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  function describe(el) {
    if (!el || !el.tagName) return String(el);
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const role = el.getAttribute('role');
    if (role) s += '[role=' + role + ']';
    const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (name) s += ' "' + (name.length > 32 ? name.slice(0, 29) + '...' : name) + '"';
    return s;
  }

  // ---------------------------------------------------------------------------
  // Header, findings and controls
  // ---------------------------------------------------------------------------
  $('sel').textContent = meta.selector || '';
  const srcInput = $('src');
  srcInput.value = meta.andiScriptUrl || '';
  srcInput.placeholder = './dist/andi-gen1.js for a local build';

  const findings = $('findings');
  function addFinding(label, value) {
    if (!value) return;
    const row = document.createElement('div');
    const b = document.createElement('strong');
    b.textContent = label + ' ';
    row.appendChild(b);
    row.appendChild(document.createTextNode(value));
    findings.appendChild(row);
  }
  addFinding('ANDI mode:', meta.mode);
  addFinding('Source:', (meta.pageTitle || '') + ' — ' + (meta.sourceUrl || '') + ' (' + (meta.frameContext || '') + ')');
  addFinding('Captured:', (meta.generatedAtLocal || '') + ' · ' + (meta.browser || ''));
  addFinding('Screen reader output:', meta.screenReaderOutput);
  addFinding('Accessible name:', meta.accName);
  addFinding('Accessible description:', meta.accDesc);
  addFinding('Coordinates on source page:', meta.coordinates);
  const alertList = meta.alerts || [];
  if (alertList.length === 0) {
    addFinding('ANDI alerts:', 'none detected for this element');
  } else {
    alertList.forEach(function (a) {
      addFinding('[' + String(a.level).toUpperCase() + ' ' + a.module + 'ANDI]', a.message);
    });
  }

  $('keys').addEventListener('change', function (e) {
    state.simulateKeys = e.target.checked;
    log('info', 'Keyboard activation simulation ' + (state.simulateKeys ? 'ON' : 'OFF (native browser behavior only)'));
  });
  $('clear').addEventListener('click', function () {
    logEl.textContent = '';
  });
  $('collapse').addEventListener('click', function () {
    const body = $('body');
    const collapsed = body.hidden !== true;
    body.hidden = collapsed;
    $('collapse').setAttribute('aria-expanded', String(!collapsed));
    $('collapse').textContent = collapsed ? '▸ Expand' : '▾ Collapse';
  });
  $('launch').addEventListener('click', function () {
    const url = String(srcInput.value || '').trim();
    if (!url) {
      log('error', 'Enter the URL of andi-gen1.js first.');
      return;
    }
    (window).ANDI_INITIAL_MODE = meta.modeKey || 'f';
    const s = document.createElement('script');
    s.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'v=' + Date.now();
    s.onload = function () {
      log('info', 'ANDI-Gen1 loaded on this harness (mode ' + (meta.modeKey || 'f') + ').');
    };
    s.onerror = function () {
      log('error', 'Could not load ' + url + ' (offline, blocked by CSP, or wrong path).');
    };
    document.head.appendChild(s);
  });

  // ---------------------------------------------------------------------------
  // Highlight overlay for the inspected element (drawn in the chrome, so the
  // element's own outline / focus indicator is never altered)
  // ---------------------------------------------------------------------------
  function updateOverlay() {
    const t = document.querySelector('[data-hx-target]');
    if (!t || !$('hl').checked) {
      overlay.hidden = true;
      return;
    }
    const r = t.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      overlay.hidden = true;
      return;
    }
    overlay.hidden = false;
    overlay.style.left = r.left - 5 + 'px';
    overlay.style.top = r.top - 5 + 'px';
    overlay.style.width = r.width + 10 + 'px';
    overlay.style.height = r.height + 10 + 'px';
  }
  window.addEventListener('scroll', updateOverlay, true);
  window.addEventListener('resize', updateOverlay);
  setInterval(updateOverlay, 300);
  document.documentElement.style.paddingBottom = '260px';

  // ---------------------------------------------------------------------------
  // Event logging
  // ---------------------------------------------------------------------------
  function isHarnessOrAndi(target) {
    return target === host || (target && target.id === 'andi-gen1-host');
  }

  const LOGGED = ['click', 'dblclick', 'keydown', 'focusin', 'focusout', 'input', 'change', 'submit', 'invalid', 'toggle', 'close', 'cancel'];
  LOGGED.forEach(function (name) {
    document.addEventListener(
      name,
      function (e) {
        if (isHarnessOrAndi(e.target)) return;
        let extra = '';
        if (name === 'keydown') {
          extra = ' key=' + e.key + (e.shiftKey ? '+Shift' : '') + (e.ctrlKey ? '+Ctrl' : '') + (e.altKey ? '+Alt' : '');
        } else if (name === 'input' || name === 'change') {
          const v = e.target && e.target.value;
          if (v !== undefined) extra = ' value="' + String(v).slice(0, 40) + '"';
        }
        let kind = 'click';
        if (name === 'keydown') kind = 'key';
        else if (name === 'submit' || name === 'invalid') kind = 'form';
        else if (name === 'close' || name === 'cancel' || name === 'toggle') kind = 'dialog';
        log(kind, name + ' → ' + describe(e.target) + extra);
      },
      true
    );
  });

  window.addEventListener('error', function (e) {
    log('error', '⚠ Script error: ' + (e.message || 'unknown') + ' — an inline handler likely needs page code that is not part of this harness.');
  });
  window.addEventListener('unhandledrejection', function (e) {
    log('error', '⚠ Unhandled promise rejection: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
  });

  // Native JS dialogs still appear, but every call is recorded.
  ['alert', 'confirm', 'prompt'].forEach(function (name) {
    const original = (window)[name];
    (window)[name] = function () {
      log('dialog', name + '(' + Array.prototype.slice.call(arguments).join(', ') + ')');
      return original.apply(window, arguments);
    };
  });
  window.open = function (url) {
    log('info', 'window.open(' + String(url) + ') blocked inside the harness');
    return null;
  };

  // ---------------------------------------------------------------------------
  // Stub page functions referenced by inline handlers (onclick="save()", href="javascript:go()")
  // ---------------------------------------------------------------------------
  const RESERVED = ['if', 'for', 'while', 'switch', 'return', 'function', 'catch', 'typeof', 'new', 'void', 'delete', 'this', 'event', 'with', 'else', 'do', 'in', 'of'];
  const stubbed = [];
  const handlerSources = [];
  document.querySelectorAll('*').forEach(function (n) {
    if (n === host) return;
    for (let i = 0; i < n.attributes.length; i++) {
      const a = n.attributes[i];
      if (a.name.indexOf('on') === 0) {
        handlerSources.push(a.value);
      } else if (a.name === 'href' && /^javascript:/i.test(a.value)) {
        handlerSources.push(a.value.replace(/^javascript:/i, ''));
      }
    }
  });
  handlerSources.forEach(function (src) {
    const re = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
    let m = null;
    while ((m = re.exec(src)) !== null) {
      const fname = m[1];
      if (RESERVED.indexOf(fname) !== -1 || typeof (window)[fname] !== 'undefined') continue;
      (window)[fname] = function () {
        log('info', 'Stubbed page function ' + fname + '(' + Array.prototype.slice.call(arguments).join(', ') + ') was called by an inline handler');
      };
      stubbed.push(fname);
    }
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function isNativeInteractive(el) {
    const t = el.tagName;
    return t === 'BUTTON' || t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || t === 'SUMMARY' || (t === 'A' && el.hasAttribute('href'));
  }

  function isDisabled(el) {
    return el.disabled === true || el.getAttribute('aria-disabled') === 'true';
  }

  function idsOf(el, attr) {
    const raw = el.getAttribute(attr);
    if (!raw) return [];
    return raw
      .trim()
      .split(/\s+/)
      .map(function (id) {
        return document.getElementById(id);
      })
      .filter(Boolean);
  }

  function isDialogEl(n) {
    return !!n && (n.tagName === 'DIALOG' || n.getAttribute('role') === 'dialog' || n.getAttribute('role') === 'alertdialog');
  }

  function isDialogOpen(d) {
    if (d.tagName === 'DIALOG') return d.open === true;
    if (d.hidden) return false;
    const cs = getComputedStyle(d);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function focusables(root) {
    return Array.prototype.slice
      .call(root.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex],[contenteditable="true"]'))
      .filter(function (n) {
        return !n.disabled && n.getAttribute('tabindex') !== '-1' && n.getClientRects().length > 0;
      });
  }

  // ---------------------------------------------------------------------------
  // Dialogs (<dialog>, role="dialog", role="alertdialog")
  // ---------------------------------------------------------------------------
  function openDialog(d, opener) {
    const active = document.activeElement;
    state.opener = opener || (active && active !== host && active !== document.body ? active : document.querySelector('[data-hx-target]'));
    state.trap = d.tagName === 'DIALOG' || d.getAttribute('aria-modal') === 'true';
    if (d.tagName === 'DIALOG') {
      try {
        d.showModal();
      } catch (err) {
        d.setAttribute('open', '');
      }
    } else {
      d.hidden = false;
      d.style.removeProperty('display');
      if (getComputedStyle(d).display === 'none') d.style.display = 'block';
      if (!d.hasAttribute('tabindex')) d.setAttribute('tabindex', '-1');
    }
    state.dialog = d;
    const first = focusables(d)[0] || d;
    first.focus();
    log('dialog', 'Opened ' + describe(d) + (state.trap ? ' (modal: focus trapped, Esc closes)' : ' (non-modal, Esc closes)'));
    refreshDialogButtons();
  }

  function closeDialog(d, why) {
    if (d.tagName === 'DIALOG') {
      if (d.open) d.close();
    } else {
      d.hidden = true;
      d.style.display = 'none';
    }
    log('dialog', 'Closed ' + describe(d) + ' (' + why + ')');
    if (state.dialog === d) {
      state.dialog = null;
      if (state.opener && state.opener.focus) state.opener.focus();
    }
    refreshDialogButtons();
  }

  function looksLikeDismiss(el) {
    const btn = el.closest('button,[role="button"],a,input[type="button"],input[type="submit"]');
    if (!btn) return false;
    if (btn.hasAttribute('data-dismiss') || btn.hasAttribute('data-close') || btn.hasAttribute('data-bs-dismiss')) return true;
    const label = (btn.getAttribute('aria-label') || btn.value || btn.textContent || '').replace(/\s+/g, ' ').trim();
    return /^(close|cancel|dismiss|ok|okay|no|done|got it|×|✕|x)$/i.test(label);
  }

  const dialogButtons = [];
  const dialogHost = $('dialogs');
  Array.prototype.slice.call(document.querySelectorAll('dialog,[role="dialog"],[role="alertdialog"]')).forEach(function (d) {
    const b = document.createElement('button');
    b.type = 'button';
    (b)._hxDialog = d;
    b.addEventListener('click', function () {
      if (isDialogOpen(d)) closeDialog(d, 'harness button');
      else openDialog(d, null);
    });
    d.addEventListener('close', function () {
      if (state.dialog === d) {
        state.dialog = null;
        if (state.opener && state.opener.focus) state.opener.focus();
      }
      refreshDialogButtons();
    });
    dialogHost.appendChild(b);
    dialogButtons.push(b);
  });
  function refreshDialogButtons() {
    dialogButtons.forEach(function (b) {
      const d = b._hxDialog;
      const heading = d.querySelector('h1,h2,h3,h4,[role="heading"]');
      const nm = d.getAttribute('aria-label') || (heading ? heading.textContent : '') || d.tagName.toLowerCase();
      b.textContent = (isDialogOpen(d) ? '✕ Close dialog: ' : '🗨 Open dialog: ') + String(nm).replace(/\s+/g, ' ').trim().slice(0, 28);
    });
  }
  refreshDialogButtons();

  // ---------------------------------------------------------------------------
  // Live regions
  // ---------------------------------------------------------------------------
  let liveCounter = 0;
  const liveHost = $('lives');
  Array.prototype.slice
    .call(document.querySelectorAll('[aria-live]:not([aria-live="off"]),[role="alert"],[role="status"],[role="log"],[role="timer"]'))
    .forEach(function (region) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = '🔔 Announce in ' + describe(region).slice(0, 34);
      b.addEventListener('click', function () {
        liveCounter += 1;
        const line = document.createElement('div');
        line.textContent = 'Test announcement #' + liveCounter + ' (' + new Date().toLocaleTimeString() + ')';
        region.appendChild(line);
        log('info', 'Injected live-region text into ' + describe(region));
      });
      liveHost.appendChild(b);
    });

  // ---------------------------------------------------------------------------
  // ARIA widget behaviour (only where the element has no inline handler of its own)
  // ---------------------------------------------------------------------------
  function setExpanded(trigger, expanded) {
    trigger.setAttribute('aria-expanded', String(expanded));
    idsOf(trigger, 'aria-controls').forEach(function (t) {
      if (isDialogEl(t)) return;
      if (expanded) {
        t.hidden = false;
        t.style.removeProperty('display');
        if (getComputedStyle(t).display === 'none') t.style.display = 'block';
      } else {
        t.hidden = true;
        t.style.display = 'none';
      }
    });
    log('info', describe(trigger) + ' aria-expanded=' + expanded);
  }

  function selectTab(tab) {
    const list = tab.closest('[role="tablist"]') || tab.parentElement;
    Array.prototype.slice.call(list.querySelectorAll('[role="tab"]')).forEach(function (t) {
      const sel = t === tab;
      t.setAttribute('aria-selected', sel ? 'true' : 'false');
      t.setAttribute('tabindex', sel ? '0' : '-1');
      idsOf(t, 'aria-controls').forEach(function (p) {
        p.hidden = !sel;
      });
    });
    log('info', 'Selected tab ' + describe(tab));
  }

  function selectRadio(radio) {
    const role = radio.getAttribute('role');
    const group = radio.closest('[role="radiogroup"],[role="menu"],[role="menubar"]') || radio.parentElement;
    Array.prototype.slice.call(group.querySelectorAll('[role="' + role + '"]')).forEach(function (r) {
      r.setAttribute('aria-checked', r === radio ? 'true' : 'false');
      if (role === 'radio') r.setAttribute('tabindex', r === radio ? '0' : '-1');
    });
    log('info', 'Checked ' + describe(radio));
  }

  function selectOption(opt) {
    const box = opt.closest('[role="listbox"]') || opt.parentElement;
    const multi = box.getAttribute('aria-multiselectable') === 'true';
    if (multi) {
      opt.setAttribute('aria-selected', opt.getAttribute('aria-selected') === 'true' ? 'false' : 'true');
    } else {
      Array.prototype.slice.call(box.querySelectorAll('[role="option"]')).forEach(function (o) {
        o.setAttribute('aria-selected', o === opt ? 'true' : 'false');
      });
    }
    log('info', 'Option ' + describe(opt) + ' aria-selected=' + opt.getAttribute('aria-selected'));
  }

  function activateWidget(w) {
    if (isDisabled(w) || w.hasAttribute('onclick')) return;
    const role = w.getAttribute('role') || '';
    const tag = w.tagName;
    const nativeField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

    const dialogTarget = idsOf(w, 'aria-controls').filter(isDialogEl)[0];
    if (dialogTarget || (w.getAttribute('aria-haspopup') === 'dialog' && !nativeField)) {
      if (dialogTarget && !isDialogOpen(dialogTarget)) {
        openDialog(dialogTarget, w);
        if (w.hasAttribute('aria-expanded')) w.setAttribute('aria-expanded', 'true');
      }
      return;
    }

    if (role === 'tab') {
      selectTab(w);
    } else if (role === 'radio' || role === 'menuitemradio') {
      if (!nativeField) selectRadio(w);
    } else if (role === 'checkbox' || role === 'switch' || role === 'menuitemcheckbox') {
      if (!nativeField) {
        w.setAttribute('aria-checked', w.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
        log('info', describe(w) + ' aria-checked=' + w.getAttribute('aria-checked'));
      }
    } else if (role === 'option') {
      selectOption(w);
    } else if (!nativeField && w.hasAttribute('aria-pressed')) {
      w.setAttribute('aria-pressed', w.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      log('info', describe(w) + ' aria-pressed=' + w.getAttribute('aria-pressed'));
    } else if (!nativeField && w.hasAttribute('aria-expanded')) {
      setExpanded(w, w.getAttribute('aria-expanded') !== 'true');
    }
  }

  const WIDGET_SELECTOR =
    '[aria-expanded],[aria-pressed],[aria-haspopup],[aria-controls],[role="tab"],[role="checkbox"],[role="switch"],[role="radio"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"]';

  function handleAnchor(a, e) {
    const href = a.getAttribute('href') || '';
    if (/^javascript:/i.test(href)) return;
    e.preventDefault();
    if (href.charAt(0) === '#') {
      const id = decodeURIComponent(href.slice(1));
      const target = id ? document.getElementById(id) || document.getElementsByName(id)[0] : null;
      if (target) {
        const had = target.hasAttribute('tabindex');
        if (!had) target.setAttribute('tabindex', '-1');
        target.scrollIntoView({ block: 'center' });
        target.focus({ preventScroll: true });
        log('click', 'Same-page link to #' + id + ' → focus moved to ' + describe(target));
      } else {
        log('click', 'Same-page link ' + href + ' (no matching target in this harness)');
      }
      return;
    }
    log('click', 'Navigation blocked: ' + a.href + (a.target === '_blank' ? ' (new tab)' : '') + ' — the harness stays on this page');
  }

  document.addEventListener('click', function (e) {
    if (isHarnessOrAndi(e.target) || !(e.target instanceof Element)) return;
    const el = e.target;
    const anchor = el.closest('a[href]');
    if (anchor) handleAnchor(anchor, e);
    const dlg = el.closest('dialog,[role="dialog"],[role="alertdialog"]');
    if (dlg && isDialogOpen(dlg) && looksLikeDismiss(el)) closeDialog(dlg, 'dismiss control');
    const w = el.closest(WIDGET_SELECTOR);
    if (w) activateWidget(w);
  });

  document.addEventListener(
    'submit',
    function (e) {
      const form = e.target;
      if (form && form.getAttribute && form.getAttribute('method') === 'dialog') return;
      e.preventDefault();
      const parts = [];
      try {
        new FormData(form).forEach(function (v, k) {
          parts.push(k + '=' + String(v).slice(0, 30));
        });
      } catch (err) {
        parts.push('(unreadable)');
      }
      log('form', 'Submit intercepted (no network request). Fields: ' + (parts.join(', ') || 'none'));
    },
    true
  );

  // ---------------------------------------------------------------------------
  // Keyboard simulation for custom (non-native) widgets
  // ---------------------------------------------------------------------------
  const ENTER_ROLES = ['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'treeitem'];
  const SPACE_ROLES = ['button', 'checkbox', 'switch', 'radio', 'tab', 'option', 'menuitemcheckbox', 'menuitemradio'];
  const ARROW_ROLES = ['tab', 'radio', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option'];
  const ARROW_CONTAINERS = '[role="tablist"],[role="radiogroup"],[role="menu"],[role="menubar"],[role="listbox"],[role="toolbar"]';

  function adjustSlider(el, e) {
    const role = el.getAttribute('role');
    if (role !== 'slider' && role !== 'spinbutton') return false;
    const min = Number(el.getAttribute('aria-valuemin') || 0);
    const max = Number(el.getAttribute('aria-valuemax') || 100);
    const step = Number(el.getAttribute('aria-valuestep') || 1);
    let value = Number(el.getAttribute('aria-valuenow') || min);
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowUp') value += step;
    else if (k === 'ArrowLeft' || k === 'ArrowDown') value -= step;
    else if (k === 'PageUp') value += step * 10;
    else if (k === 'PageDown') value -= step * 10;
    else if (k === 'Home') value = min;
    else if (k === 'End') value = max;
    else return false;
    value = Math.max(min, Math.min(max, value));
    el.setAttribute('aria-valuenow', String(value));
    e.preventDefault();
    log('key', describe(el) + ' aria-valuenow=' + value);
    return true;
  }

  document.addEventListener('keydown', function (e) {
    if (isHarnessOrAndi(e.target)) return;
    const active = e.target instanceof Element ? e.target : null;

    // Dialog focus trap and Escape handling
    if (state.dialog && isDialogOpen(state.dialog)) {
      if (e.key === 'Tab' && state.trap) {
        const f = focusables(state.dialog);
        if (f.length === 0) {
          e.preventDefault();
        } else if (!state.dialog.contains(document.activeElement)) {
          e.preventDefault();
          f[0].focus();
        } else if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0].focus();
        }
      } else if (e.key === 'Escape' && state.dialog.tagName !== 'DIALOG') {
        e.preventDefault();
        closeDialog(state.dialog, 'Escape key');
        return;
      }
    }

    if (!state.simulateKeys || !active || !active.getAttribute) return;

    // Escape collapses an expanded popup that contains focus (or its trigger)
    if (e.key === 'Escape') {
      const triggers = Array.prototype.slice.call(document.querySelectorAll('[aria-expanded="true"][aria-controls]'));
      for (let i = 0; i < triggers.length; i++) {
        const t = triggers[i];
        const owns = idsOf(t, 'aria-controls').some(function (p) {
          return !isDialogEl(p) && p.contains(active);
        });
        if (t === active || owns) {
          setExpanded(t, false);
          t.focus();
          e.preventDefault();
          return;
        }
      }
    }

    if (adjustSlider(active, e)) return;

    const role = active.getAttribute('role') || '';
    const custom = !isNativeInteractive(active);

    if (custom && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) {
      const allowed = e.key === 'Enter' ? ENTER_ROLES : SPACE_ROLES;
      if (allowed.indexOf(role) !== -1 || (e.key === 'Enter' && active.hasAttribute('aria-expanded'))) {
        e.preventDefault();
        log('key', 'Simulated click from ' + (e.key === 'Enter' ? 'Enter' : 'Space') + ' on ' + describe(active));
        active.click();
        return;
      }
    }

    if (ARROW_ROLES.indexOf(role) !== -1 && /^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(e.key)) {
      const container = active.closest(ARROW_CONTAINERS);
      if (!container) return;
      const items = Array.prototype.slice
        .call(container.querySelectorAll('[role="' + role + '"]'))
        .filter(function (n) {
          return !isDisabled(n) && n.getClientRects().length > 0;
        });
      const idx = items.indexOf(active);
      if (idx === -1 || items.length < 2) return;
      let next = idx;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + items.length) % items.length;
      else next = (idx + 1) % items.length;
      e.preventDefault();
      items[next].focus();
      if (role === 'tab' || role === 'radio') items[next].click();
    }
  });

  updateOverlay();
  log('info', 'Harness ready. Interact with the highlighted element — events, simulated widget state changes, blocked navigation and dialogs are logged here.');
  if (stubbed.length > 0) {
    log('info', 'Stubbed page functions referenced by inline handlers: ' + stubbed.join(', '));
  }
}

  // === Module: src\test-harness.ts ===
/**
 * ANDI-Gen1 — "Copy DOM Code" & Local Test Harness Generator
 *
 * - `getCleanDomCode()` returns the inspected element's full, pretty-printed HTML with ANDI's own
 *   instrumentation (`data-andi*` attributes, injected scripts) removed.
 * - `buildTestHarnessHtml()` produces a standalone `.html` file that recreates the element in its
 *   original context so it can be tested locally:
 *     1. the nearest structural context (table, list, fieldset, select, dialog, label...) so semantics survive,
 *     2. a shell of the element's ancestors (tag + attributes only) so landmarks / forms / CSS selectors still apply,
 *     3. every element it references by IDREF (aria-labelledby, aria-describedby, headers, label[for], aria-controls...),
 *     4. the CSS rules that match those elements (flattened from the page's stylesheets),
 *     5. an event-handler / dialog / live-region runtime (`harnessRuntime`) and a log panel.
 */


const HARNESS_ANDI_VERSION = 'v31.4';
const HARNESS_CDN_URL = 'https://cdn.jsdelivr.net/gh/devarshipant/ANDI-Gen1@v31.4/dist/andi-gen1.js';
const ANDI_PAGE_STYLE_ID = 'andi-gen1-page-highlights-css';
const HARNESS_MAX_CONTEXT_CHARS = 30000;
const HARNESS_MAX_CSS_CHARS = 250000;
const HARNESS_MAX_SHELL_DEPTH = 12;
const HARNESS_MAX_MATCH_POOL = 600;

const HARNESS_CONTEXT_SELECTOR =
  'table, [role="table"], [role="grid"], [role="treegrid"], ul, ol, menu, dl, ' +
  '[role="list"], [role="listbox"], [role="menu"], [role="menubar"], [role="tablist"], [role="radiogroup"], [role="group"], ' +
  'fieldset, select, figure, dialog, [role="dialog"], [role="alertdialog"], label';

const HARNESS_REF_ATTRS_BEFORE = ['aria-labelledby', 'aria-describedby', 'aria-errormessage', 'headers'];
const HARNESS_REF_ATTRS_AFTER = ['aria-controls', 'aria-details', 'aria-owns', 'aria-activedescendant'];
const PRESERVE_WHITESPACE_TAGS = ['pre', 'textarea', 'script', 'style'];
const VOID_TAGS = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];



function removeAndiAttributes(node) {
  for (let i = node.attributes.length - 1; i >= 0; i--) {
    const name = node.attributes[i].name;
    if (name.indexOf('data-andi') === 0) {
      node.removeAttribute(name);
    }
  }
}

/**
 * Strips ANDI instrumentation + scripts from a deep clone and freezes live form state
 * (typed values, checked boxes, selected options) into attributes so it survives serialization.
 * `orig` and `clone` must be structurally identical on entry.
 */
function sanitizeClone(orig, clone, target) {
  const origNodes = [orig].concat(Array.from(orig.querySelectorAll('*')));
  const cloneNodes = [clone].concat(Array.from(clone.querySelectorAll('*')));
  const scripts = [];

  for (let i = 0; i < origNodes.length; i++) {
    const o = origNodes[i];
    const c = cloneNodes[i];
    if (!c) {
      continue;
    }
    removeAndiAttributes(c);
    const tag = o.tagName.toLowerCase();
    if (tag === 'script') {
      scripts.push(c);
      continue;
    }
    if (target && o === target) {
      c.setAttribute('data-hx-target', 'true');
    }
    if (tag === 'input') {
      const inp = o;
      const type = (inp.type || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        if (inp.checked) {
          c.setAttribute('checked', '');
        } else {
          c.removeAttribute('checked');
        }
      } else if (type !== 'password' && type !== 'file' && inp.value !== (c.getAttribute('value') || '')) {
        c.setAttribute('value', inp.value);
      }
    } else if (tag === 'textarea') {
      c.textContent = (o).value;
    } else if (tag === 'select') {
      const opts = (o).options;
      const copts = c.querySelectorAll('option');
      for (let j = 0; j < opts.length && j < copts.length; j++) {
        if (opts[j].selected) {
          copts[j].setAttribute('selected', '');
        } else {
          copts[j].removeAttribute('selected');
        }
      }
    }
  }

  for (const s of scripts) {
    if (s.parentNode) {
      s.parentNode.removeChild(s);
    }
  }
}

function escapeText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function prettyPrint(node, depth, out) {
  const pad = '  '.repeat(depth);
  if (node.nodeType === 3) {
    const t = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
    if (t) {
      out.push(pad + escapeText(t));
    }
    return;
  }
  if (node.nodeType === 8) {
    out.push(pad + '<!--' + (node.nodeValue || '') + '-->');
    return;
  }
  if (node.nodeType !== 1) {
    return;
  }
  const el = node;
  const tag = el.tagName.toLowerCase();
  if (!el.firstElementChild || PRESERVE_WHITESPACE_TAGS.indexOf(tag) !== -1 || VOID_TAGS.indexOf(tag) !== -1) {
    out.push(pad + el.outerHTML);
    return;
  }
  const shell = (el.cloneNode(false)).outerHTML;
  const open = shell.slice(0, shell.lastIndexOf('</'));
  out.push(pad + open);
  for (let i = 0; i < el.childNodes.length; i++) {
    prettyPrint(el.childNodes[i], depth + 1, out);
  }
  out.push(pad + '</' + tag + '>');
}

/**
 * Returns the inspected element's full DOM code (outerHTML), pretty-printed, with ANDI
 * instrumentation removed. This is exactly what "Copy DOM Code" puts on the clipboard.
 */
function getCleanDomCode(el) {
  const clone = el.cloneNode(true);
  sanitizeClone(el, clone);
  const lines = [];
  prettyPrint(clone, 0, lines);
  return lines.join('\n');
}

function getHarnessFileName(rec) {
  const base = rec.tagName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'element';
  return `andi-harness-${base}-${rec.index}.html`;
}

function pickHarnessRoot(el) {
  let ctx = null;
  if (el.matches(HARNESS_CONTEXT_SELECTOR)) {
    ctx = el;
  } else if (el.parentElement) {
    ctx = el.parentElement.closest(HARNESS_CONTEXT_SELECTOR);
  }
  if (ctx && ctx.outerHTML.length <= HARNESS_MAX_CONTEXT_CHARS) {
    return ctx;
  }
  return el;
}

function getEffectiveBackground(el) {
  const win = el.ownerDocument.defaultView || window;
  let cur = el;
  while (cur) {
    const bg = win.getComputedStyle(cur).backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)/.test(bg)) {
      return bg;
    }
    cur = cur.parentElement;
  }
  return 'rgb(255, 255, 255)';
}

/**
 * Freezes the computed visual facts that most affect ANDI results onto the inspected element
 * (hidden state always; text color / effective background / font size & weight for cANDI).
 */
function applyTargetStyleSnapshot(orig, clone, modeKey) {
  const win = orig.ownerDocument.defaultView || window;
  const cs = win.getComputedStyle(orig);
  const decls = [];
  if (cs.display === 'none') {
    decls.push('display:none');
  }
  if (cs.visibility === 'hidden' || cs.visibility === 'collapse') {
    decls.push('visibility:hidden');
  }
  if (modeKey === 'c') {
    decls.push('color:' + cs.color);
    decls.push('background-color:' + getEffectiveBackground(orig));
    decls.push('font-size:' + cs.fontSize);
    decls.push('font-weight:' + cs.fontWeight);
  }
  if (decls.length === 0) {
    return;
  }
  const existing = (clone.getAttribute('style') || '').trim();
  const sep = existing && existing.slice(-1) !== ';' ? ';' : '';
  clone.setAttribute('style', existing + sep + decls.join(';'));
}

function collectReferencedElements(doc, scope, root) {
  const before = [];
  const after = [];
  const seen = [];

  const addTarget = (t, bucket) => {
    if (t === root || root.contains(t) || t.contains(root)) {
      return;
    }
    if (seen.some((p) => p === t || p.contains(t))) {
      return;
    }
    seen.push(t);
    bucket.push(t);
  };

  const addIds = (node, attr, bucket) => {
    const raw = node.getAttribute(attr);
    if (!raw) {
      return;
    }
    for (const id of raw.trim().split(/\s+/)) {
      const t = doc.getElementById(id);
      if (t) {
        addTarget(t, bucket);
      }
    }
  };

  for (const node of scope) {
    for (const attr of HARNESS_REF_ATTRS_BEFORE) {
      addIds(node, attr, before);
    }
    for (const attr of HARNESS_REF_ATTRS_AFTER) {
      addIds(node, attr, after);
    }
    if (node.id) {
      const labels = doc.querySelectorAll('label[for="' + CSS.escape(node.id) + '"]');
      labels.forEach((l) => addTarget(l, before));
    }
  }
  return { before, after };
}

function splitSelectorList(sel) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < sel.length; i++) {
    const ch = sel.charAt(i);
    if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    }
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) {
    parts.push(cur);
  }
  return parts;
}

/**
 * Removes pseudo-elements and transient interaction states so that rules such as
 * `a:hover`, `button:focus-visible` or `p::before` are still included for the base element.
 */
function normalizeSelectorForHarness(part) {
  let s = part.replace(
    /::?(?:before|after|first-line|first-letter|placeholder|selection|marker|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)/gi,
    ''
  );
  s = s.replace(/:(?:hover|focus-visible|focus-within|focus|active|visited|target)(?![\w-])/gi, '');
  s = s.trim();
  if (s === '') {
    return '*';
  }
  if (/^[>+~]/.test(s)) {
    s = '*' + s;
  }
  if (/[>+~]$/.test(s)) {
    s = s + '*';
  }
  return s;
}

function collectMatchedCss(doc, elements) {
  const win = doc.defaultView || window;
  const links = [];
  const chunks = [];
  let budget = HARNESS_MAX_CSS_CHARS;
  const pool = elements.slice(0, HARNESS_MAX_MATCH_POOL);

  const matchesAny = (selectorList) => {
    for (const part of splitSelectorList(selectorList)) {
      const normalized = normalizeSelectorForHarness(part);
      for (const e of pool) {
        try {
          if (e.matches(normalized)) {
            return true;
          }
        } catch (err) {
          break;
        }
      }
    }
    return false;
  };

  const visitRules = (rules) => {
    for (let i = 0; i < rules.length; i++) {
      if (budget <= 0) {
        return;
      }
      const r = rules[i];
      if (r.type === 1) {
        const selectorText = r.selectorText || '';
        if (selectorText.indexOf('data-andi') === -1 && matchesAny(selectorText)) {
          const text = r.cssText;
          budget -= text.length;
          chunks.push(text);
        }
      } else if (r.type === 4) {
        let ok = true;
        try {
          ok = win.matchMedia(r.conditionText || r.media.mediaText).matches;
        } catch (err) {
          ok = false;
        }
        if (ok) {
          visitRules(r.cssRules);
        }
      } else if (r.type === 12) {
        visitRules(r.cssRules);
      }
    }
  };

  for (const sheet of Array.from(doc.styleSheets)) {
    const owner = sheet.ownerNode;
    if (owner && owner.id === ANDI_PAGE_STYLE_ID) {
      continue;
    }
    if (sheet.disabled) {
      continue;
    }
    let rules = null;
    try {
      rules = sheet.cssRules;
    } catch (err) {
      rules = null;
    }
    if (rules === null) {
      if (sheet.href) {
        links.push(sheet.href);
      }
      continue;
    }
    visitRules(rules);
  }

  return { css: chunks.join('\n'), links };
}

function copySafeAttrs(src, allowStyle) {
  const out = [];
  for (let i = 0; i < src.attributes.length; i++) {
    const a = src.attributes[i];
    const name = a.name.toLowerCase();
    if (name.indexOf('data-andi') === 0 || name.indexOf('on') === 0) {
      continue;
    }
    let value = a.value;
    if (name === 'style') {
      if (!allowStyle) {
        continue;
      }
      // Drop the page margins ANDI adds when docked so the harness is not pushed off-screen.
      value = value
        .split(';')
        .filter((d) => !/^\s*margin(-(top|right|bottom|left))?\s*:/i.test(d))
        .join(';');
      if (value.trim() === '') {
        continue;
      }
    }
    out.push(` ${a.name}="${escapeAttr(value)}"`);
  }
  return out.join('');
}

function sanitizeShell(shell) {
  removeAndiAttributes(shell);
  for (let i = shell.attributes.length - 1; i >= 0; i--) {
    const name = shell.attributes[i].name.toLowerCase();
    if (name.indexOf('on') === 0) {
      shell.removeAttribute(shell.attributes[i].name);
    }
  }
}

/**
 * Builds a complete, standalone, locally-runnable test harness `.html` file for the inspected element.
 */
function buildTestHarnessHtml(
  rec,
  modeKey,
  modeLabel,
  frameLabel
) {
  const el = rec.element;
  const doc = el.ownerDocument;
  const root = pickHarnessRoot(el);

  // 1. Context root (with the inspected element tagged as the harness target)
  const rootClone = root.cloneNode(true);
  sanitizeClone(root, rootClone, el);
  const targetClone = rootClone.hasAttribute('data-hx-target')
    ? rootClone
    : (rootClone.querySelector('[data-hx-target]'));
  if (targetClone) {
    applyTargetStyleSnapshot(el, targetClone, modeKey);
  }

  // 2. Ancestor shell (tag + attributes only)
  const shellChain = [];
  let anc = root.parentElement;
  while (anc && anc !== doc.body && anc !== doc.documentElement && shellChain.length < HARNESS_MAX_SHELL_DEPTH) {
    shellChain.unshift(anc);
    anc = anc.parentElement;
  }
  let stageNode = rootClone;
  for (let i = shellChain.length - 1; i >= 0; i--) {
    const sh = shellChain[i].cloneNode(false);
    sanitizeShell(sh);
    sh.appendChild(stageNode);
    stageNode = sh;
  }

  // 3. IDREF targets (labels, descriptions, headers, controlled popups...)
  const scopeNodes = [root].concat(Array.from(root.querySelectorAll('*'))).concat(shellChain);
  const refs = collectReferencedElements(doc, scopeNodes, root);
  const cloneRef = (r) => {
    const c = r.cloneNode(true);
    sanitizeClone(r, c);
    return c.outerHTML;
  };
  const beforeHtml = refs.before.map(cloneRef).join('\n');
  const afterHtml = refs.after.map(cloneRef).join('\n');

  // 4. Matching CSS
  const cssPool = [doc.documentElement, doc.body];
  for (const n of scopeNodes) {
    cssPool.push(n);
  }
  for (const r of refs.before.concat(refs.after)) {
    cssPool.push(r);
    r.querySelectorAll('*').forEach((d) => cssPool.push(d));
  }
  const cssResult = collectMatchedCss(doc, cssPool);

  // 5. Metadata for the harness panel
  const env = getBrowserEnvironmentInfo();
  const meta = {
    modeKey,
    mode: modeLabel,
    selector: rec.selector,
    sourceUrl: doc.location ? doc.location.href : '',
    pageTitle: doc.title,
    frameContext: frameLabel,
    generatedAtLocal: new Date().toLocaleString(),
    browser: env.browserName,
    andiVersion: HARNESS_ANDI_VERSION,
    andiScriptUrl: HARNESS_CDN_URL,
    screenReaderOutput: rec.screenReaderOutput,
    accName: rec.accName,
    accDesc: rec.accDesc,
    coordinates: rec.coordinates.formatted,
    alerts: rec.alerts.map((a) => ({ level: a.level, code: a.code, module: a.module, message: a.message }))
  };
  const metaJson = JSON.stringify(meta).replace(/</g, '\\u003c');
  const runtimeSource = ('(' + harnessRuntime.toString() + ')();').replace(/<\/script/gi, '<\\/script');

  const baseHref = doc.baseURI && /^(https?|file):/i.test(doc.baseURI) ? doc.baseURI : '';
  const linkTags = cssResult.links
    .map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}">`)
    .join('\n');
  const refsWrap = (html, label) =>
    html
      ? `<div data-hx-refs="${label}" style="outline:1px dashed #94a3b8;outline-offset:2px;margin:6px 0;padding:2px">\n${html}\n</div>`
      : '';

  return [
    '<!DOCTYPE html>',
    `<html${copySafeAttrs(doc.documentElement, false)}>`,
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>ANDI-Gen1 Test Harness — ${escapeText(rec.selector)}</title>`,
    baseHref ? `<base href="${escapeAttr(baseHref)}">` : '',
    linkTags,
    '<style id="hx-page-css">',
    cssResult.css.replace(/<\/style/gi, '<\\/style'),
    '</style>',
    '</head>',
    `<body${copySafeAttrs(doc.body, true)}>`,
    `<!-- ANDI-Gen1 ${HARNESS_ANDI_VERSION} test harness generated ${new Date().toISOString()} from ${escapeText(doc.location ? doc.location.href : '')} (${escapeText(modeLabel)}) -->`,
    '<!-- Inspected element: ' + escapeText(rec.selector).replace(/--/g, '- -') + ' (marked data-hx-target). Ancestors are reproduced as empty shells so landmarks, forms and CSS selectors still apply. -->',
    refsWrap(beforeHtml, 'before'),
    stageNode.outerHTML,
    refsWrap(afterHtml, 'after'),
    `<script id="hx-meta" type="application/json">${metaJson}</script>`,
    `<script>${runtimeSource}</script>`,
    '</body>',
    '</html>'
  ]
    .filter((line) => line !== '')
    .join('\n');
}


  // === Module: andi\fandi.ts ===
/**
 * fANDI — Focusable Elements Inspector Module (TypeScript)
 * Refactored from legacy fandi.js into strict, zero-dependency TypeScript.
 */


const FANDI_VERSION = '8.0.0-ts';

function evaluateFocusableElement(
  el,
  tag,
  focusInfo,
  computed,
  pageIndex
) {
  const alerts = [];

  if (!computed.accName && !isAriaHiddenInTree(el)) {
    if (computed.components.ariaDescribedby) {
      alerts.push({
        id: 'f-dby-alone',
        code: 'ALERT_DBY_ALONE',
        level: 'warning',
        module: 'f',
        message: '[aria-describedby] is used without any component that provides an accessible name.'
      });
    } else {
      alerts.push({
        id: 'f-no-name',
        code: 'ALERT_NO_ACC_NAME',
        level: 'danger',
        module: 'f',
        message: `<${formatTagName(el)}> has no accessible name, associated <label>, or [title].`
      });
    }
  }

  if (computed.missingLabelledbyIds.length > 0) {
    alerts.push({
      id: 'f-missing-lby',
      code: 'ALERT_MISSING_LBY_REF',
      level: 'danger',
      module: 'f',
      message: `[aria-labelledby] references missing ID(s): "${computed.missingLabelledbyIds.join(', ')}".`
    });
  }

  if (computed.missingDescribedbyIds.length > 0) {
    alerts.push({
      id: 'f-missing-dby',
      code: 'ALERT_MISSING_DBY_REF',
      level: 'warning',
      module: 'f',
      message: `[aria-describedby] references missing ID(s): "${computed.missingDescribedbyIds.join(', ')}".`
    });
  }

  if (el.hasAttribute('aria-labeledby')) {
    alerts.push({
      id: 'f-misspelled-lby',
      code: 'ALERT_MISSPELLED_ARIA',
      level: 'danger',
      module: 'f',
      message: '[aria-labeledby] is misspelled; use [aria-labelledby].'
    });
  }

  if (el.id) {
    const matchingLabels = pageIndex.labelForMap.get(el.id);
    if (matchingLabels && matchingLabels.length > 1) {
      alerts.push({
        id: 'f-dup-for',
        code: 'ALERT_DUP_LABEL_FOR',
        level: 'danger',
        module: 'f',
        message: `More than one <label for="${el.id}"> (${matchingLabels.length}) associates with this element.`
      });
    }
  }

  if (focusInfo.tabIndexValue !== null && focusInfo.tabIndexValue > 0) {
    alerts.push({
      id: 'f-pos-tabindex',
      code: 'ALERT_POSITIVE_TABINDEX',
      level: 'warning',
      module: 'f',
      message: `[tabindex="${focusInfo.tabIndexValue}"] is greater than 0 and overrides natural DOM tab order.`
    });
  }

  if (focusInfo.isFocusable && isAriaHiddenInTree(el)) {
    alerts.push({
      id: 'f-aria-hidden-focusable',
      code: 'ALERT_FOCUSABLE_ARIA_HIDDEN',
      level: 'danger',
      module: 'f',
      message: 'Focusable element has or is contained by [aria-hidden="true"].'
    });
  }

  if (
    tag === 'input' &&
    ['checkbox', 'radio'].includes((el.getAttribute('type') || '').toLowerCase()) &&
    !computed.components.nativeLabel
  ) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 21 && rect.height > 0 && rect.height < 21) {
      alerts.push({
        id: 'f-small-target',
        code: 'ALERT_SMALL_CLICK_AREA',
        level: 'caution',
        module: 'f',
        message: `Small clickable area (${Math.round(rect.width)}x${Math.round(rect.height)}px); associate a <label> to increase target size.`
      });
    }
  }

  return alerts;
}

  // === Module: andi\gandi.ts ===
/**
 * gANDI — Graphics & Images Inspector Module (TypeScript)
 * Refactored from legacy gandi.js into strict, zero-dependency TypeScript.
 */


const GANDI_VERSION = '8.0.0-ts';

const REDUNDANT_IMAGE_REGEX = /\b(image of|graphic of|picture of|photo of|icon of)\b/i;
const IMAGE_FILENAME_REGEX = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;

function evaluateGraphicElement(
  el,
  tag,
  role,
  isTabbable,
  computed
) {
  const alerts = [];
  const isDecorative =
    role === 'presentation' ||
    role === 'none' ||
    (tag === 'img' && el.getAttribute('alt') === '');

  if (role === 'image') {
    alerts.push({
      id: 'g-role-image',
      code: 'ALERT_ROLE_IMAGE_INVALID',
      level: 'danger',
      module: 'g',
      message: '[role="image"] is invalid; use [role="img"].'
    });
  }

  if (isDecorative && isTabbable) {
    alerts.push({
      id: 'g-decorative-tabbable',
      code: 'ALERT_DECORATIVE_TABBABLE',
      level: 'danger',
      module: 'g',
      message: 'Image marked as decorative is in the keyboard tab order.'
    });
  }

  if (!isDecorative && !computed.accName && !isAriaHiddenInTree(el)) {
    alerts.push({
      id: 'g-no-name',
      code: 'ALERT_IMG_NO_NAME',
      level: 'danger',
      module: 'g',
      message: `Graphic <${tag}> has no accessible name, [alt], or [title].`
    });
  }

  if (computed.accName) {
    if (REDUNDANT_IMAGE_REGEX.test(computed.accName)) {
      alerts.push({
        id: 'g-redundant-phrase',
        code: 'ALERT_IMG_REDUNDANT_PHRASE',
        level: 'caution',
        module: 'g',
        message: 'Redundant phrase ("image of" / "graphic of") found in image accessible name.'
      });
    }
    if (IMAGE_FILENAME_REGEX.test(computed.accName)) {
      alerts.push({
        id: 'g-filename-alt',
        code: 'ALERT_IMG_FILENAME_ALT',
        level: 'warning',
        module: 'g',
        message: `Image accessible name ("${computed.accName}") appears to be a raw file name.`
      });
    }
  }

  return alerts;
}

  // === Module: andi\landi.ts ===
/**
 * lANDI — Links & Buttons Inspector Module (TypeScript)
 * Refactored from legacy landi.js into strict, zero-dependency TypeScript.
 */


const LANDI_VERSION = '8.0.0-ts';

const VAGUE_LINK_PHRASES = new Set([
  'click here', 'here', 'link', 'more', 'read more', 'learn more', 'info', 'details', 'go'
]);

function evaluateLinkOrButtonElement(
  el,
  tag,
  role,
  isTabbable,
  computed
) {
  const alerts = [];
  const isLink = tag === 'a' || role === 'link';

  if (isLink) {
    if (tag === 'a' && !el.hasAttribute('href') && role !== 'button' && role !== 'link') {
      alerts.push({
        id: 'l-no-href',
        code: 'ALERT_ANCHOR_NO_HREF',
        level: 'warning',
        module: 'l',
        message: '<a> element has no [href] or [role]; may not be keyboard accessible or announced as a link/button.'
      });
    }
    if (computed.accName && VAGUE_LINK_PHRASES.has(computed.accName.trim().toLowerCase())) {
      alerts.push({
        id: 'l-vague-text',
        code: 'ALERT_VAGUE_LINK',
        level: 'caution',
        module: 'l',
        message: `Link text "${computed.accName}" is vague and does not identify its destination out of context.`
      });
    }
    const href = el.getAttribute('href');
    if (href && href.startsWith('#') && href.length > 1) {
      const targetId = href.slice(1);
      const doc = el.ownerDocument || document;
      if (!doc.getElementById(targetId)) {
        alerts.push({
          id: 'l-broken-anchor',
          code: 'ALERT_BROKEN_INPAGE_ANCHOR',
          level: 'warning',
          module: 'l',
          message: `In-page anchor link references [${href}], but no element with [id="${targetId}"] exists.`
        });
      }
    }
  }

  if (!isTabbable && !isAriaHiddenInTree(el)) {
    alerts.push({
      id: 'l-not-tabbable',
      code: 'ALERT_INTERACTIVE_NOT_TABBABLE',
      level: 'warning',
      module: 'l',
      message: `Interactive <${tag}> is not in the sequential keyboard tab order.`
    });
  }

  return alerts;
}

  // === Module: andi\tandi.ts ===
/**
 * tANDI — Data Tables & Semantic ARIA Grids Inspector Module (TypeScript)
 * Refactored from legacy tandi.js into strict, zero-dependency TypeScript.
 * Supports both native <table>/<tr>/<th>/<td> and ARIA role="table"|"grid"|"treegrid",
 * role="row", role="columnheader", role="rowheader", role="cell", role="gridcell".
 */


const TANDI_VERSION = '8.1.0-ts';

function evaluateTableElement(
  el,
  tag,
  role,
  computed
) {
  const alerts = [];

  const isTableContainer =
    (tag === 'table' && role !== 'presentation' && role !== 'none') ||
    role === 'table' ||
    role === 'grid' ||
    role === 'treegrid';

  const isHeaderCell =
    tag === 'th' || role === 'columnheader' || role === 'rowheader';

  const isDataCell =
    tag === 'td' || role === 'cell' || role === 'gridcell';

  if (isTableContainer) {
    const labelDescriptor = tag === 'table' ? 'Data <table>' : `Semantic [role="${role}"] table`;
    const thCount = el.querySelectorAll('th, [role="columnheader"], [role="rowheader"]').length;
    if (thCount === 0) {
      alerts.push({
        id: 't-no-th',
        code: 'ALERT_TABLE_NO_TH',
        level: 'danger',
        module: 't',
        message: `${labelDescriptor} has no <th> header cells or [role="columnheader"/"rowheader"].`
      });
    }
    const rowCount = el.querySelectorAll('tr, [role="row"]').length;
    if (rowCount === 0) {
      alerts.push({
        id: 't-no-rows',
        code: 'ALERT_TABLE_NO_ROWS',
        level: 'danger',
        module: 't',
        message: `${labelDescriptor} has no <tr> or [role="row"] elements.`
      });
    }
    const hasScope = el.querySelectorAll('th[scope]').length > 0;
    const hasHeaders = el.querySelectorAll('[headers]').length > 0;
    if (hasScope && hasHeaders) {
      alerts.push({
        id: 't-mixed-scope-headers',
        code: 'ALERT_TABLE_MIXED_SCOPE_HEADERS',
        level: 'danger',
        module: 't',
        message: 'Table mixes [scope] and [headers] associations, which can cause inconsistent screen reader announcements.'
      });
    }
    if (!computed.accName) {
      alerts.push({
        id: 't-no-name',
        code: 'ALERT_TABLE_NO_NAME',
        level: 'caution',
        module: 't',
        message: `${labelDescriptor} has no accessible name, <caption>, aria-label, or aria-labelledby.`
      });
    }
  } else if (isHeaderCell) {
    if (!computed.accName) {
      const hdrDesc = tag === 'th' ? '<th>' : `[role="${role}"]`;
      alerts.push({
        id: 't-empty-th',
        code: 'ALERT_EMPTY_TH',
        level: 'caution',
        module: 't',
        message: `Empty ${hdrDesc} table header cell.`
      });
    }
  } else if (isDataCell) {
    // Check for broken [headers] IDREF references
    const headersGroup = computed.idRefGroups.find((g) => g.attribute === 'headers');
    if (headersGroup) {
      const missingIds = headersGroup.items.filter((i) => !i.exists).map((i) => i.id);
      if (missingIds.length > 0) {
        alerts.push({
          id: 't-missing-headers-ref',
          code: 'ALERT_MISSING_HEADERS_REF',
          level: 'danger',
          module: 't',
          message: `[headers] attribute references missing ID(s): "${missingIds.join(', ')}".`
        });
      }
    }
    // Check if cell is inside a semantic table/grid but has no associated headers
    if (
      computed.tableAssociation &&
      computed.tableAssociation.columnHeaders.length === 0 &&
      computed.tableAssociation.rowHeaders.length === 0 &&
      computed.accName
    ) {
      const cellDesc = tag === 'td' ? '<td>' : `[role="${role}"]`;
      alerts.push({
        id: 't-cell-no-headers',
        code: 'ALERT_CELL_NO_HEADERS',
        level: 'caution',
        module: 't',
        message: `Table cell ${cellDesc} has no associated column or row headers (<th> or [role="columnheader"/"rowheader"]).`
      });
    }
  }

  return alerts;
}

  // === Module: andi\sandi.ts ===
/**
 * sANDI — Structures & Headings Inspector Module (TypeScript)
 * Refactored from legacy sandi.js into strict, zero-dependency TypeScript.
 */


const SANDI_VERSION = '8.0.0-ts';

function evaluateStructureElement(
  el,
  tag,
  role,
  computed,
  lastHeadingLevel,
  setLastHeadingLevel
) {
  const alerts = [];

  let headingLevel = null;
  if (/^h[1-6]$/.test(tag)) {
    headingLevel = parseInt(tag.slice(1), 10);
  } else if (role === 'heading') {
    const ariaLevel = parseInt(el.getAttribute('aria-level') || '2', 10);
    headingLevel = Number.isNaN(ariaLevel) ? 2 : ariaLevel;
  }

  if (headingLevel !== null) {
    if (!computed.accName) {
      alerts.push({
        id: 's-empty-heading',
        code: 'ALERT_EMPTY_HEADING',
        level: 'danger',
        module: 's',
        message: `Empty heading (level ${headingLevel}) has no accessible text.`
      });
    }
    if (lastHeadingLevel > 0 && headingLevel > lastHeadingLevel + 1) {
      alerts.push({
        id: 's-skipped-heading',
        code: 'ALERT_HEADING_SKIP',
        level: 'warning',
        module: 's',
        message: `Heading level skipped from <h${lastHeadingLevel}> to <h${headingLevel}>.`
      });
    }
    setLastHeadingLevel(headingLevel);
  }

  return alerts;
}


  // === Module: andi\candi.ts ===
/**
 * cANDI — Color Contrast Inspector Module (TypeScript)
 * Refactored from legacy candi.js into strict, zero-dependency TypeScript.
 */


const CANDI_VERSION = '8.0.0-ts';


function evaluateColorContrastElement(
  el,
  getStyle,
  computeRatio
) {
  const alerts = [];
  const directText = getDirectTextContent(el);
  if (!directText) {
    return { alerts };
  }

  const contrast = computeRatio(el, getStyle);
  if (contrast.ratio < contrast.requiredRatio) {
    alerts.push({
      id: 'c-low-contrast',
      code: 'ALERT_LOW_CONTRAST',
      level: 'danger',
      module: 'c',
      message: `Insufficient color contrast ${contrast.ratio}:1 (WCAG AA minimum is ${contrast.requiredRatio}:1).`
    });
  }

  return {
    alerts,
    contrastRatio: contrast.ratio,
    requiredContrastRatio: contrast.requiredRatio
  };
}


  // === Module: andi\handi.ts ===
/**
 * hANDI — Hidden Content Inspector Module (TypeScript)
 * Refactored from legacy handi.js into strict, zero-dependency TypeScript.
 */


const HANDI_VERSION = '8.0.0-ts';

function evaluateHiddenElement(
  el,
  isFocusable,
  getStyle
) {
  const alerts = [];
  const style = getStyle(el);

  if (el.getAttribute('aria-hidden') === 'true' && isFocusable) {
    alerts.push({
      id: 'h-aria-hidden-focus',
      code: 'ALERT_ARIA_HIDDEN_FOCUSABLE',
      level: 'danger',
      module: 'h',
      message: 'Element has [aria-hidden="true"] while remaining keyboard focusable.'
    });
  } else if (style.display === 'none' || style.visibility === 'hidden' || el.hasAttribute('hidden')) {
    alerts.push({
      id: 'h-hidden-dom',
      code: 'ALERT_HIDDEN_CONTENT',
      level: 'caution',
      module: 'h',
      message: 'Element is visually and programmatically hidden from assistive technologies.'
    });
  } else if (isAriaHiddenInTree(el) && isFocusable) {
    alerts.push({
      id: 'h-ancestor-aria-hidden-focus',
      code: 'ALERT_ANCESTOR_ARIA_HIDDEN_FOCUSABLE',
      level: 'danger',
      module: 'h',
      message: 'Focusable element is inside an [aria-hidden="true"] container.'
    });
  }

  return alerts;
}


  // === Module: andi\iandi.ts ===
/**
 * iANDI — Iframes & Step-In Inspector Module (TypeScript)
 * Refactored from legacy iandi.js into strict, zero-dependency TypeScript.
 */


const IANDI_VERSION = '8.0.0-ts';


function evaluateIframeElement(
  el,
  tag,
  computed
) {
  const alerts = [];
  if (tag !== 'iframe') {
    return {
      alerts,
      isIframe: false,
      iframeCanStepIn: false,
      iframeSrc: ''
    };
  }

  const iframeEl = el;
  const canStepIn = canStepIntoIframe(iframeEl);
  const iframeSrc =
    iframeEl.getAttribute('src') ||
    (iframeEl.hasAttribute('srcdoc') ? '[inline srcdoc]' : '[about:blank]');

  if (!computed.accName) {
    alerts.push({
      id: 'i-no-title',
      code: 'ALERT_IFRAME_NO_TITLE',
      level: 'danger',
      module: 'i',
      message: '<iframe> has no [title] or [aria-label] to identify its purpose to screen readers.'
    });
  }

  return {
    alerts,
    isIframe: true,
    iframeCanStepIn: canStepIn,
    iframeSrc
  };
}


  // === Module: src\analyzers.ts ===
/**
 * ANDI-Gen1 — Multi-Module Accessibility Analysis & Element Inventory Engine
 * Supports running individual modules (f, g, l, t, s, c, h, i) OR the unified
 * `'all'` mode (placed as the last option in the mode droplist), semantic ARIA role
 * detection, and building the full Element Inventory array for the Fly-In Drawer.
 */


const INTERACTIVE_ARIA_WIDGET_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
  'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'tab', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'treeitem'
]);

const FORM_CONTROL_ROLES = new Set([
  'textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio',
  'switch', 'slider', 'spinbutton'
]);

const LANDMARK_TAGS = new Set([
  'main', 'nav', 'header', 'footer', 'aside', 'form', 'region', 'search'
]);

const LANDMARK_ROLES = new Set([
  'banner', 'navigation', 'main', 'contentinfo', 'complementary', 'region', 'search', 'form'
]);

function analyzePage(
  pageIndex,
  mode,
  frameContext = 'top'
) {
  const records = [];
  let elementCounter = 0;

  const linkSignatures = new Map();
  const buttonNames = new Map();
  const accessKeyMap = new Map();
  let previousHeadingLevel = 0;

  const candidatePool =
    mode === 'h' || mode === 'all' ? pageIndex.allElements : pageIndex.visibleElements;
  const visibleSet = new Set(pageIndex.visibleElements);

  for (const el of candidatePool) {
    const isVisible = visibleSet.has(el);
    const tag = el.tagName.toLowerCase();
    const role = getValidRole(el);
    const focusInfo = getFocusability(el);
    const selector = getElementSelector(el);

    const matchedModules = getMatchedModulesForElement(
      el,
      tag,
      role,
      focusInfo.isFocusable,
      isVisible,
      pageIndex
    );

    const existingNote = readElementNote(el, selector, frameContext);
    const shouldInspect =
      mode === 'all'
        ? matchedModules.length > 0 || existingNote !== null
        : matchedModules.includes(mode) || existingNote !== null;

    if (!shouldInspect) {
      continue;
    }

    const computed = computeAccessibleData(el, pageIndex);
    const alerts = [];

    const activeModules = mode === 'all' ? matchedModules : [mode];

    for (const mod of activeModules) {
      switch (mod) {
        case 'f':
          runFocusableChecks(el, tag, role, focusInfo, computed, pageIndex, alerts);
          break;
        case 'g':
          runGraphicsChecks(el, tag, role, focusInfo.isTabbable, computed, alerts);
          break;
        case 'l':
          runLinksButtonsChecks(el, tag, role, focusInfo, computed, alerts);
          break;
        case 't':
          runTableChecks(el, tag, role, computed, alerts);
          break;
        case 's':
          prevHeadingCheck(el, tag, role, computed, alerts, (lvl) => {
            if (previousHeadingLevel > 0 && lvl - previousHeadingLevel > 1) {
              pushAlert(
                alerts,
                's',
                'ALERT_S_HEADING_SKIP',
                'warning',
                `Heading level skipped from H${previousHeadingLevel} to H${lvl}.`
              );
            }
            previousHeadingLevel = lvl;
          });
          break;
        case 'c':
          if (isVisible) {
            runContrastChecks(el, computed, pageIndex, alerts);
          }
          break;
        case 'h':
          runHiddenChecks(el, isVisible, focusInfo.isFocusable, alerts);
          break;
        case 'i':
          runIframeChecks(el, focusInfo, computed, alerts);
          break;
      }
    }

    if (el.id) {
      const idMatches = pageIndex.idMap.get(el.id);
      if (idMatches && idMatches.length > 1) {
        pushAlert(
          alerts,
          activeModules[0] || 'f',
          'ALERT_DUP_ID',
          'danger',
          `Duplicate element [id="${el.id}"] (${idMatches.length} instances on page); IDs must be unique.`
        );
      }
    }

    elementCounter += 1;
    const rawAccessKey = el.getAttribute('accesskey')?.trim().toUpperCase() || null;
    const isIframe = tag === 'iframe';
    const iframeAccessible = isIframe ? canStepIntoIframe(el) : false;
    const iframeSrc = isIframe ? el.getAttribute('src') || '(inline srcdoc)' : '';

    const record = {
      index: elementCounter,
      element: el,
      selector,
      domSnippet: extractDomNodeSnippet(el),
      tagName: formatTagName(el),
      role,
      semanticRole: computed.semanticRole,
      isFocusable: focusInfo.isFocusable,
      isTabbable: focusInfo.isTabbable,
      tabIndexValue: focusInfo.tabIndexValue,
      accessKey: rawAccessKey,
      accName: computed.accName,
      accDesc: computed.accDesc,
      accGroup: computed.accGroup,
      screenReaderOutput: computed.screenReaderOutput,
      addOnProps: computed.addOnProps,
      components: computed.components,
      idRefGroups: computed.idRefGroups,
      tableAssociation: computed.tableAssociation,
      alerts,
      modulesMatched: matchedModules,
      note: existingNote,
      coordinates: getElementCoordinates(el),
      isIframe,
      iframeAccessible,
      iframeSrc
    };

    if (rawAccessKey && activeModules.includes('f')) {
      if (rawAccessKey.length > 1) {
        pushAlert(
          record.alerts,
          'f',
          'ALERT_ACCESSKEY_MULTI',
          'danger',
          `[accesskey="${rawAccessKey}"] has more than one character.`
        );
      } else {
        const prev = accessKeyMap.get(rawAccessKey);
        if (prev) {
          pushAlert(
            record.alerts,
            'f',
            'ALERT_ACCESSKEY_DUP',
            'danger',
            `Duplicate [accesskey="${rawAccessKey}"] also used on element #${prev.index}.`
          );
        } else {
          accessKeyMap.set(rawAccessKey, record);
        }
      }
    }

    if (activeModules.includes('l') && computed.accName) {
      const sig = `${computed.accName.toLowerCase()}||${computed.accDesc.toLowerCase()}`;
      if (tag === 'a' || role === 'link') {
        const href = (el.getAttribute('href') || '').trim();
        const existing = linkSignatures.get(sig);
        if (existing && existing.href !== href) {
          pushAlert(
            record.alerts,
            'l',
            'ALERT_LINK_AMBIGUOUS',
            'warning',
            `Ambiguous Link: shares accessible name "${computed.accName}" with element #${existing.record.index} but points to a different href.`
          );
        } else if (!existing) {
          linkSignatures.set(sig, { href, record });
        }
      } else if (tag === 'button' || role === 'button') {
        const existingBtn = buttonNames.get(sig);
        if (existingBtn) {
          pushAlert(
            record.alerts,
            'l',
            'ALERT_BUTTON_NON_UNIQUE',
            'warning',
            `Non-unique button: shares name/description "${computed.accName}" with element #${existingBtn.index}.`
          );
        } else {
          buttonNames.set(sig, record);
        }
      }
    }

    records.push(record);
  }

  return records;
}

/**
 * Builds a categorized array of interface elements for the Element Inventory Fly-In Drawer.
 * The inventory is scoped to the SELECTED ANDI mode: in a specific mode (f, g, l, t, s, c, h, i)
 * only elements that module actually inspects are listed; `all` lists every categorized visible element.
 */
function buildPageInventory(
  pageIndex,
  records,
  mode
) {
  const recordByElement = new Map();
  for (const r of records) {
    recordByElement.set(r.element, r);
  }

  const inventory = [];
  let invId = 0;

  const candidatePool =
    mode === 'h' ? pageIndex.allElements : pageIndex.visibleElements;
  const visibleSet = new Set(pageIndex.visibleElements);

  for (const el of candidatePool) {
    const tag = el.tagName.toLowerCase();
    const role = getValidRole(el);
    const rec = recordByElement.get(el) || null;

    let categories = classifyInventoryCategories(el, tag, role);

    if (mode === 'all') {
      if (!visibleSet.has(el) || categories.length === 0) {
        continue;
      }
    } else {
      const matched = getMatchedModulesForElement(
        el,
        tag,
        role,
        getFocusability(el).isFocusable,
        visibleSet.has(el),
        pageIndex
      );
      if (!matched.includes(mode)) {
        continue;
      }
      if (categories.length === 0) {
        // Table cells are summarized by their parent table; every other uncategorized
        // element inspected by this module is listed under "Other".
        if (mode === 't') {
          continue;
        }
        categories = ['other'];
      }
    }

    const computed = rec ? null : computeAccessibleData(el, pageIndex);
    const accName = rec ? rec.accName : computed.accName;
    const accDesc = rec ? rec.accDesc : computed.accDesc;
    const semanticRole = rec ? rec.semanticRole : computed.semanticRole;
    const domSnippet = rec ? rec.domSnippet : extractDomNodeSnippet(el);
    const selector = rec ? rec.selector : getElementSelector(el);
    const coordinates = rec ? rec.coordinates : getElementCoordinates(el);
    const alertCount = rec ? rec.alerts.length : 0;
    const tableAssoc = rec ? rec.tableAssociation : computed.tableAssociation;
    const contrast = rec ? rec.addOnProps['contrast'] || '' : '';

    for (const category of categories) {
      invId += 1;
      const details = formatInventoryDetails(el, tag, role, category, tableAssoc, contrast);
      inventory.push({
        id: `inv-${invId}`,
        category,
        inspectedIndex: rec ? rec.index : null,
        element: el,
        tagName: formatTagName(el),
        role,
        semanticRole: semanticRole || role || tag,
        domSnippet,
        selector,
        accName,
        accDesc,
        details,
        alertCount,
        coordinates
      });
    }
  }

  return inventory;
}

function classifyInventoryCategories(
  el,
  tag,
  role
) {
  const cats = [];

  // 1. Tables & Semantic ARIA Tables/Grids (plus table cells/headers if part of table structure)
  if (
    (tag === 'table' && role !== 'presentation' && role !== 'none') ||
    role === 'table' ||
    role === 'grid' ||
    role === 'treegrid'
  ) {
    cats.push('tables');
  }

  // 2. Links
  if (tag === 'a' || role === 'link') {
    cats.push('links');
  }

  // 3. Buttons
  const inputType = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : '';
  if (
    tag === 'button' ||
    role === 'button' ||
    tag === 'summary' ||
    (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(inputType))
  ) {
    cats.push('buttons');
  }

  // 4. Form Controls (Native & ARIA widget roles)
  if (
    (tag === 'input' && !['button', 'submit', 'reset', 'image', 'hidden'].includes(inputType)) ||
    tag === 'select' ||
    tag === 'textarea' ||
    tag === 'meter' ||
    tag === 'progress' ||
    tag === 'output' ||
    FORM_CONTROL_ROLES.has(role)
  ) {
    cats.push('formControls');
  }

  // 5. Landmarks
  if (
    LANDMARK_TAGS.has(tag) ||
    LANDMARK_ROLES.has(role) ||
    (tag === 'section' && (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')))
  ) {
    cats.push('landmarks');
  }

  // 6. Headings
  if (/^h[1-6]$/.test(tag) || role === 'heading') {
    cats.push('headings');
  }

  // 7. Graphics
  if (
    tag === 'img' ||
    tag === 'svg' ||
    tag === 'canvas' ||
    tag === 'area' ||
    role === 'img' ||
    role === 'image' ||
    role === 'figure' ||
    tag === 'figure'
  ) {
    cats.push('graphics');
  }

  // 8. Dialogs, Lists & Live Regions
  if (
    tag === 'dialog' ||
    role === 'dialog' ||
    role === 'alertdialog' ||
    el.hasAttribute('aria-live') ||
    ['alert', 'status', 'log', 'marquee', 'timer'].includes(role)
  ) {
    cats.push('dialogsLive');
  }

  // 9. Iframes
  if (tag === 'iframe') {
    cats.push('iframes');
  }

  return cats;
}

function formatInventoryDetails(
  el,
  tag,
  role,
  category,
  tableAssoc,
  contrast = ''
) {
  switch (category) {
    case 'other': {
      const base = `<${tag}${role ? ` role="${role}"` : ''}>`;
      return contrast ? `${base} • contrast ${contrast}` : base;
    }
    case 'tables': {
      const kind = tag === 'table' ? '<table>' : `[role="${role}"]`;
      if (tableAssoc) {
        const hdrs = [...tableAssoc.columnHeaders, ...tableAssoc.rowHeaders];
        const hdrSummary = hdrs.length > 0 ? `Headers: ${hdrs.slice(0, 5).join(', ')}` : 'No headers detected';
        return `${kind} • ${tableAssoc.rowCount} rows × ${tableAssoc.colCount} cols • ${hdrSummary}`;
      }
      return kind;
    }
    case 'links': {
      const href = el.getAttribute('href');
      return href ? `href="${href}"` : role === 'link' ? '[role="link"] (no href)' : '<a> (no href)';
    }
    case 'buttons': {
      const ariaExpanded = el.getAttribute('aria-expanded');
      const ariaPressed = el.getAttribute('aria-pressed');
      const extra = [];
      if (role === 'button' && tag !== 'button') extra.push(`<${tag} role="button">`);
      if (ariaExpanded) extra.push(`expanded=${ariaExpanded}`);
      if (ariaPressed) extra.push(`pressed=${ariaPressed}`);
      return extra.join(' • ') || `<${formatTagName(el)}>`;
    }
    case 'formControls': {
      const extra = [];
      if (role && FORM_CONTROL_ROLES.has(role) && !['input', 'select', 'textarea'].includes(tag)) {
        extra.push(`<${tag} role="${role}">`);
      } else {
        extra.push(`<${formatTagName(el)}>`);
      }
      if (el.hasAttribute('required') || el.getAttribute('aria-required') === 'true') {
        extra.push('required');
      }
      return extra.join(' • ');
    }
    case 'landmarks': {
      const lmRole = role || (tag === 'header' ? 'banner' : tag === 'footer' ? 'contentinfo' : tag === 'nav' ? 'navigation' : tag === 'aside' ? 'complementary' : tag);
      return `Landmark: ${lmRole} (<${tag}>)`;
    }
    case 'headings': {
      const lvl = el.getAttribute('aria-level') || (/^h[1-6]$/.test(tag) ? tag.charAt(1) : '2');
      return `Level H${lvl} (${role === 'heading' && !/^h[1-6]$/.test(tag) ? `<${tag} role="heading" aria-level="${lvl}">` : `<${tag}>`})`;
    }
    case 'graphics': {
      const alt = el.getAttribute('alt');
      if (alt === '') return 'Decorative (alt="")';
      return `<${tag}${role ? ` role="${role}"` : ''}>`;
    }
    case 'dialogsLive': {
      const live = el.getAttribute('aria-live');
      return live ? `aria-live="${live}"` : `role="${role || tag}"`;
    }
    case 'iframes': {
      const src = el.getAttribute('src') || '(inline srcdoc)';
      return `src="${src}"`;
    }
  }
}

function getMatchedModulesForElement(
  el,
  tag,
  role,
  isFocusable,
  isVisible,
  pageIndex
) {
  const matched = [];

  if (!isVisible || el.getAttribute('aria-hidden') === 'true') {
    if (
      el.getAttribute('aria-hidden') === 'true' ||
      isFocusable ||
      el.querySelector('input, button, a[href], select, textarea, [tabindex]')
    ) {
      matched.push('h');
    }
    if (!isVisible) {
      return matched;
    }
  }

  if (isFocusable || tag === 'canvas' || INTERACTIVE_ARIA_WIDGET_ROLES.has(role)) {
    matched.push('f');
  }

  if (
    tag === 'img' ||
    tag === 'svg' ||
    tag === 'canvas' ||
    tag === 'area' ||
    tag === 'figure' ||
    role === 'img' ||
    role === 'image' ||
    role === 'figure' ||
    (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'image')
  ) {
    matched.push('g');
  }

  if (
    tag === 'a' ||
    tag === 'button' ||
    role === 'link' ||
    role === 'button' ||
    (tag === 'input' &&
      ['button', 'submit', 'reset', 'image'].includes((el.getAttribute('type') || '').toLowerCase()))
  ) {
    matched.push('l');
  }

  if (
    tag === 'table' ||
    role === 'table' ||
    role === 'grid' ||
    role === 'treegrid' ||
    tag === 'th' ||
    tag === 'td' ||
    role === 'columnheader' ||
    role === 'rowheader' ||
    role === 'cell' ||
    role === 'gridcell'
  ) {
    matched.push('t');
  }

  if (
    /^h[1-6]$/.test(tag) ||
    role === 'heading' ||
    LANDMARK_TAGS.has(tag) ||
    LANDMARK_ROLES.has(role) ||
    (tag === 'section' && (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby'))) ||
    el.hasAttribute('aria-live') ||
    ['alert', 'status', 'log', 'marquee', 'timer', 'dialog', 'alertdialog'].includes(role) ||
    tag === 'dialog' ||
    tag === 'li' ||
    role === 'listitem' ||
    role === 'list'
  ) {
    matched.push('s');
  }

  if (hasDirectNonEmptyTextNode(el) && !['script', 'style', 'noscript', 'title'].includes(tag)) {
    matched.push('c');
  }

  if (tag === 'iframe') {
    matched.push('i');
  }

  void pageIndex;
  return matched;
}

function runFocusableChecks(
  el,
  tag,
  role,
  focusInfo,
  computed,
  pageIndex,
  alerts
) {
  const fAlerts = evaluateFocusableElement(el, tag, focusInfo, computed, pageIndex);
  for (const a of fAlerts) {
    alerts.push(a);
  }
  if (
    role &&
    FORM_CONTROL_ROLES.has(role) &&
    !focusInfo.isFocusable &&
    el.getAttribute('aria-disabled') !== 'true'
  ) {
    pushAlert(
      alerts,
      'f',
      'ALERT_ARIA_WIDGET_NOT_FOCUSABLE',
      'warning',
      `Semantic ARIA control [role="${role}"] on <${tag}> is not keyboard focusable (missing tabindex="0").`
    );
  }
  if (computed.accName.length > 250) {
    pushAlert(
      alerts,
      'f',
      'ALERT_EXCESSIVE_NAME',
      'warning',
      `Accessible name length (${computed.accName.length} chars) exceeds 250 characters; consider condensing.`
    );
  }
}

function runGraphicsChecks(
  el,
  tag,
  role,
  isTabbable,
  computed,
  alerts
) {
  const gAlerts = evaluateGraphicElement(el, tag, role, isTabbable, computed);
  for (const a of gAlerts) {
    alerts.push(a);
  }
}

function runLinksButtonsChecks(
  el,
  tag,
  role,
  focusInfo,
  computed,
  alerts
) {
  const lAlerts = evaluateLinkOrButtonElement(el, tag, role, focusInfo.isTabbable, computed);
  for (const a of lAlerts) {
    alerts.push(a);
  }
}

function runTableChecks(
  el,
  tag,
  role,
  computed,
  alerts
) {
  const tAlerts = evaluateTableElement(el, tag, role, computed);
  for (const a of tAlerts) {
    alerts.push(a);
  }
}

function prevHeadingCheck(
  el,
  tag,
  role,
  computed,
  alerts,
  onLevel
) {
  if (/^h[1-6]$/.test(tag) || role === 'heading') {
    const nativeLevel = /^h[1-6]$/.test(tag) ? Number(tag.charAt(1)) : null;
    const ariaLevelRaw = el.getAttribute('aria-level');
    const ariaLevel = ariaLevelRaw ? Number(ariaLevelRaw) : null;

    if (nativeLevel && ariaLevel && nativeLevel !== ariaLevel) {
      pushAlert(
        alerts,
        's',
        'ALERT_HEADING_CONFLICT',
        'warning',
        `Heading tag <${tag}> conflicts with [aria-level="${ariaLevel}"].`
      );
    }
    const effectiveLevel = ariaLevel || nativeLevel || 2;
    onLevel(effectiveLevel);

    if (!computed.accName) {
      pushAlert(
        alerts,
        's',
        'ALERT_EMPTY_HEADING',
        'danger',
        `Heading <${tag}${role === 'heading' ? ' role="heading"' : ''}> has no text content or accessible name.`
      );
    }
  } else if (tag === 'li' || role === 'listitem') {
    const listParent = el.closest('ul, ol, menu, [role="list"], [role="menu"], [role="menubar"], [role="tablist"]');
    if (!listParent) {
      const desc = tag === 'li' ? '<li>' : `[role="listitem"]`;
      pushAlert(
        alerts,
        's',
        'ALERT_ORPHAN_LI',
        'danger',
        `${desc} element is not contained within a semantic list container (<ul>, <ol>, or [role="list"]).`
      );
    }
  }
}

function runContrastChecks(
  el,
  computed,
  pageIndex,
  alerts
) {
  if ((el).disabled || el.getAttribute('aria-disabled') === 'true') {
    return;
  }
  const style = pageIndex.getStyle(el);
  const fg = parseRgbColor(style.color);
  const bg = resolveEffectiveBackgroundColor(el, pageIndex);

  if (!fg || !bg) {
    return;
  }

  const ratio = computeContrastRatio(fg, bg);
  const fontSizePx = parseFloat(style.fontSize) || 16;
  const fontWeight = parseInt(style.fontWeight, 10) || (style.fontWeight === 'bold' ? 700 : 400);
  const isLargeText = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
  const minRatio = isLargeText ? 3.0 : 4.5;

  computed.addOnProps['contrast'] = `${ratio.toFixed(2)}:1 (min ${minRatio.toFixed(1)}:1)`;

  if (ratio < minRatio) {
    pushAlert(
      alerts,
      'c',
      'ALERT_LOW_CONTRAST',
      'danger',
      `Text contrast ratio is ${ratio.toFixed(2)}:1, below the WCAG AA minimum of ${minRatio.toFixed(1)}:1.`
    );
  }
}

function runHiddenChecks(
  el,
  isVisible,
  isFocusable,
  alerts
) {
  if (el.getAttribute('aria-hidden') === 'true') {
    if (isFocusable || el.querySelector('a[href], button, input, select, textarea, [tabindex="0"]')) {
      pushAlert(
        alerts,
        'h',
        'ALERT_ARIA_HIDDEN_FOCUSABLE',
        'danger',
        `[aria-hidden="true"] element is focusable or contains focusable descendants.`
      );
    } else {
      pushAlert(
        alerts,
        'h',
        'ALERT_ARIA_HIDDEN_INFO',
        'caution',
        `Element is hidden from assistive technologies via [aria-hidden="true"].`
      );
    }
  } else if (!isVisible && isFocusable) {
    pushAlert(
      alerts,
      'h',
      'ALERT_HIDDEN_FOCUSABLE',
      'caution',
      `Visually hidden element has focusable markup.`
    );
  }
}

function runIframeChecks(
  el,
  focusInfo,
  computed,
  alerts
) {
  if (!computed.accName) {
    pushAlert(
      alerts,
      'i',
      'ALERT_IFRAME_NO_TITLE',
      'danger',
      `<iframe> has no accessible name or [title] attribute.`
    );
  }
  if (focusInfo.tabIndexValue !== null && focusInfo.tabIndexValue < 0) {
    pushAlert(
      alerts,
      'i',
      'ALERT_IFRAME_NEG_TABINDEX',
      'warning',
      `<iframe> has negative [tabindex="${focusInfo.tabIndexValue}"], which may trap or block keyboard access to its contents.`
    );
  }
}

function pushAlert(
  alerts,
  module,
  code,
  level,
  message
) {
  if (alerts.some((a) => a.code === code && a.message === message)) {
    return;
  }
  alerts.push({
    id: `${module}-${code}-${alerts.length + 1}`,
    code,
    level,
    module,
    message
  });
}

function hasDirectNonEmptyTextNode(el) {
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === Node.TEXT_NODE && n.nodeValue && n.nodeValue.trim().length > 0) {
      return true;
    }
  }
  return false;
}


function parseRgbColor(cssColor) {
  const m = cssColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
  if (!m) {
    return null;
  }
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] !== undefined ? Number(m[4]) : 1
  };
}

function resolveEffectiveBackgroundColor(el, pageIndex) {
  let curr = el;
  while (curr) {
    const bgStr = pageIndex.getStyle(curr).backgroundColor;
    const parsed = parseRgbColor(bgStr);
    if (parsed && parsed.a > 0.05) {
      return parsed;
    }
    curr = curr.parentElement;
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

function computeContrastRatio(fg, bg) {
  const lum1 = relativeLuminance(fg.r, fg.g, fg.b);
  const lum2 = relativeLuminance(bg.r, bg.g, bg.b);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

function relativeLuminance(r8, g8, b8) {
  const transform = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * transform(r8) + 0.7152 * transform(g8) + 0.0722 * transform(b8);
}

  // === Module: src\ui-shadow.ts ===
/**
 * ANDI-Gen1 — Shadow DOM UI Controller (High-Contrast WCAG AAA & Ergonomic 3-Zone Workflow)
 * Implements:
 * 1. Actionable `Notes (x)` pill that opens the Fly-In Notes Drawer with ALL saved notes + active note editor
 * 2. Eliminates redundant `+Add Note` / toolbar `Note` duplication (single global `Notes (x)` + contextual `Note` on element)
 * 3. Visual Defect Report Modal that renders embedded PNG screenshots (`<img>`), plus HTML/MD/JSON/CSV export
 * 4. Defect Report strictly shows ANDI-detected defects (`alerts.length > 0`) PLUS any tester notes (`note !== null`)
 *    with exact DOM coordinates (`x, y, pageX, pageY, width × height`), browser/OS info, and timestamps
 * 5. WCAG AAA (7:1 to 20:1) high-contrast Dark & Light themes
 * 6. Ergonomic 3-Zone control placement (Scope -> Telemetry/Triage -> Workspace Chrome, with Prev/Next in Element Navigator)
 */


const PAGE_HIGHLIGHT_STYLE_ID = 'andi-gen1-page-highlights-css';
const STORAGE_KEY_THEME = 'ANDI_GEN1_THEME';
const STORAGE_KEY_DOCK = 'ANDI_GEN1_DOCK';
const STORAGE_KEY_SIZE_TOP = 'ANDI_GEN1_SIZE_TOP';
const STORAGE_KEY_SIZE_SIDE = 'ANDI_GEN1_SIZE_SIDE';

// Resize limits for the user-draggable inspector edge.
const DEFAULT_TOP_HEIGHT = 240;
const MIN_TOP_HEIGHT = 90;
const DEFAULT_SIDE_WIDTH = 440;
const MIN_SIDE_WIDTH = 300;
const RESIZE_KEYBOARD_STEP = 16;

// Requirement: Move ALL mode as the last item in droplist
const DROPLIST_MODES_ORDER = ['f', 'g', 'l', 't', 's', 'c', 'h', 'i', 'all'];

const MODULE_LABELS = {
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

class AndiGen1Controller {
  records = [];
  inventoryItems = [];
  elementToRecord = new WeakMap();
  activeIndex = 0;
  laserEnabled = true;
  highlightedIdRefEl = null;

  // Theme & Dock settings
  theme = 'light';
  dock = 'top';

  // User-adjustable inspector size (height when docked top, width when docked left/right).
  // topHeight 0 means "auto" — the grid keeps its content-driven max-height until the
  // tester actually drags the edge, so a sparse page still gets a compact inspector.
  topHeight = 0;
  sideWidth = DEFAULT_SIDE_WIDTH;

  // Iframe Step-In state
  activeDocument = document;
  activeFrameLabel = 'Top Document';
  steppedInIframe = null;
  detectedIframes = [];

  // CSP Detector & Resolver
  cspGuard = new CspGuard();

  hostEl = null;
  shadow = null;
  barResizeObserver = null;
  laserSvg = null;
  laserLine = null;

  // UI Element References inside Shadow DOM

  // Fly-in Note Drawer References
  currentScreenshotDataUrl = '';

  // Fly-in Element Inventory Drawer References
  activeInventoryCategory = 'all';
  inventorySearchQuery = '';

  // Modal (Visual/Code Defect Report)

  // Bound delegated handlers

  constructor(initialMode = 'f') {
    this.mode = initialMode;
    this.loadPreferences();
    this.boundMouseOver = this.handleDocumentMouseOver.bind(this);
    this.boundFocusIn = this.handleDocumentFocusIn.bind(this);
    this.boundKeyDown = this.handleDocumentKeyDown.bind(this);
  }

  loadPreferences() {
    try {
      const savedTheme = window.localStorage.getItem(STORAGE_KEY_THEME);
      if (savedTheme === 'dark' || savedTheme === 'light') {
        this.theme = savedTheme;
      }
      const savedDock = window.localStorage.getItem(STORAGE_KEY_DOCK);
      if (savedDock && ['top', 'left', 'right'].includes(savedDock)) {
        this.dock = savedDock;
      }
      const savedTop = Number(window.localStorage.getItem(STORAGE_KEY_SIZE_TOP));
      if (Number.isFinite(savedTop) && savedTop >= MIN_TOP_HEIGHT) {
        this.topHeight = savedTop;
      }
      const savedSide = Number(window.localStorage.getItem(STORAGE_KEY_SIZE_SIDE));
      if (Number.isFinite(savedSide) && savedSide >= MIN_SIDE_WIDTH) {
        this.sideWidth = savedSide;
      }
    } catch {
      // Ignore storage errors
    }
  }

  launch(mode) {
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
    this.observeBarResize();
    this.syncTopDockOffset();
  }

  setMode(mode) {
    this.mode = mode;
    const selectEl = this.shadow?.getElementById('andi-module-select');
    if (selectEl && selectEl.value !== mode) {
      selectEl.value = mode;
    }
    this.runScan();
  }

  setTheme(theme) {
    this.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY_THEME, this.theme);
    } catch {
      // ignore
    }
    const themeBtn = this.shadow?.getElementById('andi-theme-btn') | null;
    if (themeBtn) {
      themeBtn.textContent = this.theme === 'dark' ? 'Light Theme' : 'Dark Theme';
    }
    this.applyDockAndTheme();
  }

  setDock(dock) {
    this.dock = dock;
    try {
      window.localStorage.setItem(STORAGE_KEY_DOCK, this.dock);
    } catch {
      // ignore
    }
    const dockSelect = this.shadow?.getElementById('andi-dock-select');
    if (dockSelect && dockSelect.value !== dock) {
      dockSelect.value = dock;
    }
    this.applyDockAndTheme();
  }

  destroy() {
    this.disconnectBarResize();
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
  stepIntoIframe(iframeEl) {
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
  stepOutOfIframe() {
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

  runScan() {
    this.clearPageElementMarkers(this.activeDocument);
    this.elementToRecord = new WeakMap();

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

  populateIframeStepperDropdown() {
    if (!this.iframeStepperSelect) {
      return;
    }
    this.iframeStepperSelect.textContent = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent =
      this.detectedIframes.length > 0
        ? `Iframes (${this.detectedIframes.length}) — Step In…`
        : `Iframes (0 detected)`;
    this.iframeStepperSelect.appendChild(defaultOpt);
    this.iframeStepperSelect.disabled = this.detectedIframes.length === 0;

    this.detectedIframes.forEach((ifr, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      const accessible = canStepIntoIframe(ifr);
      const label = ifr.id
        ? `#${ifr.id}`
        : ifr.getAttribute('title') || ifr.getAttribute('src') || `iframe #${idx + 1}`;
      opt.textContent = `${accessible ? '↪ Step into' : 'Cross-origin'}: ${label}`;
      this.iframeStepperSelect.appendChild(opt);
    });
  }

  clearPageElementMarkers(doc) {
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
  navigateToDomElement(targetEl) {
    if (this.highlightedIdRefEl && this.highlightedIdRefEl !== targetEl) {
      this.highlightedIdRefEl.removeAttribute('data-andi-idref-target');
      this.highlightedIdRefEl.removeAttribute('data-andi-pulse-target');
    }

    (window).$andiActiveNode = targetEl;

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

  inspectByIndex(index, moveFocus = false) {
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
    (window).$andiActiveNode = rec.element;
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
    this.drawLaserToElement(rec.element);
  }

  handleDocumentMouseOver(e) {
    if (e.shiftKey) {
      return;
    }
    const target = e.target;
    if (!target || target.id === ANDI_HOST_ID || target.closest(`#${ANDI_HOST_ID}`)) {
      return;
    }
    let curr = target;
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

  handleDocumentFocusIn(e) {
    const target = e.target;
    if (!target || target.id === ANDI_HOST_ID || target.closest(`#${ANDI_HOST_ID}`)) {
      return;
    }
    const rec = this.elementToRecord.get(target);
    if (rec && this.activeIndex !== rec.index) {
      this.inspectByIndex(rec.index, false);
    }
  }

  handleDocumentKeyDown(e) {
    if (e.altKey && e.key === '.') {
      e.preventDefault();
      this.stepElement(1);
    } else if (e.altKey && e.key === ',') {
      e.preventDefault();
      this.stepElement(-1);
    }
  }

  stepElement(delta) {
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

  injectPageHighlightStyles(doc) {
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
        content: "Note" !important;
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

  mountLaserSvg() {
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

  drawLaserToElement(targetEl) {
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

  eraseLaser() {
    if (this.laserSvg) {
      this.laserSvg.style.display = 'none';
    }
  }

  attachDelegatedEvents(doc) {
    doc.addEventListener('mouseover', this.boundMouseOver, true);
    doc.addEventListener('focusin', this.boundFocusIn, true);
    doc.addEventListener('keydown', this.boundKeyDown, true);
  }

  detachDelegatedEvents(doc) {
    doc.removeEventListener('mouseover', this.boundMouseOver, true);
    doc.removeEventListener('focusin', this.boundFocusIn, true);
    doc.removeEventListener('keydown', this.boundKeyDown, true);
  }

  applyDockAndTheme() {
    if (!this.barEl || !this.hostEl) {
      return;
    }
    this.barEl.setAttribute('data-theme', this.theme);
    this.barEl.setAttribute('data-dock', this.dock);
    this.hostEl.setAttribute('data-dock', this.dock);

    this.resetBodyMargins();
    this.applyBarSize();
    if (this.dock === 'top') {
      this.hostEl.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483646;';
      this.syncTopDockOffset();
    } else if (this.dock === 'left') {
      document.body.style.marginLeft = `${this.sideWidth}px`;
      this.hostEl.style.cssText =
        `position:fixed;top:0;bottom:0;left:0;width:${this.sideWidth}px;z-index:2147483646;`;
    } else if (this.dock === 'right') {
      document.body.style.marginRight = `${this.sideWidth}px`;
      this.hostEl.style.cssText =
        `position:fixed;top:0;bottom:0;right:0;width:${this.sideWidth}px;z-index:2147483646;`;
    }
    this.syncResizeHandleState();
  }

  /**
   * Applies the user's chosen size. Docked to the top the draggable dimension is the content
   * grid's height (the header stays a fixed cost); docked to a side it is the host width.
   */
  applyBarSize() {
    if (!this.gridEl) {
      return;
    }
    if (this.dock === 'top' && this.topHeight > 0) {
      this.topHeight = Math.min(Math.max(this.topHeight, MIN_TOP_HEIGHT), this.maxTopHeight());
      this.gridEl.style.height = `${this.topHeight}px`;
      this.gridEl.style.maxHeight = 'none';
    } else {
      this.gridEl.style.removeProperty('height');
      this.gridEl.style.removeProperty('max-height');
    }
  }

  /** Current grid height in px, whether it is user-set or still content-driven. */
  currentTopHeight() {
    if (this.topHeight > 0) {
      return this.topHeight;
    }
    return this.gridEl ? Math.round(this.gridEl.getBoundingClientRect().height) : DEFAULT_TOP_HEIGHT;
  }

  maxTopHeight() {
    return Math.max(MIN_TOP_HEIGHT, Math.round(window.innerHeight * 0.8));
  }

  maxSideWidth() {
    return Math.max(MIN_SIDE_WIDTH, Math.round(window.innerWidth * 0.7));
  }

  /**
   * Keeps the handle's orientation, help text and ARIA range in sync with the current dock.
   */
  syncResizeHandleState() {
    if (!this.resizeHandleEl) {
      return;
    }
    const isTop = this.dock === 'top';
    const value = isTop ? this.currentTopHeight() : this.sideWidth;
    const min = isTop ? MIN_TOP_HEIGHT : MIN_SIDE_WIDTH;
    const max = isTop ? this.maxTopHeight() : this.maxSideWidth();
    const dimension = isTop ? 'height' : 'width';
    this.resizeHandleEl.setAttribute('aria-orientation', isTop ? 'horizontal' : 'vertical');
    this.resizeHandleEl.setAttribute('aria-valuenow', String(Math.round(value)));
    this.resizeHandleEl.setAttribute('aria-valuemin', String(min));
    this.resizeHandleEl.setAttribute('aria-valuemax', String(max));
    this.resizeHandleEl.setAttribute(
      'aria-label',
      `Resize ANDI-Gen1 ${dimension} — drag, or use arrow keys. Press Home to reset.`
    );
    this.resizeHandleEl.title = `Drag to change the inspector ${dimension} (arrow keys also work, Home resets)`;
  }

  persistBarSize() {
    try {
      window.localStorage.setItem(STORAGE_KEY_SIZE_TOP, String(Math.round(this.topHeight)));
      window.localStorage.setItem(STORAGE_KEY_SIZE_SIDE, String(Math.round(this.sideWidth)));
    } catch {
      // ignore
    }
  }

  /**
   * Resizes by `delta` CSS pixels along the current dock's axis, clamped to sane limits.
   * The first adjustment converts the top dock from auto height to an explicit one.
   */
  resizeBarBy(delta) {
    if (this.dock === 'top') {
      this.topHeight = Math.min(
        Math.max(this.currentTopHeight() + delta, MIN_TOP_HEIGHT),
        this.maxTopHeight()
      );
    } else {
      this.sideWidth = Math.min(
        Math.max(this.sideWidth + delta, MIN_SIDE_WIDTH),
        this.maxSideWidth()
      );
    }
    this.applyDockAndTheme();
  }

  /** Restores the default: auto (content-driven) height on top, 440px on the sides. */
  resetBarSize() {
    if (this.dock === 'top') {
      this.topHeight = 0;
    } else {
      this.sideWidth = DEFAULT_SIDE_WIDTH;
    }
    this.applyDockAndTheme();
    this.persistBarSize();
  }

  /**
   * Draggable + keyboard-operable edge used to shrink the inspector so more of the page
   * under test stays visible. Exposed as a `separator` so it is reachable by keyboard and
   * announced with its current size, matching the accessibility bar ANDI itself enforces.
   */
  buildResizeHandle() {
    const handle = document.createElement('div');
    handle.className = 'andi-resizer';
    handle.setAttribute('role', 'separator');
    handle.tabIndex = 0;
    this.resizeHandleEl = handle;

    let dragging = false;
    let startPos = 0;
    let startSize = 0;

    const onPointerMove = (ev) => {
      if (!dragging) {
        return;
      }
      ev.preventDefault();
      if (this.dock === 'top') {
        this.topHeight = startSize + (ev.clientY - startPos);
      } else if (this.dock === 'left') {
        this.sideWidth = startSize + (ev.clientX - startPos);
      } else {
        this.sideWidth = startSize - (ev.clientX - startPos);
      }
      this.resizeBarBy(0);
    };

    const endDrag = (ev) => {
      if (!dragging) {
        return;
      }
      dragging = false;
      handle.classList.remove('dragging');
      handle.releasePointerCapture?.(ev.pointerId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      this.persistBarSize();
    };

    handle.addEventListener('pointerdown', (ev) => {
      dragging = true;
      startPos = this.dock === 'top' ? ev.clientY : ev.clientX;
      startSize = this.dock === 'top' ? this.currentTopHeight() : this.sideWidth;
      handle.classList.add('dragging');
      handle.setPointerCapture?.(ev.pointerId);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', endDrag);
      ev.preventDefault();
    });

    handle.addEventListener('keydown', (ev) => {
      const isTop = this.dock === 'top';
      let delta = 0;
      if (ev.key === (isTop ? 'ArrowUp' : 'ArrowLeft')) {
        delta = this.dock === 'right' ? RESIZE_KEYBOARD_STEP : -RESIZE_KEYBOARD_STEP;
      } else if (ev.key === (isTop ? 'ArrowDown' : 'ArrowRight')) {
        delta = this.dock === 'right' ? -RESIZE_KEYBOARD_STEP : RESIZE_KEYBOARD_STEP;
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        this.resetBarSize();
        return;
      } else {
        return;
      }
      ev.preventDefault();
      this.resizeBarBy(delta);
      this.persistBarSize();
    });

    handle.addEventListener('dblclick', () => {
      this.resetBarSize();
    });

    return handle;
  }

  /**
   * Pushes the page down by the inspector's real rendered height (instead of a fixed guess)
   * so the top-most page elements stay visible without scrolling while docked to the top.
   */
  syncTopDockOffset() {
    if (this.dock !== 'top' || !this.hostEl) {
      return;
    }
    const height = Math.ceil(this.hostEl.getBoundingClientRect().height);
    if (height <= 0) {
      return;
    }
    document.body.style.marginTop = `${height}px`;
    // Keeps in-page anchor jumps and focus scrolling clear of the fixed inspector.
    document.documentElement.style.scrollPaddingTop = `${height}px`;
    // While the height is still content-driven, the measurement is only trustworthy once
    // layout has settled, so refresh the handle's reported value here too.
    this.syncResizeHandleState();
    if (window.scrollY > 0 && window.scrollY <= height) {
      window.scrollTo(window.scrollX, 0);
    }
  }

  /**
   * Re-measures the top dock whenever the inspector's own content changes height.
   */
  observeBarResize() {
    this.disconnectBarResize();
    if (typeof ResizeObserver === 'undefined' || !this.barEl) {
      return;
    }
    this.barResizeObserver = new ResizeObserver(() => {
      this.syncTopDockOffset();
    });
    this.barResizeObserver.observe(this.barEl);
  }

  disconnectBarResize() {
    this.barResizeObserver?.disconnect();
    this.barResizeObserver = null;
  }

  resetBodyMargins() {
    document.body.style.removeProperty('margin-top');
    document.body.style.removeProperty('margin-bottom');
    document.body.style.removeProperty('margin-left');
    document.body.style.removeProperty('margin-right');
    document.documentElement.style.removeProperty('scroll-padding-top');
  }

  mountShadowUI() {
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
    // Zone 3 (Right): Environment & Window Chrome (`Dock`, `Theme`, `Close`)
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
    // Substituted by scripts/build.py with "<tag> TS · <short sha>" so the UI always
    // reports the exact build that is loaded. Unsubstituted means an un-built source run.
    versionSpan.textContent = 'v31.4 TS (2026-11-10)';
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
      this.setMode(moduleSelect.value);
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
      'Defect Report',
      'Open Visual & Exportable Defect Report (ANDI Alerts + Notes with Coordinates & Screenshots)',
      () => {
        this.openReportModal();
      }
    );
    this.reportTriggerBtn.classList.add('btn-primary');

    zoneTelemetry.append(this.summaryBadgeEl, this.reportTriggerBtn);

    // --- ZONE 3: Workspace & Environment Utilities (`Dock`, `Theme`, `Close`) ---
    const zoneChrome = document.createElement('div');
    zoneChrome.className = 'toolbar-zone zone-chrome';

    const dockSelect = document.createElement('select');
    dockSelect.id = 'andi-dock-select';
    dockSelect.setAttribute('aria-label', 'Pin ANDI-Gen1 Position');
    const dockOptions = [
      { value: 'top', label: 'Dock: Top' },
      { value: 'left', label: 'Dock: Left' },
      { value: 'right', label: 'Dock: Right' }
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
      this.setDock(dockSelect.value);
    });

    const themeBtn = this.createButton(
      this.theme === 'dark' ? 'Light Theme' : 'Dark Theme',
      'Switch between High-Contrast Dark and Light layout themes',
      () => {
        this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
      }
    );
    themeBtn.id = 'andi-theme-btn';

    const closeBtn = this.createButton('✕ Close', 'Close ANDI-Gen1', () => this.destroy());
    closeBtn.classList.add('btn-danger');

    zoneChrome.append(dockSelect, themeBtn, closeBtn);
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
    srTitle.textContent = 'Screen Reader Spoken Output';
    this.srOutputEl = document.createElement('div');
    this.srOutputEl.className = 'sr-output';

    // Unified element details: ARIA attributes, IDREF associations and computed
    // properties in one deduplicated table, shown before the extracted code.
    const detailsLabel = document.createElement('span');
    detailsLabel.className = 'sr-sub-label';
    detailsLabel.textContent = 'Element Details';

    const detailsTable = document.createElement('table');
    detailsTable.className = 'comp-table';
    this.detailsTbodyEl = document.createElement('tbody');
    detailsTable.appendChild(this.detailsTbodyEl);

    // Extracted DOM code + copy action, rendered after the element's ARIA / IDREF details
    this.srDomNodeBarEl = document.createElement('div');
    this.srDomNodeBarEl.className = 'sr-dom-node-bar';

    srBox.append(
      srTitle,
      this.srOutputEl,
      detailsLabel,
      detailsTable,
      this.srDomNodeBarEl
    );

    this.elementAlertsListEl = document.createElement('ul');
    this.elementAlertsListEl.className = 'alert-list';

    colInspect.append(this.elementHeaderEl, srBox, this.elementAlertsListEl);

    // Panel 2: Page Accessibility Alerts Panel — only rendered when alerts exist, so a
    // clean page gives Panel 1 the full width of the inspector.
    const colAlerts = document.createElement('div');
    colAlerts.className = 'andi-panel';
    this.pageAlertsPanelEl = colAlerts;
    const alertsHeading = document.createElement('h2');
    alertsHeading.className = 'panel-title';
    alertsHeading.textContent = 'Page Accessibility Alerts — select an alert to focus its element';

    this.pageAlertsListEl = document.createElement('ul');
    this.pageAlertsListEl.className = 'alert-list page-alert-list';
    colAlerts.append(alertsHeading, this.pageAlertsListEl);

    grid.append(colInspect, colAlerts);
    this.gridEl = grid;
    bar.appendChild(grid);

    // Draggable edge so testers can shrink the inspector and see more of the page.
    bar.appendChild(this.buildResizeHandle());

    // 3. On-Demand Fly-in Notes & All Saved Notes Drawer (#1, #2, #9)
    this.noteDrawerEl = this.buildFlyinNoteDrawer();
    bar.appendChild(this.noteDrawerEl);

    // 4. On-Demand Fly-in Element Inventory Drawer (Requirement #3: Array of tables, links, buttons, landmarks, headings, etc.)
    this.inventoryDrawerEl = this.buildFlyinInventoryDrawer();
    bar.appendChild(this.inventoryDrawerEl);

    // 5. Modal (#3/#4/#6 Visual + Code Defect Report)
    this.reportModalEl = this.buildReportModal();
    bar.append(this.reportModalEl);

    shadow.appendChild(bar);
  }

  /**
   * Builds the On-Demand Fly-in Notes Drawer containing:
   * 1. Active Element Note & Automatic Screenshot Editor (with exact DOM coordinates)
   * 2. Complete interactive list of ALL saved notes on the page (`Notes (x)`)
   */
  buildFlyinNoteDrawer() {
    const drawer = document.createElement('aside');
    drawer.className = 'flyin-note-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Tester Notes and DOM Node Screenshots Panel');

    const topRow = document.createElement('div');
    topRow.className = 'flyin-header';
    const title = document.createElement('h3');
    title.textContent = 'Tester Notes & DOM Node Screenshots';
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
    (['danger', 'warning', 'caution']).forEach((lvl) => {
      const opt = document.createElement('option');
      opt.value = lvl;
      opt.textContent = `Severity: ${lvl.toUpperCase()}`;
      this.noteSeveritySelect.appendChild(opt);
    });

    // Primary Unified Action: Saves note AND captures the annotated DOM node screenshot so Defect Reports always have the screenshot!
    const saveWithShotBtn = this.createButton(
      'Save Note + Screenshot',
      'Save note to localStorage and capture annotated DOM node screenshot with coordinates for the Defect Report',
      () => {
        this.saveActiveElementNote(true);
      }
    );
    saveWithShotBtn.classList.add('btn-primary');

    const saveTextOnlyBtn = this.createButton(
      'Save Text Only',
      'Save note text to localStorage without updating screenshot',
      () => {
        this.saveActiveElementNote(false);
      }
    );

    const clearBtn = this.createButton('Delete Note', 'Remove note & screenshot for this element', () => {
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
      'Download Screenshot (.png)',
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

  openNoteDrawer(focusTarget = 'editor') {
    this.renderAllNotesListInDrawer();
    this.noteDrawerEl.classList.add('open');
    if (focusTarget === 'list') {
      this.allNotesCountHeadingEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      this.noteTextarea.focus();
    }
  }

  syncNoteDrawerForRecord(rec) {
    if (!this.noteTextarea || !this.activeNoteMetaEl) {
      return;
    }
    const env = getBrowserEnvironmentInfo();
    this.activeNoteMetaEl.textContent = '';

    const line1 = document.createElement('div');
    line1.innerHTML = `<strong>Active Element #${rec.index}:</strong> <code>&lt;${rec.tagName}&gt;</code> — <code>${rec.selector}</code>`;
    const line2 = document.createElement('div');
    line2.textContent = `Exact DOM coords: ${rec.coordinates.formatted} | Browser: ${env.browserName}`;
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
      this.noteStatusEl.textContent = `No saved note yet for ${rec.selector}. Click "Save Note + Screenshot" to record.`;
      this.currentScreenshotDataUrl = '';
      this.screenshotWrapEl.style.display = 'none';
    }
  }

  renderAllNotesListInDrawer() {
    if (!this.allNotesListEl || !this.allNotesCountHeadingEl) {
      return;
    }
    this.allNotesListEl.textContent = '';

    const notedRecords = this.records.filter((r) => r.note !== null);
    this.allNotesCountHeadingEl.textContent = `All Saved Notes on Page (${notedRecords.length})`;

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

      const jumpBtn = this.createButton('Inspect Node', 'Jump to and highlight this DOM node', () => {
        this.inspectByIndex(rec.index, true);
      });
      jumpBtn.classList.add('btn-primary');

      const delBtn = this.createButton('Delete', 'Delete this note', () => {
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
      metaLine.textContent = `${coordsText} · ${new Date(note.updatedAt).toLocaleString()} · ${note.browserInfo || getBrowserEnvironmentInfo().browserName}`;

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

  saveActiveElementNote(withScreenshot) {
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
    const severity = this.noteSeveritySelect.value;
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

  clearActiveElementNote() {
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

  renderPageSummaryAndAlerts() {
    this.summaryBadgeEl.textContent = '';

    const totalAlerts = this.records.reduce((acc, r) => acc + r.alerts.length, 0);
    const totalNotes = this.records.filter((r) => r.note !== null).length;
    const totalDefectReportItems = this.records.filter(
      (r) => r.alerts.length > 0 || r.note !== null
    ).length;

    if (this.reportTriggerBtn) {
      this.reportTriggerBtn.textContent = `Defect Report (${totalDefectReportItems})`;
    }

    // The frame pill only has a function when stepped into an iframe (it tells the tester which document is being audited).
    // On the top document it carried no information, so it is not rendered.
    const pillFrame = document.createElement('span');
    pillFrame.className = 'pill pill-frame';
    pillFrame.textContent = `Frame: ${this.activeFrameLabel}`;

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
    pillNotesBtn.textContent = `Notes (${totalNotes})`;
    pillNotesBtn.title = 'Click to open the Notes Panel and view all saved notes on this page';
    pillNotesBtn.addEventListener('click', () => {
      this.inventoryDrawerEl?.classList.remove('open');
      this.openNoteDrawer('list');
    });

    // Requirement #3 (Part A): Actionable `Inventory (x)` button that opens the Element Inventory Fly-In Drawer!
    const pillInventoryBtn = document.createElement('button');
    pillInventoryBtn.type = 'button';
    pillInventoryBtn.className = 'pill pill-inventory pill-actionable';
    pillInventoryBtn.textContent = `Inventory (${this.inventoryItems.length})`;
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
        link.textContent = `[#${rec.index} ${alert.module}ANDI] ${alert.message}${rec.note ? ' (Note attached)' : ''}`;
        link.addEventListener('click', (e) => {
          e.preventDefault();
          this.inspectByIndex(rec.index, true);
        });

        li.append(ball, link);
        this.pageAlertsListEl.appendChild(li);
      }
    }

    // The Page Accessibility Alerts panel is only shown when alerts exist, so a clean page
    // leaves one full-width inspection panel instead of an empty second column.
    const hasPageAlerts = this.pageAlertsListEl.children.length > 0;
    if (this.pageAlertsPanelEl) {
      this.pageAlertsPanelEl.style.display = hasPageAlerts ? '' : 'none';
    }
    if (this.gridEl) {
      this.gridEl.classList.toggle('single-panel', !hasPageAlerts);
    }
    this.syncTopDockOffset();
  }

  /**
   * Renders Panel 1's Active Element Navigator (with integrated Prev/Next buttons,
   * element `#index`, tag/role, exact DOM coordinates, and contextual `Note` button).
   */
  renderActiveElementInspection(rec) {
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
    coordsSpan.textContent = `(${rec.coordinates.x}, ${rec.coordinates.y}) ${rec.coordinates.width}×${rec.coordinates.height}px`;

    // Show only the module(s) actually being run. In a single-module mode an element can still *qualify* for other
    // modules (e.g. a hidden element that also has text qualifies for both hANDI and cANDI) but those are not run, so listing
    // them was misleading. In ALL mode every module the element qualified for is shown.
    const modulesSpan = document.createElement('span');
    modulesSpan.className = 'el-modules';
    const shownModules =
      this.mode === 'all' ? rec.modulesMatched : rec.modulesMatched.filter((m) => m === this.mode);
    modulesSpan.textContent =
      shownModules.length > 0 ? shownModules.map((m) => `${m}ANDI`).join(' · ') : 'note only';

    navGroup.append(prevBtn, indexBadge, nextBtn, tagCode, coordsSpan, modulesSpan);

    const contextActions = document.createElement('div');
    contextActions.className = 'el-context-actions';

    // Single contextual note button on the active element header (no duplicate toolbar button)
    const noteBadgeBtn = this.createButton(
      rec.note ? 'Note ✓' : 'Note',
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
        rec.iframeAccessible ? '↪ Step Into Iframe' : 'Cross-origin Iframe',
        'Inspect DOM inside this iframe',
        () => {
          this.stepIntoIframe(rec.element);
        }
      );
      stepInBtn.classList.add('btn-primary');
      contextActions.appendChild(stepInBtn);
    }

    this.elementHeaderEl.append(navGroup, contextActions);

    // Screen Reader Spoken Output
    this.srOutputEl.textContent =
      rec.screenReaderOutput || 'No accessible name — silent output';
    this.srOutputEl.className = rec.accName ? 'sr-output' : 'sr-output sr-missing';

    // Extracted DOM code + copy action, shown after the element's ARIA / IDREF details
    this.srDomNodeBarEl.textContent = '';
    const domLabel = document.createElement('span');
    domLabel.className = 'sr-sub-label';
    domLabel.textContent = 'Extracted Code';

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
      'Copy DOM Code',
      'Copy the inspected element’s full HTML (ANDI markers removed) to the clipboard',
      () => {
        this.runDomAction(domStatus, 'DOM code copied', () => {
          this.copyTextToClipboard(getCleanDomCode(rec.element), domStatus, 'DOM code copied');
        });
      }
    );
    copyDomBtn.classList.add('btn-primary');
    domActions.append(copyDomBtn, domStatus);
    this.srDomNodeBarEl.append(domLabel, domCode, domActions);

    this.renderElementDetails(rec);

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
   * Renders every detail ANDI knows about the inspected element as ONE deduplicated table.
   *
   * Previously the same facts were split across three blocks that overlapped heavily: an IDREF
   * bar and a semantic-association bar above the extracted code, plus a components table below
   * it. An element with `aria-labelledby` was therefore listed twice, in two different formats
   * and two different naming conventions (`ariaLabelledby` vs `aria-labelledby`). Here each
   * attribute appears exactly once, in source-attribute order, and any attribute that resolves
   * IDREFs shows its raw value together with clickable links to the referenced nodes.
   */
  renderElementDetails(rec) {
    this.detailsTbodyEl.textContent = '';

    const idRefByAttr = new Map();
    for (const group of rec.idRefGroups) {
      idRefByAttr.set(group.attribute, group);
    }
    const renderedIdRefAttrs = new Set();
    const comps = rec.components;

    // Ordered so the accessible-name sources come first, then description, then associations.
    // `idRefAttr` marks the component whose value is already covered by an IDREF group, so the
    // two are merged into a single row instead of being printed twice.
    const detailRows = [
      { key: 'ariaLabel', label: 'aria-label' },
      { key: 'ariaLabelledby', label: 'aria-labelledby', idRefAttr: 'aria-labelledby' },
      { key: 'nativeLabel', label: 'label', idRefAttr: 'label[for]' },
      { key: 'alt', label: 'alt' },
      { key: 'caption', label: 'caption' },
      { key: 'legend', label: 'legend' },
      { key: 'figcaption', label: 'figcaption' },
      { key: 'value', label: 'value' },
      { key: 'placeholder', label: 'placeholder' },
      { key: 'title', label: 'title' },
      { key: 'pseudoBefore', label: '::before' },
      { key: 'innerText', label: 'text' },
      { key: 'pseudoAfter', label: '::after' },
      { key: 'subtreeSummary', label: 'subtree' },
      { key: 'ariaDescribedby', label: 'aria-describedby', idRefAttr: 'aria-describedby' },
      { key: 'ariaDescription', label: 'aria-description' },
      { key: 'tableContext', label: 'table context' },
      { key: 'tableColumnHeaders', label: 'column header(s)' },
      { key: 'tableRowHeaders', label: 'row header(s)' }
    ];

    for (const row of detailRows) {
      const value = comps[row.key];
      const idRefAttr = row.idRefAttr;
      const group = idRefAttr ? idRefByAttr.get(idRefAttr) : undefined;
      if ((value === undefined || value === '') && !group) {
        continue;
      }
      let label = row.label;
      // Keeps the role that the old semantic bar reported (table / grid / treegrid).
      if (row.key === 'tableContext' && rec.tableAssociation) {
        label = `${rec.tableAssociation.tableRole} context`;
      }
      if (group && idRefAttr) {
        renderedIdRefAttrs.add(idRefAttr);
        this.appendIdRefDetailRow(label, group, value);
      } else {
        this.appendDetailRow(label, value || '');
      }
    }

    // Remaining IDREF attributes that have no component counterpart (headers, aria-controls,
    // aria-owns, aria-activedescendant, ...).
    for (const group of rec.idRefGroups) {
      if (!renderedIdRefAttrs.has(group.attribute)) {
        this.appendIdRefDetailRow(group.attribute, group);
      }
    }

    // Computed/measured properties (contrast, aria-expanded, ...).
    for (const [propKey, propVal] of Object.entries(rec.addOnProps)) {
      this.appendDetailRow(propKey, propVal);
    }

    if (this.detailsTbodyEl.children.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = 'No accessibility markup found on this element.';
      tr.appendChild(td);
      this.detailsTbodyEl.appendChild(tr);
    }
  }

  appendDetailRow(label, value) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = label;
    const td = document.createElement('td');
    td.textContent = value;
    tr.append(th, td);
    this.detailsTbodyEl.appendChild(tr);
    return td;
  }

  /**
   * One row for an IDREF attribute: the literal attribute value plus a clickable link per
   * referenced node, so the raw markup and what it actually resolves to stay together.
   */
  appendIdRefDetailRow(
    label,
    group,
    resolvedValue
  ) {
    const td = this.appendDetailRow(label, '');

    const rawBadge = document.createElement('code');
    rawBadge.className = 'detail-raw';
    rawBadge.textContent = `="${group.rawValue}"`;
    td.appendChild(rawBadge);

    if (resolvedValue && resolvedValue !== '"" (empty/unresolved)') {
      const resolvedText = document.createElement('span');
      resolvedText.className = 'detail-resolved';
      resolvedText.textContent = resolvedValue;
      td.appendChild(resolvedText);
    }

    for (const item of group.items) {
      if (item.exists && item.targetElement) {
        const targetEl = item.targetElement;
        const link = document.createElement('a');
        link.href = `#${item.id}`;
        link.className = 'sr-idref-target-link';
        const preview = item.text.length > 42 ? `${item.text.slice(0, 39)}...` : item.text || '(empty)';
        link.textContent = `#${item.id} → <${item.targetTag}> "${preview}"`;
        link.title = `Click to navigate to referenced DOM node ${item.targetSelector} (<${item.targetTag} id="${item.id}">)`;
        link.addEventListener('click', (e) => {
          e.preventDefault();
          this.navigateToDomElement(targetEl);
        });
        td.appendChild(link);
      } else {
        const missing = document.createElement('span');
        missing.className = 'sr-idref-missing';
        missing.textContent = `#${item.id} — missing ID target`;
        td.appendChild(missing);
      }
    }
  }

  /**
   * Runs a DOM-copy / harness action and reports failures (e.g. cross-origin CSS, blocked clipboard) inline.
   */
  runDomAction(statusEl, label, action) {
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
  copyTextToClipboard(text, statusEl, okMessage) {
    const done = () => {
      statusEl.textContent = `✓ ${okMessage}`;
    };
    const fallback = () => {
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
        : 'Clipboard blocked by the browser — copy the code manually';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  renderEmptyActiveElement() {
    this.elementHeaderEl.textContent = 'No inspectable elements found for this mode.';
    this.srOutputEl.textContent = '—';
    this.srDomNodeBarEl.textContent = '';
    this.detailsTbodyEl.textContent = '';
    this.elementAlertsListEl.textContent = '';
  }

  /**
   * Requirement #3 (Part A): Builds the Fly-In Element Inventory Drawer (similar to Note Drawer),
   * listing all page interface elements in an interactive array categorized by:
   * Tables, Links, Buttons, Form Controls, Landmarks, Headings, Graphics, Dialogs/Live, and Iframes.
   */
  buildFlyinInventoryDrawer() {
    const drawer = document.createElement('aside');
    drawer.className = 'flyin-note-drawer flyin-inventory-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Page Element Inventory Fly-In Drawer');

    const topRow = document.createElement('div');
    topRow.className = 'flyin-header';
    const title = document.createElement('h3');
    title.textContent = 'Element Inventory';
    this.inventoryTitleEl = title;

    const topActions = document.createElement('div');
    topActions.className = 'saved-note-actions';

    const copyInvBtn = this.createButton(
      'Copy Inventory JSON',
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
          copyInvBtn.textContent = 'Copy Inventory JSON';
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

  openInventoryDrawer(category) {
    this.noteDrawerEl?.classList.remove('open');
    if (category) {
      this.activeInventoryCategory = category;
    }
    this.renderInventoryDrawer();
    this.inventoryDrawerEl.classList.add('open');
    this.inventorySearchInput.focus();
  }

  getFilteredInventoryItems() {
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

  renderInventoryDrawer() {
    if (!this.inventoryCategoryBarEl || !this.inventoryListEl || !this.inventoryCountHeadingEl) {
      return;
    }

    const categoryMeta = [
      { key: 'all', label: 'All' },
      { key: 'tables', label: 'Tables' },
      { key: 'links', label: 'Links' },
      { key: 'buttons', label: 'Buttons' },
      { key: 'formControls', label: 'Form Controls' },
      { key: 'landmarks', label: 'Landmarks' },
      { key: 'headings', label: 'Headings' },
      { key: 'graphics', label: 'Graphics' },
      { key: 'dialogsLive', label: 'Dialogs/Live' },
      { key: 'iframes', label: 'Iframes' },
      { key: 'other', label: 'Other' }
    ];

    if (this.inventoryTitleEl) {
      this.inventoryTitleEl.textContent = `Element Inventory — ${MODULE_LABELS[this.mode]}`;
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
      btn.textContent = `${cat.label} (${count})`;
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
        item.inspectedIndex ? `Navigate (#${item.inspectedIndex})` : 'Navigate to Node',
        `Scroll to, focus, and highlight ${item.selector}`,
        () => {
          this.navigateToDomElement(item.element);
        }
      );
      jumpBtn.classList.add('btn-primary');

      headerRow.append(leftBadges, jumpBtn);

      const nameRow = document.createElement('div');
      nameRow.className = 'saved-note-text';
      nameRow.textContent = `Accessible name: "${item.accName || '(No Accessible Name)'}"${item.accDesc ? ` | Desc: "${item.accDesc}"` : ''}`;

      const detailsRow = document.createElement('div');
      detailsRow.className = 'saved-note-meta';
      detailsRow.textContent = `${item.details} · ${item.coordinates.formatted}`;

      const domRow = document.createElement('div');
      domRow.className = 'inv-dom-row';
      const domCode = document.createElement('code');
      domCode.className = 'sr-dom-code';
      domCode.textContent = item.domSnippet;
      const copyStatus = document.createElement('span');
      copyStatus.className = 'sr-dom-status';
      copyStatus.setAttribute('role', 'status');
      const copyBtn = this.createButton('Copy DOM', `Copy the full HTML of ${item.selector}`, () => {
        this.runDomAction(copyStatus, 'Copy', () => {
          this.copyTextToClipboard(getCleanDomCode(item.element), copyStatus, 'Copied');
        });
      });
      domRow.append(domCode, copyBtn, copyStatus);

      li.append(headerRow, nameRow, detailsRow, domRow);
      this.inventoryListEl.appendChild(li);
    });
  }

  /**
   * Requirements #3 & #4: Defect Report Modal with Visual Preview (displaying embedded screenshots,
   * exact DOM coordinates, browser info, and timestamps) + Raw HTML/MD/JSON/CSV export.
   */
  buildReportModal() {
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
      'Defect Report (ANDI Alerts + Tester Notes, Coordinates & Screenshots)';

    const controls = document.createElement('div');
    controls.className = 'report-controls';

    this.reportFormatSelect = document.createElement('select');
    this.reportFormatSelect.setAttribute('aria-label', 'Report View and Export Format');
    (['visual', 'html', 'markdown', 'json', 'csv']).forEach((fmt) => {
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
      'Download Report + Screenshots',
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

  openReportModal() {
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

  refreshReportContent() {
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
  renderVisualReportPreview(report) {
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
      coordsBadge.textContent = `DOM coords: ${item.coordinates.formatted}`;

      cardHeader.append(h3, coordsBadge);

      const srLine = document.createElement('div');
      srLine.className = 'visual-defect-sr';
      srLine.textContent = `Screen reader output: "${item.screenReaderOutput}" | Accessible Name: "${item.accessibleName}"`;

      card.append(cardHeader, srLine);

      if (item.alerts.length > 0) {
        const alertTitle = document.createElement('div');
        alertTitle.className = 'visual-subhead';
        alertTitle.textContent = `ANDI detected alerts (${item.alerts.length}):`;
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
        noteHead.textContent = `Tester note [${item.note.severity.toUpperCase()}] · Coords: ${noteCoords} · Browser: ${noteBrowser} · Time: ${noteTime}`;

        const noteP = document.createElement('p');
        noteP.className = 'visual-note-text';
        noteP.textContent = item.note.text;

        noteBox.append(noteHead, noteP);

        if (item.note.screenshotDataUrl) {
          const shotWrap = document.createElement('div');
          shotWrap.className = 'visual-shot-wrap';
          const shotLabel = document.createElement('div');
          shotLabel.className = 'visual-shot-label';
          shotLabel.textContent = 'Captured DOM node screenshot with tester note:';
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

  downloadReportAndScreenshots() {
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

  createButton(label, title, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'andi-btn';
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /**
   * Requirement #5: High-Contrast WCAG AAA Color Palettes for both Light (default) and Dark Themes.
   * - Light Theme: #020617 & #1e293b text on #ffffff / #f8fafc backgrounds (14.2:1 to 20.1:1 contrast)
   * - Dark Theme: #ffffff & #e2e8f0 text on #020617 / #0f172a backgrounds (14.6:1 to 19.3:1 contrast)
   */
  getShadowStyles() {
    return `
      :host {
        all: initial;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      * { box-sizing: border-box; }

      /* High-Contrast Dark Theme (WCAG AAA 14:1+ text contrast) */
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
        font-size: 14.5px;
        line-height: 1.5;
        position: relative;
      }

      /* Draggable / keyboard-operable resize edge (shrink the inspector to reveal more page) */
      .andi-resizer {
        position: absolute;
        background: transparent;
        z-index: 5;
        touch-action: none;
      }
      .andi-resizer::after {
        content: '';
        position: absolute;
        background: var(--border-color);
        border-radius: 999px;
        opacity: 0.55;
      }
      .andi-bar[data-dock="top"] .andi-resizer {
        left: 0;
        right: 0;
        bottom: -3px;
        height: 11px;
        cursor: ns-resize;
      }
      .andi-bar[data-dock="top"] .andi-resizer::after {
        left: 50%;
        transform: translateX(-50%);
        top: 4px;
        width: 64px;
        height: 4px;
      }
      .andi-bar[data-dock="left"] .andi-resizer,
      .andi-bar[data-dock="right"] .andi-resizer {
        top: 0;
        bottom: 0;
        width: 11px;
        cursor: ew-resize;
      }
      .andi-bar[data-dock="left"] .andi-resizer {
        right: -3px;
      }
      .andi-bar[data-dock="right"] .andi-resizer {
        left: -3px;
      }
      .andi-bar[data-dock="left"] .andi-resizer::after,
      .andi-bar[data-dock="right"] .andi-resizer::after {
        top: 50%;
        transform: translateY(-50%);
        left: 4px;
        width: 4px;
        height: 64px;
      }
      .andi-resizer:hover::after, .andi-resizer.dragging::after {
        opacity: 1;
        background: var(--accent);
      }
      .andi-resizer:focus-visible {
        outline: 3px solid var(--accent);
        outline-offset: -1px;
      }

      /* High-Contrast Light Theme (Default — WCAG AAA 14:1+ text contrast) */
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

      /* Dock Layouts (#7: Top / Left / Right) */
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
        font-size: 16px;
        color: var(--accent);
      }
      .andi-version {
        font-size: 12px;
        font-weight: 700;
        background: var(--btn-bg);
        color: var(--text-main);
        border: 1px solid var(--border-color);
        padding: 2px 7px;
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
        padding: 5px 9px;
        font-size: 13.5px;
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
        padding: 4px 11px;
        border-radius: 999px;
        font-size: 13px;
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
        padding: 5px 12px;
        font-size: 13.5px;
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
        max-height: 240px;
      }
      /* One full-width inspection panel when the page has no accessibility alerts */
      .andi-grid.single-panel {
        grid-template-columns: 1fr;
      }
      .andi-panel {
        background: var(--bg-panel);
        border: 1.5px solid var(--border-color);
        border-radius: 8px;
        padding: 9px 11px;
        overflow-y: auto;
        max-height: 222px;
      }
      .panel-title {
        margin: 0 0 6px;
        font-size: 14.5px;
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
        font-size: 13px;
        padding: 3px 9px;
        border-radius: 4px;
      }
      .el-tag {
        color: var(--accent);
        font-weight: 800;
        font-size: 14px;
      }
      .el-coords {
        font-size: 12.5px;
        font-weight: 700;
        color: var(--text-muted);
        background: var(--bg-sub);
        border: 1px solid var(--border-color);
        padding: 2px 7px;
        border-radius: 4px;
      }
      .el-modules {
        font-size: 12.5px;
        font-weight: 700;
        color: var(--text-muted);
      }

      .sr-box {
        background: var(--bg-sub);
        border: 1px solid var(--border-color);
        border-left: 4px solid var(--accent);
        padding: 7px 10px;
        border-radius: 4px;
        margin-bottom: 6px;
      }
      .sr-title {
        font-size: 12px;
        font-weight: 800;
        color: var(--text-muted);
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }
      .sr-output {
        font-weight: 800;
        font-size: 15px;
        margin-top: 3px;
        color: var(--text-main);
      }
      .sr-missing { color: var(--sr-missing-color); }

      /* Requirement #1: Extracted Code Bar — rendered after the ARIA / IDREF detail bars */
      .sr-dom-node-bar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px dashed var(--border-color);
      }
      .sr-sub-label {
        font-size: 12px;
        font-weight: 800;
        color: var(--text-muted);
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }
      .sr-dom-code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
        font-weight: 600;
        color: var(--text-main);
        background: var(--bg-panel);
        border: 1.5px solid var(--border-color);
        border-radius: 5px;
        padding: 4px 9px;
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
        font-size: 12.5px;
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

      /* IDREF target links inside the merged Element Details table */
      .sr-idref-target-link {
        display: inline-block;
        margin: 2px 6px 2px 0;
        align-items: center;
        background: #0c4a6e;
        color: #ffffff;
        border: 1px solid #7dd3fc;
        border-radius: 4px;
        padding: 3px 9px;
        font-size: 12.5px;
        font-weight: 700;
        text-decoration: underline;
        cursor: pointer;
      }
      .sr-idref-target-link:hover, .sr-idref-target-link:focus-visible {
        outline: 2.5px solid #ffffff;
        background: #0369a1;
      }
      .sr-idref-missing {
        display: inline-block;
        margin: 2px 6px 2px 0;
        align-items: center;
        background: #7f1d1d;
        color: #ffffff;
        border: 1px solid #fca5a5;
        border-radius: 4px;
        padding: 3px 9px;
        font-size: 12.5px;
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
        font-size: 13.5px;
        margin-bottom: 5px;
      }
      .comp-table th, .comp-table td {
        border-bottom: 1px solid var(--border-color);
        padding: 4px 6px;
        text-align: left;
        vertical-align: top;
      }
      .comp-table th {
        color: var(--accent);
        font-weight: 800;
        width: 30%;
        font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
        white-space: nowrap;
      }
      /* Merged detail rows: literal attribute value, resolved text, then IDREF target links.
         Inline-block keeps the table's two-column alignment intact while letting the
         badges and links wrap inside the value cell. */
      .detail-raw {
        display: inline-block;
        font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
        font-size: 12.5px;
        color: var(--text-dim);
        margin-right: 6px;
      }
      .detail-resolved {
        display: inline-block;
        font-weight: 700;
        margin-right: 6px;
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
        gap: 7px;
        padding: 5px 0;
        font-size: 13.5px;
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
        width: 20px;
        height: 20px;
        min-width: 20px;
        border-radius: 50%;
        font-size: 12.5px;
        font-weight: 900;
      }
      .ball-danger { background: #991b1b; color: #ffffff; border: 1px solid #fca5a5; }
      .ball-warning { background: #fef08a; color: #020617; border: 1px solid #ca8a04; }
      .ball-caution { background: #075985; color: #ffffff; border: 1px solid #7dd3fc; }
      .empty-msg { color: var(--text-muted); font-style: italic; font-size: 13px; }

      /* Report Modal */
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
        font-size: 12.5px;
      }
    `;
  }
}

  // === Module: andi\andi.ts ===
/**
 * ANDI-Gen1 Core Orchestrator: andi.ts
 * Refactored from legacy andi.js into strict, zero-dependency TypeScript.
 */


const ANDI_GEN1_VERSION = '31.0.0-gen1-ts';

const ANDI_MODULE_REGISTRY = {
  f: { version: FANDI_VERSION, evaluate: evaluateFocusableElement },
  g: { version: GANDI_VERSION, evaluate: evaluateGraphicElement },
  l: { version: LANDI_VERSION, evaluate: evaluateLinkOrButtonElement },
  t: { version: TANDI_VERSION, evaluate: evaluateTableElement },
  s: { version: SANDI_VERSION, evaluate: evaluateStructureElement },
  c: { version: CANDI_VERSION, evaluate: evaluateColorContrastElement },
  h: { version: HANDI_VERSION, evaluate: evaluateHiddenElement },
  i: { version: IANDI_VERSION, evaluate: evaluateIframeElement }
};

function launchAndiGen1(initialMode = 'f') {
  const controller = new AndiGen1Controller(initialMode);
  controller.launch(initialMode);
  return controller;
}


  // === Module: src\index.ts ===
/**
 * ANDI-Gen1 — Main Entry Point (Bookmarklet & Browser Extension Ready)
 * Supports launching in default `f` mode or `'all'` mode (`window.AndiGen1.launch('all')`).
 */




function bootstrapAndiGen1() {
  if (window.AndiGen1) {
    window.AndiGen1.destroy();
  }

  const initialMode = window.ANDI_INITIAL_MODE || 'f';
  const controller = new AndiGen1Controller(initialMode);

  const api = {
    controller,
    launch(mode) {
      controller.launch(mode);
    },
    runAll() {
      controller.launch('all');
    },
    setDock(dock) {
      controller.setDock(dock);
    },
    setTheme(theme) {
      controller.setTheme(theme);
    },
    destroy() {
      controller.destroy();
    }
  };

  window.AndiGen1 = api;
  window.AndiNext = api;
  controller.launch(initialMode);
  return api;
}

bootstrapAndiGen1();
})();
