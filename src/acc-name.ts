/**
 * ANDI-Gen1 — W3C Accessible Name, Description, IDREF & Semantic Association Engine
 * Implements the Accessible Name and Description Computation 1.2 specification
 * with O(1) label/ID resolution, interactive IDREF target extraction, and semantic
 * association computation across native HTML and ARIA roles (e.g. role="table", role="grid",
 * role="row", role="columnheader", role="rowheader", role="cell", role="gridcell").
 */

import {
  AccessibleComponents,
  IdRefResolutionGroup,
  IdRefTargetItem,
  PageIndex,
  TableSemanticAssociation
} from './types';
import {
  formatTagName,
  getElementSelector,
  getValidRole,
  isBlockLevel,
  isElementVisible
} from './dom-index';

const NAME_FROM_CONTENT_ROLES: ReadonlySet<string> = new Set([
  'button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link',
  'listitem', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'row',
  'rowgroup', 'rowheader', 'switch', 'tab', 'term', 'tooltip', 'tree', 'treeitem'
]);

const NAME_FROM_CONTENT_TAGS: ReadonlySet<string> = new Set([
  'a', 'button', 'caption', 'dd', 'dt', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'label', 'legend', 'li', 'option', 'summary', 'td', 'th'
]);

const LABELABLE_TAGS: ReadonlySet<string> = new Set([
  'input', 'select', 'textarea', 'meter', 'output', 'progress'
]);

const LABELABLE_ROLES: ReadonlySet<string> = new Set([
  'textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'slider', 'spinbutton', 'switch'
]);

export interface ComputedAccessibilityResult {
  accName: string;
  accDesc: string;
  accGroup: string;
  semanticRole: string;
  screenReaderOutput: string;
  components: AccessibleComponents;
  addOnProps: Record<string, string>;
  missingLabelledbyIds: string[];
  missingDescribedbyIds: string[];
  idRefGroups: IdRefResolutionGroup[];
  tableAssociation: TableSemanticAssociation | null;
}

export function computeAccessibleData(
  el: HTMLElement,
  pageIndex: PageIndex
): ComputedAccessibilityResult {
  const components: AccessibleComponents = {};
  const missingLabelledbyIds: string[] = [];
  const missingDescribedbyIds: string[] = [];
  const idRefGroups: IdRefResolutionGroup[] = [];
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
      components.caption = extractVisibleText(caption as HTMLElement, pageIndex).trim();
    }
  } else if (tag === 'fieldset' || role === 'group' || role === 'radiogroup') {
    const legend = el.querySelector(':scope > legend');
    if (legend) {
      components.legend = extractVisibleText(legend as HTMLElement, pageIndex).trim();
    }
  } else if (tag === 'figure' || role === 'figure') {
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
          accGroup = extractVisibleText(legend as HTMLElement, pageIndex).trim();
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
            accGroup = extractVisibleText(groupLegend as HTMLElement, pageIndex).trim();
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
  const outputParts: string[] = [];
  if (accGroup) {
    outputParts.push(`[Group: ${accGroup}]`);
  }
  if (tableAssociation && (tableAssociation.columnHeaders.length > 0 || tableAssociation.rowHeaders.length > 0)) {
    const hdrParts: string[] = [];
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
  attribute: string,
  rawValue: string,
  pageIndex: PageIndex,
  missingIdsOut: string[]
): IdRefResolutionGroup {
  const ids = rawValue.trim().split(/\s+/).filter(Boolean);
  const items: IdRefTargetItem[] = [];
  const seen = new Set<string>();

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
  idListStr: string,
  pageIndex: PageIndex,
  missingIdsOut: string[]
): string {
  const group = buildIdRefGroup('idref', idListStr, pageIndex, missingIdsOut);
  return group.items
    .filter((item) => item.exists && item.text)
    .map((item) => item.text)
    .join(' ');
}

function resolveNativeLabel(
  el: HTMLElement,
  pageIndex: PageIndex,
  idRefGroupsOut: IdRefResolutionGroup[]
): string | null {
  const parts: string[] = [];

  // 1. Explicit <label for="id"> via O(1) Map lookup
  if (el.id) {
    const labels = pageIndex.labelForMap.get(el.id);
    if (labels && labels.length > 0) {
      const labelItems: IdRefTargetItem[] = [];
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
      const txt = extractVisibleText(parentLabel as HTMLElement, pageIndex, el).trim();
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
export function computeTableSemanticAssociation(
  el: HTMLElement,
  tag: string,
  role: string,
  pageIndex: PageIndex
): TableSemanticAssociation | null {
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
    : (el.closest('table, [role="table"], [role="grid"], [role="treegrid"]') as HTMLElement | null);

  if (!tableEl) {
    return null;
  }

  const tableExplicitRole = getValidRole(tableEl);
  if (tableExplicitRole === 'presentation' || tableExplicitRole === 'none') {
    return null;
  }

  const tableRole: 'table' | 'grid' | 'treegrid' =
    tableExplicitRole === 'grid'
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
    tableName = extractVisibleText(tCaption as HTMLElement, pageIndex).trim();
  }

  // Gather semantic rows belonging directly to this table/grid
  const allRows = Array.from(tableEl.querySelectorAll('tr, [role="row"]')).filter(
    (r) => r.closest('table, [role="table"], [role="grid"], [role="treegrid"]') === tableEl
  ) as HTMLElement[];

  const rowMatrix: HTMLElement[][] = [];
  for (const r of allRows) {
    const cells = Array.from(
      r.querySelectorAll('th, td, [role="columnheader"], [role="rowheader"], [role="cell"], [role="gridcell"]')
    ).filter((c) => c.closest('tr, [role="row"]') === r) as HTMLElement[];
    if (cells.length > 0) {
      rowMatrix.push(cells);
    }
  }

  const rowCount = Number(tableEl.getAttribute('aria-rowcount')) || rowMatrix.length;
  const maxCols = rowMatrix.reduce((max, r) => Math.max(max, r.length), 0);
  const colCount = Number(tableEl.getAttribute('aria-colcount')) || maxCols;

  const isColHeaderCell = (cell: HTMLElement): boolean => {
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

  const isRowHeaderCell = (cell: HTMLElement): boolean => {
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
    const colHeaderTexts: string[] = [];
    const rowHeaderTexts: string[] = [];
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

  const columnHeaders: string[] = [];
  const rowHeaders: string[] = [];

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
      let matchedHeader: HTMLElement | null = null;
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

function extractCellHeaderText(cell: HTMLElement, pageIndex: PageIndex): string {
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

function collectAddOnProperties(
  el: HTMLElement,
  role: string,
  pageIndex: PageIndex
): Record<string, string> {
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
    props['aria-checked'] =
      ariaChecked === 'true' ? 'checked' : ariaChecked === 'mixed' ? 'partially checked' : 'not checked';
  } else if (tag === 'input') {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      props['checked'] = (el as HTMLInputElement).checked ? 'checked' : 'not checked';
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

export function getImplicitRoleLabel(el: HTMLElement): string {
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
