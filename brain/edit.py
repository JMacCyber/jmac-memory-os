"""edit.py: the only code in the Brain View that writes. Create, update, archive.

Rules:
    - Only .md, .yaml and .yml files under a known top folder of the memory repo.
    - No absolute paths, no "..", no symlinks out of the repo, no .git or archive/.
    - Update needs the digest of the text the editor opened. If the file changed
      since, it refuses (Conflict) instead of overwriting.
    - Nothing is deleted. Archive moves the file to archive/<same path> and adds
      one line to archive/README.md: original path, date, reason, replacement.
    - Each change is one local git commit of just the touched paths. Nothing is
      pushed: pushing the memory repo stays a human step.
"""

import datetime
import hashlib
import json
import os
import re
import subprocess

import build_graph

MAX_BYTES = 1_000_000
TOPS = set(build_graph.KINDS)
PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class Refused(Exception):
    """The request breaks a rule. HTTP 400."""


class Conflict(Exception):
    """The file changed on disk since the editor opened it. HTTP 409."""


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def check_rel(repo, rel, must_exist):
    """Return the absolute path for rel, or raise Refused."""
    if not isinstance(rel, str) or not rel or "\\" in rel or rel.startswith("/"):
        raise Refused("path must be relative, like records/2026/09/note.md")
    parts = rel.split("/")
    if parts[0] not in TOPS:
        raise Refused("top folder must be one of: " + ", ".join(sorted(TOPS)))
    if any(not PART.match(p) for p in parts) or any(p in build_graph.SKIP_DIRS for p in parts):
        raise Refused("each path part must be letters, digits, dot, dash or underscore, and not start with a dot")
    if not rel.endswith(build_graph.EXTS):
        raise Refused("file must end in .md, .yaml or .yml")
    root = os.path.realpath(repo)
    path = os.path.join(root, *parts)
    parent = os.path.realpath(os.path.dirname(path))
    if parent != root and not parent.startswith(root + os.sep):
        raise Refused("path leaves the repo")
    if os.path.islink(path):
        raise Refused("will not write through a symlink")
    if must_exist and not os.path.isfile(path):
        raise Refused("no such file: " + rel)
    if not must_exist and os.path.lexists(path):
        raise Refused("a file already exists at " + rel)
    return path


def check_text(text):
    if not isinstance(text, str):
        raise Refused("text must be a string")
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise Refused("text is over 1 MB")
    return text if text.endswith("\n") else text + "\n"


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=30)


def commit(repo, paths, message):
    """Commit only these paths. Returns the short sha, or None if repo is not a git repo."""
    if git(repo, "rev-parse", "--git-dir").returncode:
        return None
    add = git(repo, "add", "-A", "--", *paths)
    if add.returncode:
        raise Refused("git add failed: " + add.stderr.strip())
    done = git(repo, "commit", "-q", "-m", message, "--", *paths)
    if done.returncode:
        raise Refused("git commit failed: " + (done.stderr or done.stdout).strip())
    return git(repo, "rev-parse", "--short", "HEAD").stdout.strip()


def write_atomic(path, text):
    tmp = path + ".brain-tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


def create(repo, rel, text):
    path = check_rel(repo, rel, must_exist=False)
    text = check_text(text)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "x", encoding="utf-8") as fh:
        fh.write(text)
    return {"rel": rel, "commit": commit(repo, [rel], "memory: create %s (Brain View)" % rel)}


def update(repo, rel, text, base):
    path = check_rel(repo, rel, must_exist=True)
    text = check_text(text)
    with open(path, encoding="utf-8") as fh:
        now = fh.read()
    if digest(now) != base:
        raise Conflict("the file changed on disk since you opened it")
    if now == text:
        return {"rel": rel, "commit": None, "unchanged": True}
    write_atomic(path, text)
    return {"rel": rel, "commit": commit(repo, [rel], "memory: edit %s (Brain View)" % rel)}


def archive(repo, rel, reason, replacement=""):
    path = check_rel(repo, rel, must_exist=True)
    reason = " ".join(str(reason or "").split())
    if not reason:
        raise Refused("give a reason for the archive")
    replacement = " ".join(str(replacement or "").split()) or "none"
    today = datetime.date.today().isoformat()
    dest_rel = "archive/" + rel
    if os.path.lexists(os.path.join(repo, dest_rel)):
        stem, ext = os.path.splitext(dest_rel)
        dest_rel = "%s.%s%s" % (stem, datetime.datetime.now().strftime("%Y%m%d-%H%M%S"), ext)
    dest = os.path.join(os.path.realpath(repo), *dest_rel.split("/"))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    os.replace(path, dest)
    readme = os.path.join(os.path.realpath(repo), "archive", "README.md")
    new = not os.path.exists(readme)
    with open(readme, "a", encoding="utf-8") as fh:
        if new:
            fh.write("# Archive\n\nMoved, not deleted. One line per move: original path, date, reason, replacement.\n\n")
        fh.write("- `%s` -> `%s` · %s · %s · replacement: %s\n" % (rel, dest_rel, today, reason, replacement))
    sha = commit(repo, [rel, dest_rel, "archive/README.md"], "memory: archive %s (Brain View)" % rel)
    return {"rel": rel, "archived_to": dest_rel, "commit": sha}


def rebuild(repo, graph_path):
    graph = build_graph.build(repo)
    tmp = graph_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(graph, fh, indent=1)
    os.replace(tmp, graph_path)
    return graph


def git_state(repo):
    """Branch and how many local commits are not on the upstream yet."""
    branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    ahead = git(repo, "rev-list", "--count", "@{u}..HEAD")
    return {"branch": branch, "ahead": int(ahead.stdout.strip()) if ahead.returncode == 0 else None}
