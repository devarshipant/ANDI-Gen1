/**
 * ANDI Next — W3C Accessible Name & Description Computation Engine
 * Implements the Accessible Name and Description Computation 1.2 specification
 * with O(1) label/ID resolution and cached computed styles.
 */

import { AccessibleComponents, PageIndex } from './types';
import { getValidRole, isBlockLevel, isElementVisible } from './dom-index';

const NAME_FROM_CONTENT_ROLES: ReadonlySet<string> = new Set([
  'button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'row',
  'rowgroup', 'rowheader', 'switch', 'tab', 'tooltip', 'tree', 'treeitem'
]);

const NAME_FROM_CONTENT_TAGS: ReadonlySet<string> = new Set([
  'a', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'option',
  'summary', 'td', 'th'
]);

const LABELABLE_TAGS: ReadonlySet<string> = new Set([
  'input', 'select', 'textarea', 'meter', 'output', 'progress'
]);

const LABELABLE_ROLES: ReadonlySet<string> = new Set([
  'textbox', 'combobox', 'listbox', 'checkbox', 'radio', 'slider', 'spinbutton', 'switch'
]);

export interface ComputedAccessibilityResult {
  accName: string;
  accDesc: string;
  accGroup: string;
  screenReaderOutput: string;
  components: AccessibleComponents;
  addOnProps: Record<string, string>;
  missingLabelledbyIds: string[];
  missingDescribedbyIds: string[];
}

export function computeAccessibleData(
  el: HTMLElement,
  pageIndex: PageIndex
): ComputedAccessibilityResult {
  const components: AccessibleComponents = {};
  const missingLabelledbyIds: string[] = [];
  const missingDescribedbyIds: string[] = [];
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
      components.caption = extractVisibleText(caption as HTMLElement, pageIndex).trim();
    }
  } else if (tag === 'fieldset') {
    const legend = el.querySelector(':scope > legend');
    if (legend) {
      components.legend = extractVisibleText(legend as HTMLElement, pageIndex).trim();
    }
  } else if (tag === 'figure') {
    const figcaption = el.querySelector(':scope > figcaption');
    if (figcaption) {
      components.figcaption = extractVisibleText(figcaption as HTMLElement, pageIndex).trim();
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
          accGroup = extractVisibleText(legend as HTMLElement, pageIndex).trim();
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
  const outputParts: string[] = [];
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
  idListStr: string,
  pageIndex: PageIndex,
  missingIdsOut: string[]
): string {
  const ids = idListStr.trim().split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const pieces: string[] = [];

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

function resolveNativeLabel(el: HTMLElement, pageIndex: PageIndex): string | null {
  const parts: string[] = [];

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
      const txt = extractVisibleText(parentLabel as HTMLElement, pageIndex, el).trim();
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
export function extractVisibleText(
  root: HTMLElement,
  pageIndex: PageIndex,
  excludeElement?: HTMLElement
): string {
  const chunks: string[] = [];

  const visit = (node: Node): void => {
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
    const el = node as HTMLElement;
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
function getPseudoElementText(el: Element, pseudo: '::before' | '::after'): string {
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

function collectAddOnProperties(el: HTMLElement, role: string): Record<string, string> {
  const props: Record<string, string> = {};
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
  if ((el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') {
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
      props['checked'] = (el as HTMLInputElement).checked ? 'checked' : 'not checked';
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

function getImplicitRoleLabel(el: HTMLElement): string {
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

