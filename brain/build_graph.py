#!/usr/bin/env python3
"""build_graph.py: turn memory folders into one graph file for the Brain View.

    build_graph.py [--out PATH] [SOURCE_DIR ...]

Each SOURCE_DIR is one area. Every .md file in it (INDEX.md, MEMORY.md and
archive/ excluded) is one memory node. Edges:
    root -> area          one per area
    area -> memory        the memory lives in that area
    memory -> memory      a [[name]] link in the body that resolves

With no SOURCE_DIR it reads every ~/.claude/projects/*/memory folder.
This is a file walk. No model call, no network. It reads the sources and
writes only the --out file.
"""

import glob
import json
import os
import re
import sys
import time

FRONT = re.compile(r"\A---\n(.*?)\n---\n?(.*)\Z", re.S)
LINK = re.compile(r"\[\[([^\]|#]+)")
TYPES = ("user", "feedback", "project", "reference", "decision")
SKIP = {"INDEX.md", "MEMORY.md"}
HOME = os.path.expanduser("~")


def parse(text):
    """Return (flat dict of frontmatter keys, body). Nested keys are flattened."""
    m = FRONT.match(text)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        key, sep, value = line.strip().partition(":")
        if sep and key and not key.startswith("#"):
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            meta.setdefault(key.strip(), value)
    return meta, m.group(2)


def area_name(src):
    """~/.claude/projects/-Users-me-Foo-Bar/memory -> Foo-Bar. Else the folder name."""
    parent = os.path.basename(os.path.dirname(os.path.abspath(src)))
    if os.path.basename(os.path.abspath(src)) == "memory" and parent.startswith("-"):
        prefix = HOME.replace("/", "-")
        name = parent[len(prefix):].lstrip("-") if parent.startswith(prefix) else parent.lstrip("-")
        if "-scratch-" in name:
            return "Scratch " + name.rsplit("-scratch-", 1)[1]
        return name or "Home"
    return os.path.basename(os.path.abspath(src).rstrip("/")) or src


def iso(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def build(sources):
    nodes = [{"id": "root", "kind": "root", "name": "JMac Memory OS", "area": "",
              "description": "The root. Every area hangs from here.", "path": "", "modified": ""}]
    edges = []
    by_name = {}      # (area, key) -> id, and ("*", key) -> [ids]
    raw_links = []    # (from id, area, target)
    areas_seen = {}
    for src in sources:
        files = sorted(f for f in glob.glob(os.path.join(src, "*.md")) if os.path.basename(f) not in SKIP)
        if not files:
            continue
        area = area_name(src)
        if area in areas_seen:
            area = area + " (" + os.path.abspath(src) + ")"
        aid = "area:" + area
        areas_seen[area] = aid
        nodes.append({"id": aid, "kind": "area", "name": area, "area": area,
                      "description": "%d memories in %s" % (len(files), os.path.abspath(src)),
                      "path": os.path.abspath(src), "modified": ""})
        edges.append({"from": "root", "to": aid, "why": "area"})
        for f in files:
            try:
                with open(f, encoding="utf-8") as fh:
                    meta, body = parse(fh.read())
            except (OSError, UnicodeDecodeError):
                continue
            stem = os.path.basename(f)[:-3]
            name = meta.get("name") or stem
            kind = meta.get("type", "").lower()
            kind = kind if kind in TYPES else "other"
            nid = "mem:%s/%s" % (area, stem)
            nodes.append({"id": nid, "kind": kind, "name": name, "area": area,
                          "description": meta.get("description", ""), "path": os.path.abspath(f),
                          "modified": meta.get("modified") or iso(os.path.getmtime(f))})
            edges.append({"from": aid, "to": nid, "why": "area"})
            for key in {name, stem, name.replace("_", "-"), stem.replace("_", "-")}:
                by_name.setdefault((area, key), nid)
                by_name.setdefault(("*", key), []).append(nid)
            for target in LINK.findall(body):
                raw_links.append((nid, area, target.strip()))
    unresolved = []
    seen = set()
    for src_id, area, target in raw_links:
        key = target.replace("_", "-")
        to = by_name.get((area, target)) or by_name.get((area, key))
        if not to:
            hits = by_name.get(("*", target)) or by_name.get(("*", key)) or []
            to = hits[0] if len(hits) == 1 else None
        if not to:
            unresolved.append({"from": src_id, "target": target})
            continue
        if to != src_id and (src_id, to) not in seen:
            seen.add((src_id, to))
            edges.append({"from": src_id, "to": to, "why": "link"})
    return {
        "built": iso(time.time()),
        "sources": [os.path.abspath(s) for s in sources],
        "nodes": nodes,
        "edges": edges,
        "unresolved": unresolved,
    }


def main(argv):
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "graph.json")
    args = list(argv)
    if "--out" in args:
        i = args.index("--out")
        out = args[i + 1]
        del args[i:i + 2]
    sources = args or sorted(glob.glob(os.path.join(HOME, ".claude", "projects", "*", "memory")))
    graph = build(sources)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(graph, fh, indent=1)
    os.replace(tmp, out)
    kinds = {}
    for n in graph["nodes"]:
        kinds[n["kind"]] = kinds.get(n["kind"], 0) + 1
    links = sum(1 for e in graph["edges"] if e["why"] == "link")
    print("wrote %s: %d nodes %s, %d edges (%d memory links), %d unresolved links"
          % (out, len(graph["nodes"]), kinds, len(graph["edges"]), links, len(graph["unresolved"])))


if __name__ == "__main__":
    main(sys.argv[1:])
