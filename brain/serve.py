#!/usr/bin/env python3
"""serve.py: the Brain View server. Reads only. Writes nothing.

    serve.py [PORT]        default 4895, bound to 127.0.0.1

Routes (the whole list):
    GET /                  index.html
    GET /brain.js          the page script
    GET /brain.css         the page styles
    GET /graph.json        data/graph.json, as built by build_graph.py
    GET /file?id=<node>    the text of one memory file named in graph.json
Anything else is 404. Any method other than GET or HEAD is 405.
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
GRAPH = os.path.join(HERE, "data", "graph.json")
STATIC = {"/": ("index.html", "text/html"), "/brain.js": ("brain.js", "text/javascript"),
          "/brain.css": ("brain.css", "text/css")}


def load_graph():
    with open(GRAPH, encoding="utf-8") as fh:
        return json.load(fh)


class Handler(BaseHTTPRequestHandler):
    server_version = "BrainView/1"

    def send(self, code, body, ctype="text/plain; charset=utf-8"):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
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
                    return self.send(200, fh.read())
            except OSError:
                return self.send(410, "could not read " + node["path"] + ": moved or archived since the last build")
        return self.send(404, "not found")

    do_HEAD = do_GET

    def refuse(self):
        self.send(405, "read only")

    do_POST = do_PUT = do_DELETE = do_PATCH = refuse

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4895
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("Brain View on http://127.0.0.1:%d" % port, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
