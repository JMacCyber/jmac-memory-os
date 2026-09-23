# Cursor

Cursor reads and writes files in the open workspace.

## Setup

Easiest path: add your memory repo as a second folder in the Cursor workspace.
`File → Add Folder to Workspace → ~/my-memory`.

Then create `.cursor/rules/memory.mdc` in your project:

```markdown
---
description: Shared AI memory
alwaysApply: true
---

Read `memory/INDEX.md` in the my-memory folder before answering questions about
this person's setup, preferences or past decisions.

When you learn a durable fact, write it as a new file in `memory/` following
`AGENTS.md`, and add a line to `INDEX.md`.

Never read `memory/archive/` unless asked what used to be true.
```

## Check it works

Ask in chat: *what does my memory index say?*

If Cursor cannot see the folder, it was not added to the workspace — the rules
file alone does not grant access.
