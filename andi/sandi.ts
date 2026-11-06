/**
 * sANDI — Structures & Headings Inspector Module (TypeScript)
 * Refactored from legacy sandi.js into strict, zero-dependency TypeScript.
 */

import { AndiAlert } from '../src/types';
import { ComputedAccessibilityResult } from '../src/acc-name';

export const SANDI_VERSION = '8.0.0-ts';

export function evaluateStructureElement(
  el: HTMLElement,
  tag: string,
  role: string,
  computed: ComputedAccessibilityResult,
  lastHeadingLevel: number,
  setLastHeadingLevel: (level: number) => void
): AndiAlert[] {
  const alerts: AndiAlert[] = [];

  let headingLevel: number | null = null;
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
