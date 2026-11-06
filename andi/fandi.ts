/**
 * fANDI — Focusable Elements Inspector Module (TypeScript)
 * Refactored from legacy fandi.js into strict, zero-dependency TypeScript.
 */

import { AndiAlert, PageIndex } from '../src/types';
import { formatTagName, isAriaHiddenInTree } from '../src/dom-index';
import { ComputedAccessibilityResult } from '../src/acc-name';

export const FANDI_VERSION = '8.0.0-ts';

export function evaluateFocusableElement(
  el: HTMLElement,
  tag: string,
  focusInfo: { isFocusable: boolean; isTabbable: boolean; tabIndexValue: number | null },
  computed: ComputedAccessibilityResult,
  pageIndex: PageIndex
): AndiAlert[] {
  const alerts: AndiAlert[] = [];

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
