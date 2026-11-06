/**
 * tANDI — Data Tables Inspector Module (TypeScript)
 * Refactored from legacy tandi.js into strict, zero-dependency TypeScript.
 */

import { AndiAlert } from '../src/types';
import { ComputedAccessibilityResult } from '../src/acc-name';

export const TANDI_VERSION = '8.0.0-ts';

export function evaluateTableElement(
  el: HTMLElement,
  tag: string,
  role: string,
  computed: ComputedAccessibilityResult
): AndiAlert[] {
  const alerts: AndiAlert[] = [];

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
