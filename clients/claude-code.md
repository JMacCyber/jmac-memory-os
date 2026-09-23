# Claude Code

Claude Code reads files directly, so it needs no connector. It reads and writes.

## Setup

Clone your memory repo somewhere permanent:

```bash
git clone git@github.com:<you>/my-memory.git ~/my-memory
```

Add this to `~/.claude/CLAUDE.md` so every session picks it up:

```markdown
## Memory

My memory lives at ~/my-memory. Read ~/my-memory/AGENTS.md at the start of a
session, then ~/my-memory/memory/INDEX.md. Open the memories that look relevant.

When I tell you something durable, write it as a memory per AGENTS.md and
commit it.
```

For one project only, put the same block in that project's `CLAUDE.md`.

## Check it works

Start a session and ask: *what is in my memory index?*

It should list your memories without you pasting anything.

## Keeping it current

Claude Code can commit, but it will not push unless you ask. Either tell it to
push after writing, or add to the block above:

```markdown
After writing a memory, commit it and push to origin.
```
