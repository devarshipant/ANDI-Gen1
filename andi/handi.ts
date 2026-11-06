/**
 * hANDI — Hidden Content Inspector Module (TypeScript)
 * Refactored from legacy handi.js into strict, zero-dependency TypeScript.
 */

import { AndiAlert } from '../src/types';
import { isAriaHiddenInTree } from '../src/dom-index';

export const HANDI_VERSION = '8.0.0-ts';

export function evaluateHiddenElement(
  el: HTMLElement,
  isFocusable: boolean,
  getStyle: (el: Element) => CSSStyleDeclaration
): AndiAlert[] {
  const alerts: AndiAlert[] = [];
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
