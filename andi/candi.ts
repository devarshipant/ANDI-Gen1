/**
 * cANDI — Color Contrast Inspector Module (TypeScript)
 * Refactored from legacy candi.js into strict, zero-dependency TypeScript.
 */

import { AndiAlert } from '../src/types';
import { getDirectTextContent } from '../src/dom-index';

export const CANDI_VERSION = '8.0.0-ts';

export type ContrastCalculator = (
  el: HTMLElement,
  getStyle: (el: Element) => CSSStyleDeclaration
) => { ratio: number; requiredRatio: number };

export function evaluateColorContrastElement(
  el: HTMLElement,
  getStyle: (el: Element) => CSSStyleDeclaration,
  computeRatio: ContrastCalculator
): { alerts: AndiAlert[]; contrastRatio?: number; requiredContrastRatio?: number } {
  const alerts: AndiAlert[] = [];
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

