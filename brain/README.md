# Brain View (Test)

A read-only graph of the private memory repo `JMacCyber/JMacAIUnifiedMemory`. Four layouts: Rings, Areas, Links, Timeline.

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
