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

    def test_no_other_methods(self):
        for m in ("PUT", "DELETE", "PATCH"):
            self.assertEqual(self.get("/graph.json", m)[0], 405)
        self.assertEqual(self.get("/graph.json", "POST")[0], 404)

    def test_server_writes_only_through_edit(self):
        with open(os.path.join(HERE, "serve.py")) as fh:
            src = fh.read()
        self.assertIsNone(re.search(r"open\([^)]*['\"][wax+]|os\.(remove|unlink|rename|replace|makedirs)|shutil\.", src))


class Edits(unittest.TestCase):
    """The write path: guards first, then create, update, conflict, archive."""
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.repo = os.path.join(cls.tmp, "repo")
        put(cls.repo, "records/a.md", "---\nid: a\nproject: p\n---\n# A\n")
        write(cls.tmp, "outside.md", "not in the repo")
        g = lambda *a: subprocess.run(["git", "-C", cls.repo, *a], check=True, capture_output=True)
        subprocess.run(["git", "init", "-q", cls.repo], check=True)
        g("config", "user.email", "t@example.com"); g("config", "user.name", "T")
        g("add", "-A"); g("commit", "-q", "-m", "seed")
        cls.saved = serve.GRAPH
        serve.GRAPH = os.path.join(cls.tmp, "graph.json")
        build_graph.main(["--out", serve.GRAPH, cls.repo])
        cls.srv = serve.ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler)
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown(); cls.srv.server_close(); serve.GRAPH = cls.saved

    def post(self, path, body, token=None, headers=None):
        h = {"Content-Type": "application/json", "X-Brain-Token": serve.TOKEN if token is None else token}
        h.update(headers or {})
        req = urllib.request.Request(self.base + path, json.dumps(body).encode(), h, method="POST")
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()

    def read(self, rel):
        with open(os.path.join(self.repo, rel)) as fh:
            return fh.read()

    def test_1_guards(self):
        body = {"rel": "records/x.md", "text": "x"}
        self.assertEqual(self.post("/api/create", body, token="wrong")[0], 403)
        self.assertEqual(self.post("/api/create", body, headers={"Origin": "http://evil.example"})[0], 403)
        self.assertEqual(self.post("/api/create", body, headers={"Host": "evil.example:80"})[0], 403)
        for rel in ("../outside.md", "/etc/x.md", "records/../../outside.md", "archive/x.md", ".git/x.md",
                    "records/x.py", "nowhere/x.md", "records/.hidden.md", "records/a.md"):
            self.assertEqual(self.post("/api/create", {"rel": rel, "text": "x"})[0], 400, rel)
        self.assertEqual(self.post("/api/update", {"id": "mem:../outside.md", "text": "x", "base": ""})[0], 404)
        with urllib.request.urlopen(self.base + "/api/session") as r:
            self.assertIsNone(r.headers.get("Access-Control-Allow-Origin"))  # other sites cannot read the token

    def test_2_create_update_conflict_archive(self):
        code, out = self.post("/api/create", {"rel": "records/p/new.md", "text": "---\nproject: p\n---\n# New"})
        self.assertEqual((code, self.read("records/p/new.md")), (200, "---\nproject: p\n---\n# New\n"))
        self.assertTrue(out["commit"])
        with urllib.request.urlopen(self.base + "/file?id=mem:records/a.md") as r:
            base = r.headers["ETag"].strip('"')
        self.assertEqual(self.post("/api/update", {"id": "mem:records/a.md", "text": "# A2", "base": base})[0], 200)
        self.assertEqual(self.read("records/a.md"), "# A2\n")
        self.assertEqual(self.post("/api/update", {"id": "mem:records/a.md", "text": "# A3", "base": base})[0], 409)
        self.assertEqual(self.read("records/a.md"), "# A2\n")  # conflict did not overwrite
        self.assertEqual(self.post("/api/archive", {"id": "mem:records/a.md", "reason": ""})[0], 400)
        code, out = self.post("/api/archive", {"id": "mem:records/a.md", "reason": "old", "replacement": "records/p/new.md"})
        self.assertEqual((code, out["archived_to"]), (200, "archive/records/a.md"))
        self.assertFalse(os.path.exists(os.path.join(self.repo, "records/a.md")))
        self.assertEqual(self.read("archive/records/a.md"), "# A2\n")  # moved, not deleted
        self.assertIn("`records/a.md` -> `archive/records/a.md`", self.read("archive/README.md"))
        with open(serve.GRAPH) as fh:
            ids = {n["id"] for n in json.load(fh)["nodes"]}
        self.assertIn("mem:records/p/new.md", ids); self.assertNotIn("mem:records/a.md", ids)  # graph rebuilt
        log = subprocess.run(["git", "-C", self.repo, "log", "--format=%s"], capture_output=True, text=True).stdout
        self.assertEqual(log.count("(Brain View)"), 3)
        status = subprocess.run(["git", "-C", self.repo, "status", "--short"], capture_output=True, text=True).stdout
        self.assertEqual(status, "")  # every change committed, nothing left loose


if __name__ == "__main__":
    unittest.main()
