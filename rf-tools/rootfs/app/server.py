#!/usr/bin/env python3

import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 8099
STATE_PATH = "/data/rf-tools.json"
OPTIONS_PATH = "/data/options.json"

DEFAULT_STATE = {
    "remotes": []
}

def load_options():
    try:
        with open(OPTIONS_PATH, 'r') as f:
            opts = json.load(f)
            devices = opts.get('devices', []) or []
            # normalize devices and assign stable ids based on index
            normalized = []
            for i, d in enumerate(devices):
                nd = {
                    'id': d.get('id') or f'dev_{i}',
                    'name': d.get('name', f'Device {i+1}'),
                    'learn_entity': d.get('learn_entity', ''),
                    'sensor_entity': d.get('sensor_entity', ''),
                    'transmit_service': d.get('transmit_service', 'esphome.transmit_rf')
                }
                normalized.append(nd)
            return normalized
    except (FileNotFoundError, json.JSONDecodeError):
        return []

PAGE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>RF Tools</title>
    <style>
        :root {
            color-scheme: dark;
            background: #08101c;
            color: #e8eef5;
            font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            background: radial-gradient(circle at top, #15202b 0%, #08101c 46%, #02060a 100%);
        }
        header {
            padding: 2rem 1.5rem 1rem;
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            font-size: clamp(2rem, 2.5vw, 3rem);
            margin: 0 0 0.25rem;
            letter-spacing: -0.03em;
        }
        p.lead {
            margin: 0;
            color: #96a4b5;
            max-width: 55rem;
            line-height: 1.7;
        }
        .grid {
            display: grid;
            gap: 1.5rem;
            padding: 0 1.5rem 2rem;
            max-width: 1200px;
            margin: 0 auto;
        }
        .card {
            background: rgba(16, 28, 40, 0.92);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 24px;
            padding: 1.5rem;
            box-shadow: 0 20px 45px rgba(0, 0, 0, 0.18);
            backdrop-filter: blur(18px);
        }
        .card h2 {
            margin-top: 0;
            margin-bottom: 1rem;
            font-size: 1.35rem;
        }
        .muted {
            color: #7f94a8;
        }
        .field-row {
            display: grid;
            grid-template-columns: 1fr;
            gap: 1rem;
        }
        @media (min-width: 640px) {
            .field-row {
                grid-template-columns: 1fr 1fr;
            }
        }
        label {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            font-size: 0.95rem;
            color: #c7d6e4;
        }
        input,
        select,
        textarea {
            width: 100%;
            border: 1px solid rgba(255,255,255,0.12);
            background: rgba(255, 255, 255, 0.05);
            color: #eef4ff;
            border-radius: 14px;
            padding: 0.95rem 1rem;
            font-size: 0.95rem;
        }
        button {
            border: none;
            color: #fff;
            background: linear-gradient(135deg, #4d97ff 0%, #2864ff 100%);
            box-shadow: 0 12px 26px rgba(34, 94, 255, 0.26);
            border-radius: 16px;
            padding: 0.95rem 1.4rem;
            font-size: 0.96rem;
            cursor: pointer;
            transition: transform 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease;
        }
        button:hover { transform: translateY(-1px); }
        button:disabled {
            opacity: 0.55;
            cursor: not-allowed;
            box-shadow: none;
        }
        .button-small {
            padding: 0.65rem 1rem;
            border-radius: 12px;
            font-size: 0.9rem;
        }
        .button-soft {
            background: rgba(255, 255, 255, 0.08);
            color: #bcd0f4;
            box-shadow: none;
        }
        .line-list {
            list-style: none;
            margin: 0;
            padding: 0;
            display: grid;
            gap: 1rem;
        }
        .line-item {
            border: 1px solid rgba(255,255,255,0.08);
            padding: 1rem;
            border-radius: 18px;
            display: grid;
            gap: 0.75rem;
        }
        .line-item strong { display: block; margin-bottom: 0.35rem; }
        .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
        }
        .notice {
            background: rgba(66, 146, 255, 0.12);
            border: 1px solid rgba(66, 146, 255, 0.2);
            padding: 1rem 1.2rem;
            border-radius: 16px;
            color: #d8ebff;
        }
        .tag { display: inline-block; color: #9db8da; font-size: 0.85rem; background: rgba(255,255,255,0.06); padding: 0.28rem 0.6rem; border-radius: 999px; }
        .small-text { color: #8fa7c0; font-size: 0.9rem; line-height: 1.6; }
        .split { display: grid; gap: 1rem; }
        @media (min-width: 900px) {
            .split { grid-template-columns: 2fr 1fr; }
        }
        .code-box {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 16px;
            padding: 1rem;
            color: #d4e5ff;
            overflow-x: auto;
        }
        .status-pill {
            display: inline-flex;
            align-items: center;
            padding: 0.3rem 0.75rem;
            border-radius: 999px;
            font-size: 0.82rem;
        }
        .status-pill.ok { background: rgba(72, 187, 120, 0.18); color: #b6ffd2; }
        .status-pill.warn { background: rgba(255, 193, 7, 0.18); color: #ffec9e; }
        .status-pill.error { background: rgba(255, 95, 95, 0.16); color: #ffd8d8; }
    </style>
</head>
<body>
    <header>
        <h1>RF Tools</h1>
        <p class="lead">Register ESPHome RF transceiver devices, learn remote buttons, and replay codes from a polished in-app dashboard.</p>
    </header>
    <main class="grid">
        <section class="card">
            <h2>Device setup</h2>
            <p class="small-text">Add your ESPHome device manually using its HA entity IDs. The add-on uses Home Assistant REST endpoints from the browser, so your session stays authenticated.</p>
            <div class="field-row">
                <label>Device name<input id="deviceName" type="text" placeholder="Living Room RF" /></label>
                <label>Learn switch entity<input id="deviceLearnEntity" type="text" placeholder="switch.rf_learn_mode" /></label>
            </div>
            <div class="field-row">
                <label>Learned code sensor<input id="deviceSensorEntity" type="text" placeholder="sensor.rf_last_code" /></label>
                <label>Transmit service<input id="deviceService" type="text" placeholder="esphome.transmit_rf" value="esphome.transmit_rf" /></label>
            </div>
            <div class="actions">
                <button id="addDeviceButton" onclick="addDevice()">Add device</button>
            </div>
        </section>

        <section class="card">
            <h2>Registered devices</h2>
            <ul id="deviceList" class="line-list"></ul>
            <p id="deviceEmpty" class="muted">No devices registered yet. Add one above to start learning remotes.</p>
        </section>

        <section class="card split">
            <div>
                <h2>Learn a button</h2>
                <div class="field-row">
                    <label>Device<select id="learnDevice"></select></label>
                    <label>Button name<input id="learnButtonName" type="text" placeholder="Power" /></label>
                </div>
                <label>Stored code<textarea id="learnedCode" rows="3" readonly placeholder="Learn a code to populate this field."></textarea></label>
                <div class="actions">
                    <button id="learnButton" onclick="learnButton()">Start learn mode</button>
                    <button id="saveButton" onclick="saveLearnedButton()" class="button-small" disabled>Save button</button>
                </div>
                <p class="small-text">Once the sensor updates, the learned raw code will appear. Then save it into a remote device.</p>
            </div>
            <div>
                <h2>Remote group</h2>
                <label>Remote name<input id="remoteName" type="text" placeholder="TV Remote" /></label>
                <label>Existing remote<select id="remoteSelect"></select></label>
                <p class="small-text">Give the learned button a home. You can create a new remote collection or add it to an existing one.</p>
            </div>
        </section>

        <section class="card">
            <h2>Saved remotes</h2>
            <ul id="remoteList" class="line-list"></ul>
            <p id="remoteEmpty" class="muted">No remotes saved yet. Learn a button and save it into a remote.</p>
        </section>

        <section class="card notice">
            <strong>Tips</strong>
            <ul>
                <li>Make sure your ESPHome device is added to Home Assistant.</li>
                <li>The device should expose a learn-mode switch and a sensor that publishes the learned raw pulse array.</li>
                <li>If your custom service name differs, update it when adding the device.</li>
            </ul>
        </section>
    </main>
    <script>
        const stateUrl = '/api/state';
        let appState = { devices: [], remotes: [] };
        let currentLearnDevice = null;
        let currentSensorValue = null;

        async function fetchState() {
            try {
                const response = await fetch(stateUrl);
                appState = await response.json();
            } catch (error) {
                console.error('Could not load state', error);
                appState = { devices: [], remotes: [] };
            }
            renderState();
        }

        async function saveState() {
            await fetch(stateUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(appState)
            });
            renderState();
        }

        function renderState() {
            const deviceList = document.getElementById('deviceList');
            const remoteList = document.getElementById('remoteList');
            const learnDevice = document.getElementById('learnDevice');
            const remoteSelect = document.getElementById('remoteSelect');
            deviceList.innerHTML = '';
            remoteList.innerHTML = '';
            learnDevice.innerHTML = '';
            remoteSelect.innerHTML = '<option value="">Select an existing remote</option>';

            if (appState.devices.length === 0) {
                document.getElementById('deviceEmpty').style.display = 'block';
            } else {
                document.getElementById('deviceEmpty').style.display = 'none';
                appState.devices.forEach((device) => {
                    const item = document.createElement('li');
                    item.className = 'line-item';
                    item.innerHTML = `<strong>${device.name}</strong>
                        <span class="tag">Learn switch: ${device.learn_entity}</span>
                        <span class="tag">Sensor: ${device.sensor_entity}</span>
                        <span class="tag">Service: ${device.transmit_service}</span>
                        <div class="actions">
                            <button class="button-small" onclick="removeDevice('${device.id}')">Remove</button>
                        </div>`;
                    deviceList.appendChild(item);

                    const option = document.createElement('option');
                    option.value = device.id;
                    option.textContent = device.name;
                    learnDevice.appendChild(option);
                });
            }

            if (appState.remotes.length === 0) {
                document.getElementById('remoteEmpty').style.display = 'block';
            } else {
                document.getElementById('remoteEmpty').style.display = 'none';
                appState.remotes.forEach((remote) => {
                    const item = document.createElement('li');
                    item.className = 'line-item';
                    const device = appState.devices.find(d => d.id === remote.device_id);
                    const buttonsHtml = remote.buttons.map((button) => `
                        <div class="actions">
                            <span>${button.name}</span>
                            <button class="button-small button-soft" onclick="sendRemoteButton('${remote.id}','${button.id}')">Send</button>
                        </div>
                    `).join('');
                    item.innerHTML = `<strong>${remote.name}</strong>
                        <div class="small-text">Device: ${device ? device.name : 'Unknown'}</div>
                        ${buttonsHtml}
                        <div class="actions">
                            <button class="button-small" onclick="removeRemote('${remote.id}')">Remove remote</button>
                        </div>`;
                    remoteList.appendChild(item);

                    const option = document.createElement('option');
                    option.value = remote.id;
                    option.textContent = remote.name;
                    remoteSelect.appendChild(option);
                });
            }
        }

        function addDevice() {
            const name = document.getElementById('deviceName').value.trim();
            const learnEntity = document.getElementById('deviceLearnEntity').value.trim();
            const sensorEntity = document.getElementById('deviceSensorEntity').value.trim();
            const transmitService = document.getElementById('deviceService').value.trim() || 'esphome.transmit_rf';

            if (!name || !learnEntity || !sensorEntity) {
                alert('Please fill in a device name, learn switch entity, and sensor entity.');
                return;
            }
            const id = `dev_${Date.now()}`;
                // Devices are managed via the add-on configuration (Options). Edit the add-on and configure up to 5 devices.
            alert('Devices must be configured in the add-on Options (max 5). Open the add-on and edit Configuration.');
        }

        function removeDevice(deviceId) {
            alert('Devices are configured in the add-on Options; remove them there.');
        }

        function removeRemote(remoteId) {
            appState.remotes = appState.remotes.filter(r => r.id !== remoteId);
            saveState();
        }

        async function learnButton() {
            const deviceId = document.getElementById('learnDevice').value;
            const buttonName = document.getElementById('learnButtonName').value.trim();
            if (!deviceId) {
                alert('Choose a registered device before learning a button.');
                return;
            }
            if (!buttonName) {
                alert('Enter a button name for the learned code.');
                return;
            }
            const device = appState.devices.find(d => d.id === deviceId);
            if (!device) return;

            document.getElementById('learnButton').disabled = true;
            document.getElementById('learnButton').textContent = 'Learning...';
            document.getElementById('learnedCode').value = '';

            const initialState = await getEntityState(device.sensor_entity);
            currentSensorValue = initialState;

            try {
                await callService('switch', 'turn_on', { entity_id: [device.learn_entity] });
                const learned = await waitForSensorChange(device.sensor_entity, initialState, 20);
                document.getElementById('learnedCode').value = learned;
                document.getElementById('saveButton').disabled = false;
                currentLearnDevice = device.id;
            } catch (error) {
                alert('Learning failed: ' + error.message);
            } finally {
                document.getElementById('learnButton').disabled = false;
                document.getElementById('learnButton').textContent = 'Start learn mode';
            }
        }

        async function saveLearnedButton() {
            const remoteName = document.getElementById('remoteName').value.trim();
            const remoteSelect = document.getElementById('remoteSelect').value;
            const buttonName = document.getElementById('learnButtonName').value.trim();
            const codeText = document.getElementById('learnedCode').value.trim();

            if (!codeText || !buttonName || !currentLearnDevice) {
                alert('Learn a button first and provide a button name.');
                return;
            }
            let remoteId = remoteSelect;
            if (!remoteId) {
                if (!remoteName) {
                    alert('Enter a remote name or choose an existing remote.');
                    return;
                }
                remoteId = `rem_${Date.now()}`;
                appState.remotes.push({ id: remoteId, name: remoteName, device_id: currentLearnDevice, buttons: [] });
            }
            const remote = appState.remotes.find(r => r.id === remoteId);
            if (!remote) {
                alert('Selected remote not found.');
                return;
            }
            if (remote.device_id !== currentLearnDevice) {
                remote.device_id = currentLearnDevice;
            }
            const buttonId = `btn_${Date.now()}`;
            const parsed = parseCode(codeText);
            remote.buttons.push({ id: buttonId, name: buttonName, code: parsed });
            saveState();
            document.getElementById('learnedCode').value = '';
            document.getElementById('learnButtonName').value = '';
            document.getElementById('remoteName').value = '';
            document.getElementById('saveButton').disabled = true;
            currentLearnDevice = null;
        }

        function parseCode(text) {
            try {
                const cleaned = text.trim();
                const parsed = JSON.parse(cleaned);
                if (Array.isArray(parsed)) return parsed;
            } catch (error) {
                // fallback parse
            }
            return cleaned.split(/[,\\s]+/).map((item) => parseInt(item, 10)).filter((n) => !Number.isNaN(n));
        }

        async function sendRemoteButton(remoteId, buttonId) {
            const remote = appState.remotes.find(r => r.id === remoteId);
            if (!remote) return;
            const button = remote.buttons.find(b => b.id === buttonId);
            if (!button) return;
            const device = appState.devices.find(d => d.id === remote.device_id);
            if (!device) {
                alert('Device not found for this remote.');
                return;
            }
            const serviceParts = device.transmit_service.split('.');
            if (serviceParts.length !== 2) {
                alert('Transmit service must be in the form domain.service');
                return;
            }
            const [domain, service] = serviceParts;
            const data = {
                raw_codes: button.code,
                target: { entity_id: [device.learn_entity] }
            };
            try {
                await callService(domain, service, data);
                alert(`Sent ${button.name} on ${remote.name}`);
            } catch (error) {
                alert('Send failed: ' + error.message);
            }
        }

        async function getEntityState(entityId) {
            const response = await fetch(`/api/states/${encodeURIComponent(entityId)}`);
            if (!response.ok) throw new Error('Entity not found: ' + entityId);
            const data = await response.json();
            return data.state;
        }

        async function callService(domain, service, data) {
            const response = await fetch(`/api/services/${domain}/${service}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!response.ok) {
                let text = await response.text();
                throw new Error(`Service call failed: ${response.status} ${response.statusText} ${text}`);
            }
            return await response.json();
        }

        async function waitForSensorChange(entityId, initialValue, timeoutSeconds) {
            const end = Date.now() + timeoutSeconds * 1000;
            while (Date.now() < end) {
                try {
                    const state = await getEntityState(entityId);
                    if (state && state !== initialValue && state !== 'unknown' && state !== 'unavailable') {
                        return state;
                    }
                } catch (error) {
                    console.warn('Polling failed', error);
                }
                await new Promise((resolve) => setTimeout(resolve, 1200));
            }
            throw new Error('Timeout waiting for the learned code sensor to update.');
        }

        fetchState();
    </script>
</body>
</html>"""


class RequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, text, status=200):
        body = text.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/' or self.path.startswith('/?'):
            self._send_text(PAGE_HTML)
            return

        if self.path == '/api/state':
            state = load_state()
            # override devices with add-on options (up to 5 configured devices)
            state['devices'] = load_options()
            self._send_json(state)
            return

        self.send_error(404, 'Not Found')

    def do_POST(self):
        if self.path == '/api/state':
            length = int(self.headers.get('Content-Length', '0'))
            body = self.rfile.read(length) if length else b''
            try:
                data = json.loads(body.decode('utf-8'))
                # persist only the remotes (devices are managed in add-on options)
                existing = load_state()
                existing['remotes'] = data.get('remotes', existing.get('remotes', []))
                save_state(existing)
                self._send_json({ 'ok': True })
            except json.JSONDecodeError:
                self.send_error(400, 'Invalid JSON')
            return

        self.send_error(404, 'Not Found')

    def log_message(self, format, *args):
        return


def load_state():
    try:
        with open(STATE_PATH, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return DEFAULT_STATE.copy()


def save_state(data):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, 'w') as f:
        json.dump(data, f, indent=2)


def main():
    server = HTTPServer(('0.0.0.0', PORT), RequestHandler)
    print(f'RF Tools running on port {PORT}')
    server.serve_forever()


if __name__ == '__main__':
    main()
