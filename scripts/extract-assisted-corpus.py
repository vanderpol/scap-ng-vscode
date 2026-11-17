#!/usr/bin/env python3
"""Extract human-readable Rule check text from the external 65-stream corpus.

This is an offline evidence helper. It reads preserved source Rule XML only and
never writes generated Assessment content into the repository.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET

XCCDF = "http://checklists.nist.gov/xccdf/1.2"
NS = {"xccdf": XCCDF}


def text(element: ET.Element | None) -> str:
    return "" if element is None else "".join(element.itertext()).strip()


def extract(root: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for path in sorted(root.glob("*/source-preservation/rules/*.xml")):
        try:
            tree = ET.parse(path)
        except ET.ParseError as error:
            records.append({"parse_error": str(error), "source_path": str(path)})
            continue
        rule = tree.getroot()
        checks = rule.findall("xccdf:check", NS)
        contents: list[dict[str, str]] = []
        for check in checks:
            for content in check.findall("xccdf:check-content", NS):
                value = text(content)
                if value:
                    contents.append({
                        "selector": check.get("selector", ""),
                        "system": check.get("system", ""),
                        "text": value,
                    })
        # Prefer the explicitly manual procedure, then the longest available
        # text. XCCDF check-content-ref alone is intentionally not invented into
        # prose: the source text is absent and must remain a gap.
        manual = [item for item in contents if item["selector"].lower() == "manual"]
        selected = max(manual or contents, key=lambda item: len(item["text"]), default=None)
        records.append({
            "benchmark": path.parent.parent.parent.name,
            "source_path": str(path),
            "source_rule": rule.get("id", ""),
            "title": text(rule.find("xccdf:title", NS)),
            "check_text": selected["text"] if selected else "",
            "check_selector": selected["selector"] if selected else "",
            "check_system": selected["system"] if selected else "",
            "check_count": len(checks),
            "check_content_count": len(contents),
            "has_manual_text": bool(manual),
        })
    return records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path, help="draft-source-preserving corpus root")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    records = extract(args.root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({
        "records": len(records),
        "with_check_text": sum(bool(r.get("check_text")) for r in records),
        "manual_text": sum(bool(r.get("has_manual_text")) for r in records),
        "parse_errors": sum("parse_error" in r for r in records),
        "output": str(args.output),
    }, indent=2))


if __name__ == "__main__":
    main()
