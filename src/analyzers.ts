/**
 * ANDI-Gen1 — Multi-Module Accessibility Analysis & Element Inventory Engine
 * Supports running individual modules (f, g, l, t, s, c, h, i) OR the unified
 * `'all'` mode (placed as the last option in the mode droplist), semantic ARIA role
 * detection, and building the full Element Inventory array for the Fly-In Drawer.
 */

import {
  AndiAlert,
  AndiMode,
  InspectedElementRecord,
  InventoryCategory,
  InventoryItem,
  PageIndex
} from './types';
import {
  canStepIntoIframe,
  extractDomNodeSnippet,
  formatTagName,
  getElementSelector,
  getFocusability,
  getValidRole,
  isAriaHiddenInTree
} from './dom-index';
import { computeAccessibleData, ComputedAccessibilityResult } from './acc-name';
import { getElementCoordinates, readElementNote } from './notes-report';
import { evaluateFocusableElement } from '../andi/fandi';
import { evaluateGraphicElement } from '../andi/gandi';
import { evaluateLinkOrButtonElement } from '../andi/landi';
import { evaluateTableElement } from '../andi/tandi';

const INTERACTIVE_ARIA_WIDGET_ROLES: ReadonlySet<string> = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
  'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'tab', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'treeitem'
]);

const FORM_CONTROL_ROLES: ReadonlySet<string> = new Set([
  'textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio',
  'switch', 'slider', 'spinbutton'
]);

const LANDMARK_TAGS: ReadonlySet<string> = new Set([
  'main', 'nav', 'header', 'footer', 'aside', 'form', 'region', 'search'
]);

const LANDMARK_ROLES: ReadonlySet<string> = new Set([
  'banner', 'navigation', 'main', 'contentinfo', 'complementary', 'region', 'search', 'form'
]);

export function analyzePage(
  pageIndex: PageIndex,
  mode: AndiMode,
  frameContext = 'top'
): InspectedElementRecord[] {
  const records: InspectedElementRecord[] = [];
  let elementCounter = 0;

  const linkSignatures = new Map<string, { href: string; record: InspectedElementRecord }>();
  const buttonNames = new Map<string, InspectedElementRecord>();
  const accessKeyMap = new Map<string, InspectedElementRecord>();
  let previousHeadingLevel = 0;

  const candidatePool =
    mode === 'h' || mode === 'all' ? pageIndex.allElements : pageIndex.visibleElements;
  const visibleSet = new Set<HTMLElement>(pageIndex.visibleElements);

  for (const el of candidatePool) {
    const isVisible = visibleSet.has(el);
    const tag = el.tagName.toLowerCase();
    const role = getValidRole(el);
    const focusInfo = getFocusability(el);
    const selector = getElementSelector(el);

    const matchedModules = getMatchedModulesForElement(
      el,
      tag,
      role,
      focusInfo.isFocusable,
      isVisible,
      pageIndex
    );

    const existingNote = readElementNote(el, selector, frameContext);
    const shouldInspect =
      mode === 'all'
        ? matchedModules.length > 0 || existingNote !== null
        : matchedModules.includes(mode) || existingNote !== null;

    if (!shouldInspect) {
      continue;
    }

    const computed = computeAccessibleData(el, pageIndex);
    const alerts: AndiAlert[] = [];

    const activeModules: Array<Exclude<AndiMode, 'all'>> =
      mode === 'all' ? matchedModules : [mode];

    for (const mod of activeModules) {
      switch (mod) {
        case 'f':
          runFocusableChecks(el, tag, role, focusInfo, computed, pageIndex, alerts);
          break;
        case 'g':
          runGraphicsChecks(el, tag, role, focusInfo.isTabbable, computed, alerts);
          break;
        case 'l':
          runLinksButtonsChecks(el, tag, role, focusInfo, computed, alerts);
          break;
        case 't':
          runTableChecks(el, tag, role, computed, alerts);
          break;
        case 's':
          prevHeadingCheck(el, tag, role, computed, alerts, (lvl) => {
            if (previousHeadingLevel > 0 && lvl - previousHeadingLevel > 1) {
              pushAlert(
                alerts,
                's',
                'ALERT_S_HEADING_SKIP',
                'warning',
                `Heading level skipped from H${previousHeadingLevel} to H${lvl}.`
              );
            }
            previousHeadingLevel = lvl;
          });
          break;
        case 'c':
          if (isVisible) {
            runContrastChecks(el, computed, pageIndex, alerts);
          }
          break;
        case 'h':
          runHiddenChecks(el, isVisible, focusInfo.isFocusable, alerts);
          break;
        case 'i':
          runIframeChecks(el, focusInfo, computed, alerts);
          break;
      }
    }

    if (el.id) {
      const idMatches = pageIndex.idMap.get(el.id);
      if (idMatches && idMatches.length > 1) {
        pushAlert(
          alerts,
          activeModules[0] || 'f',
          'ALERT_DUP_ID',
          'danger',
          `Duplicate element [id="${el.id}"] (${idMatches.length} instances on page); IDs must be unique.`
        );
      }
    }

    elementCounter += 1;
    const rawAccessKey = el.getAttribute('accesskey')?.trim().toUpperCase() || null;
    const isIframe = tag === 'iframe';
    const iframeAccessible = isIframe ? canStepIntoIframe(el as HTMLIFrameElement) : false;
    const iframeSrc = isIframe ? el.getAttribute('src') || '(inline srcdoc)' : '';

    const record: InspectedElementRecord = {
      index: elementCounter,
      element: el,
      selector,
      domSnippet: extractDomNodeSnippet(el),
      tagName: formatTagName(el),
      role,
      semanticRole: computed.semanticRole,
      isFocusable: focusInfo.isFocusable,
      isTabbable: focusInfo.isTabbable,
      tabIndexValue: focusInfo.tabIndexValue,
      accessKey: rawAccessKey,
      accName: computed.accName,
      accDesc: computed.accDesc,
      accGroup: computed.accGroup,
      screenReaderOutput: computed.screenReaderOutput,
      addOnProps: computed.addOnProps,
      components: computed.components,
      idRefGroups: computed.idRefGroups,
      tableAssociation: computed.tableAssociation,
      alerts,
      modulesMatched: matchedModules,
      note: existingNote,
      coordinates: getElementCoordinates(el),
      isIframe,
      iframeAccessible,
      iframeSrc
    };

    if (rawAccessKey && activeModules.includes('f')) {
      if (rawAccessKey.length > 1) {
        pushAlert(
          record.alerts,
          'f',
          'ALERT_ACCESSKEY_MULTI',
          'danger',
          `[accesskey="${rawAccessKey}"] has more than one character.`
        );
      } else {
        const prev = accessKeyMap.get(rawAccessKey);
        if (prev) {
          pushAlert(
            record.alerts,
            'f',
            'ALERT_ACCESSKEY_DUP',
            'danger',
            `Duplicate [accesskey="${rawAccessKey}"] also used on element #${prev.index}.`
          );
        } else {
          accessKeyMap.set(rawAccessKey, record);
        }
      }
    }

    if (activeModules.includes('l') && computed.accName) {
      const sig = `${computed.accName.toLowerCase()}||${computed.accDesc.toLowerCase()}`;
      if (tag === 'a' || role === 'link') {
        const href = (el.getAttribute('href') || '').trim();
        const existing = linkSignatures.get(sig);
        if (existing && existing.href !== href) {
          pushAlert(
            record.alerts,
            'l',
            'ALERT_LINK_AMBIGUOUS',
            'warning',
            `Ambiguous Link: shares accessible name "${computed.accName}" with element #${existing.record.index} but points to a different href.`
          );
        } else if (!existing) {
          linkSignatures.set(sig, { href, record });
        }
      } else if (tag === 'button' || role === 'button') {
        const existingBtn = buttonNames.get(sig);
        if (existingBtn) {
          pushAlert(
            record.alerts,
            'l',
            'ALERT_BUTTON_NON_UNIQUE',
            'warning',
            `Non-unique button: shares name/description "${computed.accName}" with element #${existingBtn.index}.`
          );
        } else {
          buttonNames.set(sig, record);
        }
      }
    }

    records.push(record);
  }

  return records;
}

/**
 * Builds a categorized array of interface elements on the page for the
 * Element Inventory Fly-In Drawer (tables, links, buttons, formControls, landmarks,
 * headings, graphics, dialogsLive, iframes).
 */
export function buildPageInventory(
  pageIndex: PageIndex,
  records: InspectedElementRecord[]
): InventoryItem[] {
  const recordByElement = new Map<HTMLElement, InspectedElementRecord>();
  for (const r of records) {
    recordByElement.set(r.element, r);
  }

  const inventory: InventoryItem[] = [];
  let invId = 0;

  for (const el of pageIndex.visibleElements) {
    const tag = el.tagName.toLowerCase();
    const role = getValidRole(el);
    const rec = recordByElement.get(el) || null;

    const categories = classifyInventoryCategories(el, tag, role);
    if (categories.length === 0) {
      continue;
    }

    const computed = rec ? null : computeAccessibleData(el, pageIndex);
    const accName = rec ? rec.accName : computed!.accName;
    const accDesc = rec ? rec.accDesc : computed!.accDesc;
    const semanticRole = rec ? rec.semanticRole : computed!.semanticRole;
    const domSnippet = rec ? rec.domSnippet : extractDomNodeSnippet(el);
    const selector = rec ? rec.selector : getElementSelector(el);
    const coordinates = rec ? rec.coordinates : getElementCoordinates(el);
    const alertCount = rec ? rec.alerts.length : 0;
    const tableAssoc = rec ? rec.tableAssociation : computed!.tableAssociation;

    for (const category of categories) {
      invId += 1;
      const details = formatInventoryDetails(el, tag, role, category, tableAssoc);
      inventory.push({
        id: `inv-${invId}`,
        category,
        inspectedIndex: rec ? rec.index : null,
        element: el,
        tagName: formatTagName(el),
        role,
        semanticRole: semanticRole || role || tag,
        domSnippet,
        selector,
        accName,
        accDesc,
        details,
        alertCount,
        coordinates
      });
    }
  }

  return inventory;
}

function classifyInventoryCategories(
  el: HTMLElement,
  tag: string,
  role: string
): InventoryCategory[] {
  const cats: InventoryCategory[] = [];

  // 1. Tables & Semantic ARIA Tables/Grids (plus table cells/headers if part of table structure)
  if (
    (tag === 'table' && role !== 'presentation' && role !== 'none') ||
    role === 'table' ||
    role === 'grid' ||
    role === 'treegrid'
  ) {
    cats.push('tables');
  }

  // 2. Links
  if (tag === 'a' || role === 'link') {
    cats.push('links');
  }

  // 3. Buttons
  const inputType = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : '';
  if (
    tag === 'button' ||
    role === 'button' ||
    tag === 'summary' ||
    (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(inputType))
  ) {
    cats.push('buttons');
  }

  // 4. Form Controls (Native & ARIA widget roles)
  if (
    (tag === 'input' && !['button', 'submit', 'reset', 'image', 'hidden'].includes(inputType)) ||
    tag === 'select' ||
    tag === 'textarea' ||
    tag === 'meter' ||
    tag === 'progress' ||
    tag === 'output' ||
    FORM_CONTROL_ROLES.has(role)
  ) {
    cats.push('formControls');
  }

  // 5. Landmarks
  if (
    LANDMARK_TAGS.has(tag) ||
    LANDMARK_ROLES.has(role) ||
    (tag === 'section' && (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')))
  ) {
    cats.push('landmarks');
  }

  // 6. Headings
  if (/^h[1-6]$/.test(tag) || role === 'heading') {
    cats.push('headings');
  }

  // 7. Graphics
  if (
    tag === 'img' ||
    tag === 'svg' ||
    tag === 'canvas' ||
    tag === 'area' ||
    role === 'img' ||
    role === 'image' ||
    role === 'figure' ||
    tag === 'figure'
  ) {
    cats.push('graphics');
  }

  // 8. Dialogs, Lists & Live Regions
  if (
    tag === 'dialog' ||
    role === 'dialog' ||
    role === 'alertdialog' ||
    el.hasAttribute('aria-live') ||
    ['alert', 'status', 'log', 'marquee', 'timer'].includes(role)
  ) {
    cats.push('dialogsLive');
  }

  // 9. Iframes
  if (tag === 'iframe') {
    cats.push('iframes');
  }

  return cats;
}

function formatInventoryDetails(
  el: HTMLElement,
  tag: string,
  role: string,
  category: InventoryCategory,
  tableAssoc: InspectedElementRecord['tableAssociation']
): string {
  switch (category) {
    case 'tables': {
      const kind = tag === 'table' ? '<table>' : `[role="${role}"]`;
      if (tableAssoc) {
        const hdrs = [...tableAssoc.columnHeaders, ...tableAssoc.rowHeaders];
        const hdrSummary = hdrs.length > 0 ? `Headers: ${hdrs.slice(0, 5).join(', ')}` : 'No headers detected';
        return `${kind} • ${tableAssoc.rowCount} rows × ${tableAssoc.colCount} cols • ${hdrSummary}`;
      }
      return kind;
    }
    case 'links': {
      const href = el.getAttribute('href');
      return href ? `href="${href}"` : role === 'link' ? '[role="link"] (no href)' : '<a> (no href)';
    }
    case 'buttons': {
      const ariaExpanded = el.getAttribute('aria-expanded');
      const ariaPressed = el.getAttribute('aria-pressed');
      const extra: string[] = [];
      if (role === 'button' && tag !== 'button') extra.push(`<${tag} role="button">`);
      if (ariaExpanded) extra.push(`expanded=${ariaExpanded}`);
      if (ariaPressed) extra.push(`pressed=${ariaPressed}`);
      return extra.join(' • ') || `<${formatTagName(el)}>`;
    }
    case 'formControls': {
      const extra: string[] = [];
      if (role && FORM_CONTROL_ROLES.has(role) && !['input', 'select', 'textarea'].includes(tag)) {
        extra.push(`<${tag} role="${role}">`);
      } else {
        extra.push(`<${formatTagName(el)}>`);
      }
      if (el.hasAttribute('required') || el.getAttribute('aria-required') === 'true') {
        extra.push('required');
      }
      return extra.join(' • ');
    }
    case 'landmarks': {
      const lmRole = role || (tag === 'header' ? 'banner' : tag === 'footer' ? 'contentinfo' : tag === 'nav' ? 'navigation' : tag === 'aside' ? 'complementary' : tag);
      return `Landmark: ${lmRole} (<${tag}>)`;
    }
    case 'headings': {
      const lvl = el.getAttribute('aria-level') || (/^h[1-6]$/.test(tag) ? tag.charAt(1) : '2');
      return `Level H${lvl} (${role === 'heading' && !/^h[1-6]$/.test(tag) ? `<${tag} role="heading" aria-level="${lvl}">` : `<${tag}>`})`;
    }
    case 'graphics': {
      const alt = el.getAttribute('alt');
      if (alt === '') return 'Decorative (alt="")';
      return `<${tag}${role ? ` role="${role}"` : ''}>`;
    }
    case 'dialogsLive': {
      const live = el.getAttribute('aria-live');
      return live ? `aria-live="${live}"` : `role="${role || tag}"`;
    }
    case 'iframes': {
      const src = el.getAttribute('src') || '(inline srcdoc)';
      return `src="${src}"`;
    }
  }
}

function getMatchedModulesForElement(
  el: HTMLElement,
  tag: string,
  role: string,
  isFocusable: boolean,
  isVisible: boolean,
  pageIndex: PageIndex
): Array<Exclude<AndiMode, 'all'>> {
  const matched: Array<Exclude<AndiMode, 'all'>> = [];

  if (!isVisible || el.getAttribute('aria-hidden') === 'true') {
    if (
      el.getAttribute('aria-hidden') === 'true' ||
      isFocusable ||
      el.querySelector('input, button, a[href], select, textarea, [tabindex]')
    ) {
      matched.push('h');
    }
    if (!isVisible) {
      return matched;
    }
  }

  if (isFocusable || tag === 'canvas' || INTERACTIVE_ARIA_WIDGET_ROLES.has(role)) {
    matched.push('f');
  }

  if (
    tag === 'img' ||
    tag === 'svg' ||
    tag === 'canvas' ||
    tag === 'area' ||
    tag === 'figure' ||
    role === 'img' ||
    role === 'image' ||
    role === 'figure' ||
    (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'image')
  ) {
    matched.push('g');
  }

  if (
    tag === 'a' ||
    tag === 'button' ||
    role === 'link' ||
    role === 'button' ||
    (tag === 'input' &&
      ['button', 'submit', 'reset', 'image'].includes((el.getAttribute('type') || '').toLowerCase()))
  ) {
    matched.push('l');
  }

  if (
    tag === 'table' ||
    role === 'table' ||
    role === 'grid' ||
    role === 'treegrid' ||
    tag === 'th' ||
    tag === 'td' ||
    role === 'columnheader' ||
    role === 'rowheader' ||
    role === 'cell' ||
    role === 'gridcell'
  ) {
    matched.push('t');
  }

  if (
    /^h[1-6]$/.test(tag) ||
    role === 'heading' ||
    LANDMARK_TAGS.has(tag) ||
    LANDMARK_ROLES.has(role) ||
    (tag === 'section' && (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby'))) ||
    el.hasAttribute('aria-live') ||
    ['alert', 'status', 'log', 'marquee', 'timer', 'dialog', 'alertdialog'].includes(role) ||
    tag === 'dialog' ||
    tag === 'li' ||
    role === 'listitem' ||
    role === 'list'
  ) {
    matched.push('s');
  }

  if (hasDirectNonEmptyTextNode(el) && !['script', 'style', 'noscript', 'title'].includes(tag)) {
    matched.push('c');
  }

  if (tag === 'iframe') {
    matched.push('i');
  }

  void pageIndex;
  return matched;
}

function runFocusableChecks(
  el: HTMLElement,
  tag: string,
  role: string,
  focusInfo: { isFocusable: boolean; isTabbable: boolean; tabIndexValue: number | null },
  computed: ComputedAccessibilityResult,
  pageIndex: PageIndex,
  alerts: AndiAlert[]
): void {
  const fAlerts = evaluateFocusableElement(el, tag, focusInfo, computed, pageIndex);
  for (const a of fAlerts) {
    alerts.push(a);
  }
  if (
    role &&
    FORM_CONTROL_ROLES.has(role) &&
    !focusInfo.isFocusable &&
    el.getAttribute('aria-disabled') !== 'true'
  ) {
    pushAlert(
      alerts,
      'f',
      'ALERT_ARIA_WIDGET_NOT_FOCUSABLE',
      'warning',
      `Semantic ARIA control [role="${role}"] on <${tag}> is not keyboard focusable (missing tabindex="0").`
    );
  }
  if (computed.accName.length > 250) {
    pushAlert(
      alerts,
      'f',
      'ALERT_EXCESSIVE_NAME',
      'warning',
      `Accessible name length (${computed.accName.length} chars) exceeds 250 characters; consider condensing.`
    );
  }
}

function runGraphicsChecks(
  el: HTMLElement,
  tag: string,
  role: string,
  isTabbable: boolean,
  computed: ComputedAccessibilityResult,
  alerts: AndiAlert[]
): void {
  const gAlerts = evaluateGraphicElement(el, tag, role, isTabbable, computed);
  for (const a of gAlerts) {
    alerts.push(a);
  }
}

function runLinksButtonsChecks(
  el: HTMLElement,
  tag: string,
  role: string,
  focusInfo: { isFocusable: boolean; isTabbable: boolean; tabIndexValue: number | null },
  computed: ComputedAccessibilityResult,
  alerts: AndiAlert[]
): void {
  const lAlerts = evaluateLinkOrButtonElement(el, tag, role, focusInfo.isTabbable, computed);
  for (const a of lAlerts) {
    alerts.push(a);
  }
}

function runTableChecks(
  el: HTMLElement,
  tag: string,
  role: string,
  computed: ComputedAccessibilityResult,
  alerts: AndiAlert[]
): void {
  const tAlerts = evaluateTableElement(el, tag, role, computed);
  for (const a of tAlerts) {
    alerts.push(a);
  }
}

function prevHeadingCheck(
  el: HTMLElement,
  tag: string,
  role: string,
  computed: ComputedAccessibilityResult,
  alerts: AndiAlert[],
  onLevel: (level: number) => void
): void {
  if (/^h[1-6]$/.test(tag) || role === 'heading') {
    const nativeLevel = /^h[1-6]$/.test(tag) ? Number(tag.charAt(1)) : null;
    const ariaLevelRaw = el.getAttribute('aria-level');
    const ariaLevel = ariaLevelRaw ? Number(ariaLevelRaw) : null;

    if (nativeLevel && ariaLevel && nativeLevel !== ariaLevel) {
      pushAlert(
        alerts,
        's',
        'ALERT_HEADING_CONFLICT',
        'warning',
        `Heading tag <${tag}> conflicts with [aria-level="${ariaLevel}"].`
      );
    }
    const effectiveLevel = ariaLevel || nativeLevel || 2;
    onLevel(effectiveLevel);

    if (!computed.accName) {
      pushAlert(
        alerts,
        's',
        'ALERT_EMPTY_HEADING',
        'danger',
        `Heading <${tag}${role === 'heading' ? ' role="heading"' : ''}> has no text content or accessible name.`
      );
    }
  } else if (tag === 'li' || role === 'listitem') {
    const listParent = el.closest('ul, ol, menu, [role="list"], [role="menu"], [role="menubar"], [role="tablist"]');
    if (!listParent) {
      const desc = tag === 'li' ? '<li>' : `[role="listitem"]`;
      pushAlert(
        alerts,
        's',
        'ALERT_ORPHAN_LI',
        'danger',
        `${desc} element is not contained within a semantic list container (<ul>, <ol>, or [role="list"]).`
      );
    }
  }
}

function runContrastChecks(
  el: HTMLElement,
  computed: ComputedAccessibilityResult,
  pageIndex: PageIndex,
  alerts: AndiAlert[]
): void {
  if ((el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') {
    return;
  }
  const style = pageIndex.getStyle(el);
  const fg = parseRgbColor(style.color);
  const bg = resolveEffectiveBackgroundColor(el, pageIndex);

  if (!fg || !bg) {
    return;
  }

  const ratio = computeContrastRatio(fg, bg);
  const fontSizePx = parseFloat(style.fontSize) || 16;
  const fontWeight = parseInt(style.fontWeight, 10) || (style.fontWeight === 'bold' ? 700 : 400);
  const isLargeText = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
  const minRatio = isLargeText ? 3.0 : 4.5;

  computed.addOnProps['contrast'] = `${ratio.toFixed(2)}:1 (min ${minRatio.toFixed(1)}:1)`;

  if (ratio < minRatio) {
    pushAlert(
      alerts,
      'c',
      'ALERT_LOW_CONTRAST',
      'danger',
      `Text contrast ratio is ${ratio.toFixed(2)}:1, below the WCAG AA minimum of ${minRatio.toFixed(1)}:1.`
    );
  }
}

function runHiddenChecks(
  el: HTMLElement,
  isVisible: boolean,
  isFocusable: boolean,
  alerts: AndiAlert[]
): void {
  if (el.getAttribute('aria-hidden') === 'true') {
    if (isFocusable || el.querySelector('a[href], button, input, select, textarea, [tabindex="0"]')) {
      pushAlert(
        alerts,
        'h',
        'ALERT_ARIA_HIDDEN_FOCUSABLE',
        'danger',
        `[aria-hidden="true"] element is focusable or contains focusable descendants.`
      );
    } else {
      pushAlert(
        alerts,
        'h',
        'ALERT_ARIA_HIDDEN_INFO',
        'caution',
        `Element is hidden from assistive technologies via [aria-hidden="true"].`
      );
    }
  } else if (!isVisible && isFocusable) {
    pushAlert(
      alerts,
      'h',
      'ALERT_HIDDEN_FOCUSABLE',
      'caution',
      `Visually hidden element has focusable markup.`
    );
  }
}

function runIframeChecks(
  el: HTMLElement,
  focusInfo: { isFocusable: boolean; isTabbable: boolean; tabIndexValue: number | null },
  computed: ComputedAccessibilityResult,
  alerts: AndiAlert[]
): void {
  if (!computed.accName) {
    pushAlert(
      alerts,
      'i',
      'ALERT_IFRAME_NO_TITLE',
      'danger',
      `<iframe> has no accessible name or [title] attribute.`
    );
  }
  if (focusInfo.tabIndexValue !== null && focusInfo.tabIndexValue < 0) {
    pushAlert(
      alerts,
      'i',
      'ALERT_IFRAME_NEG_TABINDEX',
      'warning',
      `<iframe> has negative [tabindex="${focusInfo.tabIndexValue}"], which may trap or block keyboard access to its contents.`
    );
  }
}

function pushAlert(
  alerts: AndiAlert[],
  module: Exclude<AndiMode, 'all'>,
  code: string,
  level: 'danger' | 'warning' | 'caution',
  message: string
): void {
  if (alerts.some((a) => a.code === code && a.message === message)) {
    return;
  }
  alerts.push({
    id: `${module}-${code}-${alerts.length + 1}`,
    code,
    level,
    module,
    message
  });
}

function hasDirectNonEmptyTextNode(el: HTMLElement): boolean {
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === Node.TEXT_NODE && n.nodeValue && n.nodeValue.trim().length > 0) {
      return true;
    }
  }
  return false;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseRgbColor(cssColor: string): RgbColor | null {
  const m = cssColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
  if (!m) {
    return null;
  }
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] !== undefined ? Number(m[4]) : 1
  };
}

function resolveEffectiveBackgroundColor(el: HTMLElement, pageIndex: PageIndex): RgbColor | null {
  let curr: HTMLElement | null = el;
  while (curr) {
    const bgStr = pageIndex.getStyle(curr).backgroundColor;
    const parsed = parseRgbColor(bgStr);
    if (parsed && parsed.a > 0.05) {
      return parsed;
    }
    curr = curr.parentElement;
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

function computeContrastRatio(fg: RgbColor, bg: RgbColor): number {
  const lum1 = relativeLuminance(fg.r, fg.g, fg.b);
  const lum2 = relativeLuminance(bg.r, bg.g, bg.b);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

function relativeLuminance(r8: number, g8: number, b8: number): number {
  const transform = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * transform(r8) + 0.7152 * transform(g8) + 0.0722 * transform(b8);
}
