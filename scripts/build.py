#!/usr/bin/env python3
"""
ANDI-Gen1 — Zero-Dependency TypeScript-to-IIFE Bundler
Compiles `src/*.ts` and `andi/*.ts` into a self-contained browser bundle (`dist/andi-gen1.js` and `dist/andi-next.js`),
a bookmarklet (`dist/bookmarklet.txt`), and a Manifest V3 browser extension (`dist/extension/`).
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "src"
ANDI_DIR = ROOT / "andi"
DIST_DIR = ROOT / "dist"
EXT_DIR = DIST_DIR / "extension"

MODULE_ORDER = [
    SRC_DIR / "csp-guard.ts",
    SRC_DIR / "dom-index.ts",
    SRC_DIR / "acc-name.ts",
    SRC_DIR / "notes-report.ts",
    ANDI_DIR / "fandi.ts",
    ANDI_DIR / "gandi.ts",
    ANDI_DIR / "landi.ts",
    ANDI_DIR / "tandi.ts",
    ANDI_DIR / "sandi.ts",
    ANDI_DIR / "candi.ts",
    ANDI_DIR / "handi.ts",
    ANDI_DIR / "iandi.ts",
    SRC_DIR / "analyzers.ts",
    SRC_DIR / "ui-shadow.ts",
    ANDI_DIR / "andi.ts",
    SRC_DIR / "index.ts",
]


def strip_typescript(source: str) -> str:
    """Strips TypeScript-only declarations, imports/exports, and type annotations."""
    lines = source.splitlines()
    out_lines = []
    skip_block_depth = 0

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Skip import statements (including multi-line imports)
        if stripped.startswith("import "):
            while i < len(lines) and ";" not in lines[i]:
                i += 1
            i += 1
            continue

        # Skip export type / type alias lines
        if re.match(r"^(export\s+)?type\s+\w+", stripped):
            while i < len(lines) and ";" not in lines[i]:
                i += 1
            i += 1
            continue

        # Skip interface or declare global blocks
        if re.match(r"^(export\s+)?interface\s+\w+", stripped) or stripped.startswith("declare global"):
            skip_block_depth = line.count("{") - line.count("}")
            i += 1
            while i < len(lines) and skip_block_depth > 0:
                skip_block_depth += lines[i].count("{") - lines[i].count("}")
                i += 1
            continue

        # Remove leading `export ` keyword
        line = re.sub(r"^(\s*)export\s+(const|function|class|let|var)\b", r"\1\2", line)

        # Remove uninitialized typed class fields (`private prop!: Type;` or `private fn: (e: Event) => void;`)
        if re.match(r"^\s*(?:private|public|protected)\s+\w+!?:\s*(?:[^=]|=>)+;$", line):
            i += 1
            continue

        # Remove class field visibility modifiers (`private`, `public`, `protected`)
        line = re.sub(r"^(\s*)(private|public|protected)\s+(?:readonly\s+)?", r"\1", line)

        # Remove type annotations on initialized class fields (`prop: Type = val` -> `prop = val`)
        line = re.sub(
            r"^(\s*\w+)\s*:\s*(?:AndiMode|ThemeMode|DockPosition|Document|CspViolationRecord\[\]|InspectedElementRecord\[\]|HTMLIFrameElement\[\]|HTMLIFrameElement\s*\|\s*null|HTMLElement\s*\|\s*null|ShadowRoot\s*\|\s*null|SVGSVGElement\s*\|\s*null|SVGLineElement\s*\|\s*null|\(\(e:\s*Event\)\s*=>\s*void\)\s*\|\s*null)\s*=",
            r"\1 =",
            line,
        )

        # Strip generic type arguments on Map/Set/WeakMap constructors
        line = re.sub(r"\b(new\s+(?:Map|Set|WeakMap))\s*<[^>()]+>\s*\(", r"\1(", line)

        out_lines.append(line)
        i += 1

    code = "\n".join(out_lines)

    # Remove `: Type` on const/let/var declarations before `=` (including Array<{...}> with semicolons)
    code = re.sub(
        r"\b(const|let|var)\s+(\w+)\s*:\s*(?:Array<\{[^}]+\}>\s*|[^=;\n]+)=\s*",
        r"\1 \2 = ",
        code,
    )

    # Remove `as Type` casts
    code = re.sub(
        r"\s+as\s+(?:const|unknown\s+as\s+\{[^}]+\}|HTMLElement\s*\|\s*null|HTMLSelectElement\s*\|\s*null|HTMLInputElement\s*\|\s*HTMLButtonElement|HTMLElement|HTMLLabelElement|HTMLInputElement|HTMLSelectElement|HTMLButtonElement|HTMLTextAreaElement|HTMLImageElement|HTMLIFrameElement|SVGSVGElement|SVGLineElement|SecurityPolicyViolationEvent|ThemeMode\s*\|\s*null|DockPosition\s*\|\s*null|ThemeMode|DockPosition|Array<[^>]+>|\w+\[\]|AndiMode|AlertLevel|Record<[^>]+>)",
        "",
        code,
    )

    # Remove non-null assertions `curr!.tagName` -> `curr.tagName`
    code = re.sub(r"(\b\w+)!\.", r"\1.", code)

    # Strip function parameter and return types
    code = strip_function_signatures(code)

    return code


def strip_function_signatures(code: str) -> str:
    # 1. Remove multi-line or complex return type annotations before `{`
    code = re.sub(
        r"\)\s*:\s*\{[^{}]*\}\s*\{",
        r") {",
        code,
    )
    # 2. Remove single-line return type annotations `) : ReturnType {` or `): ReturnType =>`
    code = re.sub(
        r"\)\s*:\s*(?:[A-Za-z0-9_<>\[\]|&\s',]+)\s*(\{|=>)",
        r") \1",
        code,
    )

    # 3. Strip parameter type annotations in common patterns
    param_types = [
        r":\s*\(el:\s*Element\)\s*=>\s*CSSStyleDeclaration",
        r":\s*\(level:\s*number\)\s*=>\s*void",
        r":\s*\(\)\s*=>\s*void",
        r":\s*\{\s*isFocusable:\s*boolean;\s*isTabbable:\s*boolean;\s*tabIndexValue:\s*number\s*\|\s*null\s*\}",
        r":\s*Array<Exclude<AndiMode,\s*'all'>>",
        r":\s*Exclude<AndiMode,\s*'all'>",
        r":\s*Record<string,\s*AndiNote>",
        r":\s*'::before'\s*\|\s*'::after'",
        r":\s*'danger'\s*\|\s*'warning'\s*\|\s*'caution'",
        r":\s*ShadowRoot\s*\|\s*Document",
        r":\s*InspectedElementRecord\[\]",
        r":\s*InspectedElementRecord",
        r":\s*ComputedAccessibilityResult",
        r":\s*SecurityPolicyViolationEvent",
        r":\s*ContrastCalculator",
        r":\s*CspReportState",
        r":\s*CspViolationRecord",
        r":\s*HTMLIFrameElement",
        r":\s*HTMLSelectElement",
        r":\s*HTMLButtonElement",
        r":\s*HTMLTextAreaElement",
        r":\s*HTMLImageElement",
        r":\s*AndiAlert\[\]",
        r":\s*HTMLElement\[\]",
        r":\s*string\[\]",
        r":\s*PageIndex",
        r":\s*DefectReport",
        r":\s*DockPosition",
        r":\s*ThemeMode",
        r":\s*AndiMode",
        r":\s*AlertLevel",
        r":\s*HTMLElement",
        r":\s*Document",
        r":\s*Window",
        r":\s*Element",
        r":\s*Node",
        r":\s*Event",
        r":\s*MouseEvent",
        r":\s*FocusEvent",
        r":\s*KeyboardEvent",
        r":\s*RgbColor",
        r":\s*string",
        r":\s*number",
        r":\s*boolean",
    ]
    for pt in param_types:
        code = re.sub(r"(\b\w+)\?" + pt, r"\1", code)
        code = re.sub(r"(\b\w+)" + pt, r"\1", code)

    return code


def main() -> None:
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    EXT_DIR.mkdir(parents=True, exist_ok=True)

    bundle_parts = [
        "/*! ANDI-Gen1 v31.0.0 — Zero-Dependency TypeScript Rewrite (SSA ANDI) */",
        "(function() {",
        "  'use strict';",
    ]

    for path in MODULE_ORDER:
        raw = path.read_text(encoding="utf-8")
        transformed = strip_typescript(raw)
        rel_name = path.relative_to(ROOT)
        bundle_parts.append(f"\n  // === Module: {rel_name} ===")
        bundle_parts.append(transformed)

    bundle_parts.append("})();\n")
    full_bundle = "\n".join(bundle_parts)

    out_gen1_js = DIST_DIR / "andi-gen1.js"
    out_next_js = DIST_DIR / "andi-next.js"
    out_gen1_js.write_text(full_bundle, encoding="utf-8")
    out_next_js.write_text(full_bundle, encoding="utf-8")

    # Copy into extension folder
    (EXT_DIR / "andi-gen1.js").write_text(full_bundle, encoding="utf-8")
    (EXT_DIR / "andi-next.js").write_text(full_bundle, encoding="utf-8")

    manifest = {
        "manifest_version": 3,
        "name": "ANDI-Gen1 — Accessible Name & Description Inspector",
        "version": "31.0.0",
        "description": "Zero-dependency TypeScript rewrite of SSA ANDI with Fly-In LocalStorage Notes, Node Screenshots, Iframe Step-In, CSP Guard, Multi-Docking, and Dark/Light Themes.",
        "permissions": ["activeTab", "scripting"],
        "action": {"default_title": "Launch ANDI-Gen1"},
        "background": {"service_worker": "background.js"},
    }
    (EXT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (EXT_DIR / "background.js").write_text(
        "chrome.action.onClicked.addListener((tab) => {\n"
        "  if (tab.id) {\n"
        "    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['andi-gen1.js'] });\n"
        "  }\n"
        "});\n",
        encoding="utf-8",
    )

    bookmarklet = (
        "javascript:(function(){"
        "window.ANDI_INITIAL_MODE='f';"
        "var s=document.createElement('script');"
        "s.src='https://cdn.jsdelivr.net/gh/devarshipant/ANDI-Gen1@feat/andi-updates/dist/andi-gen1.js';"
        "document.head.appendChild(s);"
        "})();"
    )
    (DIST_DIR / "bookmarklet.txt").write_text(bookmarklet, encoding="utf-8")

    print(f"Built {out_gen1_js} ({out_gen1_js.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
