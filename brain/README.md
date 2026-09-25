# Brain View (Test)

A read-only graph of memory folders. Four layouts: Rings, Areas, Links, Timeline.

```bash
python3 brain/build_graph.py            # writes brain/data/graph.json (not committed)
python3 brain/serve.py 4895             # http://127.0.0.1:4895
python3 -m unittest brain/test_brain.py
```

With no arguments the builder reads every `~/.claude/projects/*/memory` folder. Pass folders to read others.
