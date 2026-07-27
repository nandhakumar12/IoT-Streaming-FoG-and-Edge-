"""
EdgeGuardian – Sensor Simulator
================================
Main entry point for the virtual sensor array.

Usage:
    python simulator.py [options]

Options:
    --broker-host   MQTT broker hostname      (default: localhost)
    --broker-port   MQTT broker port          (default: 1883)
    --rate          Messages/second/sensor    (default: 1.0)
    --sensors       Comma-separated list      (default: all 5)
    --duration      Run duration in seconds   (default: infinite)
    --count         Number of each sensor     (default: 2)
    --client-id     MQTT client ID prefix     (default: edgeguardian-sim)

Example:
    python simulator.py --rate 2.0 --sensors temperature,vibration --count 3

Design note: Each sensor publishes to MQTT topic 'sensors/{type}/{sensor_id}'
with QoS=1 (at-least-once delivery). QoS 1 ensures the fog node receives
all messages even under unstable network conditions [OASIS MQTT v5.0, §4.3].
"""
import argparse
import json
import logging
import os
import signal
import sys
import time
from typing import List

# Add parent directory to path for package imports (must precede local imports)
sys.path.insert(0, os.path.dirname(__file__))

import paho.mqtt.client as mqtt  # noqa: E402

from sensors import SENSOR_REGISTRY  # noqa: E402

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [SENSOR] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Global state ─────────────────────────────────────────────────────────────
_running = True
_total_published = 0



def signal_handler(sig, frame):
    """Graceful shutdown on Ctrl-C."""
    global _running
    log.info(f"Shutdown signal received. Total published: {_total_published}")
    _running = False


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


# ── MQTT callbacks ────────────────────────────────────────────────────────────
def on_connect(client: mqtt.Client, userdata, flags, rc: int):
    if rc == 0:
        log.info("✓ Connected to MQTT broker")
    else:
        log.error(f"✗ Connection failed with code {rc}")


def on_publish(client: mqtt.Client, userdata, mid: int):
    pass  # Suppress per-message logs at high rates


def on_disconnect(client: mqtt.Client, userdata, rc: int):
    if rc != 0:
        log.warning(f"Unexpected disconnect (rc={rc}). Attempting reconnect…")


# ── Simulator ────────────────────────────────────────────────────────────────
def create_sensors(sensor_types: List[str], count: int) -> list:
    """Instantiate `count` sensors of each requested type."""
    instances = []
    for stype in sensor_types:
        if stype not in SENSOR_REGISTRY:
            log.warning(f"Unknown sensor type '{stype}' — skipping")
            continue
        cls = SENSOR_REGISTRY[stype]
        for i in range(count):
            sensor_id = f"{stype[:4].upper()}-{i+1:02d}"
            instances.append(cls(sensor_id=sensor_id))
            log.info(f"  Created sensor: {sensor_id} ({stype})")
    return instances


def publish_payload(client: mqtt.Client, sensor) -> dict:
    """Generate and publish one reading; return the payload dict."""
    global _total_published
    payload = sensor.generate()
    topic = sensor.topic
    message = json.dumps(payload, ensure_ascii=False)
    result = client.publish(topic, message, qos=1)
    if result.rc == mqtt.MQTT_ERR_SUCCESS:
        _total_published += 1
    return payload


def run_simulator(args):
    """Main simulation loop."""
    # ── MQTT client setup ────────────────────────────────────────────────────
    client = mqtt.Client(client_id=f"{args.client_id}-{os.getpid()}")
    client.on_connect = on_connect
    client.on_publish = on_publish
    client.on_disconnect = on_disconnect

    log.info(f"Connecting to MQTT broker at {args.broker_host}:{args.broker_port}…")
    try:
        client.connect(args.broker_host, args.broker_port, keepalive=60)
    except ConnectionRefusedError:
        log.error("Could not connect to MQTT broker. Is Mosquitto running?")
        sys.exit(1)

    client.loop_start()

    # ── Create sensor instances ──────────────────────────────────────────────
    sensor_types = [s.strip() for s in args.sensors.split(",") if s.strip()]
    sensors = create_sensors(sensor_types, args.count)

    if not sensors:
        log.error("No valid sensors created. Exiting.")
        sys.exit(1)

    log.info(f"Publishing {len(sensors)} sensor(s) at {args.rate} msg/s each")
    log.info(f"Topics: sensors/{{type}}/{{id}} | QoS: 1 | Duration: "
             f"{'infinite' if args.duration == 0 else f'{args.duration}s'}")

    # ── Main publish loop ────────────────────────────────────────────────────
    interval = 1.0 / args.rate           # seconds between each sensor's publish
    start_time = time.monotonic()
    iteration = 0

    while _running:
        loop_start = time.monotonic()

        for sensor in sensors:
            if not _running:
                break
            payload = publish_payload(client, sensor)

            # Print every 10th message to avoid console flooding
            if iteration % 10 == 0:
                log.info(
                    f"→ {sensor.topic:45s} | "
                    f"{payload['value']:>8.3f} {payload['unit']}"
                )

        iteration += 1

        # Check duration limit
        if args.duration > 0 and (time.monotonic() - start_time) >= args.duration:
            log.info(f"Duration limit ({args.duration}s) reached.")
            break

        # Sleep for remainder of interval (per sensor)
        elapsed = time.monotonic() - loop_start
        sleep_time = interval - elapsed
        if sleep_time > 0:
            time.sleep(sleep_time)

    # ── Cleanup ──────────────────────────────────────────────────────────────
    client.loop_stop()
    client.disconnect()
    log.info(f"Simulator stopped. Total messages published: {_total_published}")


# ── CLI ───────────────────────────────────────────────────────────────────────
def parse_args():
    parser = argparse.ArgumentParser(
        description="EdgeGuardian Virtual Sensor Simulator",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--broker-host", default=os.getenv("MQTT_BROKER_HOST", "localhost"),
                        help="MQTT broker hostname")
    parser.add_argument("--broker-port", type=int, default=int(os.getenv("MQTT_BROKER_PORT", 1883)),
                        help="MQTT broker port")
    parser.add_argument("--rate", type=float, default=float(os.getenv("PUBLISH_RATE", 1.0)),
                        help="Messages per second per sensor")
    parser.add_argument("--sensors", default=os.getenv("SENSORS",
                        "temperature,vibration,humidity,pressure,power_consumption"),
                        help="Comma-separated list of sensor types to simulate")
    parser.add_argument("--duration", type=int, default=0,
                        help="Simulation duration in seconds (0 = run forever)")
    parser.add_argument("--count", type=int, default=2,
                        help="Number of sensors per type")
    parser.add_argument("--client-id", default="edgeguardian-sim",
                        help="MQTT client ID prefix")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run_simulator(args)
