/**
 * ANDI-Gen1 — Built-in Content Security Policy (CSP) Detector & Resolver
 * Detects <meta http-equiv="Content-Security-Policy"> rules and runtime
 * SecurityPolicyViolationEvents, applies Constructable Stylesheets to bypass
 * inline style-src blocks, and can neutralize restrictive meta CSPs on demand.
 */

import { CspReportState, CspViolationRecord } from './types';

export class CspGuard {
  private violations: CspViolationRecord[] = [];
  private adoptedStyleSheetsActive = false;
  private metaResolved = false;
  private boundViolationHandler: (e: SecurityPolicyViolationEvent) => void;

  constructor() {
    this.boundViolationHandler = this.handleViolation.bind(this);
  }

  public attach(doc: Document = document): void {
    doc.addEventListener('securitypolicyviolation', this.boundViolationHandler);
  }

  public detach(doc: Document = document): void {
    doc.removeEventListener('securitypolicyviolation', this.boundViolationHandler);
    this.restoreMetaCsp(doc);
  }

  private handleViolation(e: SecurityPolicyViolationEvent): void {
    this.violations.push({
      violatedDirective: e.violatedDirective || e.effectiveDirective || 'unknown-directive',
      blockedURI: e.blockedURI || 'inline',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Applies CSS to a ShadowRoot or Document using Constructable Stylesheets first
   * (which bypasses CSP `style-src` inline <style> restrictions), with fallback to <style>.
   */
  public applySafeStyles(
    target: ShadowRoot | Document,
    cssText: string,
    fallbackId?: string
  ): void {
    try {
      if ('adoptedStyleSheets' in target && typeof CSSStyleSheet !== 'undefined') {
        const sheet = new CSSStyleSheet();
        if (typeof sheet.replaceSync === 'function') {
          sheet.replaceSync(cssText);
          target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
          this.adoptedStyleSheetsActive = true;
          return;
        }
      }
    } catch {
      // Fallback to <style> element below
    }

    const doc = target instanceof Document ? target : target.ownerDocument;
    const styleEl = doc.createElement('style');
    if (fallbackId) {
      styleEl.id = fallbackId;
    }
    styleEl.textContent = cssText;
    if (target instanceof Document) {
      target.head.appendChild(styleEl);
    } else {
      target.appendChild(styleEl);
    }
  }

  /**
   * Inspects the document for <meta http-equiv="Content-Security-Policy"> tags
   * and returns the current CSP status & resolution report.
   */
  public getReport(doc: Document = document): CspReportState {
    const metaTags = Array.from(
      doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i], meta[data-andi-orig-csp]')
    );
    const metaPolicies = metaTags.map(
      (m) => m.getAttribute('content') || m.getAttribute('data-andi-orig-csp') || '(empty)'
    );

    return {
      metaTagCount: metaTags.length,
      metaPolicies,
      adoptedStyleSheetsActive: this.adoptedStyleSheetsActive,
      metaResolved: this.metaResolved,
      violations: [...this.violations]
    };
  }

  /**
   * Neutralizes restrictive <meta http-equiv="Content-Security-Policy"> tags in the
   * active document (storing original policies in `data-andi-orig-csp`) so screenshots,
   * data URLs, and dynamic inspection run without meta-CSP blocks.
   */
  public resolveMetaCsp(doc: Document = document): number {
    const metaTags = Array.from(
      doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]')
    );
    let count = 0;
    for (const meta of metaTags) {
      const orig = meta.getAttribute('content') || '';
      meta.setAttribute('data-andi-orig-csp', orig);
      meta.removeAttribute('http-equiv');
      meta.removeAttribute('content');
      count += 1;
    }
    this.metaResolved = true;
    return count;
  }

  /**
   * Restores any neutralized <meta http-equiv="Content-Security-Policy"> tags.
   */
  public restoreMetaCsp(doc: Document = document): void {
    const restored = Array.from(doc.querySelectorAll('meta[data-andi-orig-csp]'));
    for (const meta of restored) {
      const orig = meta.getAttribute('data-andi-orig-csp') || '';
      meta.setAttribute('http-equiv', 'Content-Security-Policy');
      meta.setAttribute('content', orig);
      meta.removeAttribute('data-andi-orig-csp');
    }
    this.metaResolved = false;
  }
}
