#!/usr/bin/env python3
"""
ANDI Next — Zero-Dependency TypeScript-to-IIFE Bundler
Compiles `src/*.ts` into a self-contained browser bundle (`dist/andi-next.js`),
a bookmarklet (`dist/bookmarklet.txt`), and a Manifest V3 browser extension (`dist/extension/`).
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "src"
DIST_DIR = ROOT / "dist"
EXT_DIR = DIST_DIR / "extension"

MODULE_ORDER = [
    "dom-index.ts",
    "acc-name.ts",
    "notes-report.ts",
    "analyzers.ts",
    "ui-shadow.ts",
    "index.ts",
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
        line = re.sub(r"^(\s*)(private|public|protected)\s+", r"\1", line)

        # Remove type annotations on initialized class fields (`prop: Type = val` -> `prop = val`)
        line = re.sub(
            r"^(\s*\w+)\s*:\s*(?:AndiMode|InspectedElementRecord\[\]|HTMLElement\s*\|\s*null|ShadowRoot\s*\|\s*null|SVGSVGElement\s*\|\s*null|SVGLineElement\s*\|\s*null)\s*=",
            r"\1 =",
            line,
        )

        # Strip generic type arguments on Map/Set/WeakMap constructors
        line = re.sub(r"\b(new\s+(?:Map|Set|WeakMap))\s*<[^>()]+>\s*\(", r"\1(", line)

        out_lines.append(line)
        i += 1

    code = "\n".join(out_lines)

    # Remove `: Type` on const/let/var declarations before `=`
    code = re.sub(
        r"\b(const|let|var)\s+(\w+)\s*:\s*[^=;\n]+=",
        r"\1 \2 =",
        code,
    )

    # Remove `as Type` casts
    code = re.sub(
        r"\s+as\s+(?:const|HTMLElement\s*\|\s*null|HTMLElement|HTMLLabelElement|HTMLInputElement\s*\|\s*HTMLButtonElement|HTMLInputElement|Array<[^>]+>|\w+\[\]|AndiMode|AlertLevel)",
        "",
        code,
    )

    # Remove non-null assertions `curr!.tagName` -> `curr.tagName`
    code = re.sub(r"(\b\w+)!\.", r"\1.", code)

    # Strip function parameter and return types
    code = strip_function_signatures(code)

    return code


def strip_function_signatures(code: str) -> str:
    # 1. Remove return type annotations `) : ReturnType {` or `): ReturnType =>`
    code = re.sub(
        r"\)\s*:\s*(?:[A-Za-z0-9_<>\[\]|&\s',]+|\{\s*isFocusable:\s*boolean;\s*isTabbable:\s*boolean;\s*tabIndexValue:\s*number\s*\|\s*null;\s*\})\s*(\{|=>)",
        r") \1",
        code,
    )

    # 2. Strip parameter type annotations in common patterns
    param_types = [
        r":\s*\(el:\s*Element\)\s*=>\s*CSSStyleDeclaration",
        r":\s*\(level:\s*number\)\s*=>\s*void",
        r":\s*\(\)\s*=>\s*void",
        r":\s*\{\s*isFocusable:\s*boolean;\s*isTabbable:\s*boolean;\s*tabIndexValue:\s*number\s*\|\s*null\s*\}",
        r":\s*Array<Exclude<AndiMode,\s*'all'>>",
        r":\s*Exclude<AndiMode,\s*'all'>",
        r":\s*'::before'\s*\|\s*'::after'",
        r":\s*'danger'\s*\|\s*'warning'\s*\|\s*'caution'",
        r":\s*InspectedElementRecord\[\]",
        r":\s*InspectedElementRecord",
        r":\s*ComputedAccessibilityResult",
        r":\s*AndiAlert\[\]",
        r":\s*string\[\]",
        r":\s*PageIndex",
        r":\s*DefectReport",
        r":\s*AndiMode",
        r":\s*AlertLevel",
        r":\s*HTMLElement",
        r":\s*Element",
        r":\s*Node",
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
        "/*! ANDI Next v30.0.0 — Zero-Dependency TypeScript Rewrite (SSA ANDI) */",
        "(function() {",
        "  'use strict';",
    ]

    for filename in MODULE_ORDER:
        path = SRC_DIR / filename
        raw = path.read_text(encoding="utf-8")
        transformed = strip_typescript(raw)
        bundle_parts.append(f"\n  // === Module: {filename} ===")
        bundle_parts.append(transformed)

    bundle_parts.append("})();\n")
    full_bundle = "\n".join(bundle_parts)

    out_js = DIST_DIR / "andi-next.js"
    out_js.write_text(full_bundle, encoding="utf-8")

    # Copy into extension folder
    (EXT_DIR / "andi-next.js").write_text(full_bundle, encoding="utf-8")

    manifest = {
        "manifest_version": 3,
        "name": "ANDI Next — Accessible Name & Description Inspector",
        "version": "30.0.0",
        "description": "Zero-dependency TypeScript rewrite of SSA ANDI with 'All' mode and persistent DOM Defect Notes.",
        "permissions": ["activeTab", "scripting"],
        "action": {"default_title": "Launch ANDI Next"},
        "background": {"service_worker": "background.js"},
    }
    (EXT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (EXT_DIR / "background.js").write_text(
        "chrome.action.onClicked.addListener((tab) => {\n"
        "  if (tab.id) {\n"
        "    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['andi-next.js'] });\n"
        "  }\n"
        "});\n",
        encoding="utf-8",
    )

    bookmarklet = (
        "javascript:(function(){"
        "var s=document.createElement('script');"
        "s.src='dist/andi-next.js';"
        "document.head.appendChild(s);"
        "})();"
    )
    (DIST_DIR / "bookmarklet.txt").write_text(bookmarklet, encoding="utf-8")

    print(f"Built {out_js} ({out_js.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
