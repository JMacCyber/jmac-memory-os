# ChatGPT

ChatGPT reads and writes your repo through the GitHub connector. It cannot
create the repo, so run `memos-init` first and push it yourself.

## Setup

1. Push your memory repo to GitHub (private is fine).
2. In ChatGPT: **Settings → Connectors → GitHub → Connect**, and authorise the
   repo. Grant it the single repo, not your whole account.
3. Start a conversation with this, once:

```
My memory is the GitHub repo <you>/my-memory. Before answering anything about
my work, setup or preferences, read memory/INDEX.md in that repo and open the
relevant files. Follow AGENTS.md when I ask you to remember something. Never
read memory/archive/ unless I ask what used to be true.
```

Put that in a Project's instructions so you do not retype it.

## Check it works

Ask: *what is in my memory index?*

## Limits worth knowing

- It fetches named files. It does not walk the directory, which is why
  `INDEX.md` exists — give it that path and it finds everything else.
- Connector reads can lag a fresh push by a few minutes.
- It cannot create a repository. First-time setup is always a local command.
