/**
 * tANDI — Data Tables & Semantic ARIA Grids Inspector Module (TypeScript)
 * Refactored from legacy tandi.js into strict, zero-dependency TypeScript.
 * Supports both native <table>/<tr>/<th>/<td> and ARIA role="table"|"grid"|"treegrid",
 * role="row", role="columnheader", role="rowheader", role="cell", role="gridcell".
 */

import { AndiAlert } from '../src/types';
import { ComputedAccessibilityResult } from '../src/acc-name';

export const TANDI_VERSION = '8.1.0-ts';

export function evaluateTableElement(
  el: HTMLElement,
  tag: string,
  role: string,
  computed: ComputedAccessibilityResult
): AndiAlert[] {
  const alerts: AndiAlert[] = [];

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
