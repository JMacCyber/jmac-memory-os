#!/usr/bin/env python3
"""build_graph.py: turn the memory Git repo into one graph file for the Brain View.

    build_graph.py [--out PATH] [REPO_DIR]

REPO_DIR defaults to $BRAIN_REPO, else ~/JMacAIUnifiedMemory. Every .md,
.yaml and .yml file in it is one memory node (.git, .github, scripts/ and
any archive/ folder excluded).
    root     the repo: its name, GitHub link, branch and commit
    area     one per project, from the file's project: field, else a
             "Project:" line in the text, else the folder path
    kind     the top folder: records, threads, artifacts, handoffs, ...
Edges:
    root -> area, area -> memory
    memory -> memory      related:, supersedes:, [[name]] and relative
                          Markdown links that resolve to another file
This is a file walk plus read-only git commands. No model call, no network.
It writes only the --out file.
"""

import json
import os
import re
import subprocess
import sys
import time
from urllib.parse import urlparse

FRONT = re.compile(r"\A---\n(.*?)\n---\n?(.*)\Z", re.S)
WIKI = re.compile(r"\[\[([^\]|#]+)")
MDLINK = re.compile(r"\]\(([^)#\s]+\.(?:md|ya?ml))\)")
PROJECT_LINE = re.compile(r"^[*_ \t]*project[*_ \t]*:[*_ \t]*([A-Za-z0-9][\w. -]*?)[*_ \t]*$", re.I | re.M)
DATEISH = re.compile(r"^\d{2,4}(-\d{2}){0,2}$")
KINDS = {"records": "record", "threads": "thread", "artifacts": "artifact", "handoffs": "handoff",
         "projects": "project", "policies": "policy", "prompts": "prompt", "schemas": "schema",
         "global": "global"}
PROVIDERS = {"chatgpt", "claude", "codex", "cursor", "gemini"}
SKIP_DIRS = {".git", ".github", "scripts", "archive", "node_modules"}
EXTS = (".md", ".yaml", ".yml")


def read_yaml(text):
    """Top-level keys of simple YAML: scalars, [inline] lists, - item lists, > and | blocks."""
    meta, key, block = {}, None, None
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line[0].isspace():
            k, sep, v = line.partition(":")
            if not sep:
                key = None
                continue
            key, v = k.strip(), v.strip()
            block = None
            if v in (">", "|", ">-", "|-"):
                meta[key], block = "", v[0]
            elif v.startswith("[") and v.endswith("]"):
                meta[key] = [x.strip().strip("\"'") for x in v[1:-1].split(",") if x.strip()]
            elif v:
                meta[key] = v[1:-1] if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'" else v
            else:
                meta[key] = None
        elif key:
            s = line.strip()
            if block:
                meta[key] += (" " if block == ">" and meta[key] else "\n" if meta[key] else "") + s
            elif s.startswith("- ") and (meta[key] is None or isinstance(meta[key], list)):
                meta[key] = (meta[key] or []) + [s[2:].strip().strip("\"'")]
    return meta


def parse(path, text):
    """Return (meta dict, body text)."""
    if path.endswith(".md"):
        m = FRONT.match(text)
        return (read_yaml(m.group(1)), m.group(2)) if m else ({}, text)
    return read_yaml(text), text


def as_list(v):
    return v if isinstance(v, list) else [v] if isinstance(v, str) and v else []


def slug(s):
    return re.sub(r"[\s_]+", "-", s.strip().lower())


def project_of(rel, meta, body):
    for k in ("project", "project_id"):
        if isinstance(meta.get(k), str) and meta[k]:
            return slug(meta[k])
    m = rel.endswith(".md") and PROJECT_LINE.search("\n".join(body.splitlines()[:30]))
    if m:
        return slug(m.group(1))
    for seg in rel.split("/")[1:-1]:
        if not DATEISH.match(seg) and seg.lower() not in PROVIDERS:
            return slug(seg)
    return "general"


def first_text(body):
    heading, para = "", ""
    for line in body.splitlines():
        s = line.strip()
        if not heading and s.startswith("# "):
            heading = s[2:].strip()
        elif s and not para and not s.startswith(("#", "|", "---", "```", "<")):
            para = s.strip("*_ ")
        if heading and para:
            break
    return heading, para[:220]


def git(repo, *args):
    try:
        return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True,
                              timeout=20, check=True).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def github_url(remote):
    """Remote URL -> https://github.com/owner/repo, with any user or token removed."""
    remote = remote.strip()
    m = re.match(r"^[\w.-]+@([\w.-]+):(.+?)(\.git)?$", remote)
    if m:
        return "https://%s/%s" % (m.group(1), m.group(2))
    u = urlparse(remote)
    if u.scheme in ("http", "https") and u.hostname:
        return "https://%s%s" % (u.hostname, re.sub(r"\.git$", "", u.path))
    return ""


def last_changed(repo):
    """rel path -> ISO date of the last commit that touched it. One git call."""
    out, when = {}, ""
    for line in git(repo, "log", "--format=%x00%cI", "--name-only").splitlines():
        if line.startswith("\0"):
            when = line[1:]
        elif line and line not in out:
            out[line] = when
    return out


def iso(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def walk(repo):
    for top, dirs, files in os.walk(repo):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith("."))
        for f in sorted(files):
            if f.endswith(EXTS):
                yield os.path.relpath(os.path.join(top, f), repo).replace(os.sep, "/")


def build(repo):
    repo = os.path.abspath(repo)
    url = github_url(git(repo, "remote", "get-url", "origin"))
    branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD").strip()
    commit = git(repo, "rev-parse", "--short", "HEAD").strip()
    name = url.rstrip("/").rsplit("/", 1)[-1] if url else os.path.basename(repo)
    where = " · ".join(x for x in (url.replace("https://", ""), branch and "branch " + branch,
                                   commit and "commit " + commit) if x)
    root = {"id": "root", "kind": "root", "name": name, "area": "", "url": url,
            "description": (where or repo) + ". Every project hangs from here.",
            "path": repo, "modified": ""}
    changed = last_changed(repo)
    mems, areas = [], {}
    for rel in walk(repo):
        path = os.path.join(repo, rel)
        try:
            with open(path, encoding="utf-8") as fh:
                meta, body = parse(rel, fh.read())
        except (OSError, UnicodeDecodeError):
            continue
        heading, para = first_text(body if rel.endswith(".md") else "")
        top = rel.split("/")[0] if "/" in rel else ""
        area = project_of(rel, meta, body)
        s = lambda k: meta.get(k) if isinstance(meta.get(k), str) else ""
        node = {"id": "mem:" + rel, "kind": KINDS.get(top, "other"), "area": area,
                "name": s("title") or s("name") or heading or s("id") or os.path.basename(rel),
                "description": (s("summary") or s("description") or s("notes") or
                               next(iter(as_list(meta.get("what_changed"))), "") or para).replace("**", ""),
                "path": path, "rel": rel,
                "modified": changed.get(rel) or s("created_at") or iso(os.path.getmtime(path))}
        mems.append((node, meta, body))
        areas[area] = areas.get(area, 0) + 1

    nodes, edges = [root], []
    for area in sorted(areas):
        nodes.append({"id": "area:" + area, "kind": "area", "name": area, "area": area,
                      "description": "%d files name this project" % areas[area], "path": "", "modified": ""})
        edges.append({"from": "root", "to": "area:" + area, "why": "area"})

    by_key = {}
    for node, meta, _ in mems:
        nodes.append(node)
        edges.append({"from": "area:" + node["area"], "to": node["id"], "why": "area"})
        stem = os.path.splitext(os.path.basename(node["rel"]))[0]
        for k in {node["rel"], stem, slug(stem), node["name"], slug(node["name"]),
                  meta.get("id") if isinstance(meta.get("id"), str) else ""}:
            if k:
                by_key.setdefault(k, []).append(node["id"])

    def resolve(node, target):
        t = target.strip().lstrip("./")
        here = os.path.dirname(node["rel"])
        near = os.path.normpath(os.path.join(here, target.strip())).replace(os.sep, "/")
        for k in (near, t, slug(os.path.splitext(os.path.basename(t))[0]), slug(t)):
            hits = by_key.get(k, [])
            if len(set(hits)) == 1:
                return hits[0]
        return None

    unresolved, seen = [], set()
    for node, meta, body in mems:
        targets = [("related", t) for t in as_list(meta.get("related"))]
        targets += [("supersedes", t) for t in as_list(meta.get("supersedes"))]
        targets += [("link", t) for t in WIKI.findall(body) + MDLINK.findall(body)]
        for rel_kind, target in targets:
            if re.match(r"^[a-z]+://", target) or (rel_kind == "supersedes" and " " in target.strip()):
                continue
            to = resolve(node, target)
            if not to:
                unresolved.append({"from": node["id"], "target": target, "rel": rel_kind})
            elif to != node["id"] and (node["id"], to) not in seen:
                seen.add((node["id"], to))
                edges.append({"from": node["id"], "to": to, "why": "link", "rel": rel_kind})
    return {"built": iso(time.time()), "sources": [repo], "repo": {"name": name, "url": url,
            "branch": branch, "commit": commit}, "nodes": nodes, "edges": edges, "unresolved": unresolved}


def main(argv):
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "graph.json")
    args = list(argv)
    if "--out" in args:
        i = args.index("--out")
        out = args[i + 1]
        del args[i:i + 2]
    repo = args[0] if args else os.environ.get("BRAIN_REPO") or os.path.expanduser("~/JMacAIUnifiedMemory")
    graph = build(repo)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(graph, fh, indent=1)
    os.replace(tmp, out)
    kinds = {}
    for n in graph["nodes"]:
        kinds[n["kind"]] = kinds.get(n["kind"], 0) + 1
    links = sum(1 for e in graph["edges"] if e["why"] == "link")
    print("wrote %s from %s: %d nodes %s, %d edges (%d memory links), %d unresolved links"
          % (out, graph["repo"]["url"] or repo, len(graph["nodes"]), kinds, len(graph["edges"]),
             links, len(graph["unresolved"])))


if __name__ == "__main__":
    main(sys.argv[1:])
