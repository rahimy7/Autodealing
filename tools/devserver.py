#!/usr/bin/env python3
"""Local dev server for Novara Motors.

Serves the site and accepts POST /__save?name=img/... so tools/render.html can
write the generated vehicle images straight into the img/ folder.
Usage: python3 tools/devserver.py [port]
"""
import http.server
import os
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "img")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        if url.path != "/__save":
            self.send_error(404)
            return
        name = urllib.parse.parse_qs(url.query).get("name", [""])[0]
        target = os.path.normpath(os.path.join(ROOT, name))
        if not target.startswith(IMG_DIR + os.sep) or not target.endswith((".webp", ".png", ".jpg")):
            self.send_error(403, "Only image files inside img/ can be written")
            return
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as fh:
            fh.write(data)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(f"saved {name} ({len(data)} bytes)".encode())

    def log_message(self, fmt, *args):
        if self.command == "POST":
            sys.stderr.write("%s\n" % (fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5179
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler) as httpd:
        print(f"Novara Motors dev server on http://localhost:{port}")
        httpd.serve_forever()
