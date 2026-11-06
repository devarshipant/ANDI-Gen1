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
 * - Persists notes in `window.localStorage` (and mirrors `data-andi-note` on DOM) (#1)
 * - Generates Defect Reports strictly from Page Accessibility Alerts + attached on-demand notes (#6)
 * - Captures annotated PNG screenshots of the DOM node with the tester's note rendered on it (#9)
 */


const ATTR_NOTE_TEXT = 'data-andi-note';
const ATTR_NOTE_SEVERITY = 'data-andi-note-severity';
const ATTR_NOTE_UPDATED = 'data-andi-note-updated';
const STORAGE_KEY_NOTES = 'ANDI_GEN1_NOTES_STORE_V1';

function getStorageKeyForSelector(selector, frameContext = 'top') {
  const pageKey = `${window.location.origin}${window.location.pathname}`;
  return `${pageKey}::${frameContext}::${selector}`;
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
  frameContext = 'top'
) {
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
  const severity = rawSeverity === 'danger' || rawSeverity === 'warning' || rawSeverity === 'caution'
      ? rawSeverity
      : 'warning';
  const updatedAt = el.getAttribute(ATTR_NOTE_UPDATED) || new Date().toISOString();

  const note = {
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
function writeElementNote(
  el,
  selector,
  text,
  severity = 'warning',
  screenshotDataUrl,
  frameContext = 'top'
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

  const note = {
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
function clearElementNote(
  el,
  selector,
  frameContext = 'top'
) {
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
    (el).value ||
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
 * Feature #6: Builds the Defect Report strictly based on Page Accessibility Alerts
 * (`rec.alerts.length > 0`) and includes any on-demand Fly-in Notes & Screenshots.
 */
function buildDefectReport(
  records,
  modeRun,
  frameContext = 'Top Document'
) {
  let totalAlerts = 0;
  let totalNotesIncluded = 0;
  let totalScreenshotsIncluded = 0;
  const items = [];

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
function formatReportAsMarkdown(report) {
  const lines = [
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
function formatReportAsHtml(report) {
  const esc = (s) =>
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
function formatReportAsCsv(report) {
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
        : matchedModules.includes(mode);

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


const PAGE_HIGHLIGHT_STYLE_ID = 'andi-gen1-page-highlights-css';
const STORAGE_KEY_THEME = 'ANDI_GEN1_THEME';
const STORAGE_KEY_DOCK = 'ANDI_GEN1_DOCK';

// Requirement #4: Move ALL mode as the last item in droplist
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
  highlightsEnabled = true;
  laserEnabled = true;

  // Theme & Dock settings (#7, #8)
  theme = 'dark';
  dock = 'top';

  // Iframe Step-In state (#2)
  activeDocument = document;
  activeFrameLabel = 'Top Document';
  steppedInIframe = null;
  detectedIframes = [];

  // CSP Detector & Resolver (#5)
  cspGuard = new CspGuard();

  hostEl = null;
  shadow = null;
  laserSvg = null;
  laserLine = null;

  // UI Element References inside Shadow DOM

  // Fly-in Note Drawer References (#1, #9)
  currentScreenshotDataUrl = '';

  // Modals (#5, #6)

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

  destroy() {
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
  stepIntoIframe(iframe) {
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
  stepOutOfIframe() {
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

  runScan() {
    this.clearPageElementMarkers(this.activeDocument);
    const pageIndex = buildPageIndex(this.activeDocument.body);
    this.detectedIframes = pageIndex.iframes;
    this.records = analyzePage(pageIndex, this.mode, this.activeFrameLabel);
    this.elementToRecord = new WeakMap();

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

  populateIframeStepperDropdown() {
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

  clearPageElementMarkers(doc) {
    const marked = doc.querySelectorAll('[data-andi508-index], [data-andi-active], [data-andi-highlight]');
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

  mountLaserSvg() {
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

  drawLaserToElement(targetEl) {
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

  /**
   * Features #7 & #8: Applies Dock position (top, bottom, left, right, dom) and Theme (dark, light).
   */
  applyDockAndTheme() {
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

  positionDomInlineDock(targetEl) {
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
      this.setMode(moduleSelect.value);
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
    const dockOptions = [
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
      this.dock = dockSelect.value;
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
  buildFlyinNoteDrawer() {
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
    (['danger', 'warning', 'caution']).forEach((lvl) => {
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

  toggleNoteDrawer(forceOpen) {
    const isOpen = this.noteDrawerEl.classList.contains('open');
    const nextState = forceOpen !== undefined ? forceOpen : !isOpen;
    if (nextState) {
      this.noteDrawerEl.classList.add('open');
      this.noteTextarea.focus();
    } else {
      this.noteDrawerEl.classList.remove('open');
    }
  }

  syncNoteDrawerForRecord(rec) {
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

  saveActiveElementNote(withScreenshot) {
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
    const severity = this.noteSeveritySelect.value;

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
  }

  renderPageSummaryAndAlerts() {
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

  renderActiveElementInspection(rec) {
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
          this.stepIntoIframe(rec.element);
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

  renderEmptyActiveElement() {
    this.elementHeaderEl.textContent = 'No inspectable elements found for this mode.';
    this.srOutputEl.textContent = '—';
    this.componentsTbodyEl.textContent = '';
    this.elementAlertsListEl.textContent = '';
  }

  /**
   * Feature #5: Built-in CSP Detection & Resolution Modal.
   */
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
   * Features #6 & #9: Defect Report Modal (strictly based on Page Accessibility Alerts + on-demand notes & screenshots).
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
    title.textContent = '📋 Page Accessibility Alerts & On-Demand Notes Defect Report';

    const controls = document.createElement('div');
    controls.className = 'report-controls';

    this.reportFormatSelect = document.createElement('select');
    (['html', 'markdown', 'json', 'csv']).forEach((fmt) => {
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

  openReportModal() {
    this.refreshReportContent();
    this.reportModalEl.classList.add('open');
    this.reportTextarea.focus();
  }

  refreshReportContent() {
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

  downloadReportAndScreenshots() {
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

  createButton(label, title, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'andi-btn';
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', onClick);
    return btn;
  }

  getShadowStyles() {
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
