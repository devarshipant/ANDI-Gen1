/**
 * ANDI-Gen1 Core Orchestrator: andi.ts
 * Refactored from legacy andi.js into strict, zero-dependency TypeScript.
 */

import { AndiMode } from '../src/types';
import { AndiGen1Controller } from '../src/ui-shadow';
import { FANDI_VERSION, evaluateFocusableElement } from './fandi';
import { GANDI_VERSION, evaluateGraphicElement } from './gandi';
import { LANDI_VERSION, evaluateLinkOrButtonElement } from './landi';
import { TANDI_VERSION, evaluateTableElement } from './tandi';
import { SANDI_VERSION, evaluateStructureElement } from './sandi';
import { CANDI_VERSION, evaluateColorContrastElement } from './candi';
import { HANDI_VERSION, evaluateHiddenElement } from './handi';
import { IANDI_VERSION, evaluateIframeElement } from './iandi';

export const ANDI_GEN1_VERSION = '31.0.0-gen1-ts';

export const ANDI_MODULE_REGISTRY = {
  f: { version: FANDI_VERSION, evaluate: evaluateFocusableElement },
  g: { version: GANDI_VERSION, evaluate: evaluateGraphicElement },
  l: { version: LANDI_VERSION, evaluate: evaluateLinkOrButtonElement },
  t: { version: TANDI_VERSION, evaluate: evaluateTableElement },
  s: { version: SANDI_VERSION, evaluate: evaluateStructureElement },
  c: { version: CANDI_VERSION, evaluate: evaluateColorContrastElement },
  h: { version: HANDI_VERSION, evaluate: evaluateHiddenElement },
  i: { version: IANDI_VERSION, evaluate: evaluateIframeElement }
};

export function launchAndiGen1(initialMode: AndiMode = 'f'): AndiGen1Controller {
  const controller = new AndiGen1Controller(initialMode);
  controller.launch(initialMode);
  return controller;
}

