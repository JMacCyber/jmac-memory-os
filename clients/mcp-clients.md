# Anything that speaks MCP

Claude, Gemini, Grok, Mistral Vibe, Perplexity, Microsoft 365 Copilot, Amazon Q,
DeepSeek Harness and Qwen Chat all accept a Model Context Protocol server.
GitHub runs a hosted one, so you install nothing.

## Setup

Add GitHub's remote MCP server to the client and sign in. The URL:

```
https://api.githubcopilot.com/mcp/
```

Each client puts this in a different place:

| Client | Where |
|---|---|
| Claude | Settings → Connectors → Add custom connector |
| Gemini | Spark → Connected Apps |
| Grok | grok.com/connectors → New Connector → Custom (paid tier) |
| Perplexity | Settings → Connectors → Custom (Pro, Max or Enterprise) |
| Mistral Vibe | Connectors → MCP |

Then give the client the same standing instruction:

```
My memory is the GitHub repo <you>/my-memory. Read memory/INDEX.md there before
answering questions about my work or preferences. Follow AGENTS.md when writing.
Never read memory/archive/ unless I ask what used to be true.
```

## Verified 21 September 2026

Connector surfaces move. If a client is not in the table above, check whether it
accepts a custom MCP server URL — if it does, it works, and nothing here needs
to change.

## What MCP gives you and what it does not

It gives the client tools: fetch a file, list a directory, commit. That is
enough for the whole format.

It does not give the client a filesystem. It will not discover memories by
looking around, which is exactly why every path in this format starts at one
known file: `memory/INDEX.md`.
