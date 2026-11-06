/**
 * iANDI — Iframes & Step-In Inspector Module (TypeScript)
 * Refactored from legacy iandi.js into strict, zero-dependency TypeScript.
 */

import { AndiAlert } from '../src/types';
import { canStepIntoIframe } from '../src/dom-index';
import { ComputedAccessibilityResult } from '../src/acc-name';

export const IANDI_VERSION = '8.0.0-ts';

export interface IframeEvaluationResult {
  alerts: AndiAlert[];
  isIframe: boolean;
  iframeCanStepIn: boolean;
  iframeSrc: string;
}

export function evaluateIframeElement(
  el: HTMLElement,
  tag: string,
  computed: ComputedAccessibilityResult
): IframeEvaluationResult {
  const alerts: AndiAlert[] = [];
  if (tag !== 'iframe') {
    return {
      alerts,
      isIframe: false,
      iframeCanStepIn: false,
      iframeSrc: ''
    };
  }

  const iframeEl = el as HTMLIFrameElement;
  const canStepIn = canStepIntoIframe(iframeEl);
  const iframeSrc =
    iframeEl.getAttribute('src') ||
    (iframeEl.hasAttribute('srcdoc') ? '[inline srcdoc]' : '[about:blank]');

  if (!computed.accName) {
    alerts.push({
      id: 'i-no-title',
      code: 'ALERT_IFRAME_NO_TITLE',
      level: 'danger',
      module: 'i',
      message: '<iframe> has no [title] or [aria-label] to identify its purpose to screen readers.'
    });
  }

  return {
    alerts,
    isIframe: true,
    iframeCanStepIn: canStepIn,
    iframeSrc
  };
}
