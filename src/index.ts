/**
 * ANDI Next — Main Entry Point (Bookmarklet & Browser Extension Ready)
 * Supports launching in default `f` mode or `'all'` mode (`window.AndiNext.launch('all')`).
 */

import { AndiMode } from './types';
import { AndiNextController } from './ui-shadow';

export interface AndiNextGlobalAPI {
  controller: AndiNextController;
  launch: (mode?: AndiMode) => void;
  runAll: () => void;
  destroy: () => void;
}

declare global {
  interface Window {
    AndiNext?: AndiNextGlobalAPI;
    ANDI_INITIAL_MODE?: AndiMode;
  }
}

export function bootstrapAndiNext(): AndiNextGlobalAPI {
  if (window.AndiNext) {
    window.AndiNext.destroy();
  }

  const initialMode: AndiMode = window.ANDI_INITIAL_MODE || 'f';
  const controller = new AndiNextController(initialMode);

  const api: AndiNextGlobalAPI = {
    controller,
    launch(mode?: AndiMode) {
      controller.launch(mode);
    },
    runAll() {
      controller.launch('all');
    },
    destroy() {
      controller.destroy();
    }
  };

  window.AndiNext = api;
  controller.launch(initialMode);
  return api;
}

bootstrapAndiNext();

