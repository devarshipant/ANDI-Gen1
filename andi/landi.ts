/**
 * lANDI — Links & Buttons Inspector Module (TypeScript)
 * Refactored from legacy landi.js into strict, zero-dependency TypeScript.
 */

import { AndiAlert } from '../src/types';
import { isAriaHiddenInTree } from '../src/dom-index';
import { ComputedAccessibilityResult } from '../src/acc-name';

export const LANDI_VERSION = '8.0.0-ts';

const VAGUE_LINK_PHRASES: ReadonlySet<string> = new Set([
  'click here', 'here', 'link', 'more', 'read more', 'learn more', 'info', 'details', 'go'
]);

export function evaluateLinkOrButtonElement(
  el: HTMLElement,
  tag: string,
  role: string,
  isTabbable: boolean,
  computed: ComputedAccessibilityResult
): AndiAlert[] {
  const alerts: AndiAlert[] = [];
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
