/**
 * ANDI-Gen1 — "Copy DOM Code" & Local Test Harness Generator
 *
 * - `getCleanDomCode()` returns the inspected element's full, pretty-printed HTML with ANDI's own
 *   instrumentation (`data-andi*` attributes, injected scripts) removed.
 * - `buildTestHarnessHtml()` produces a standalone `.html` file that recreates the element in its
 *   original context so it can be tested locally:
 *     1. the nearest structural context (table, list, fieldset, select, dialog, label...) so semantics survive,
 *     2. a shell of the element's ancestors (tag + attributes only) so landmarks / forms / CSS selectors still apply,
 *     3. every element it references by IDREF (aria-labelledby, aria-describedby, headers, label[for], aria-controls...),
 *     4. the CSS rules that match those elements (flattened from the page's stylesheets),
 *     5. an event-handler / dialog / live-region runtime (`harnessRuntime`) and a log panel.
 */

import { InspectedElementRecord } from './types';
import { getBrowserEnvironmentInfo } from './notes-report';
import { harnessRuntime } from './harness-runtime';

const HARNESS_ANDI_VERSION = '__ANDI_VERSION__';
const HARNESS_CDN_URL = 'https://cdn.jsdelivr.net/gh/devarshipant/ANDI-Gen1@__ANDI_VERSION__/dist/andi-gen1.js';
const ANDI_PAGE_STYLE_ID = 'andi-gen1-page-highlights-css';
const HARNESS_MAX_CONTEXT_CHARS = 30000;
const HARNESS_MAX_CSS_CHARS = 250000;
const HARNESS_MAX_SHELL_DEPTH = 12;
const HARNESS_MAX_MATCH_POOL = 600;

const HARNESS_CONTEXT_SELECTOR =
  'table, [role="table"], [role="grid"], [role="treegrid"], ul, ol, menu, dl, ' +
  '[role="list"], [role="listbox"], [role="menu"], [role="menubar"], [role="tablist"], [role="radiogroup"], [role="group"], ' +
  'fieldset, select, figure, dialog, [role="dialog"], [role="alertdialog"], label';

const HARNESS_REF_ATTRS_BEFORE = ['aria-labelledby', 'aria-describedby', 'aria-errormessage', 'headers'];
const HARNESS_REF_ATTRS_AFTER = ['aria-controls', 'aria-details', 'aria-owns', 'aria-activedescendant'];
const PRESERVE_WHITESPACE_TAGS = ['pre', 'textarea', 'script', 'style'];
const VOID_TAGS = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];

interface HarnessRefs {
  before: HTMLElement[];
  after: HTMLElement[];
}

interface HarnessCssResult {
  css: string;
  links: string[];
}

function removeAndiAttributes(node: Element): void {
  for (let i = node.attributes.length - 1; i >= 0; i--) {
    const name = node.attributes[i].name;
    if (name.indexOf('data-andi') === 0) {
      node.removeAttribute(name);
    }
  }
}

/**
 * Strips ANDI instrumentation + scripts from a deep clone and freezes live form state
 * (typed values, checked boxes, selected options) into attributes so it survives serialization.
 * `orig` and `clone` must be structurally identical on entry.
 */
function sanitizeClone(orig: HTMLElement, clone: HTMLElement, target?: HTMLElement): void {
  const origNodes = [orig].concat(Array.from(orig.querySelectorAll('*')) as HTMLElement[]);
  const cloneNodes = [clone].concat(Array.from(clone.querySelectorAll('*')) as HTMLElement[]);
  const scripts: HTMLElement[] = [];

  for (let i = 0; i < origNodes.length; i++) {
    const o = origNodes[i];
    const c = cloneNodes[i];
    if (!c) {
      continue;
    }
    removeAndiAttributes(c);
    const tag = o.tagName.toLowerCase();
    if (tag === 'script') {
      scripts.push(c);
      continue;
    }
    if (target && o === target) {
      c.setAttribute('data-hx-target', 'true');
    }
    if (tag === 'input') {
      const inp = o as HTMLInputElement;
      const type = (inp.type || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        if (inp.checked) {
          c.setAttribute('checked', '');
        } else {
          c.removeAttribute('checked');
        }
      } else if (type !== 'password' && type !== 'file' && inp.value !== (c.getAttribute('value') || '')) {
        c.setAttribute('value', inp.value);
      }
    } else if (tag === 'textarea') {
      c.textContent = (o as HTMLTextAreaElement).value;
    } else if (tag === 'select') {
      const opts = (o as HTMLSelectElement).options;
      const copts = c.querySelectorAll('option');
      for (let j = 0; j < opts.length && j < copts.length; j++) {
        if (opts[j].selected) {
          copts[j].setAttribute('selected', '');
        } else {
          copts[j].removeAttribute('selected');
        }
      }
    }
  }

  for (const s of scripts) {
    if (s.parentNode) {
      s.parentNode.removeChild(s);
    }
  }
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function prettyPrint(node: Node, depth: number, out: string[]): void {
  const pad = '  '.repeat(depth);
  if (node.nodeType === 3) {
    const t = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
    if (t) {
      out.push(pad + escapeText(t));
    }
    return;
  }
  if (node.nodeType === 8) {
    out.push(pad + '<!--' + (node.nodeValue || '') + '-->');
    return;
  }
  if (node.nodeType !== 1) {
    return;
  }
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (!el.firstElementChild || PRESERVE_WHITESPACE_TAGS.indexOf(tag) !== -1 || VOID_TAGS.indexOf(tag) !== -1) {
    out.push(pad + el.outerHTML);
    return;
  }
  const shell = (el.cloneNode(false) as HTMLElement).outerHTML;
  const open = shell.slice(0, shell.lastIndexOf('</'));
  out.push(pad + open);
  for (let i = 0; i < el.childNodes.length; i++) {
    prettyPrint(el.childNodes[i], depth + 1, out);
  }
  out.push(pad + '</' + tag + '>');
}

/**
 * Returns the inspected element's full DOM code (outerHTML), pretty-printed, with ANDI
 * instrumentation removed. This is exactly what "Copy DOM Code" puts on the clipboard.
 */
export function getCleanDomCode(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  sanitizeClone(el, clone);
  const lines: string[] = [];
  prettyPrint(clone, 0, lines);
  return lines.join('\n');
}

export function getHarnessFileName(rec: InspectedElementRecord): string {
  const base = rec.tagName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'element';
  return `andi-harness-${base}-${rec.index}.html`;
}

function pickHarnessRoot(el: HTMLElement): HTMLElement {
  let ctx: HTMLElement | null = null;
  if (el.matches(HARNESS_CONTEXT_SELECTOR)) {
    ctx = el;
  } else if (el.parentElement) {
    ctx = el.parentElement.closest(HARNESS_CONTEXT_SELECTOR) as HTMLElement | null;
  }
  if (ctx && ctx.outerHTML.length <= HARNESS_MAX_CONTEXT_CHARS) {
    return ctx;
  }
  return el;
}

function getEffectiveBackground(el: HTMLElement): string {
  const win = el.ownerDocument.defaultView || window;
  let cur: HTMLElement | null = el;
  while (cur) {
    const bg = win.getComputedStyle(cur).backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)/.test(bg)) {
      return bg;
    }
    cur = cur.parentElement;
  }
  return 'rgb(255, 255, 255)';
}

/**
 * Freezes the computed visual facts that most affect ANDI results onto the inspected element
 * (hidden state always; text color / effective background / font size & weight for cANDI).
 */
function applyTargetStyleSnapshot(orig: HTMLElement, clone: HTMLElement, modeKey: string): void {
  const win = orig.ownerDocument.defaultView || window;
  const cs = win.getComputedStyle(orig);
  const decls: string[] = [];
  if (cs.display === 'none') {
    decls.push('display:none');
  }
  if (cs.visibility === 'hidden' || cs.visibility === 'collapse') {
    decls.push('visibility:hidden');
  }
  if (modeKey === 'c') {
    decls.push('color:' + cs.color);
    decls.push('background-color:' + getEffectiveBackground(orig));
    decls.push('font-size:' + cs.fontSize);
    decls.push('font-weight:' + cs.fontWeight);
  }
  if (decls.length === 0) {
    return;
  }
  const existing = (clone.getAttribute('style') || '').trim();
  const sep = existing && existing.slice(-1) !== ';' ? ';' : '';
  clone.setAttribute('style', existing + sep + decls.join(';'));
}

function collectReferencedElements(doc: Document, scope: HTMLElement[], root: HTMLElement): HarnessRefs {
  const before: HTMLElement[] = [];
  const after: HTMLElement[] = [];
  const seen: HTMLElement[] = [];

  const addTarget = (t: HTMLElement, bucket: HTMLElement[]): void => {
    if (t === root || root.contains(t) || t.contains(root)) {
      return;
    }
    if (seen.some((p) => p === t || p.contains(t))) {
      return;
    }
    seen.push(t);
    bucket.push(t);
  };

  const addIds = (node: HTMLElement, attr: string, bucket: HTMLElement[]): void => {
    const raw = node.getAttribute(attr);
    if (!raw) {
      return;
    }
    for (const id of raw.trim().split(/\s+/)) {
      const t = doc.getElementById(id);
      if (t) {
        addTarget(t, bucket);
      }
    }
  };

  for (const node of scope) {
    for (const attr of HARNESS_REF_ATTRS_BEFORE) {
      addIds(node, attr, before);
    }
    for (const attr of HARNESS_REF_ATTRS_AFTER) {
      addIds(node, attr, after);
    }
    if (node.id) {
      const labels = doc.querySelectorAll('label[for="' + CSS.escape(node.id) + '"]');
      labels.forEach((l) => addTarget(l as HTMLElement, before));
    }
  }
  return { before, after };
}

function splitSelectorList(sel: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < sel.length; i++) {
    const ch = sel.charAt(i);
    if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    }
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) {
    parts.push(cur);
  }
  return parts;
}

/**
 * Removes pseudo-elements and transient interaction states so that rules such as
 * `a:hover`, `button:focus-visible` or `p::before` are still included for the base element.
 */
function normalizeSelectorForHarness(part: string): string {
  let s = part.replace(
    /::?(?:before|after|first-line|first-letter|placeholder|selection|marker|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)/gi,
    ''
  );
  s = s.replace(/:(?:hover|focus-visible|focus-within|focus|active|visited|target)(?![\w-])/gi, '');
  s = s.trim();
  if (s === '') {
    return '*';
  }
  if (/^[>+~]/.test(s)) {
    s = '*' + s;
  }
  if (/[>+~]$/.test(s)) {
    s = s + '*';
  }
  return s;
}

function collectMatchedCss(doc: Document, elements: Element[]): HarnessCssResult {
  const win = doc.defaultView || window;
  const links: string[] = [];
  const chunks: string[] = [];
  let budget = HARNESS_MAX_CSS_CHARS;
  const pool = elements.slice(0, HARNESS_MAX_MATCH_POOL);

  const matchesAny = (selectorList: string): boolean => {
    for (const part of splitSelectorList(selectorList)) {
      const normalized = normalizeSelectorForHarness(part);
      for (const e of pool) {
        try {
          if (e.matches(normalized)) {
            return true;
          }
        } catch (err) {
          break;
        }
      }
    }
    return false;
  };

  const visitRules = (rules: any): void => {
    for (let i = 0; i < rules.length; i++) {
      if (budget <= 0) {
        return;
      }
      const r: any = rules[i];
      if (r.type === 1) {
        const selectorText: string = r.selectorText || '';
        if (selectorText.indexOf('data-andi') === -1 && matchesAny(selectorText)) {
          const text: string = r.cssText;
          budget -= text.length;
          chunks.push(text);
        }
      } else if (r.type === 4) {
        let ok = true;
        try {
          ok = win.matchMedia(r.conditionText || r.media.mediaText).matches;
        } catch (err) {
          ok = false;
        }
        if (ok) {
          visitRules(r.cssRules);
        }
      } else if (r.type === 12) {
        visitRules(r.cssRules);
      }
    }
  };

  for (const sheet of Array.from(doc.styleSheets)) {
    const owner: any = sheet.ownerNode;
    if (owner && owner.id === ANDI_PAGE_STYLE_ID) {
      continue;
    }
    if (sheet.disabled) {
      continue;
    }
    let rules: any = null;
    try {
      rules = sheet.cssRules;
    } catch (err) {
      rules = null;
    }
    if (rules === null) {
      if (sheet.href) {
        links.push(sheet.href);
      }
      continue;
    }
    visitRules(rules);
  }

  return { css: chunks.join('\n'), links };
}

function copySafeAttrs(src: Element, allowStyle: boolean): string {
  const out: string[] = [];
  for (let i = 0; i < src.attributes.length; i++) {
    const a = src.attributes[i];
    const name = a.name.toLowerCase();
    if (name.indexOf('data-andi') === 0 || name.indexOf('on') === 0) {
      continue;
    }
    let value = a.value;
    if (name === 'style') {
      if (!allowStyle) {
        continue;
      }
      // Drop the page margins ANDI adds when docked so the harness is not pushed off-screen.
      value = value
        .split(';')
        .filter((d) => !/^\s*margin(-(top|right|bottom|left))?\s*:/i.test(d))
        .join(';');
      if (value.trim() === '') {
        continue;
      }
    }
    out.push(` ${a.name}="${escapeAttr(value)}"`);
  }
  return out.join('');
}

function sanitizeShell(shell: HTMLElement): void {
  removeAndiAttributes(shell);
  for (let i = shell.attributes.length - 1; i >= 0; i--) {
    const name = shell.attributes[i].name.toLowerCase();
    if (name.indexOf('on') === 0) {
      shell.removeAttribute(shell.attributes[i].name);
    }
  }
}

/**
 * Builds a complete, standalone, locally-runnable test harness `.html` file for the inspected element.
 */
export function buildTestHarnessHtml(
  rec: InspectedElementRecord,
  modeKey: string,
  modeLabel: string,
  frameLabel: string
): string {
  const el = rec.element;
  const doc = el.ownerDocument;
  const root = pickHarnessRoot(el);

  // 1. Context root (with the inspected element tagged as the harness target)
  const rootClone = root.cloneNode(true) as HTMLElement;
  sanitizeClone(root, rootClone, el);
  const targetClone = rootClone.hasAttribute('data-hx-target')
    ? rootClone
    : (rootClone.querySelector('[data-hx-target]') as HTMLElement | null);
  if (targetClone) {
    applyTargetStyleSnapshot(el, targetClone, modeKey);
  }

  // 2. Ancestor shell (tag + attributes only)
  const shellChain: HTMLElement[] = [];
  let anc = root.parentElement;
  while (anc && anc !== doc.body && anc !== doc.documentElement && shellChain.length < HARNESS_MAX_SHELL_DEPTH) {
    shellChain.unshift(anc);
    anc = anc.parentElement;
  }
  let stageNode: HTMLElement = rootClone;
  for (let i = shellChain.length - 1; i >= 0; i--) {
    const sh = shellChain[i].cloneNode(false) as HTMLElement;
    sanitizeShell(sh);
    sh.appendChild(stageNode);
    stageNode = sh;
  }

  // 3. IDREF targets (labels, descriptions, headers, controlled popups...)
  const scopeNodes = [root].concat(Array.from(root.querySelectorAll('*')) as HTMLElement[]).concat(shellChain);
  const refs = collectReferencedElements(doc, scopeNodes, root);
  const cloneRef = (r: HTMLElement): string => {
    const c = r.cloneNode(true) as HTMLElement;
    sanitizeClone(r, c);
    return c.outerHTML;
  };
  const beforeHtml = refs.before.map(cloneRef).join('\n');
  const afterHtml = refs.after.map(cloneRef).join('\n');

  // 4. Matching CSS
  const cssPool: Element[] = [doc.documentElement, doc.body];
  for (const n of scopeNodes) {
    cssPool.push(n);
  }
  for (const r of refs.before.concat(refs.after)) {
    cssPool.push(r);
    r.querySelectorAll('*').forEach((d) => cssPool.push(d));
  }
  const cssResult = collectMatchedCss(doc, cssPool);

  // 5. Metadata for the harness panel
  const env = getBrowserEnvironmentInfo();
  const meta = {
    modeKey,
    mode: modeLabel,
    selector: rec.selector,
    sourceUrl: doc.location ? doc.location.href : '',
    pageTitle: doc.title,
    frameContext: frameLabel,
    generatedAtLocal: new Date().toLocaleString(),
    browser: env.browserName,
    andiVersion: HARNESS_ANDI_VERSION,
    andiScriptUrl: HARNESS_CDN_URL,
    screenReaderOutput: rec.screenReaderOutput,
    accName: rec.accName,
    accDesc: rec.accDesc,
    coordinates: rec.coordinates.formatted,
    alerts: rec.alerts.map((a) => ({ level: a.level, code: a.code, module: a.module, message: a.message }))
  };
  const metaJson = JSON.stringify(meta).replace(/</g, '\\u003c');
  const runtimeSource = ('(' + harnessRuntime.toString() + ')();').replace(/<\/script/gi, '<\\/script');

  const baseHref = doc.baseURI && /^(https?|file):/i.test(doc.baseURI) ? doc.baseURI : '';
  const linkTags = cssResult.links
    .map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}">`)
    .join('\n');
  const refsWrap = (html: string, label: string): string =>
    html
      ? `<div data-hx-refs="${label}" style="outline:1px dashed #94a3b8;outline-offset:2px;margin:6px 0;padding:2px">\n${html}\n</div>`
      : '';

  return [
    '<!DOCTYPE html>',
    `<html${copySafeAttrs(doc.documentElement, false)}>`,
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>ANDI-Gen1 Test Harness — ${escapeText(rec.selector)}</title>`,
    baseHref ? `<base href="${escapeAttr(baseHref)}">` : '',
    linkTags,
    '<style id="hx-page-css">',
    cssResult.css.replace(/<\/style/gi, '<\\/style'),
    '</style>',
    '</head>',
    `<body${copySafeAttrs(doc.body, true)}>`,
    `<!-- ANDI-Gen1 ${HARNESS_ANDI_VERSION} test harness generated ${new Date().toISOString()} from ${escapeText(doc.location ? doc.location.href : '')} (${escapeText(modeLabel)}) -->`,
    '<!-- Inspected element: ' + escapeText(rec.selector).replace(/--/g, '- -') + ' (marked data-hx-target). Ancestors are reproduced as empty shells so landmarks, forms and CSS selectors still apply. -->',
    refsWrap(beforeHtml, 'before'),
    stageNode.outerHTML,
    refsWrap(afterHtml, 'after'),
    `<script id="hx-meta" type="application/json">${metaJson}</script>`,
    `<script>${runtimeSource}</script>`,
    '</body>',
    '</html>'
  ]
    .filter((line) => line !== '')
    .join('\n');
}

