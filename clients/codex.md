# Codex

Codex works on a checked-out repo and can commit. Same shape as Claude Code.

## Setup

```bash
git clone git@github.com:<you>/my-memory.git ~/my-memory
```

Codex reads `AGENTS.md` from the working directory by default, which is why
`memos-init` writes one. If your memory repo is not the working directory, add
this to the `AGENTS.md` of the project you are in:

```markdown
## Memory

Shared memory is at ~/my-memory. Read ~/my-memory/memory/INDEX.md before
starting. Follow ~/my-memory/AGENTS.md when writing to it.
```

## Check it works

Ask: *read my memory index and tell me what is in it.*

## Note

Codex sandboxes file access by default. If it cannot reach `~/my-memory`, add
that path to the approved directories for the session, or keep the memory repo
inside the project you are working in.
