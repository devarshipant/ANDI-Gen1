/**
 * ANDI-Gen1 Help UI Controller: help/help.ts
 * Refactored from legacy andi/help/help.js into strict TypeScript.
 */

export interface HelpSectionLink {
  id: string;
  title: string;
}

export class AndiHelpController {
  public initTableOfContents(doc: Document = document): HelpSectionLink[] {
    const headings = Array.from(doc.querySelectorAll('h2[id], h3[id]')) as HTMLElement[];
    return headings.map((h) => ({
      id: h.id,
      title: (h.textContent || '').trim()
    }));
  }

  public scrollToSection(id: string, doc: Document = document): boolean {
    const target = doc.getElementById(id);
    if (!target) {
      return false;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
    return true;
  }
}
