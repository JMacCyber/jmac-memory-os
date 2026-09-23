#!/usr/bin/env python3
"""read.py — the reference reader for the JMac Memory OS git memory format.

    read.py list                 every live memory, one line each
    read.py get <name>           one memory, whole file
    read.py recall <words...>    live memories matching all the words
    read.py history <name>       what this memory used to say, newest first
    read.py check                report format problems, exit 1 if any

Reads `memory/` under the current directory, or under $MEMORY_DIR.
No dependencies. Python 3.8+.

This is the floor, not the ceiling. It does substring matching over small
directories. It has no ranking, no embeddings and no query planner, and it
holds the whole memory in memory. That is on purpose: this file shows the
format is readable, it is not a retrieval engine.
"""

import os
import re
import sys

FRONT = re.compile(r"\A---\n(.*?)\n---\n(.*)\Z", re.S)


def root():
    base = os.environ.get("MEMORY_DIR", ".")
    path = os.path.join(base, "memory")
    if not os.path.isdir(path):
        sys.exit(f"read.py: no memory/ directory under {os.path.abspath(base)}")
    return path


def parse(path):
    """Return (frontmatter dict, body). Frontmatter is flat key: value."""
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    match = FRONT.match(text)
    if not match:
        return {}, text
    meta = {}
    for line in match.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition(":")
        if sep:
            meta[key.strip()] = value.strip()
    return meta, match.group(2).strip()


def live(path=None):
    """Every live memory as (name, meta, body, path). Archive is excluded."""
    path = path or root()
    out = []
    for entry in sorted(os.listdir(path)):
        if not entry.endswith(".md") or entry == "INDEX.md":
            continue
        full = os.path.join(path, entry)
        meta, body = parse(full)
        out.append((entry[:-3], meta, body, full))
    return out


def cmd_list():
    for name, meta, _body, _path in live():
        print(f"{name:<34} {meta.get('description', '(no description)')}")


def cmd_get(name):
    path = os.path.join(root(), f"{name}.md")
    if not os.path.exists(path):
        sys.exit(f"read.py: no live memory named {name}"
                 f" (try: read.py history {name})")
    with open(path, encoding="utf-8") as fh:
        print(fh.read().rstrip())


def cmd_recall(words):
    words = [w.lower() for w in words]
    hits = 0
    for name, meta, body, _path in live():
        hay = f"{name} {meta.get('description', '')} {body}".lower()
        if all(w in hay for w in words):
            hits += 1
            print(f"## {name}")
            print(meta.get("description", ""))
            print(body)
            print()
    if not hits:
        print("Nothing in memory matches that.")
        print("This is not an all-clear. It means no one wrote it down.")


def cmd_history(name):
    archive = os.path.join(root(), "archive")
    if not os.path.isdir(archive):
        sys.exit("read.py: no memory/archive/ directory")
    found = sorted((f for f in os.listdir(archive)
                    if f.startswith(f"{name}.") and f.endswith(".md")),
                   reverse=True)
    if not found:
        print(f"No superseded versions of {name}.")
        return
    for entry in found:
        meta, body = parse(os.path.join(archive, entry))
        print(f"## {entry[:-3]}")
        print(f"true from {meta.get('effective_from', '?')}"
              f" to {meta.get('effective_to', '?')}"
              f", replaced by {meta.get('superseded_by', '?')}")
        print(body)
        print()


def cmd_check():
    problems = []
    required = ("name", "type", "description", "effective_from")
    types = {"user", "project", "decision", "reference"}
    index_path = os.path.join(root(), "INDEX.md")
    index = ""
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as fh:
            index = fh.read()
    if not index:
        problems.append("memory/INDEX.md is missing or empty")

    for name, meta, _body, path in live():
        for key in required:
            if key not in meta:
                problems.append(f"{path}: missing {key}")
        if meta.get("name") and meta["name"] != name:
            problems.append(f"{path}: name '{meta['name']}' does not match filename")
        if meta.get("type") and meta["type"] not in types:
            problems.append(f"{path}: type '{meta['type']}' is not one of {sorted(types)}")
        if f"({name}.md)" not in index:
            problems.append(f"{path}: not listed in INDEX.md")

    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} problem(s).")
        return 1
    print("Format OK.")
    return 0


def main(argv):
    if not argv:
        print(__doc__)
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd == "list":
        cmd_list()
    elif cmd == "get" and rest:
        cmd_get(rest[0])
    elif cmd == "recall" and rest:
        cmd_recall(rest)
    elif cmd == "history" and rest:
        cmd_history(rest[0])
    elif cmd == "check":
        return cmd_check()
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
