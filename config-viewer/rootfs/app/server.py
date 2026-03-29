"""Config Viewer - Simple web server for Home Assistant add-on ingress."""

import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 8099
CONFIG_PATH = "/data/config_values.json"


def load_config():
    """Load config values from JSON file."""
    try:
        with open(CONFIG_PATH, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"input_1": "", "input_2": "", "input_3": ""}


def render_html(config: dict) -> str:
    """Render the config viewer HTML page."""
    rows = ""
    for key, value in config.items():
        label = key.replace("_", " ").title()
        rows += f"""
        <tr>
            <td class="key">{label}</td>
            <td class="value">{value}</td>
        </tr>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Config Viewer</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: #1c1c1c;
            color: #e1e1e1;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            min-height: 100vh;
            padding: 40px 20px;
        }}
        .container {{
            background: #252525;
            border-radius: 12px;
            padding: 32px;
            max-width: 600px;
            width: 100%;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
        }}
        h1 {{
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 24px;
            color: #03a9f4;
            display: flex;
            align-items: center;
            gap: 10px;
        }}
        h1::before {{
            content: "📋";
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
        }}
        tr {{
            border-bottom: 1px solid #333;
        }}
        tr:last-child {{
            border-bottom: none;
        }}
        td {{
            padding: 16px 12px;
            font-size: 1rem;
        }}
        .key {{
            color: #9e9e9e;
            font-weight: 500;
            width: 40%;
        }}
        .value {{
            color: #ffffff;
            font-weight: 400;
            font-family: 'SF Mono', 'Fira Code', monospace;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Config Viewer</h1>
        <table>
            {rows}
        </table>
    </div>
</body>
</html>"""


class RequestHandler(BaseHTTPRequestHandler):
    """Handle HTTP requests for the config viewer."""

    def do_GET(self):
        config = load_config()
        html = render_html(config)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode())

    def log_message(self, format, *args):
        """Suppress default logging."""
        pass


def main():
    server = HTTPServer(("0.0.0.0", PORT), RequestHandler)
    print(f"Config Viewer running on port {PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
