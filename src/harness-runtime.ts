/**
 * ANDI-Gen1 — Test Harness Browser Runtime
 *
 * `harnessRuntime()` is NOT executed inside the inspected page. Its source is serialized
 * (`Function.prototype.toString`) into every generated test-harness `.html` file by
 * `buildTestHarnessHtml()` and runs there, standalone, with no dependency on the rest of ANDI-Gen1.
 *
 * It attaches the event handlers, widget state logic, dialogs and logging a tester needs to
 * exercise a copied DOM fragment locally. It is deliberately typed loosely (`any`) because it only
 * ever manipulates arbitrary third-party DOM.
 */

export function harnessRuntime(): void {
  const metaNode = document.getElementById('hx-meta');
  let meta: any = {};
  try {
    meta = JSON.parse((metaNode && metaNode.textContent) || '{}');
  } catch (err) {
    meta = {};
  }

  const state: any = { dialog: null, trap: false, opener: null, simulateKeys: true };

  // ---------------------------------------------------------------------------
  // Harness chrome lives in a Shadow DOM so page CSS never leaks in and so that
  // ANDI-Gen1 (or any DOM walker) run on this file inspects only the copied fragment.
  // ---------------------------------------------------------------------------
  const host = document.createElement('div');
  host.id = 'andi-harness-chrome';
  host.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = [
    '<style>',
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.panel{font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#020617;color:#fff;border-top:3px solid #7dd3fc;max-height:44vh;display:flex;flex-direction:column}',
    '.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #475569}',
    '.grow{flex:1}',
    'button{font:inherit;font-weight:700;background:#1e293b;color:#fff;border:1.5px solid #94a3b8;border-radius:6px;padding:3px 9px;cursor:pointer}',
    'button.primary{background:#1d4ed8;border-color:#93c5fd}',
    'button:focus-visible,input:focus-visible,summary:focus-visible{outline:2.5px solid #7dd3fc;outline-offset:1px}',
    'input[type=text]{font:inherit;background:#0f172a;color:#fff;border:1.5px solid #94a3b8;border-radius:6px;padding:3px 6px}',
    'code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#7dd3fc}',
    '.body{display:flex;flex-direction:column;min-height:0;overflow:hidden}',
    '.findings{padding:4px 10px;border-bottom:1px solid #475569;max-height:140px;overflow:auto}',
    '.findings div{margin:2px 0}',
    '.log{list-style:none;margin:0;padding:6px 10px;overflow:auto;flex:1;min-height:70px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}',
    '.log li{border-bottom:1px solid #1e293b;white-space:pre-wrap;word-break:break-word}',
    '.k-click{color:#7dd3fc}.k-key{color:#fde68a}.k-dialog{color:#f0abfc}.k-error{color:#fca5a5}.k-info{color:#86efac}.k-form{color:#fdba74}',
    '.overlay{position:fixed;pointer-events:none;border:3px dashed #f472b6;border-radius:4px;box-shadow:0 0 0 2px rgba(2,6,23,.6)}',
    '</style>',
    '<div class="overlay" id="overlay" hidden></div>',
    '<section class="panel" aria-label="ANDI-Gen1 test harness controls">',
    '<div class="row">',
    '<strong>🧪 ANDI-Gen1 Test Harness</strong><code id="sel"></code><span class="grow"></span>',
    '<label>ANDI script <input type="text" id="src" size="40"></label>',
    '<button class="primary" id="launch" type="button">▶ Launch ANDI-Gen1 on this harness</button>',
    '<button id="collapse" type="button" aria-expanded="true">▾ Collapse</button>',
    '</div>',
    '<div class="body" id="body">',
    '<details class="findings" open><summary>Findings captured from the source page</summary><div id="findings"></div></details>',
    '<div class="row">',
    '<label><input type="checkbox" id="keys" checked> Simulate keyboard activation (Enter / Space / arrows / Esc) on ARIA widgets</label>',
    '<label><input type="checkbox" id="hl" checked> Highlight inspected element</label>',
    '<span id="dialogs"></span><span id="lives"></span>',
    '<span class="grow"></span><button id="clear" type="button">Clear log</button>',
    '</div>',
    '<ul class="log" id="log" aria-label="Harness event log"></ul>',
    '</div>',
    '</section>'
  ].join('');

  const $ = (id: string): any => shadow.getElementById(id);
  const logEl = $('log');
  const overlay = $('overlay');

  function log(kind: string, msg: string): void {
    const li = document.createElement('li');
    li.className = 'k-' + kind;
    li.textContent = new Date().toLocaleTimeString() + '  ' + msg;
    logEl.appendChild(li);
    while (logEl.children.length > 300) {
      const first = logEl.firstElementChild;
      if (!first) break;
      logEl.removeChild(first);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  function describe(el: any): string {
    if (!el || !el.tagName) return String(el);
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const role = el.getAttribute('role');
    if (role) s += '[role=' + role + ']';
    const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (name) s += ' "' + (name.length > 32 ? name.slice(0, 29) + '...' : name) + '"';
    return s;
  }

  // ---------------------------------------------------------------------------
  // Header, findings and controls
  // ---------------------------------------------------------------------------
  $('sel').textContent = meta.selector || '';
  const srcInput = $('src');
  srcInput.value = meta.andiScriptUrl || '';
  srcInput.placeholder = './dist/andi-gen1.js for a local build';

  const findings = $('findings');
  function addFinding(label: string, value: string): void {
    if (!value) return;
    const row = document.createElement('div');
    const b = document.createElement('strong');
    b.textContent = label + ' ';
    row.appendChild(b);
    row.appendChild(document.createTextNode(value));
    findings.appendChild(row);
  }
  addFinding('ANDI mode:', meta.mode);
  addFinding('Source:', (meta.pageTitle || '') + ' — ' + (meta.sourceUrl || '') + ' (' + (meta.frameContext || '') + ')');
  addFinding('Captured:', (meta.generatedAtLocal || '') + ' · ' + (meta.browser || ''));
  addFinding('Screen reader output:', meta.screenReaderOutput);
  addFinding('Accessible name:', meta.accName);
  addFinding('Accessible description:', meta.accDesc);
  addFinding('Coordinates on source page:', meta.coordinates);
  const alertList = meta.alerts || [];
  if (alertList.length === 0) {
    addFinding('ANDI alerts:', 'none detected for this element');
  } else {
    alertList.forEach(function (a: any) {
      addFinding('[' + String(a.level).toUpperCase() + ' ' + a.module + 'ANDI]', a.message);
    });
  }

  $('keys').addEventListener('change', function (e: any) {
    state.simulateKeys = e.target.checked;
    log('info', 'Keyboard activation simulation ' + (state.simulateKeys ? 'ON' : 'OFF (native browser behavior only)'));
  });
  $('clear').addEventListener('click', function () {
    logEl.textContent = '';
  });
  $('collapse').addEventListener('click', function () {
    const body = $('body');
    const collapsed = body.hidden !== true;
    body.hidden = collapsed;
    $('collapse').setAttribute('aria-expanded', String(!collapsed));
    $('collapse').textContent = collapsed ? '▸ Expand' : '▾ Collapse';
  });
  $('launch').addEventListener('click', function () {
    const url = String(srcInput.value || '').trim();
    if (!url) {
      log('error', 'Enter the URL of andi-gen1.js first.');
      return;
    }
    (window as any).ANDI_INITIAL_MODE = meta.modeKey || 'f';
    const s = document.createElement('script');
    s.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'v=' + Date.now();
    s.onload = function () {
      log('info', 'ANDI-Gen1 loaded on this harness (mode ' + (meta.modeKey || 'f') + ').');
    };
    s.onerror = function () {
      log('error', 'Could not load ' + url + ' (offline, blocked by CSP, or wrong path).');
    };
    document.head.appendChild(s);
  });

  // ---------------------------------------------------------------------------
  // Highlight overlay for the inspected element (drawn in the chrome, so the
  // element's own outline / focus indicator is never altered)
  // ---------------------------------------------------------------------------
  function updateOverlay(): void {
    const t: any = document.querySelector('[data-hx-target]');
    if (!t || !$('hl').checked) {
      overlay.hidden = true;
      return;
    }
    const r = t.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      overlay.hidden = true;
      return;
    }
    overlay.hidden = false;
    overlay.style.left = r.left - 5 + 'px';
    overlay.style.top = r.top - 5 + 'px';
    overlay.style.width = r.width + 10 + 'px';
    overlay.style.height = r.height + 10 + 'px';
  }
  window.addEventListener('scroll', updateOverlay, true);
  window.addEventListener('resize', updateOverlay);
  setInterval(updateOverlay, 300);
  document.documentElement.style.paddingBottom = '260px';

  // ---------------------------------------------------------------------------
  // Event logging
  // ---------------------------------------------------------------------------
  function isHarnessOrAndi(target: any): boolean {
    return target === host || (target && target.id === 'andi-gen1-host');
  }

  const LOGGED = ['click', 'dblclick', 'keydown', 'focusin', 'focusout', 'input', 'change', 'submit', 'invalid', 'toggle', 'close', 'cancel'];
  LOGGED.forEach(function (name: string) {
    document.addEventListener(
      name,
      function (e: any) {
        if (isHarnessOrAndi(e.target)) return;
        let extra = '';
        if (name === 'keydown') {
          extra = ' key=' + e.key + (e.shiftKey ? '+Shift' : '') + (e.ctrlKey ? '+Ctrl' : '') + (e.altKey ? '+Alt' : '');
        } else if (name === 'input' || name === 'change') {
          const v = e.target && e.target.value;
          if (v !== undefined) extra = ' value="' + String(v).slice(0, 40) + '"';
        }
        let kind = 'click';
        if (name === 'keydown') kind = 'key';
        else if (name === 'submit' || name === 'invalid') kind = 'form';
        else if (name === 'close' || name === 'cancel' || name === 'toggle') kind = 'dialog';
        log(kind, name + ' → ' + describe(e.target) + extra);
      },
      true
    );
  });

  window.addEventListener('error', function (e: any) {
    log('error', '⚠ Script error: ' + (e.message || 'unknown') + ' — an inline handler likely needs page code that is not part of this harness.');
  });
  window.addEventListener('unhandledrejection', function (e: any) {
    log('error', '⚠ Unhandled promise rejection: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
  });

  // Native JS dialogs still appear, but every call is recorded.
  ['alert', 'confirm', 'prompt'].forEach(function (name: string) {
    const original = (window as any)[name];
    (window as any)[name] = function () {
      log('dialog', name + '(' + Array.prototype.slice.call(arguments).join(', ') + ')');
      return original.apply(window, arguments);
    };
  });
  window.open = function (url: any) {
    log('info', 'window.open(' + String(url) + ') blocked inside the harness');
    return null;
  };

  // ---------------------------------------------------------------------------
  // Stub page functions referenced by inline handlers (onclick="save()", href="javascript:go()")
  // ---------------------------------------------------------------------------
  const RESERVED = ['if', 'for', 'while', 'switch', 'return', 'function', 'catch', 'typeof', 'new', 'void', 'delete', 'this', 'event', 'with', 'else', 'do', 'in', 'of'];
  const stubbed: string[] = [];
  const handlerSources: string[] = [];
  document.querySelectorAll('*').forEach(function (n: any) {
    if (n === host) return;
    for (let i = 0; i < n.attributes.length; i++) {
      const a = n.attributes[i];
      if (a.name.indexOf('on') === 0) {
        handlerSources.push(a.value);
      } else if (a.name === 'href' && /^javascript:/i.test(a.value)) {
        handlerSources.push(a.value.replace(/^javascript:/i, ''));
      }
    }
  });
  handlerSources.forEach(function (src: string) {
    const re = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
    let m: any = null;
    while ((m = re.exec(src)) !== null) {
      const fname = m[1];
      if (RESERVED.indexOf(fname) !== -1 || typeof (window as any)[fname] !== 'undefined') continue;
      (window as any)[fname] = function () {
        log('info', 'Stubbed page function ' + fname + '(' + Array.prototype.slice.call(arguments).join(', ') + ') was called by an inline handler');
      };
      stubbed.push(fname);
    }
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function isNativeInteractive(el: any): boolean {
    const t = el.tagName;
    return t === 'BUTTON' || t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || t === 'SUMMARY' || (t === 'A' && el.hasAttribute('href'));
  }

  function isDisabled(el: any): boolean {
    return el.disabled === true || el.getAttribute('aria-disabled') === 'true';
  }

  function idsOf(el: any, attr: string): any[] {
    const raw = el.getAttribute(attr);
    if (!raw) return [];
    return raw
      .trim()
      .split(/\s+/)
      .map(function (id: string) {
        return document.getElementById(id);
      })
      .filter(Boolean);
  }

  function isDialogEl(n: any): boolean {
    return !!n && (n.tagName === 'DIALOG' || n.getAttribute('role') === 'dialog' || n.getAttribute('role') === 'alertdialog');
  }

  function isDialogOpen(d: any): boolean {
    if (d.tagName === 'DIALOG') return d.open === true;
    if (d.hidden) return false;
    const cs = getComputedStyle(d);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function focusables(root: any): any[] {
    return Array.prototype.slice
      .call(root.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex],[contenteditable="true"]'))
      .filter(function (n: any) {
        return !n.disabled && n.getAttribute('tabindex') !== '-1' && n.getClientRects().length > 0;
      });
  }

  // ---------------------------------------------------------------------------
  // Dialogs (<dialog>, role="dialog", role="alertdialog")
  // ---------------------------------------------------------------------------
  function openDialog(d: any, opener: any): void {
    const active = document.activeElement;
    state.opener = opener || (active && active !== host && active !== document.body ? active : document.querySelector('[data-hx-target]'));
    state.trap = d.tagName === 'DIALOG' || d.getAttribute('aria-modal') === 'true';
    if (d.tagName === 'DIALOG') {
      try {
        d.showModal();
      } catch (err) {
        d.setAttribute('open', '');
      }
    } else {
      d.hidden = false;
      d.style.removeProperty('display');
      if (getComputedStyle(d).display === 'none') d.style.display = 'block';
      if (!d.hasAttribute('tabindex')) d.setAttribute('tabindex', '-1');
    }
    state.dialog = d;
    const first = focusables(d)[0] || d;
    first.focus();
    log('dialog', 'Opened ' + describe(d) + (state.trap ? ' (modal: focus trapped, Esc closes)' : ' (non-modal, Esc closes)'));
    refreshDialogButtons();
  }

  function closeDialog(d: any, why: string): void {
    if (d.tagName === 'DIALOG') {
      if (d.open) d.close();
    } else {
      d.hidden = true;
      d.style.display = 'none';
    }
    log('dialog', 'Closed ' + describe(d) + ' (' + why + ')');
    if (state.dialog === d) {
      state.dialog = null;
      if (state.opener && state.opener.focus) state.opener.focus();
    }
    refreshDialogButtons();
  }

  function looksLikeDismiss(el: any): boolean {
    const btn = el.closest('button,[role="button"],a,input[type="button"],input[type="submit"]');
    if (!btn) return false;
    if (btn.hasAttribute('data-dismiss') || btn.hasAttribute('data-close') || btn.hasAttribute('data-bs-dismiss')) return true;
    const label = (btn.getAttribute('aria-label') || btn.value || btn.textContent || '').replace(/\s+/g, ' ').trim();
    return /^(close|cancel|dismiss|ok|okay|no|done|got it|×|✕|x)$/i.test(label);
  }

  const dialogButtons: any[] = [];
  const dialogHost = $('dialogs');
  Array.prototype.slice.call(document.querySelectorAll('dialog,[role="dialog"],[role="alertdialog"]')).forEach(function (d: any) {
    const b = document.createElement('button');
    b.type = 'button';
    (b as any)._hxDialog = d;
    b.addEventListener('click', function () {
      if (isDialogOpen(d)) closeDialog(d, 'harness button');
      else openDialog(d, null);
    });
    d.addEventListener('close', function () {
      if (state.dialog === d) {
        state.dialog = null;
        if (state.opener && state.opener.focus) state.opener.focus();
      }
      refreshDialogButtons();
    });
    dialogHost.appendChild(b);
    dialogButtons.push(b);
  });
  function refreshDialogButtons(): void {
    dialogButtons.forEach(function (b: any) {
      const d = b._hxDialog;
      const heading: any = d.querySelector('h1,h2,h3,h4,[role="heading"]');
      const nm = d.getAttribute('aria-label') || (heading ? heading.textContent : '') || d.tagName.toLowerCase();
      b.textContent = (isDialogOpen(d) ? '✕ Close dialog: ' : '🗨 Open dialog: ') + String(nm).replace(/\s+/g, ' ').trim().slice(0, 28);
    });
  }
  refreshDialogButtons();

  // ---------------------------------------------------------------------------
  // Live regions
  // ---------------------------------------------------------------------------
  let liveCounter = 0;
  const liveHost = $('lives');
  Array.prototype.slice
    .call(document.querySelectorAll('[aria-live]:not([aria-live="off"]),[role="alert"],[role="status"],[role="log"],[role="timer"]'))
    .forEach(function (region: any) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = '🔔 Announce in ' + describe(region).slice(0, 34);
      b.addEventListener('click', function () {
        liveCounter += 1;
        const line = document.createElement('div');
        line.textContent = 'Test announcement #' + liveCounter + ' (' + new Date().toLocaleTimeString() + ')';
        region.appendChild(line);
        log('info', 'Injected live-region text into ' + describe(region));
      });
      liveHost.appendChild(b);
    });

  // ---------------------------------------------------------------------------
  // ARIA widget behaviour (only where the element has no inline handler of its own)
  // ---------------------------------------------------------------------------
  function setExpanded(trigger: any, expanded: boolean): void {
    trigger.setAttribute('aria-expanded', String(expanded));
    idsOf(trigger, 'aria-controls').forEach(function (t: any) {
      if (isDialogEl(t)) return;
      if (expanded) {
        t.hidden = false;
        t.style.removeProperty('display');
        if (getComputedStyle(t).display === 'none') t.style.display = 'block';
      } else {
        t.hidden = true;
        t.style.display = 'none';
      }
    });
    log('info', describe(trigger) + ' aria-expanded=' + expanded);
  }

  function selectTab(tab: any): void {
    const list = tab.closest('[role="tablist"]') || tab.parentElement;
    Array.prototype.slice.call(list.querySelectorAll('[role="tab"]')).forEach(function (t: any) {
      const sel = t === tab;
      t.setAttribute('aria-selected', sel ? 'true' : 'false');
      t.setAttribute('tabindex', sel ? '0' : '-1');
      idsOf(t, 'aria-controls').forEach(function (p: any) {
        p.hidden = !sel;
      });
    });
    log('info', 'Selected tab ' + describe(tab));
  }

  function selectRadio(radio: any): void {
    const role = radio.getAttribute('role');
    const group = radio.closest('[role="radiogroup"],[role="menu"],[role="menubar"]') || radio.parentElement;
    Array.prototype.slice.call(group.querySelectorAll('[role="' + role + '"]')).forEach(function (r: any) {
      r.setAttribute('aria-checked', r === radio ? 'true' : 'false');
      if (role === 'radio') r.setAttribute('tabindex', r === radio ? '0' : '-1');
    });
    log('info', 'Checked ' + describe(radio));
  }

  function selectOption(opt: any): void {
    const box = opt.closest('[role="listbox"]') || opt.parentElement;
    const multi = box.getAttribute('aria-multiselectable') === 'true';
    if (multi) {
      opt.setAttribute('aria-selected', opt.getAttribute('aria-selected') === 'true' ? 'false' : 'true');
    } else {
      Array.prototype.slice.call(box.querySelectorAll('[role="option"]')).forEach(function (o: any) {
        o.setAttribute('aria-selected', o === opt ? 'true' : 'false');
      });
    }
    log('info', 'Option ' + describe(opt) + ' aria-selected=' + opt.getAttribute('aria-selected'));
  }

  function activateWidget(w: any): void {
    if (isDisabled(w) || w.hasAttribute('onclick')) return;
    const role = w.getAttribute('role') || '';
    const tag = w.tagName;
    const nativeField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

    const dialogTarget = idsOf(w, 'aria-controls').filter(isDialogEl)[0];
    if (dialogTarget || (w.getAttribute('aria-haspopup') === 'dialog' && !nativeField)) {
      if (dialogTarget && !isDialogOpen(dialogTarget)) {
        openDialog(dialogTarget, w);
        if (w.hasAttribute('aria-expanded')) w.setAttribute('aria-expanded', 'true');
      }
      return;
    }

    if (role === 'tab') {
      selectTab(w);
    } else if (role === 'radio' || role === 'menuitemradio') {
      if (!nativeField) selectRadio(w);
    } else if (role === 'checkbox' || role === 'switch' || role === 'menuitemcheckbox') {
      if (!nativeField) {
        w.setAttribute('aria-checked', w.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
        log('info', describe(w) + ' aria-checked=' + w.getAttribute('aria-checked'));
      }
    } else if (role === 'option') {
      selectOption(w);
    } else if (!nativeField && w.hasAttribute('aria-pressed')) {
      w.setAttribute('aria-pressed', w.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      log('info', describe(w) + ' aria-pressed=' + w.getAttribute('aria-pressed'));
    } else if (!nativeField && w.hasAttribute('aria-expanded')) {
      setExpanded(w, w.getAttribute('aria-expanded') !== 'true');
    }
  }

  const WIDGET_SELECTOR =
    '[aria-expanded],[aria-pressed],[aria-haspopup],[aria-controls],[role="tab"],[role="checkbox"],[role="switch"],[role="radio"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"]';

  function handleAnchor(a: any, e: any): void {
    const href = a.getAttribute('href') || '';
    if (/^javascript:/i.test(href)) return;
    e.preventDefault();
    if (href.charAt(0) === '#') {
      const id = decodeURIComponent(href.slice(1));
      const target = id ? document.getElementById(id) || document.getElementsByName(id)[0] : null;
      if (target) {
        const had = target.hasAttribute('tabindex');
        if (!had) target.setAttribute('tabindex', '-1');
        target.scrollIntoView({ block: 'center' });
        target.focus({ preventScroll: true });
        log('click', 'Same-page link to #' + id + ' → focus moved to ' + describe(target));
      } else {
        log('click', 'Same-page link ' + href + ' (no matching target in this harness)');
      }
      return;
    }
    log('click', 'Navigation blocked: ' + a.href + (a.target === '_blank' ? ' (new tab)' : '') + ' — the harness stays on this page');
  }

  document.addEventListener('click', function (e: any) {
    if (isHarnessOrAndi(e.target) || !(e.target instanceof Element)) return;
    const el = e.target;
    const anchor = el.closest('a[href]');
    if (anchor) handleAnchor(anchor, e);
    const dlg = el.closest('dialog,[role="dialog"],[role="alertdialog"]');
    if (dlg && isDialogOpen(dlg) && looksLikeDismiss(el)) closeDialog(dlg, 'dismiss control');
    const w = el.closest(WIDGET_SELECTOR);
    if (w) activateWidget(w);
  });

  document.addEventListener(
    'submit',
    function (e: any) {
      const form = e.target;
      if (form && form.getAttribute && form.getAttribute('method') === 'dialog') return;
      e.preventDefault();
      const parts: string[] = [];
      try {
        new FormData(form).forEach(function (v: any, k: string) {
          parts.push(k + '=' + String(v).slice(0, 30));
        });
      } catch (err) {
        parts.push('(unreadable)');
      }
      log('form', 'Submit intercepted (no network request). Fields: ' + (parts.join(', ') || 'none'));
    },
    true
  );

  // ---------------------------------------------------------------------------
  // Keyboard simulation for custom (non-native) widgets
  // ---------------------------------------------------------------------------
  const ENTER_ROLES = ['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'treeitem'];
  const SPACE_ROLES = ['button', 'checkbox', 'switch', 'radio', 'tab', 'option', 'menuitemcheckbox', 'menuitemradio'];
  const ARROW_ROLES = ['tab', 'radio', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option'];
  const ARROW_CONTAINERS = '[role="tablist"],[role="radiogroup"],[role="menu"],[role="menubar"],[role="listbox"],[role="toolbar"]';

  function adjustSlider(el: any, e: any): boolean {
    const role = el.getAttribute('role');
    if (role !== 'slider' && role !== 'spinbutton') return false;
    const min = Number(el.getAttribute('aria-valuemin') || 0);
    const max = Number(el.getAttribute('aria-valuemax') || 100);
    const step = Number(el.getAttribute('aria-valuestep') || 1);
    let value = Number(el.getAttribute('aria-valuenow') || min);
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowUp') value += step;
    else if (k === 'ArrowLeft' || k === 'ArrowDown') value -= step;
    else if (k === 'PageUp') value += step * 10;
    else if (k === 'PageDown') value -= step * 10;
    else if (k === 'Home') value = min;
    else if (k === 'End') value = max;
    else return false;
    value = Math.max(min, Math.min(max, value));
    el.setAttribute('aria-valuenow', String(value));
    e.preventDefault();
    log('key', describe(el) + ' aria-valuenow=' + value);
    return true;
  }

  document.addEventListener('keydown', function (e: any) {
    if (isHarnessOrAndi(e.target)) return;
    const active: any = e.target instanceof Element ? e.target : null;

    // Dialog focus trap and Escape handling
    if (state.dialog && isDialogOpen(state.dialog)) {
      if (e.key === 'Tab' && state.trap) {
        const f = focusables(state.dialog);
        if (f.length === 0) {
          e.preventDefault();
        } else if (!state.dialog.contains(document.activeElement)) {
          e.preventDefault();
          f[0].focus();
        } else if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0].focus();
        }
      } else if (e.key === 'Escape' && state.dialog.tagName !== 'DIALOG') {
        e.preventDefault();
        closeDialog(state.dialog, 'Escape key');
        return;
      }
    }

    if (!state.simulateKeys || !active || !active.getAttribute) return;

    // Escape collapses an expanded popup that contains focus (or its trigger)
    if (e.key === 'Escape') {
      const triggers = Array.prototype.slice.call(document.querySelectorAll('[aria-expanded="true"][aria-controls]'));
      for (let i = 0; i < triggers.length; i++) {
        const t = triggers[i];
        const owns = idsOf(t, 'aria-controls').some(function (p: any) {
          return !isDialogEl(p) && p.contains(active);
        });
        if (t === active || owns) {
          setExpanded(t, false);
          t.focus();
          e.preventDefault();
          return;
        }
      }
    }

    if (adjustSlider(active, e)) return;

    const role = active.getAttribute('role') || '';
    const custom = !isNativeInteractive(active);

    if (custom && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) {
      const allowed = e.key === 'Enter' ? ENTER_ROLES : SPACE_ROLES;
      if (allowed.indexOf(role) !== -1 || (e.key === 'Enter' && active.hasAttribute('aria-expanded'))) {
        e.preventDefault();
        log('key', 'Simulated click from ' + (e.key === 'Enter' ? 'Enter' : 'Space') + ' on ' + describe(active));
        active.click();
        return;
      }
    }

    if (ARROW_ROLES.indexOf(role) !== -1 && /^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(e.key)) {
      const container = active.closest(ARROW_CONTAINERS);
      if (!container) return;
      const items = Array.prototype.slice
        .call(container.querySelectorAll('[role="' + role + '"]'))
        .filter(function (n: any) {
          return !isDisabled(n) && n.getClientRects().length > 0;
        });
      const idx = items.indexOf(active);
      if (idx === -1 || items.length < 2) return;
      let next = idx;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + items.length) % items.length;
      else next = (idx + 1) % items.length;
      e.preventDefault();
      items[next].focus();
      if (role === 'tab' || role === 'radio') items[next].click();
    }
  });

  updateOverlay();
  log('info', 'Harness ready. Interact with the highlighted element — events, simulated widget state changes, blocked navigation and dialogs are logged here.');
  if (stubbed.length > 0) {
    log('info', 'Stubbed page functions referenced by inline handlers: ' + stubbed.join(', '));
  }
}
