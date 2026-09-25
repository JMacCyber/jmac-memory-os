"""Tests for the Brain View. Run: python3 -m unittest brain/test_brain.py"""
import json, os, re, sys, tempfile, threading, unittest, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_graph, serve  # noqa: E402


def write(d, name, text):
    with open(os.path.join(d, name), "w") as fh:
        fh.write(text)


class Build(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.a = os.path.join(self.tmp, "alpha"); os.makedirs(os.path.join(self.a, "archive"))
        self.b = os.path.join(self.tmp, "beta"); os.makedirs(self.b)
        write(self.a, "one.md", "---\nname: one\ndescription: \"first\"\nmetadata:\n  type: project\n---\nsee [[two]] and [[ghost]] and [[three]]\n")
        write(self.a, "two.md", "---\nname: two\ntype: feedback\ndescription: second\n---\nback to [[one]]\n")
        write(self.a, "MEMORY.md", "- [one](one.md)\n")
        write(os.path.join(self.a, "archive"), "old.md", "---\nname: old\n---\n")
        write(self.b, "three.md", "---\nname: three\ntype: nonsense\n---\n")
        self.g = build_graph.build([self.a, self.b, os.path.join(self.tmp, "empty")])

    def ids(self, kind=None):
        return {n["id"] for n in self.g["nodes"] if kind is None or n["kind"] == kind}

    def test_nodes(self):
        self.assertEqual(self.ids("area"), {"area:alpha", "area:beta"})
        mems = {n["name"]: n for n in self.g["nodes"] if n["kind"] not in ("root", "area")}
        self.assertEqual(set(mems), {"one", "two", "three"})  # MEMORY.md and archive/ skipped
        self.assertEqual(mems["one"]["kind"], "project")      # nested metadata.type
        self.assertEqual(mems["one"]["description"], "first")  # quotes stripped
        self.assertEqual(mems["three"]["kind"], "other")      # unknown type

    def test_links(self):
        links = {(e["from"], e["to"]) for e in self.g["edges"] if e["why"] == "link"}
        self.assertIn(("mem:alpha/one", "mem:alpha/two"), links)
        self.assertIn(("mem:alpha/two", "mem:alpha/one"), links)
        self.assertIn(("mem:alpha/one", "mem:beta/three"), links)  # unique match across areas
        self.assertEqual(self.g["unresolved"], [{"from": "mem:alpha/one", "target": "ghost"}])

    def test_every_edge_end_exists(self):
        ids = self.ids()
        for e in self.g["edges"]:
            self.assertIn(e["from"], ids); self.assertIn(e["to"], ids)


class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        src = os.path.join(cls.tmp, "src"); os.makedirs(src)
        write(src, "m.md", "---\nname: m\ntype: user\n---\nbody text\n")
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
        code, body = self.get("/file?id=mem:src/m")
        self.assertEqual((code, "body text" in body), (200, True))

    def test_only_listed_files(self):
        self.assertEqual(self.get("/file?id=../secret.txt")[0], 404)
        self.assertEqual(self.get("/file?id=area:src")[0], 404)
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
