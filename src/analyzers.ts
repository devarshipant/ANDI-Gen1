/**
 * ANDI Next — Multi-Module Accessibility Analysis Engine
 * Supports running individual modules (f, g, l, t, s, c, h, i) OR the unified
 * `'all'` mode that runs every accessibility test suite in a single pass.
 */

import {
  AndiAlert,
  AndiMode,
  InspectedElementRecord,
  PageIndex
} from './types';
import {
  formatTagName,
  getElementSelector,
  getFocusability,
  getValidRole,
  isAriaHiddenInTree
} from './dom-index';
import { computeAccessibleData, ComputedAccessibilityResult } from './acc-name';
import { readElementNote } from './notes-report';

const VAGUE_LINK_PHRASES: ReadonlySet<string> = new Set([
  'click here', 'here', 'link', 'more', 'read more', 'learn more', 'info', 'details', 'go'
]);

const REDUNDANT_IMAGE_REGEX = /\b(image of|graphic of|picture of|photo of|icon of)\b/i;
const IMAGE_FILENAME_REGEX = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;

export function analyzePage(
  pageIndex: PageIndex,
  mode: AndiMode
): InspectedElementRecord[] {
  const records: InspectedElementRecord[] = [];
  let elementCounter = 0;

  // Trackers for cross-element checks (links, buttons, accesskeys, headings)
  const linkSignatures = new Map<string, { href: string; record: InspectedElementRecord }>();
  const buttonNames = new Map<string, InspectedElementRecord>();
  const accessKeyMap = new Map<string, InspectedElementRecord>();
  let previousHeadingLevel = 0;

  // Determine candidate elements: visible elements for most modes, plus hidden elements if mode is 'h' or 'all'
  const candidatePool =
    mode === 'h' || mode === 'all' ? pageIndex.allElements : pageIndex.visibleElements;
  const visibleSet = new Set<HTMLElement>(pageIndex.visibleElements);

  for (const el of candidatePool) {
    const isVisible = visibleSet.has(el);
    const tag = el.tagName.toLowerCase();
    const role = getValidRole(el);
    const focusInfo = getFocusability(el);

    const matchedModules = getMatchedModulesForElement(
      el,
      tag,
      role,
      focusInfo.isFocusable,
      isVisible,
      pageIndex
    );

    const shouldInspect =
      mode === 'all'
        ? matchedModules.length > 0 || readElementNote(el) !== null
        : matchedModules.includes(mode);

    if (!shouldInspect) {
      continue;
    }

    const computed = computeAccessibleData(el, pageIndex);
    const alerts: AndiAlert[] = [];

    const activeModules: Array<Exclude<AndiMode, 'all'>> =
      mode === 'all' ? matchedModules : [mode];

    // Run module checks
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

    // Shared ID duplicate check (O(1) via pageIndex.idMap)
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

    const record: InspectedElementRecord = {
      index: elementCounter,
      element: el,
      selector: getElementSelector(el),
      tagName: formatTagName(el),
      role,
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
      alerts,
      modulesMatched: matchedModules,
      note: readElementNote(el)
    };

    // Cross-element duplicate accesskey check
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

    // Cross-element ambiguous link & non-unique button checks
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

  // fANDI: Focusable elements + canvas
  if (isFocusable || tag === 'canvas') {
    matched.push('f');
  }

  // gANDI: Graphics / Images
  if (
    tag === 'img' ||
    tag === 'svg' ||
    tag === 'canvas' ||
    tag === 'area' ||
    role === 'img' ||
    role === 'image' ||
    (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'image')
  ) {
    matched.push('g');
  }

  // lANDI: Links & Buttons
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

  // tANDI: Tables
  if (tag === 'table' || role === 'table' || role === 'grid' || tag === 'th' || tag === 'td') {
    matched.push('t');
  }

  // sANDI: Structures (Headings, Lists, Landmarks, Live Regions)
  if (
    /^h[1-6]$/.test(tag) ||
    role === 'heading' ||
    ['main', 'nav', 'header', 'footer', 'aside', 'form', 'region', 'search'].includes(tag) ||
    ['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'region', 'search', 'form'].includes(role) ||
    el.hasAttribute('aria-live') ||
    ['alert', 'status', 'log', 'marquee', 'timer'].includes(role) ||
    tag === 'li'
  ) {
    matched.push('s');
  }

  // cANDI: Text-bearing elements for contrast check
  if (hasDirectNonEmptyTextNode(el) && !['script', 'style', 'noscript', 'title'].includes(tag)) {
    matched.push('c');
  }

  // iANDI: Iframes
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
  // 1. Missing Accessible Name
  if (!computed.accName && !isAriaHiddenInTree(el)) {
    if (computed.components.ariaDescribedby) {
      pushAlert(
        alerts,
        'f',
        'ALERT_DBY_ALONE',
        'warning',
        `[aria-describedby] is used without any component that provides an accessible name.`
      );
    } else {
      pushAlert(
        alerts,
        'f',
        'ALERT_NO_ACC_NAME',
        'danger',
        `<${formatTagName(el)}> has no accessible name, associated <label>, or [title].`
      );
    }
  }

  // 2. Missing ID references in aria-labelledby / aria-describedby
  if (computed.missingLabelledbyIds.length > 0) {
    pushAlert(
      alerts,
      'f',
      'ALERT_MISSING_LBY_REF',
      'danger',
      `[aria-labelledby] references missing ID(s): "${computed.missingLabelledbyIds.join(', ')}".`
    );
  }
  if (computed.missingDescribedbyIds.length > 0) {
    pushAlert(
      alerts,
      'f',
      'ALERT_MISSING_DBY_REF',
      'warning',
      `[aria-describedby] references missing ID(s): "${computed.missingDescribedbyIds.join(', ')}".`
    );
  }

  // 3. Misspelled aria-labeledby
  if (el.hasAttribute('aria-labeledby')) {
    pushAlert(
      alerts,
      'f',
      'ALERT_MISSPELLED_ARIA',
      'danger',
      `[aria-labeledby] is misspelled; use [aria-labelledby].`
    );
  }

  // 4. Duplicate <label for="..."> pointing to this element (O(1) via labelForMap)
  if (el.id) {
    const matchingLabels = pageIndex.labelForMap.get(el.id);
    if (matchingLabels && matchingLabels.length > 1) {
      pushAlert(
        alerts,
        'f',
        'ALERT_DUP_LABEL_FOR',
        'danger',
        `More than one <label for="${el.id}"> (${matchingLabels.length}) associates with this element.`
      );
    }
  }

  // 5. Positive tabindex > 0 disrupts natural tab order
  if (focusInfo.tabIndexValue !== null && focusInfo.tabIndexValue > 0) {
    pushAlert(
      alerts,
      'f',
      'ALERT_POSITIVE_TABINDEX',
      'warning',
      `[tabindex="${focusInfo.tabIndexValue}"] is greater than 0 and overrides natural DOM tab order.`
    );
  }

  // 6. Focusable element inside aria-hidden="true"
  if (focusInfo.isFocusable && isAriaHiddenInTree(el)) {
    pushAlert(
      alerts,
      'f',
      'ALERT_FOCUSABLE_ARIA_HIDDEN',
      'danger',
      `Focusable element has or is contained by [aria-hidden="true"].`
    );
  }

  // 7. Small clickable area on unlabelled checkbox / radio
  if (
    tag === 'input' &&
    ['checkbox', 'radio'].includes((el.getAttribute('type') || '').toLowerCase()) &&
    !computed.components.nativeLabel
  ) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 21 && rect.height > 0 && rect.height < 21) {
      pushAlert(
        alerts,
        'f',
        'ALERT_SMALL_CLICK_AREA',
        'caution',
        `Small clickable area (${Math.round(rect.width)}x${Math.round(rect.height)}px); associate a <label> to increase target size.`
      );
    }
  }

  // 8. Excessive accessible name length (> 250 chars)
  if (computed.accName.length > 250) {
    pushAlert(
      alerts,
      'f',
      'ALERT_EXCESSIVE_NAME',
      'warning',
      `Accessible name length (${computed.accName.length} chars) exceeds 250 characters; consider condensing.`
    );
  }

  void role;
}

function runGraphicsChecks(
  el: HTMLElement,
  tag: string,
  role: string,
  isTabbable: boolean,
  computed: ComputedAccessibilityResult,
  alerts: AndiAlert[]
): void {
  const isDecorative =
    role === 'presentation' ||
    role === 'none' ||
    (tag === 'img' && el.getAttribute('alt') === '');

  if (role === 'image') {
    pushAlert(
      alerts,
      'g',
      'ALERT_ROLE_IMAGE_INVALID',
      'danger',
      `[role="image"] is invalid; use [role="img"].`
    );
  }

  if (isDecorative && isTabbable) {
    pushAlert(
      alerts,
      'g',
      'ALERT_DECORATIVE_TABBABLE',
      'danger',
      `Image marked as decorative is in the keyboard tab order.`
    );
  }

  if (!isDecorative && !computed.accName && !isAriaHiddenInTree(el)) {
    pushAlert(
      alerts,
      'g',
      'ALERT_IMG_NO_NAME',
      'danger',
      `Graphic <${tag}> has no accessible name, [alt], or [title].`
    );
  }

  if (computed.accName) {
    if (REDUNDANT_IMAGE_REGEX.test(computed.accName)) {
      pushAlert(
        alerts,
        'g',
        'ALERT_IMG_REDUNDANT_PHRASE',
        'caution',
        `Redundant phrase ("image of" / "graphic of") found in image accessible name.`
      );
    }
    if (IMAGE_FILENAME_REGEX.test(computed.accName)) {
      pushAlert(
        alerts,
        'g',
        'ALERT_IMG_FILENAME_ALT',
        'warning',
        `Image accessible name ("${computed.accName}") appears to be a raw file name.`
      );
    }
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
  const isLink = tag === 'a' || role === 'link';

  if (isLink) {
    if (tag === 'a' && !el.hasAttribute('href') && role !== 'button' && role !== 'link') {
      pushAlert(
        alerts,
        'l',
        'ALERT_ANCHOR_NO_HREF',
        'warning',
        `<a> element has no [href] or [role]; may not be keyboard accessible or announced as a link/button.`
      );
    }
    if (computed.accName && VAGUE_LINK_PHRASES.has(computed.accName.trim().toLowerCase())) {
      pushAlert(
        alerts,
        'l',
        'ALERT_VAGUE_LINK',
        'caution',
        `Link text "${computed.accName}" is vague and does not identify its destination out of context.`
      );
    }
    const href = el.getAttribute('href');
    if (href && href.startsWith('#') && href.length > 1) {
      const targetId = href.slice(1);
      if (!document.getElementById(targetId)) {
        pushAlert(
          alerts,
          'l',
          'ALERT_BROKEN_INPAGE_ANCHOR',
          'warning',
          `In-page anchor link references [${href}], but no element with [id="${targetId}"] exists.`
        );
      }
    }
  }

  if (!focusInfo.isTabbable && !isAriaHiddenInTree(el)) {
    pushAlert(
      alerts,
      'l',
      'ALERT_INTERACTIVE_NOT_TABBABLE',
      'warning',
      `Interactive <${tag}> is not in the sequential keyboard tab order.`
    );
  }
}

function runTableChecks(
  el: HTMLElement,
  tag: string,
  role: string,
  computed: ComputedAccessibilityResult,
  alerts: AndiAlert[]
): void {
  if (tag === 'table' && role !== 'presentation' && role !== 'none') {
    const thCount = el.querySelectorAll('th, [role="columnheader"], [role="rowheader"]').length;
    if (thCount === 0) {
      pushAlert(
        alerts,
        't',
        'ALERT_TABLE_NO_TH',
        'danger',
        `Data <table> has no <th> header cells or [role="columnheader"/"rowheader"].`
      );
    }
    if (!computed.accName) {
      pushAlert(
        alerts,
        't',
        'ALERT_TABLE_NO_NAME',
        'caution',
        `Data <table> has no accessible name, <caption>, or aria-label.`
      );
    }
  } else if (tag === 'th' && !computed.accName) {
    pushAlert(
      alerts,
      't',
      'ALERT_EMPTY_TH',
      'caution',
      `Empty <th> table header cell.`
    );
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
        `Heading <${tag}> has no text content or accessible name.`
      );
    }
  } else if (tag === 'li') {
    const listParent = el.parentElement;
    if (
      listParent &&
      !['ul', 'ol', 'menu'].includes(listParent.tagName.toLowerCase()) &&
      !['list', 'menu', 'menubar', 'tablist'].includes(getValidRole(listParent))
    ) {
      pushAlert(
        alerts,
        's',
        'ALERT_ORPHAN_LI',
        'danger',
        `<li> element is not contained within a semantic list container (<ul>, <ol>, or [role="list"]).`
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

