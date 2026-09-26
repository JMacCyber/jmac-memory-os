# Windows

Everything in this repo runs on Windows 10/11, on Intel/AMD x64 and on ARM64.
It is pure Python standard library plus Git, so there is nothing
architecture-specific to build or install.

## Prerequisites

```powershell
winget install --id Git.Git -e
winget install --id Python.Python.3.12 -e
git config --global user.name  "Your Name"
git config --global user.email you@example.com
```

Open a new terminal afterwards so both are on `PATH`.

Use `py` (the Python launcher) rather than `python3`. On many Windows machines
`python3` is a Microsoft Store placeholder that does not run Python.

## One-step setup

From a clone of this repo, in PowerShell:

```powershell
.\windows\Setup-Memory.ps1
# or, with a private GitHub repo you already created:
.\windows\Setup-Memory.ps1 -Remote https://github.com/<you>/my-memory.git
```

If PowerShell refuses to run scripts, allow it for this one run:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\Setup-Memory.ps1
```

This checks Git and Python, creates `%USERPROFILE%\my-memory`, installs the
pre-commit format check, and optionally pushes to GitHub.

## Manual setup

```powershell
py bin\memos-init $HOME\my-memory --git       # or: bin\memos-init.cmd ...
```

## The reader

The macOS/Linux form `MEMORY_DIR=examples python3 reader/read.py check` is not
valid in PowerShell or cmd. Use `--dir` instead, which works everywhere:

```powershell
py reader\read.py --dir examples check
py reader\read.py --dir $HOME\my-memory recall deploy friday
reader\read.cmd --dir $HOME\my-memory list
```

Every memory repo also carries its own copy at `.memos\read.py`, so on any
machine that clones it:

```powershell
py $HOME\my-memory\.memos\read.py --dir $HOME\my-memory list
```

`$env:MEMORY_DIR = "$HOME\my-memory"` also works if you prefer an environment
variable.

## Paths for the client pages

The other client pages use `~/my-memory`. On Windows that is
`C:\Users\<you>\my-memory`. The files each client reads:

| Client | Global instruction file |
|---|---|
| Claude Code | `%USERPROFILE%\.claude\CLAUDE.md` |
| Codex | `%USERPROFILE%\.codex\AGENTS.md` |
| Gemini CLI | `%USERPROFILE%\.gemini\GEMINI.md` |
| Cursor | `.cursor\rules\memory.mdc` in each project (add the memory folder to the workspace) |

In those files, write the path with forward slashes —
`C:/Users/<you>/my-memory` — which every agent and Git accept and which avoids
backslash-escaping surprises in markdown and JSON.

## Line endings and editors

Memory files are stored with LF line endings on every OS (enforced by
`.gitattributes`), so a Windows machine and a Mac editing the same repo never
fight over every line. The reader accepts CRLF and the UTF-8 BOM that
Notepad and Windows PowerShell 5.1 add, so a memory saved from any Windows
editor still parses.

If you write memories from PowerShell 5.1, prefer
`Set-Content -Encoding utf8` or, better, use PowerShell 7 or an editor.

## Filenames

Windows ignores case in filenames; Git does not. `check` rejects a memory
filename that is not lowercase, so `Ships-On-Fridays.md` and
`ships-on-fridays.md` can never both exist.
