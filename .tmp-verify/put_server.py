"""Temporary PUT-upload server for cross-host screenshot transfer (verification only)."""
import http.server

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_PUT(self):
        path = "/tmp" + self.path
        length = int(self.headers.get("Content-Length", 0))
        n = 0
        with open(path, "wb") as f:
            remaining = length
            while remaining > 0:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    break
                f.write(chunk)
                n += len(chunk)
                remaining -= len(chunk)
        body = str(n).encode()
        self.send_response(201)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass

http.server.ThreadingHTTPServer(("0.0.0.0", 8899), Handler).serve_forever()
