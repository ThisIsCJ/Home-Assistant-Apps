"""openHASP Designer - Web server for the visual screen designer."""

import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

PORT = 8099
OPTIONS_PATH = "/data/options.json"
DESIGNS_DIR = "/data/designs"

Path(DESIGNS_DIR).mkdir(parents=True, exist_ok=True)


def get_options():
    try:
        with open(OPTIONS_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"panel_width": 480, "panel_height": 480}


def get_html():
    with open("/app/static/index.html") as f:
        return f.read()


def get_static(path):
    safe = os.path.normpath(path).lstrip("/")
    full = os.path.join("/app/static", safe)
    if not full.startswith("/app/static"):
        return None, None
    if not os.path.isfile(full):
        return None, None
    ct = "text/plain"
    if full.endswith(".js"):
        ct = "application/javascript"
    elif full.endswith(".css"):
        ct = "text/css"
    elif full.endswith(".html"):
        ct = "text/html"
    elif full.endswith(".json"):
        ct = "application/json"
    with open(full, "rb") as f:
        return f.read(), ct


class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/" or self.path.startswith("/?"):
            html = get_html()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(html.encode())

        elif self.path == "/api/options":
            opts = get_options()
            self._json_response(opts)

        elif self.path == "/api/designs":
            designs = []
            for f in sorted(Path(DESIGNS_DIR).glob("*.json")):
                designs.append(f.stem)
            self._json_response({"designs": designs})

        elif self.path.startswith("/api/designs/"):
            name = self.path.split("/api/designs/", 1)[1]
            fpath = os.path.join(DESIGNS_DIR, f"{name}.json")
            if os.path.isfile(fpath):
                with open(fpath) as f:
                    self._json_response(json.load(f))
            else:
                self.send_error(404)

        elif self.path.startswith("/static/"):
            rel = self.path[len("/static/"):]
            data, ct = get_static(rel)
            if data:
                self.send_response(200)
                self.send_header("Content-Type", ct)
                self.end_headers()
                self.wfile.write(data if isinstance(data, bytes) else data.encode())
            else:
                self.send_error(404)
        else:
            self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        if self.path == "/api/designs":
            name = body.get("name", "untitled")
            safe_name = "".join(c for c in name if c.isalnum() or c in "-_").strip()
            if not safe_name:
                safe_name = "untitled"
            fpath = os.path.join(DESIGNS_DIR, f"{safe_name}.json")
            with open(fpath, "w") as f:
                json.dump(body, f, indent=2)
            self._json_response({"saved": safe_name})

        elif self.path == "/api/export":
            pages = body.get("pages", {})
            jsonl_lines = []
            for page_id, objects in sorted(pages.items(), key=lambda x: int(x[0])):
                for obj in objects:
                    hasp_obj = self._to_hasp(int(page_id), obj)
                    jsonl_lines.append(json.dumps(hasp_obj))
            self._json_response({"jsonl": "\n".join(jsonl_lines)})

        elif self.path.startswith("/api/designs/") and self.path.endswith("/delete"):
            name = self.path.split("/api/designs/", 1)[1].replace("/delete", "")
            fpath = os.path.join(DESIGNS_DIR, f"{name}.json")
            if os.path.isfile(fpath):
                os.remove(fpath)
                self._json_response({"deleted": name})
            else:
                self.send_error(404)
        else:
            self.send_error(404)

    def _to_hasp(self, page, obj):
        """Convert designer object to openHASP JSONL format."""
        hasp = {
            "page": page,
            "id": obj.get("id", 1),
            "obj": obj.get("type", "label"),
            "x": obj.get("x", 0),
            "y": obj.get("y", 0),
            "w": obj.get("w", 100),
            "h": obj.get("h", 40),
        }
        props = obj.get("props", {})
        for key, val in props.items():
            if val != "" and val is not None:
                hasp[key] = val
        return hasp

    def _json_response(self, data, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, fmt, *args):
        pass


def main():
    server = HTTPServer(("0.0.0.0", PORT), RequestHandler)
    print(f"openHASP Designer running on port {PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
