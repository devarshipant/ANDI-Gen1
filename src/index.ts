/**
 * ANDI-Gen1 — Main Entry Point (Bookmarklet & Browser Extension Ready)
 * Supports launching in default `f` mode or `'all'` mode (`window.AndiGen1.launch('all')`).
 */

import { AndiMode, DockPosition, ThemeMode } from './types';
import { AndiGen1Controller } from './ui-shadow';

export interface AndiGen1GlobalAPI {
  controller: AndiGen1Controller;
  launch: (mode?: AndiMode) => void;
  runAll: () => void;
  setDock: (dock: DockPosition) => void;
  setTheme: (theme: ThemeMode) => void;
  destroy: () => void;
}

declare global {
  interface Window {
    AndiGen1?: AndiGen1GlobalAPI;
    AndiNext?: AndiGen1GlobalAPI;
    ANDI_INITIAL_MODE?: AndiMode;
  }
}

export function bootstrapAndiGen1(): AndiGen1GlobalAPI {
  if (window.AndiGen1) {
    window.AndiGen1.destroy();
  }

  const initialMode: AndiMode = window.ANDI_INITIAL_MODE || 'f';
  const controller = new AndiGen1Controller(initialMode);

  const api: AndiGen1GlobalAPI = {
    controller,
    launch(mode?: AndiMode) {
      controller.launch(mode);
    },
    runAll() {
      controller.launch('all');
    },
    setDock(dock: DockPosition) {
      controller.setDock(dock);
    },
    setTheme(theme: ThemeMode) {
      controller.setTheme(theme);
    },
    destroy() {
      controller.destroy();
    }
  };

  window.AndiGen1 = api;
  window.AndiNext = api;
  controller.launch(initialMode);
  return api;
}

bootstrapAndiGen1();
