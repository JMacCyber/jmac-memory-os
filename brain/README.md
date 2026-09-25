# Brain View (Test)

A graph of the private memory repo `JMacCyber/JMacAIUnifiedMemory`. Six layouts: Rings, Circle, Areas, Links, Timeline, 3D Orbit.

```bash
python3 brain/build_graph.py            # writes brain/data/graph.json (not committed)
python3 brain/serve.py 4895             # http://127.0.0.1:4895
python3 -m unittest brain/test_brain.py
```

The builder reads `$BRAIN_REPO`, else `~/JMacAIUnifiedMemory`. Pass another repo path to read that one. Pull the repo first; the builder never touches the network.

- Centre: the repo, with its GitHub link, branch and commit.
- Areas: projects, from each file's `project:` field, else a `Project:` line, else the folder path.
- Colours: the top folder (records, threads, artifacts, handoffs, projects, policies, prompts, schemas, global).
- Links: `related:`, `supersedes:`, `[[name]]` and relative Markdown links, matched by path, id or file name.

## Create, Edit, Archive

- **New** (top bar, or New File Here on a project card) writes a file with a starter header.
- **Edit** saves only if the file is unchanged on disk since you opened it. Otherwise it refuses (409).
- **Archive** moves the file to `archive/<same path>` and adds a line to `archive/README.md`. Nothing is deleted.
- Each change is one local git commit. Nothing is pushed. **Not Pushed** shows the count and the push command.
- All writes go through `brain/edit.py`. The server takes them only from `127.0.0.1` or `localhost` on its own port, with a per-run token.

Test against a throwaway clone: the `brain-view-test` launch config clones the repo into `/tmp` and serves it on port 4896.
