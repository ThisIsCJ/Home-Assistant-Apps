"""Hello World - Minimal HA add-on with ingress."""

import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 8099
OPTIONS_PATH = "/data/options.json"


def get_greeting():
    try:
        with open(OPTIONS_PATH, "r") as f:
            return json.load(f).get("greeting", "Hello, Home Assistant!")
    except (FileNotFoundError, json.JSONDecodeError):
        return "Hello, Home Assistant!"


def render_html(greeting: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hello World</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1c1c1c;
            color: #e1e1e1;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }}
        .card {{
            background: #252525;
            border-radius: 12px;
            padding: 48px;
            text-align: center;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
        }}
        .wave {{ font-size: 4rem; margin-bottom: 16px; }}
        h1 {{
            font-size: 1.8rem;
            font-weight: 600;
            color: #03a9f4;
        }}
    </style>
</head>
<body>
    <div class="card">
        <div class="wave">👋</div>
        <h1>{greeting}</h1>
    </div>
</body>
</html>"""


class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        greeting = get_greeting()
        html = render_html(greeting)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode())

    def log_message(self, format, *args):
        pass


def main():
    server = HTTPServer(("0.0.0.0", PORT), RequestHandler)
    print(f"Hello World running on port {PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
