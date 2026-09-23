# JMac Memory OS — Git Memory

**Connect your models and chats together with one central git memory.**

![One memory, every model: Claude Code, Codex, Cursor and Copilot read the
folder directly; ChatGPT, Claude, Gemini, Grok and Perplexity connect through an
API, an integration or MCP;
all of them point at one git repo you own](docs/one-memory.svg)

Your AI assistants forget everything between sessions. This gives them one
memory, in a git repo you own, that every one of them can read.

Write a fact in Claude Code. Ask ChatGPT about it. Get it back.

```bash
python3 bin/memos-init ~/my-memory --git
```

That makes a repo. Push it to a **private** GitHub repo, connect your tools,
and they share one memory. No server, no database, no account with anyone,
no subscription. The memory is markdown files in your own git.

## Why a git repo

Because nearly every AI client can already read one, and most can write to one.

The table below is read from vendor documentation on 21 September 2026. Claude Code
is the one row tested on a real repo. Vendors add and drop connector support often,
so check your own client before you build on a row.

| Client | Read | Write |
|---|---|---|
| Claude Code, Codex, Cursor, Gemini CLI, Copilot, Windsurf, Aider | Yes | Yes |
| ChatGPT | Yes | Yes |
| Claude, Gemini, Grok, Mistral Vibe, Perplexity, M365 Copilot | Yes, via connector | Yes, via connector |
| Amazon Q, DeepSeek Harness, Qwen Chat | Yes, via connector | Yes, via connector |

"Via connector" means you point the client at your repo with whatever it
supports: a GitHub integration, the GitHub API, or GitHub's hosted MCP server.
All three read the same folder. You host nothing.

Two with no connector surface in their documentation on that date: Meta AI and
the DeepSeek consumer app.

## The format in one screen

```
memory/
  INDEX.md                  one line per live memory
  ships-on-fridays.md       one memory, one fact
  archive/
    postgres-is-the-database.2026-09-21.md
```

```markdown
---
name: ships-on-fridays
type: project
description: releases go out Friday afternoon, never Monday
effective_from: 2026-04-02
source: standing rule from the 2026-04-02 planning call
---

Releases ship Friday between 14:00 and 16:00.

Never Monday — the on-call rotation changes Monday morning.
```

`memory/` holds what is true now. `memory/archive/` holds what used to be true.

That split is the whole trick. A client doing plain text search will not return
an archived fact, because the archived fact is not in the folder it searched. You
get history when you ask for it, and only then.

It is a folder rule, not a guarantee about every answer. A live memory that
explains what it replaced still contains the old value, so a search for that old
value can still match it. The archived file stays out; the live file's own
wording is up to you.

![How a fact changes: the live memory moves to memory/archive/ with an
effective_to date, and the new one takes its place in memory/](docs/how-it-works.svg)

Full rules: [SPEC.md](SPEC.md). It is 150 lines and it is the entire format.

## Reading it without any tool

```bash
python3 reader/read.py list
python3 reader/read.py recall deploy friday
python3 reader/read.py history postgres-is-the-database
python3 reader/read.py check
```

`check` is the one worth wiring into a pre-commit hook. It catches a memory
missing from the index, a filename that disagrees with its `name`, and a bad
type — the three things that break a reader.

## Connecting your tools

One page each, with the exact text to paste:

- [Claude Code](clients/claude-code.md)
- [Codex](clients/codex.md)
- [Cursor](clients/cursor.md)
- [ChatGPT](clients/chatgpt.md)
- [Anything that speaks MCP](clients/mcp-clients.md)

## What this is not

This is a file format and a 170-line reader. It does substring search over a
directory. At a few hundred memories that is genuinely all you need.

It does not rank results, resolve contradictions between two memories that
disagree, or answer "what did we believe in March" as a query. Those are
retrieval problems, and they start to matter somewhere in the low thousands of
memories. If you hit that, you have outgrown a flat file search and want a real
retrieval layer. There are several.

Built by John Mackenzie — [jmactech.com](https://jmactech.com) ·
[jmaclearning.com](https://jmaclearning.com)

Most people never get there. The format here is stable, documented and yours,
and nothing in it phones home.

## Licence

MIT. Copy it, fork it, put it in your product.

"JMac Memory OS" is a trademark of John Mackenzie. The format is free
to use and implement; the name identifies this project.
