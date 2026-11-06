/**
 * gANDI — Graphics & Images Inspector Module (TypeScript)
 * Refactored from legacy gandi.js into strict, zero-dependency TypeScript.
 */

import { AndiAlert } from '../src/types';
import { isAriaHiddenInTree } from '../src/dom-index';
import { ComputedAccessibilityResult } from '../src/acc-name';

export const GANDI_VERSION = '8.0.0-ts';

const REDUNDANT_IMAGE_REGEX = /\b(image of|graphic of|picture of|photo of|icon of)\b/i;
const IMAGE_FILENAME_REGEX = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;

export function evaluateGraphicElement(
  el: HTMLElement,
  tag: string,
  role: string,
  isTabbable: boolean,
  computed: ComputedAccessibilityResult
): AndiAlert[] {
  const alerts: AndiAlert[] = [];
  const isDecorative =
    role === 'presentation' ||
    role === 'none' ||
    (tag === 'img' && el.getAttribute('alt') === '');

  if (role === 'image') {
    alerts.push({
      id: 'g-role-image',
      code: 'ALERT_ROLE_IMAGE_INVALID',
      level: 'danger',
      module: 'g',
      message: '[role="image"] is invalid; use [role="img"].'
    });
  }

  if (isDecorative && isTabbable) {
    alerts.push({
      id: 'g-decorative-tabbable',
      code: 'ALERT_DECORATIVE_TABBABLE',
      level: 'danger',
      module: 'g',
      message: 'Image marked as decorative is in the keyboard tab order.'
    });
  }

  if (!isDecorative && !computed.accName && !isAriaHiddenInTree(el)) {
    alerts.push({
      id: 'g-no-name',
      code: 'ALERT_IMG_NO_NAME',
      level: 'danger',
      module: 'g',
      message: `Graphic <${tag}> has no accessible name, [alt], or [title].`
    });
  }

  if (computed.accName) {
    if (REDUNDANT_IMAGE_REGEX.test(computed.accName)) {
      alerts.push({
        id: 'g-redundant-phrase',
        code: 'ALERT_IMG_REDUNDANT_PHRASE',
        level: 'caution',
        module: 'g',
        message: 'Redundant phrase ("image of" / "graphic of") found in image accessible name.'
      });
    }
    if (IMAGE_FILENAME_REGEX.test(computed.accName)) {
      alerts.push({
        id: 'g-filename-alt',
        code: 'ALERT_IMG_FILENAME_ALT',
        level: 'warning',
        module: 'g',
        message: `Image accessible name ("${computed.accName}") appears to be a raw file name.`
      });
    }
  }

  return alerts;
}
