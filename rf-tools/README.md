# RF Tools

RF Tools is a Home Assistant add-on that helps you register ESPHome RF transceiver devices, learn remote button codes, and replay learned codes from a polished in-app dashboard.

**Features**
- Register RF-capable ESPHome devices by entering their HA entity IDs.
- Start a learning mode on an ESPHome device and capture the raw pulse timings.
- Save learned buttons into "remote" collections and replay them via an ESPHome transmit service.
- Lightweight, modern UI served from the add-on (Ingress).

## Requirements
- Home Assistant with Add-on support (Supervisor).
- ESPHome devices that expose a learn-mode switch and publish the learned code (see examples).

## Installation
1. Add this repository to Home Assistant Add-on Store (three-dot menu → Repositories).
2. Install the `RF Tools` add-on and start it.
3. Open the add-on via Ingress (sidebar → RF Tools) to access the dashboard.

## Quick setup
1. In your ESPHome device, expose a learn-mode switch (example YAML below) and ensure the device is added to Home Assistant.
2. Create a small Home Assistant helper (an `input_text` or similar) and an automation that writes the learned code into that helper when the ESPHome device emits the `esphome.rf_code_learned` event.
3. In the RF Tools UI, add a device and supply:
   - Device name
   - Learn switch entity (e.g. `switch.rf_learn_mode`)
   - Learn-code entity (the helper you created, e.g. `input_text.rf_last_code`)
   - Transmit service (default `esphome.transmit_rf`)

Once registered you can press "Start learn mode", press the remote button near the ESPHome receiver, and RF Tools will poll the configured entity for the new code. Save the learned code into a remote and replay it with the "Send" action.

## Example ESPHome snippet
The following is an example (from a working RF transceiver) that implements a learn switch and transmits/receives via `cc1101`. You may reuse or adapt this to your hardware.

(Excerpt from your attached `rf-module.yaml` — adjust pins and frequency for your board):

```yaml
esphome:
  name: rf-module
  friendly_name: RF Module

esp32:
  board: esp32-c6-devkitc-1
  variant: esp32c6
  framework:
    type: esp-idf

# Wi‑Fi, api, ota, logger omitted for brevity — keep your existing settings

globals:
  - id: learn_mode
    type: bool
    initial_value: 'false'

switch:
  - platform: template
    name: "RF Learn Mode"
    id: rf_learn_switch
    turn_on_action:
      - globals.set:
          id: learn_mode
          value: 'true'
    turn_off_action:
      - globals.set:
          id: learn_mode
          value: 'false'

# CC1101 transceiver + remote_receiver/transmitter configuration (keep as in your yaml)

remote_receiver:
  id: rf_rx
  pin:
    number: GPIO3
    allow_other_uses: true
  dump: all
  on_raw:
    then:
      - if:
          condition:
            lambda: 'return id(learn_mode);'
          then:
            - homeassistant.event:
                event: esphome.rf_code_learned
                data:
                  code: !lambda |-
                    std::string res = "[";
                    for (size_t i = 0; i < x.size(); i++) {
                      res += std::to_string(x[i]);
                      if (i < x.size() - 1) res += ", ";
                    }
                    res += "]";
                    return res;
            - switch.turn_off: rf_learn_switch
```

## Home Assistant automation (capture event to a helper)
Create an `input_text` helper (Developer Tools → Helpers) called `input_text.rf_last_code`, then add this automation in your configuration or via UI blueprint editor:

```yaml
alias: RF: Capture learned code
trigger:
  - platform: event
    event_type: esphome.rf_code_learned
action:
  - service: input_text.set_value
    target:
      entity_id: input_text.rf_last_code
    data:
      value: "{{ trigger.event.data.code }}"
```

In RF Tools add the device and provide `input_text.rf_last_code` as the "Learned code" entity.

## Using RF Tools UI
- Devices are configured in the add-on Options (up to 5). After configuring, refresh the UI to see the devices listed.
- Learn a button: pick a device, enter a button name, click "Start learn mode", then press the remote button near your ESPHome receiver. RF Tools will poll the configured entity for the new code.
- Save button: add learned code to a remote collection. Each remote stores multiple named buttons.
- Send button: click the send action next to the saved button to call the configured transmit service on your ESPHome device and emulate the button.

## Add-on Options (configure devices)
Open the add-on in the Supervisor UI, click "Configuration" (Options) and provide a `devices` array with up to 5 device objects. Example:

```json
{
  "devices": [
    {
      "name": "Living Room RF",
      "learn_entity": "switch.livingroom_rf_learn",
      "sensor_entity": "input_text.rf_last_code",
      "transmit_service": "esphome.transmit_rf"
    },
    {
      "name": "Garage RF",
      "learn_entity": "switch.garage_rf_learn",
      "sensor_entity": "input_text.rf_last_code_garage"
    }
  ]
}
```

- `name`: Friendly name shown in the UI.
- `learn_entity`: The entity that toggles the ESPHome device into learn mode (usually a `switch`).
- `sensor_entity`: A Home Assistant entity that will hold the learned code (see example automation in this README).
- `transmit_service`: The HA service to call to transmit a learned code (defaults to `esphome.transmit_rf`).

After saving Options, restart the add-on and refresh the RF Tools page.

## Troubleshooting
- If learning times out: verify your `input_text` helper is being updated when the ESPHome device logs the event (check Developer Tools → Events and the ESPHome logs).
- If sending fails: ensure the `transmit_service` value is correct (default `esphome.transmit_rf`) and your ESPHome device exposes that service via its API.

## Next steps / Improvements
- Optionally automate creating Home Assistant entities for each learned button (this is planned for future versions).
- Support for Pronto-format transmit is available on devices that implement `transmit_pronto` in their ESPHome YAML.

---

If you'd like, I can also add a short example Home Assistant dashboard card or implement automatic helpers creation for learned buttons (creates `switch` entities). Would you like that next?