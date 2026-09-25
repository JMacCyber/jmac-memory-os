# Contributing

The format is the product. Most changes should make it smaller, not bigger.

## Before you open a pull request

Run the check. It is the only test there is.

```bash
MEMORY_DIR=examples python3 reader/read.py check
```

It must print `Format OK.` The same command runs on every push and pull request.

## What gets merged

- A bug in `reader/read.py`, with the failing case written as an example memory.
- A new client page in `clients/`, if you have used it against a real repo. Say
  which client and which version you tested.
- A correction to [SPEC.md](SPEC.md) where the spec and the reader disagree.
- Plainer wording. Short words, short sentences, no metaphors.

## What does not get merged

- A dependency. `reader/read.py` is Python 3 standard library only and stays
  that way. It is tested on macOS system Python 3.9.6 and must also run on
  Windows (x64/ARM64). `--dir` is the cross-platform way to point it at a
  folder.
- Ranking, embeddings, or a vector store. If you need those you have outgrown
  this format, which the README says outright.
- A new frontmatter field, unless a reader cannot work without it.
- A packaging layer. `git clone` and `python3` is the whole install.

## The rules the format keeps

- A memory is one file, one fact.
- Nothing is overwritten. A fact that stops being true moves to
  `memory/archive/` and gets `effective_to` and `superseded_by`.
- `memory/` holds what is true now. `memory/archive/` holds what used to be true.
- `INDEX.md` lists every live memory.

A change that breaks one of those needs a reason in the pull request body, not
just a diff.

## Licence

By opening a pull request you agree your contribution is MIT licensed, the same
as the rest of the repo.
