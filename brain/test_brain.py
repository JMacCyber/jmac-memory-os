"""Tests for the Brain View. Run: python3 -m unittest brain/test_brain.py"""
import json, os, re, subprocess, sys, tempfile, threading, unittest, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_graph, serve  # noqa: E402


def write(d, name, text):
    with open(os.path.join(d, name), "w") as fh:
        fh.write(text)


def put(root, rel, text):
    os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
    write(root, rel, text)


class Build(unittest.TestCase):
    def setUp(self):
        self.r = tempfile.mkdtemp()
        subprocess.run(["git", "init", "-q", self.r], check=True)
        subprocess.run(["git", "-C", self.r, "remote", "add", "origin", "https://me:tok123@github.com/o/Mem.git"], check=True)
        put(self.r, "records/2026/a.md", "---\nid: rec-a\nproject: Alpha\nsummary: >\n  first\n  line\nrelated:\n  - threads/t.md\n  - ghost-id\nsupersedes: [rec-old]\n---\n# A Title\nsee [[b]]\n")
        put(self.r, "records/2026/old.yaml", "id: rec-old\nproject: alpha\n")
        put(self.r, "threads/t.md", "# Thread\n\nProject: Beta Two\n\nback to [a](../records/2026/a.md)\n")
        put(self.r, "projects/gamma/b.md", "# B\n")
        put(self.r, "schemas/s.yaml", "project:\n  type: string\n")
        put(self.r, "archive/x.md", "# gone\n")
        put(self.r, "scripts/y.md", "# not memory\n")
        self.g = build_graph.build(self.r)
        self.m = {n["rel"]: n for n in self.g["nodes"] if "rel" in n}

    def test_root_is_repo_without_token(self):
        root = self.g["nodes"][0]
        self.assertEqual((root["id"], root["name"], root["url"]), ("root", "Mem", "https://github.com/o/Mem"))
        self.assertNotIn("tok123", json.dumps(self.g))

    def test_nodes(self):
        self.assertEqual(set(self.m), {"records/2026/a.md", "records/2026/old.yaml", "threads/t.md",
                                       "projects/gamma/b.md", "schemas/s.yaml"})  # archive/, scripts/ skipped
        a = self.m["records/2026/a.md"]
        self.assertEqual((a["kind"], a["area"], a["name"], a["description"]), ("record", "alpha", "A Title", "first line"))
        self.assertEqual(self.m["threads/t.md"]["area"], "beta-two")      # Project: line
        self.assertEqual(self.m["projects/gamma/b.md"]["area"], "gamma")  # folder path
        self.assertEqual(self.m["schemas/s.yaml"]["area"], "general")     # nested project: is not a project

    def test_links(self):
        links = {(e["from"][4:], e["to"][4:], e["rel"]) for e in self.g["edges"] if e["why"] == "link"}
        self.assertEqual(links, {("records/2026/a.md", "threads/t.md", "related"),
                                 ("records/2026/a.md", "records/2026/old.yaml", "supersedes"),
                                 ("records/2026/a.md", "projects/gamma/b.md", "link"),
                                 ("threads/t.md", "records/2026/a.md", "link")})
        self.assertEqual([u["target"] for u in self.g["unresolved"]], ["ghost-id"])

    def test_every_edge_end_exists(self):
        ids = {n["id"] for n in self.g["nodes"]}
        for e in self.g["edges"]:
            self.assertIn(e["from"], ids); self.assertIn(e["to"], ids)


class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        src = os.path.join(cls.tmp, "src")
        put(src, "records/m.md", "---\nid: m\n---\nbody text\n")
        write(cls.tmp, "secret.txt", "do not serve")
        serve.GRAPH = os.path.join(cls.tmp, "graph.json")
        build_graph.main(["--out", serve.GRAPH, src])
        cls.srv = serve.ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler)
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown(); cls.srv.server_close()

    def get(self, path, method="GET"):
        req = urllib.request.Request(self.base + path, method=method)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()

    def test_routes(self):
        self.assertEqual(self.get("/")[0], 200)
        self.assertEqual(self.get("/brain.js")[0], 200)
        self.assertEqual(json.loads(self.get("/graph.json")[1])["nodes"][0]["id"], "root")
        code, body = self.get("/file?id=mem:records/m.md")
        self.assertEqual((code, "body text" in body), (200, True))

    def test_only_listed_files(self):
        self.assertEqual(self.get("/file?id=../secret.txt")[0], 404)
        self.assertEqual(self.get("/file?id=area:general")[0], 404)
        self.assertEqual(self.get("/../secret.txt")[0], 404)
        self.assertEqual(self.get("/serve.py")[0], 404)

    def test_read_only(self):
        for m in ("POST", "PUT", "DELETE", "PATCH"):
            self.assertEqual(self.get("/graph.json", m)[0], 405)

    def test_no_write_calls_in_server(self):
        src = open(os.path.join(HERE, "serve.py")).read()
        self.assertIsNone(re.search(r"open\([^)]*['\"][wax+]|os\.(remove|unlink|rename|replace|makedirs)|shutil\.", src))


if __name__ == "__main__":
    unittest.main()
