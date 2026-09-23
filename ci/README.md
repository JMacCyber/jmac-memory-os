# Not wired up yet

`check.yml` is a GitHub Actions workflow. It is parked here, not in
`.github/workflows/`, so GitHub does not see it and nothing runs.

Reason: Actions minutes are free and unlimited on a public repo, and metered
while the repo is Private. This repo is Private today.

To turn it on at the moment the repo goes public:

```bash
mkdir -p .github/workflows
git mv ci/check.yml .github/workflows/check.yml
git commit -m "Turn on the format check now the repo is public"
```

Until then, run it by hand:

```bash
MEMORY_DIR=examples python3 reader/read.py check
```
