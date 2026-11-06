/*! ANDI-Gen1 v31.0.0 — Zero-Dependency TypeScript Rewrite (SSA ANDI) */
(function() {
  'use strict';

  // === Module: src/csp-guard.ts ===
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

  // === Module: src/dom-index.ts ===
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

  // === Module: src/acc-name.ts ===
/**
 * ANDI Next — W3C Accessible Name & Description Computation Engine
 * Implements the Accessible Name and Description Computation 1.2 specification
 * with O(1) label/ID resolution and cached computed styles.
 */


const NAME_FROM_CONTENT_ROLES = new Set([
  'button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'row',
  'rowgroup', 'rowheader', 'switch', 'tab', 'tooltip', 'tree', 'treeitem'
]);

const NAME_FROM_CONTENT_TAGS = new Set([
  'a', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'option',
  'summary', 'td', 'th'
]);

const LABELABLE_TAGS = new Set([
  'input', 'select', 'textarea', 'meter', 'output', 'progress'
]);

const LABELABLE_ROLES = new Set([
  'textbox', 'combobox', 'listbox', 'checkbox', 'radio', 'slider', 'spinbutton', 'switch'
]);


function computeAccessibleData(
  el,
  pageIndex
) {
  const components = {};
  const missingLabelledbyIds = [];
  const missingDescribedbyIds = [];
  const tag = el.tagName.toLowerCase();
  const role = getValidRole(el);

  // 1. Gather raw accessible components on the element
  const ariaLabelledby = el.getAttribute('aria-labelledby');
  if (ariaLabelledby !== null) {
    const resolved = resolveIdReferences(ariaLabelledby, pageIndex, missingLabelledbyIds);
    components.ariaLabelledby = resolved || '"" (empty/unresolved)';
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel !== null) {
    components.ariaLabel = ariaLabel.trim() || '""';
  }

  const ariaDescribedby = el.getAttribute('aria-describedby');
  if (ariaDescribedby !== null) {
    const resolved = resolveIdReferences(ariaDescribedby, pageIndex, missingDescribedbyIds);
    components.ariaDescribedby = resolved || '"" (empty/unresolved)';
  }

  const ariaDescription = el.getAttribute('aria-description');
  if (ariaDescription !== null) {
    components.ariaDescription = ariaDescription.trim() || '""';
  }

  // Native <label> (explicit via for="" in O(1) or implicit ancestor <label>)
  if (LABELABLE_TAGS.has(tag) || LABELABLE_ROLES.has(role)) {
    const labelText = resolveNativeLabel(el, pageIndex);
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

  // Table <caption>, Fieldset <legend>, Figure <figcaption>
  if (tag === 'table') {
    const caption = el.querySelector(':scope > caption');
    if (caption) {
      components.caption = extractVisibleText(caption, pageIndex).trim();
    }
  } else if (tag === 'fieldset') {
    const legend = el.querySelector(':scope > legend');
    if (legend) {
      components.legend = extractVisibleText(legend, pageIndex).trim();
    }
  } else if (tag === 'figure') {
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

  // Inner text for name-from-content elements
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
  const placeholderAttr = el.getAttribute('placeholder');
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
    (tag === 'img' || tag === 'area' || (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'image')) &&
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
  if (tag !== 'fieldset') {
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
        }
      }
    }
  }

  // 5. Add-on Properties & States
  const addOnProps = collectAddOnProperties(el, role);
  const stateOutput = Object.values(addOnProps).filter(Boolean).join(', ');

  // 6. Synthesize Screen Reader Output Preview
  const outputParts = [];
  if (accGroup) {
    outputParts.push(`[Group: ${accGroup}]`);
  }
  if (accName) {
    outputParts.push(accName);
  }
  if (accDesc && accDesc !== accName) {
    outputParts.push(accDesc);
  }
  const semanticRoleLabel = role || getImplicitRoleLabel(el);
  if (semanticRoleLabel) {
    outputParts.push(`(${semanticRoleLabel})`);
  }
  if (stateOutput) {
    outputParts.push(stateOutput);
  }

  return {
    accName,
    accDesc,
    accGroup,
    screenReaderOutput: outputParts.join(' '),
    components,
    addOnProps,
    missingLabelledbyIds,
    missingDescribedbyIds
  };
}

function resolveIdReferences(
  idListStr,
  pageIndex,
  missingIdsOut
) {
  const ids = idListStr.trim().split(/\s+/).filter(Boolean);
  const seen = new Set();
  const pieces = [];

  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const matches = pageIndex.idMap.get(id);
    if (!matches || matches.length === 0) {
      missingIdsOut.push(id);
      continue;
    }
    const target = matches[0];
    const targetLabel = target.getAttribute('aria-label')?.trim();
    const text = targetLabel || (target.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) {
      pieces.push(text);
    }
  }
  return pieces.join(' ');
}

function resolveNativeLabel(el, pageIndex) {
  const parts = [];

  // 1. Explicit <label for="id"> via O(1) Map lookup
  if (el.id) {
    const labels = pageIndex.labelForMap.get(el.id);
    if (labels && labels.length > 0) {
      for (const lbl of labels) {
        const txt = extractVisibleText(lbl, pageIndex, el).trim();
        if (txt) {
          parts.push(txt);
        }
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
    if (tag === 'img' || tag === 'area') {
      const alt = el.getAttribute('alt');
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

function collectAddOnProperties(el, role) {
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
    props['aria-checked'] = ariaChecked === 'true' ? 'checked' : ariaChecked === 'mixed' ? 'partially checked' : 'not checked';
  } else if (tag === 'input') {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      props['checked'] = (el).checked ? 'checked' : 'not checked';
    }
  }
  const ariaPressed = el.getAttribute('aria-pressed');
  if (ariaPressed === 'true' || ariaPressed === 'false') {
    props['aria-pressed'] = ariaPressed === 'true' ? 'pressed' : 'not pressed';
  }
  if (role === 'heading' || /^h[1-6]$/.test(tag)) {
    const level = el.getAttribute('aria-level') || (tag.startsWith('h') ? tag.charAt(1) : '2');
    props['heading-level'] = `heading level ${level}`;
  }
  return props;
}

function getImplicitRoleLabel(el) {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'a':
      return el.hasAttribute('href') ? 'link' : '';
    case 'button':
      return 'button';
    case 'select':
      return 'combobox';
    case 'textarea':
      return 'textbox';
    case 'img':
      return 'graphic';
    case 'table':
      return 'table';
    case 'input': {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio button';
      if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
      return 'textbox';
    }
    default:
      return '';
  }
}


  // === Module: src/notes-report.ts ===
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

  // === Module: andi/fandi.ts ===
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

  // === Module: andi/gandi.ts ===
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

  // === Module: andi/landi.ts ===
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

  // === Module: andi/tandi.ts ===
/**
 * tANDI — Data Tables Inspector Module (TypeScript)
 * Refactored from legacy tandi.js into strict, zero-dependency TypeScript.
 */


const TANDI_VERSION = '8.0.0-ts';

function evaluateTableElement(
  el,
  tag,
  role,
  computed
) {
  const alerts = [];

  if (tag === 'table' && role !== 'presentation' && role !== 'none') {
    const thCount = el.querySelectorAll('th, [role="columnheader"], [role="rowheader"]').length;
    if (thCount === 0) {
      alerts.push({
        id: 't-no-th',
        code: 'ALERT_TABLE_NO_TH',
        level: 'danger',
        module: 't',
        message: 'Data <table> has no <th> header cells or [role="columnheader"/"rowheader"].'
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
        message: 'Data <table> has no accessible name, <caption>, or aria-label.'
      });
    }
  } else if (tag === 'th' && !computed.accName) {
    alerts.push({
      id: 't-empty-th',
      code: 'ALERT_EMPTY_TH',
      level: 'caution',
      module: 't',
      message: 'Empty <th> table header cell.'
    });
  }

  return alerts;
}

  // === Module: andi/sandi.ts ===
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


  // === Module: andi/candi.ts ===
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


  // === Module: andi/handi.ts ===
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


  // === Module: andi/iandi.ts ===
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


  // === Module: src/analyzers.ts ===
/**
 * ANDI-Gen1 — Multi-Module Accessibility Analysis Engine
 * Supports running individual modules (f, g, l, t, s, c, h, i) OR the unified
 * `'all'` mode (placed as the last option in the mode droplist), plus iframe detection.
 */


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
      tagName: formatTagName(el),
      role,
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

  if (isFocusable || tag === 'canvas') {
    matched.push('f');
  }

  if (
    tag === 'img' ||
    tag === 'svg' ||
    tag === 'canvas' ||
    tag === 'area' ||
    role === 'img' ||
    role === 'image' ||
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

  if (tag === 'table' || role === 'table' || role === 'grid' || tag === 'th' || tag === 'td') {
    matched.push('t');
  }

  if (
    /^h[1-6]$/.test(tag) ||
    role === 'heading' ||
    ['main', 'nav', 'header', 'footer', 'aside', 'form', 'region', 'search'].includes(tag) ||
    ['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'region', 'search', 'form'].includes(role) ||
    el.hasAttribute('aria-live') ||
    ['alert', 'status', 'log', 'marquee', 'timer'].includes(role) ||
    tag === 'li'
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
  if (computed.accName.length > 250) {
    pushAlert(
      alerts,
      'f',
      'ALERT_EXCESSIVE_NAME',
      'warning',
      `Accessible name length (${computed.accName.length} chars) exceeds 250 characters; consider condensing.`
    );
  }
  void role;
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
        `Heading <${tag}> has no text content or accessible name.`
      );
    }
  } else if (tag === 'li') {
    const listParent = el.parentElement;
    if (
      listParent &&
      !['ul', 'ol', 'menu'].includes(listParent.tagName.toLowerCase()) &&
      !['list', 'menu', 'menubar', 'tablist'].includes(getValidRole(listParent))
    ) {
      pushAlert(
        alerts,
        's',
        'ALERT_ORPHAN_LI',
        'danger',
        `<li> element is not contained within a semantic list container (<ul>, <ol>, or [role="list"]).`
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

  // === Module: src/ui-shadow.ts ===
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


const PAGE_HIGHLIGHT_STYLE_ID = 'andi-gen1-page-highlights-css';
const STORAGE_KEY_THEME = 'ANDI_GEN1_THEME';
const STORAGE_KEY_DOCK = 'ANDI_GEN1_DOCK';

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
  elementToRecord = new WeakMap();
  activeIndex = 0;
  laserEnabled = true;

  // Theme & Dock settings
  theme = 'dark';
  dock = 'top';

  // Iframe Step-In state
  activeDocument = document;
  activeFrameLabel = 'Top Document';
  steppedInIframe = null;
  detectedIframes = [];

  // CSP Detector & Resolver
  cspGuard = new CspGuard();

  hostEl = null;
  shadow = null;
  laserSvg = null;
  laserLine = null;

  // UI Element References inside Shadow DOM

  // Fly-in Note Drawer References
  currentScreenshotDataUrl = '';

  // Modals (CSP Resolver & Visual/Code Defect Report)

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
      if (savedDock && ['top', 'bottom', 'left', 'right', 'dom'].includes(savedDock)) {
        this.dock = savedDock;
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
      themeBtn.textContent = this.theme === 'dark' ? '☀️ Light Theme' : '🌙 Dark Theme';
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

    const pageIndex = buildPageIndex(this.activeDocument);
    this.detectedIframes = pageIndex.iframes;
    this.populateIframeStepperDropdown();

    this.records = analyzePage(pageIndex, this.mode, this.activeFrameLabel);

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

  clearPageElementMarkers(doc) {
    const marked = doc.querySelectorAll(
      '[data-andi508-index], [data-andi-active], [data-andi-highlight]'
    );
    marked.forEach((el) => {
      el.removeAttribute('data-andi508-index');
      el.removeAttribute('data-andi-active');
      el.removeAttribute('data-andi-highlight');
      el.removeAttribute('data-andi-alert-level');
    });
    this.eraseLaser();
  }

  inspectByIndex(index, moveFocus = false) {
    const rec = this.records[index - 1];
    if (!rec) {
      return;
    }

    if (this.activeIndex > 0 && this.records[this.activeIndex - 1]) {
      this.records[this.activeIndex - 1].element.removeAttribute('data-andi-active');
    }

    this.activeIndex = index;
    rec.element.setAttribute('data-andi-active', 'true');
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

  positionDomInlineDock(targetEl) {
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

  resetBodyMargins() {
    document.body.style.removeProperty('margin-top');
    document.body.style.removeProperty('margin-bottom');
    document.body.style.removeProperty('margin-left');
    document.body.style.removeProperty('margin-right');
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
    versionSpan.textContent = 'v31.1 TS';
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
    const dockOptions = [
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
      this.setDock(dockSelect.value);
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
    srBox.append(srTitle, this.srOutputEl);

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

    // 4. Modals (#5 CSP Resolver, #3/#4/#6 Visual + Code Defect Report)
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
  buildFlyinNoteDrawer() {
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
    (['danger', 'warning', 'caution']).forEach((lvl) => {
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

  openNoteDrawer(focusTarget = 'editor') {
    this.renderAllNotesListInDrawer();
    this.noteDrawerEl.classList.add('open');
    if (focusTarget === 'list') {
      this.allNotesCountHeadingEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      this.noteTextarea.focus();
    }
  }

  toggleNoteDrawer(forceOpen) {
    const isOpen = this.noteDrawerEl.classList.contains('open');
    const nextState = forceOpen !== undefined ? forceOpen : !isOpen;
    if (nextState) {
      this.openNoteDrawer('editor');
    } else {
      this.noteDrawerEl.classList.remove('open');
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

  renderAllNotesListInDrawer() {
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
      this.reportTriggerBtn.textContent = `📋 Defect Report (${totalDefectReportItems})`;
    }

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
      this.openNoteDrawer('list');
    });

    this.summaryBadgeEl.append(pillFrame, pillElements, pillAlerts, pillNotesBtn);

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
    coordsSpan.textContent = `📍 (${rec.coordinates.x}, ${rec.coordinates.y}) ${rec.coordinates.width}×${rec.coordinates.height}px`;

    const modulesSpan = document.createElement('span');
    modulesSpan.className = 'el-modules';
    modulesSpan.textContent = rec.modulesMatched.map((m) => `${m}ANDI`).join(' · ');

    navGroup.append(prevBtn, indexBadge, nextBtn, tagCode, coordsSpan, modulesSpan);

    const contextActions = document.createElement('div');
    contextActions.className = 'el-context-actions';

    // Single contextual note button on the active element header (no duplicate toolbar button)
    const noteBadgeBtn = this.createButton(
      rec.note ? '📝 Note ✓' : '📝 Note',
      'Open Note & Screenshot Drawer for this element',
      () => this.openNoteDrawer('editor')
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
          this.stepIntoIframe(rec.element);
        }
      );
      stepInBtn.classList.add('btn-primary');
      contextActions.appendChild(stepInBtn);
    }

    this.elementHeaderEl.append(navGroup, contextActions);

    // Screen Reader Output
    this.srOutputEl.textContent =
      rec.screenReaderOutput || '⚠ No Accessible Name / Silent Output';
    this.srOutputEl.className = rec.accName ? 'sr-output' : 'sr-output sr-missing';

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

  renderEmptyActiveElement() {
    this.elementHeaderEl.textContent = 'No inspectable elements found for this mode.';
    this.srOutputEl.textContent = '—';
    this.componentsTbodyEl.textContent = '';
    this.elementAlertsListEl.textContent = '';
  }

  buildCspModal() {
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

  openCspModal() {
    this.refreshCspModal();
    this.cspModalEl.classList.add('open');
  }

  refreshCspModal() {
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
      '📋 Defect Report (ANDI Alerts + Tester Notes, Coordinates & Screenshots)';

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
   * Requirement #5: High-Contrast WCAG AAA Color Palettes for both Dark and Light Themes.
   * - Dark Theme: #ffffff & #e2e8f0 text on #020617 / #0f172a backgrounds (14.6:1 to 19.3:1 contrast)
   * - Light Theme: #020617 & #1e293b text on #ffffff / #f8fafc backgrounds (14.2:1 to 20.1:1 contrast)
   */
  getShadowStyles() {
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

  // === Module: andi/andi.ts ===
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


  // === Module: src/index.ts ===
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
