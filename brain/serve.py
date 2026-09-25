#!/usr/bin/env python3
"""serve.py: the Brain View server. All writes go through edit.py.

    serve.py [PORT]        default 4895, bound to 127.0.0.1

Routes (the whole list):
    GET /                  index.html
    GET /brain.js          the page script
    GET /brain.css         the page styles
    GET /graph.json        data/graph.json, as built by build_graph.py
    GET /file?id=<node>    the text of one memory file named in graph.json
                           (ETag = sha256 of the text, needed to save an edit)
    GET /api/session       the write token for this server run, repo, git state
    POST /api/create       {rel, text}
    POST /api/update       {id, text, base}
    POST /api/archive      {id, reason, replacement}
Anything else is 404. PUT, DELETE and PATCH are 405.
Every POST must carry: Host 127.0.0.1 or localhost on this port, a matching
Origin if one is sent, Content-Type application/json and X-Brain-Token. The
token blocks other sites (they cannot read /api/session) and the Host check
blocks DNS rebinding.
"""

import hmac
import json
import os
import secrets
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
GRAPH = os.environ.get("BRAIN_GRAPH") or os.path.join(HERE, "data", "graph.json")
TOKEN = secrets.token_urlsafe(32)
sys.path.insert(0, HERE)
import edit  # noqa: E402

STATIC = {"/": ("index.html", "text/html"), "/brain.js": ("brain.js", "text/javascript"),
          "/brain.css": ("brain.css", "text/css")}


def load_graph():
    with open(GRAPH, encoding="utf-8") as fh:
        return json.load(fh)


class Handler(BaseHTTPRequestHandler):
    server_version = "BrainView/1"

    def send(self, code, body, ctype="text/plain; charset=utf-8", extra=None):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path in STATIC:
            name, ctype = STATIC[url.path]
            with open(os.path.join(HERE, name), "rb") as fh:
                return self.send(200, fh.read(), ctype + "; charset=utf-8")
        if url.path == "/graph.json":
            try:
                with open(GRAPH, "rb") as fh:
                    return self.send(200, fh.read(), "application/json")
            except OSError:
                return self.send(503, "could not read graph.json: run build_graph.py")
        if url.path == "/file":
            nid = parse_qs(url.query).get("id", [""])[0]
            try:
                graph = load_graph()
            except (OSError, ValueError):
                return self.send(503, "could not read graph.json")
            node = next((n for n in graph["nodes"] if n["id"] == nid and n["kind"] not in ("root", "area")), None)
            if not node:
                return self.send(404, "no memory with that id in graph.json")
            try:
                with open(node["path"], encoding="utf-8") as fh:
                    text = fh.read()
                return self.send(200, text, extra={"ETag": '"%s"' % edit.digest(text)})
            except OSError:
                return self.send(410, "could not read " + node["path"] + ": moved or archived since the last build")
        if url.path == "/api/session":
            try:
                repo = load_graph()["sources"][0]
            except (OSError, ValueError, KeyError, IndexError):
                return self.send(503, "could not read graph.json")
            return self.send_json(200, {"token": TOKEN, "repo": repo, "git": edit.git_state(repo)})
        return self.send(404, "not found")

    do_HEAD = do_GET

    def send_json(self, code, obj):
        return self.send(code, json.dumps(obj), "application/json")

    def allowed(self):
        port = self.server.server_address[1]
        hosts = {"127.0.0.1:%d" % port, "localhost:%d" % port}
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        return (host in hosts and (origin is None or origin == "http://" + host)
                and self.headers.get("Content-Type", "").split(";")[0].strip() == "application/json"
                and hmac.compare_digest(self.headers.get("X-Brain-Token", ""), TOKEN))

    def do_POST(self):
        url = urlparse(self.path)
        if url.path not in ("/api/create", "/api/update", "/api/archive"):
            return self.send(404, "not found")
        if not self.allowed():
            return self.send(403, "refused: wrong host, origin, content type or token")
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size > edit.MAX_BYTES * 2:
                return self.send(413, "request too large")
            body = json.loads(self.rfile.read(size) or b"{}")
            graph = load_graph()
            repo = graph["sources"][0]
        except (ValueError, OSError, KeyError, IndexError) as e:
            return self.send(400, "bad request: %s" % e)
        node = None
        if url.path != "/api/create":
            node = next((n for n in graph["nodes"] if n["id"] == body.get("id") and n.get("rel")), None)
            if not node:
                return self.send(404, "no file with that id in graph.json")
        try:
            if url.path == "/api/create":
                out = edit.create(repo, body.get("rel"), body.get("text"))
            elif url.path == "/api/update":
                out = edit.update(repo, node["rel"], body.get("text"), body.get("base"))
            else:
                out = edit.archive(repo, node["rel"], body.get("reason"), body.get("replacement"))
        except edit.Refused as e:
            return self.send(400, str(e))
        except edit.Conflict as e:
            return self.send(409, str(e))
        edit.rebuild(repo, GRAPH)
        out["id"] = "mem:" + out["rel"]
        out["git"] = edit.git_state(repo)
        return self.send_json(200, out)

    def refuse(self):
        self.send(405, "method not allowed")

    do_PUT = do_DELETE = do_PATCH = refuse

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4895
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("Brain View on http://127.0.0.1:%d" % port, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
