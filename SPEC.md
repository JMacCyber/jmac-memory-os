# JMac Memory OS — Git Memory Format v1

One memory is one file. One file is one fact. The directory is the database.

This document is the whole format. If you implement it, your tool is compatible.
No library is required to read it. `cat` is a valid client.

## 1. Layout

```
memory/
  INDEX.md              one line per live memory
  <name>.md             a live memory, one fact
  archive/
    <name>.<date>.md    a memory that was true and no longer is
```

`memory/` holds only what is true now. `memory/archive/` holds what used to be true.

This is the single most important rule in the format, and it exists for one reason:
a client that only does text search cannot tell a current fact from a stale one.
So the format does not ask it to. A search over `memory/` cannot return a stale
answer, because the stale answer is not in `memory/`.

## 2. A memory file

```markdown
---
name: postgres-is-the-database
type: project
description: Alpha stores its data in PostgreSQL 16
effective_from: 2026-03-04
source: decision in the 2026-03-04 architecture call
---

Alpha runs on PostgreSQL 16, hosted on the primary VM, not managed.

Chosen over SQLite because three services write concurrently.

Related: [[alpha-deploy-target]]
```

### Frontmatter fields

| Field | Required | Meaning |
|---|---|---|
| `name` | Yes | kebab-case slug. Must equal the filename without `.md`. |
| `type` | Yes | One of: `user`, `project`, `decision`, `reference`. |
| `description` | Yes | One line. This is what goes in the index, and what a reader sees first. |
| `effective_from` | Yes | `YYYY-MM-DD`. The day the fact became true, not the day it was written. |
| `source` | No | Where it came from. A person, a file, a command, a URL. |
| `supersedes` | No | The `name` of the memory this one replaces. |

Archived files carry two more:

| Field | Meaning |
|---|---|
| `effective_to` | `YYYY-MM-DD`. The day the fact stopped being true. |
| `superseded_by` | The `name` of the memory that replaced it. |

### The four types

- `user` — who the person is. Role, preferences, how they want to be worked with.
- `project` — state of ongoing work. Goals, constraints, decisions in force.
- `decision` — a choice made, with its reason. Kept so it is not relitigated.
- `reference` — a pointer out. A URL, a dashboard, a ticket, a file path.

Four is deliberate. A type list that grows stops being a filter.

### Body

Free markdown. Keep it to the one fact the file is about.

`[[other-name]]` links to another memory. A link to a memory that does not exist
yet is allowed — it marks something worth writing, not an error.

## 3. The index

`memory/INDEX.md` is a flat list of every live memory, one line each:

```markdown
# Memory Index

- [postgres-is-the-database](postgres-is-the-database.md) — Alpha stores its data in PostgreSQL 16
- [ships-on-fridays](ships-on-fridays.md) — releases go out Friday afternoon, never Monday
```

The line text is the memory's `description`. Nothing else goes here. The index is
a table of contents, not a place to put content.

Why it exists: a client reached over MCP fetches named files. It does not walk a
directory. The index is the one path it needs to know.

## 4. Writing a memory

1. Check the index for a memory that already covers the fact. If one exists, supersede it (§5) rather than adding a second.
2. Choose a `name` that states the fact, not the topic. `ships-on-fridays`, not `release-notes`.
3. Write the file at `memory/<name>.md`.
4. Add one line to `memory/INDEX.md`.
5. Commit both, with the memory name in the commit message.

Never edit a fact in place. A fact that changed is a supersession, not an edit.

## 5. Superseding

When `postgres-is-the-database` stops being true:

1. Move the file to `memory/archive/postgres-is-the-database.2026-09-21.md`. The date is the day it stopped being true.
2. Add `effective_to` and `superseded_by` to the archived file's frontmatter.
3. Write the new memory at `memory/sqlite-is-the-database.md` with `supersedes: postgres-is-the-database`.
4. Replace the line in `INDEX.md`.
5. Commit all of it together.

The old file is never rewritten beyond those two added fields, and never deleted.
History stays answerable: "what did we use before?" is a question about
`memory/archive/`, and the archive has the dates to answer it.

## 6. Deleting

Don't. A fact that is wrong was never a fact — fix it by supersession with a
`source` saying it was an error. A fact that is no longer relevant is archived.

The only legitimate delete is a secret committed by mistake, and that is a
credential-rotation problem, not a memory problem.

## 7. Concurrency

Two agents writing at once touch different files, because one memory is one file.
That is the entire concurrency design. The only shared file is `INDEX.md`, and a
conflict there is a two-line merge.

Agents that pull before they write will rarely see even that.

## 8. Secrets

Never put a credential in a memory. A memory may name where a credential lives
(`type: reference`), never the credential itself.

The repo is private by default. That is not a security control — it is one.
Treat everything in `memory/` as readable by every tool the person connects.

## 9. Conformance

A **reader** is conformant if it reads `memory/INDEX.md`, resolves the listed
files, and never returns content from `memory/archive/` unless asked for history.

A **writer** is conformant if it follows §4 and §5 exactly, including the index
update and the archive move.

That is the whole specification. Version `1`. Changes to this document that break
an existing reader will carry a new version number in this line.
