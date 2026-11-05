/*! ANDI Next v30.0.0 — Zero-Dependency TypeScript Rewrite (SSA ANDI) */
(function() {
  'use strict';

  // === Module: dom-index.ts ===
/**
 * ANDI Next — High-Performance DOM Indexer & Style Cache
 * Replaces O(N^2) jQuery Sizzle queries with a single-pass TreeWalker,
 * WeakMap computed-style caching, and O(1) Map/Set lookups.
 */


const ANDI_HOST_ID = 'andi-next-host';
const ANDI_LASER_ID = 'andi-next-laser-svg';

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
 * Builds a single-pass index of the live page DOM while skipping ANDI's own UI.
 */
function buildPageIndex(root = document.body) {
  const allElements = [];
  const visibleElements = [];
  const idMap = new Map();
  const labelForMap = new Map();
  const styleCache = new WeakMap();

  const getStyle = (el) => {
    let cached = styleCache.get(el);
    if (!cached) {
      cached = window.getComputedStyle(el);
      styleCache.set(el, cached);
    }
    return cached;
  };

  const walker = document.createTreeWalker(
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
    root,
    allElements,
    visibleElements,
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
  let parent = el.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
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
  let curr = el;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    if (curr.getAttribute('aria-hidden') === 'true') {
      return true;
    }
    curr = curr.parentElement;
  }
  return false;
}

/**
 * Generates a concise, human-readable and unique CSS selector for defect reporting.
 */
function getElementSelector(el) {
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }
  const parts = [];
  let curr = el;
  while (curr && curr !== document.body && curr !== document.documentElement) {
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

  // === Module: acc-name.ts ===
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

  // === Module: notes-report.ts ===
/**
 * ANDI Next — Persistent DOM Notes & Defect Report Generator
 * Stores tester notes directly on the live DOM node via `data-andi-note*` attributes
 * so notes persist across scans, DOM serialization, and defect report exports.
 */


const ATTR_NOTE_TEXT = 'data-andi-note';
const ATTR_NOTE_SEVERITY = 'data-andi-note-severity';
const ATTR_NOTE_UPDATED = 'data-andi-note-updated';

/**
 * Reads a persisted note directly from a DOM element's `data-andi-note*` attributes.
 */
function readElementNote(el) {
  const text = el.getAttribute(ATTR_NOTE_TEXT);
  if (!text || text.trim() === '') {
    return null;
  }
  const rawSeverity = el.getAttribute(ATTR_NOTE_SEVERITY);
  const severity =
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
function writeElementNote(
  el,
  text,
  severity = 'warning'
) {
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
function clearElementNote(el) {
  el.removeAttribute(ATTR_NOTE_TEXT);
  el.removeAttribute(ATTR_NOTE_SEVERITY);
  el.removeAttribute(ATTR_NOTE_UPDATED);
}

/**
 * Generates a structured DefectReport from all inspected elements that have
 * either detected accessibility alerts or tester DOM notes.
 */
function buildDefectReport(
  records,
  modeRun
) {
  let totalAlerts = 0;
  let totalNotes = 0;
  const items = [];

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
function formatReportAsMarkdown(report) {
  const lines = [
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
function formatReportAsCsv(report) {
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

  const escapeCsv = (val) => `"${val.replace(/"/g, '""')}"`;

  const rows = [headers.map(escapeCsv).join(',')];

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

  // === Module: analyzers.ts ===
/**
 * ANDI Next — Multi-Module Accessibility Analysis Engine
 * Supports running individual modules (f, g, l, t, s, c, h, i) OR the unified
 * `'all'` mode that runs every accessibility test suite in a single pass.
 */


const VAGUE_LINK_PHRASES = new Set([
  'click here', 'here', 'link', 'more', 'read more', 'learn more', 'info', 'details', 'go'
]);

const REDUNDANT_IMAGE_REGEX = /\b(image of|graphic of|picture of|photo of|icon of)\b/i;
const IMAGE_FILENAME_REGEX = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;

function analyzePage(
  pageIndex,
  mode
) {
  const records = [];
  let elementCounter = 0;

  // Trackers for cross-element checks (links, buttons, accesskeys, headings)
  const linkSignatures = new Map();
  const buttonNames = new Map();
  const accessKeyMap = new Map();
  let previousHeadingLevel = 0;

  // Determine candidate elements: visible elements for most modes, plus hidden elements if mode is 'h' or 'all'
  const candidatePool =
    mode === 'h' || mode === 'all' ? pageIndex.allElements : pageIndex.visibleElements;
  const visibleSet = new Set(pageIndex.visibleElements);

  for (const el of candidatePool) {
    const isVisible = visibleSet.has(el);
    const tag = el.tagName.toLowerCase();
    const role = getValidRole(el);
    const focusInfo = getFocusability(el);

    const matchedModules = getMatchedModulesForElement(
      el,
      tag,
      role,
      focusInfo.isFocusable,
      isVisible,
      pageIndex
    );

    const shouldInspect =
      mode === 'all'
        ? matchedModules.length > 0 || readElementNote(el) !== null
        : matchedModules.includes(mode);

    if (!shouldInspect) {
      continue;
    }

    const computed = computeAccessibleData(el, pageIndex);
    const alerts = [];

    const activeModules =
      mode === 'all' ? matchedModules : [mode];

    // Run module checks
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

    // Shared ID duplicate check (O(1) via pageIndex.idMap)
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

    const record = {
      index: elementCounter,
      element: el,
      selector: getElementSelector(el),
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
      note: readElementNote(el)
    };

    // Cross-element duplicate accesskey check
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

    // Cross-element ambiguous link & non-unique button checks
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

  // fANDI: Focusable elements + canvas
  if (isFocusable || tag === 'canvas') {
    matched.push('f');
  }

  // gANDI: Graphics / Images
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

  // lANDI: Links & Buttons
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

  // tANDI: Tables
  if (tag === 'table' || role === 'table' || role === 'grid' || tag === 'th' || tag === 'td') {
    matched.push('t');
  }

  // sANDI: Structures (Headings, Lists, Landmarks, Live Regions)
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

  // cANDI: Text-bearing elements for contrast check
  if (hasDirectNonEmptyTextNode(el) && !['script', 'style', 'noscript', 'title'].includes(tag)) {
    matched.push('c');
  }

  // iANDI: Iframes
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
  // 1. Missing Accessible Name
  if (!computed.accName && !isAriaHiddenInTree(el)) {
    if (computed.components.ariaDescribedby) {
      pushAlert(
        alerts,
        'f',
        'ALERT_DBY_ALONE',
        'warning',
        `[aria-describedby] is used without any component that provides an accessible name.`
      );
    } else {
      pushAlert(
        alerts,
        'f',
        'ALERT_NO_ACC_NAME',
        'danger',
        `<${formatTagName(el)}> has no accessible name, associated <label>, or [title].`
      );
    }
  }

  // 2. Missing ID references in aria-labelledby / aria-describedby
  if (computed.missingLabelledbyIds.length > 0) {
    pushAlert(
      alerts,
      'f',
      'ALERT_MISSING_LBY_REF',
      'danger',
      `[aria-labelledby] references missing ID(s): "${computed.missingLabelledbyIds.join(', ')}".`
    );
  }
  if (computed.missingDescribedbyIds.length > 0) {
    pushAlert(
      alerts,
      'f',
      'ALERT_MISSING_DBY_REF',
      'warning',
      `[aria-describedby] references missing ID(s): "${computed.missingDescribedbyIds.join(', ')}".`
    );
  }

  // 3. Misspelled aria-labeledby
  if (el.hasAttribute('aria-labeledby')) {
    pushAlert(
      alerts,
      'f',
      'ALERT_MISSPELLED_ARIA',
      'danger',
      `[aria-labeledby] is misspelled; use [aria-labelledby].`
    );
  }

  // 4. Duplicate <label for="..."> pointing to this element (O(1) via labelForMap)
  if (el.id) {
    const matchingLabels = pageIndex.labelForMap.get(el.id);
    if (matchingLabels && matchingLabels.length > 1) {
      pushAlert(
        alerts,
        'f',
        'ALERT_DUP_LABEL_FOR',
        'danger',
        `More than one <label for="${el.id}"> (${matchingLabels.length}) associates with this element.`
      );
    }
  }

  // 5. Positive tabindex > 0 disrupts natural tab order
  if (focusInfo.tabIndexValue !== null && focusInfo.tabIndexValue > 0) {
    pushAlert(
      alerts,
      'f',
      'ALERT_POSITIVE_TABINDEX',
      'warning',
      `[tabindex="${focusInfo.tabIndexValue}"] is greater than 0 and overrides natural DOM tab order.`
    );
  }

  // 6. Focusable element inside aria-hidden="true"
  if (focusInfo.isFocusable && isAriaHiddenInTree(el)) {
    pushAlert(
      alerts,
      'f',
      'ALERT_FOCUSABLE_ARIA_HIDDEN',
      'danger',
      `Focusable element has or is contained by [aria-hidden="true"].`
    );
  }

  // 7. Small clickable area on unlabelled checkbox / radio
  if (
    tag === 'input' &&
    ['checkbox', 'radio'].includes((el.getAttribute('type') || '').toLowerCase()) &&
    !computed.components.nativeLabel
  ) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 21 && rect.height > 0 && rect.height < 21) {
      pushAlert(
        alerts,
        'f',
        'ALERT_SMALL_CLICK_AREA',
        'caution',
        `Small clickable area (${Math.round(rect.width)}x${Math.round(rect.height)}px); associate a <label> to increase target size.`
      );
    }
  }

  // 8. Excessive accessible name length (> 250 chars)
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
  const isDecorative =
    role === 'presentation' ||
    role === 'none' ||
    (tag === 'img' && el.getAttribute('alt') === '');

  if (role === 'image') {
    pushAlert(
      alerts,
      'g',
      'ALERT_ROLE_IMAGE_INVALID',
      'danger',
      `[role="image"] is invalid; use [role="img"].`
    );
  }

  if (isDecorative && isTabbable) {
    pushAlert(
      alerts,
      'g',
      'ALERT_DECORATIVE_TABBABLE',
      'danger',
      `Image marked as decorative is in the keyboard tab order.`
    );
  }

  if (!isDecorative && !computed.accName && !isAriaHiddenInTree(el)) {
    pushAlert(
      alerts,
      'g',
      'ALERT_IMG_NO_NAME',
      'danger',
      `Graphic <${tag}> has no accessible name, [alt], or [title].`
    );
  }

  if (computed.accName) {
    if (REDUNDANT_IMAGE_REGEX.test(computed.accName)) {
      pushAlert(
        alerts,
        'g',
        'ALERT_IMG_REDUNDANT_PHRASE',
        'caution',
        `Redundant phrase ("image of" / "graphic of") found in image accessible name.`
      );
    }
    if (IMAGE_FILENAME_REGEX.test(computed.accName)) {
      pushAlert(
        alerts,
        'g',
        'ALERT_IMG_FILENAME_ALT',
        'warning',
        `Image accessible name ("${computed.accName}") appears to be a raw file name.`
      );
    }
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
  const isLink = tag === 'a' || role === 'link';

  if (isLink) {
    if (tag === 'a' && !el.hasAttribute('href') && role !== 'button' && role !== 'link') {
      pushAlert(
        alerts,
        'l',
        'ALERT_ANCHOR_NO_HREF',
        'warning',
        `<a> element has no [href] or [role]; may not be keyboard accessible or announced as a link/button.`
      );
    }
    if (computed.accName && VAGUE_LINK_PHRASES.has(computed.accName.trim().toLowerCase())) {
      pushAlert(
        alerts,
        'l',
        'ALERT_VAGUE_LINK',
        'caution',
        `Link text "${computed.accName}" is vague and does not identify its destination out of context.`
      );
    }
    const href = el.getAttribute('href');
    if (href && href.startsWith('#') && href.length > 1) {
      const targetId = href.slice(1);
      if (!document.getElementById(targetId)) {
        pushAlert(
          alerts,
          'l',
          'ALERT_BROKEN_INPAGE_ANCHOR',
          'warning',
          `In-page anchor link references [${href}], but no element with [id="${targetId}"] exists.`
        );
      }
    }
  }

  if (!focusInfo.isTabbable && !isAriaHiddenInTree(el)) {
    pushAlert(
      alerts,
      'l',
      'ALERT_INTERACTIVE_NOT_TABBABLE',
      'warning',
      `Interactive <${tag}> is not in the sequential keyboard tab order.`
    );
  }
}

function runTableChecks(
  el,
  tag,
  role,
  computed,
  alerts
) {
  if (tag === 'table' && role !== 'presentation' && role !== 'none') {
    const thCount = el.querySelectorAll('th, [role="columnheader"], [role="rowheader"]').length;
    if (thCount === 0) {
      pushAlert(
        alerts,
        't',
        'ALERT_TABLE_NO_TH',
        'danger',
        `Data <table> has no <th> header cells or [role="columnheader"/"rowheader"].`
      );
    }
    if (!computed.accName) {
      pushAlert(
        alerts,
        't',
        'ALERT_TABLE_NO_NAME',
        'caution',
        `Data <table> has no accessible name, <caption>, or aria-label.`
      );
    }
  } else if (tag === 'th' && !computed.accName) {
    pushAlert(
      alerts,
      't',
      'ALERT_EMPTY_TH',
      'caution',
      `Empty <th> table header cell.`
    );
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

  // === Module: ui-shadow.ts ===
/**
 * ANDI Next — Shadow DOM Isolated UI & Defect Report Controller
 * Built with 100% safe DOM node construction (no untrusted innerHTML)
 * and O(1) delegated event listeners on `document`.
 */


const PAGE_HIGHLIGHT_STYLE_ID = 'andi-next-page-highlights-css';

const MODULE_LABELS = {
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

class AndiNextController {
  records = [];
  elementToRecord = new WeakMap();
  activeIndex = 0; // 1-based index into records, 0 = none selected
  highlightsEnabled = true;
  laserEnabled = true;

  hostEl = null;
  shadow = null;
  laserSvg = null;
  laserLine = null;

  // UI Element References inside Shadow DOM

  // Bound delegated handlers for clean teardown

  constructor(initialMode = 'f') {
    this.mode = initialMode;
    this.boundMouseOver = this.handleDocumentMouseOver.bind(this);
    this.boundFocusIn = this.handleDocumentFocusIn.bind(this);
    this.boundKeyDown = this.handleDocumentKeyDown.bind(this);
  }

  launch(mode) {
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

  setMode(mode) {
    this.mode = mode;
    this.runScan();
  }

  destroy() {
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

  runScan() {
    this.clearPageElementMarkers();
    const pageIndex = buildPageIndex(document.body);
    this.records = analyzePage(pageIndex, this.mode);
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

    this.renderPageSummaryAndAlerts();

    if (this.records.length > 0) {
      this.inspectByIndex(1, false);
    } else {
      this.activeIndex = 0;
      this.renderEmptyActiveElement();
    }
  }

  clearPageElementMarkers() {
    const marked = document.querySelectorAll('[data-andi508-index], [data-andi-active], [data-andi-highlight]');
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

    // Refresh note from DOM in case it was modified externally
    rec.note = readElementNote(rec.element);

    this.renderActiveElementInspection(rec);
    this.drawLaserToElement(rec.element);
  }

  handleDocumentMouseOver(e) {
    if (e.shiftKey) {
      return; // Shift key locks hover inspection (Hover Lock)
    }
    const target = e.target;
    if (!target || target.id === ANDI_HOST_ID || target.closest(`#${ANDI_HOST_ID}`)) {
      return;
    }
    let curr = target;
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

  injectPageHighlightStyles() {
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

  eraseLaser() {
    if (this.laserSvg) {
      this.laserSvg.style.display = 'none';
    }
  }

  attachDelegatedEvents() {
    document.addEventListener('mouseover', this.boundMouseOver, true);
    document.addEventListener('focusin', this.boundFocusIn, true);
    document.addEventListener('keydown', this.boundKeyDown, true);
  }

  mountShadowUI() {
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
    (Object.keys(MODULE_LABELS)).forEach((m) => {
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
    (['danger', 'warning', 'caution']).forEach((lvl) => {
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

  renderPageSummaryAndAlerts() {
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

  renderEmptyActiveElement() {
    this.elementHeaderEl.textContent = 'No inspectable elements found for this mode.';
    this.srOutputEl.textContent = '—';
    this.componentsTbodyEl.textContent = '';
    this.elementAlertsListEl.textContent = '';
    this.noteTextarea.value = '';
    this.noteStatusEl.textContent = '';
  }

  saveActiveElementNote() {
    const rec = this.records[this.activeIndex - 1];
    if (!rec) {
      return;
    }
    const text = this.noteTextarea.value;
    const severity = this.noteSeveritySelect.value;
    rec.note = writeElementNote(rec.element, text, severity);
    this.noteStatusEl.textContent = rec.note
      ? `✓ Saved to DOM attribute [data-andi-note] on ${rec.selector}`
      : `Cleared [data-andi-note] from ${rec.selector}`;
    this.renderPageSummaryAndAlerts();
  }

  clearActiveElementNote() {
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

  buildReportModal() {
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
    (['markdown', 'json', 'csv']).forEach((fmt) => {
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

  openReportModal() {
    this.refreshReportContent();
    this.reportModalEl.classList.add('open');
    this.reportTextarea.focus();
  }

  refreshReportContent() {
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

  downloadReportFile() {
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

  // === Module: index.ts ===
/**
 * ANDI Next — Main Entry Point (Bookmarklet & Browser Extension Ready)
 * Supports launching in default `f` mode or `'all'` mode (`window.AndiNext.launch('all')`).
 */




function bootstrapAndiNext() {
  if (window.AndiNext) {
    window.AndiNext.destroy();
  }

  const initialMode = window.ANDI_INITIAL_MODE || 'f';
  const controller = new AndiNextController(initialMode);

  const api = {
    controller,
    launch(mode) {
      controller.launch(mode);
    },
    runAll() {
      controller.launch('all');
    },
    destroy() {
      controller.destroy();
    }
  };

  window.AndiNext = api;
  controller.launch(initialMode);
  return api;
}

bootstrapAndiNext();
})();
