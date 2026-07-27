"""
Sensor Simulator – EdgeGuardian
Simulates five industrial sensor types (temperature, vibration, humidity,
pressure, power) and publishes readings to the MQTT broker at a configurable
rate. Fault injections are applied probabilistically to exercise the fog
node's anomaly detection pipeline.

Usage:
    python simulator.py [--broker-host HOST] [--broker-port PORT]
                        [--rate HZ] [--sensors LIST] [--duration SEC]
                        [--count N]

Topic format: sensors/{type}/{sensor_id}  (QoS 1)
"""
import argparse
import json
import logging
import os
import signal
import sys
import time
from typing import List

# sys.path.insert must come before the local 'sensors' package import
sys.path.insert(0, os.path.dirname(__file__))

import paho.mqtt.client as mqtt  # noqa: E402
from sensors import SENSOR_REGISTRY  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [SENSOR] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

_running = True
_total_published = 0


def signal_handler(sig, frame):
    """Stop the publish loop on SIGINT or SIGTERM."""
    global _running
    log.info(f"Shutting down. Total published: {_total_published}")
    _running = False


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


def on_connect(client: mqtt.Client, userdata, flags, rc: int):
    if rc == 0:
        log.info("Connected to MQTT broker")
    else:
        log.error(f"Connection failed (rc={rc})")


def on_publish(client: mqtt.Client, userdata, mid: int):
    pass  # high-rate publishing, per-message logging would flood the console


def on_disconnect(client: mqtt.Client, userdata, rc: int):
    if rc != 0:
        log.warning(f"Unexpected disconnect (rc={rc}), will attempt reconnect")


def create_sensors(sensor_types: List[str], count: int) -> list:
    """Build sensor instances for each requested type."""
    instances = []
    for stype in sensor_types:
        if stype not in SENSOR_REGISTRY:
            log.warning(f"Unknown sensor type '{stype}' — skipped")
            continue
        cls = SENSOR_REGISTRY[stype]
        for i in range(count):
            sensor_id = f"{stype[:4].upper()}-{i+1:02d}"
            instances.append(cls(sensor_id=sensor_id))
            log.info(f"  Registered: {sensor_id} ({stype})")
    return instances


def publish_payload(client: mqtt.Client, sensor) -> dict:
    """Publish one sensor reading and return the generated payload."""
    global _total_published
    payload = sensor.generate()
    message = json.dumps(payload, ensure_ascii=False)
    result = client.publish(sensor.topic, message, qos=1)
    if result.rc == mqtt.MQTT_ERR_SUCCESS:
        _total_published += 1
    return payload


def run_simulator(args):
    """Connect to the broker, create sensors, and run the publish loop."""
    client = mqtt.Client(client_id=f"{args.client_id}-{os.getpid()}")
    client.on_connect = on_connect
    client.on_publish = on_publish
    client.on_disconnect = on_disconnect

    log.info(f"Connecting to {args.broker_host}:{args.broker_port}")
    try:
        client.connect(args.broker_host, args.broker_port, keepalive=60)
    except ConnectionRefusedError:
        log.error("Could not reach MQTT broker. Is Mosquitto running?")
        sys.exit(1)

    client.loop_start()

    sensor_types = [s.strip() for s in args.sensors.split(",") if s.strip()]
    sensors = create_sensors(sensor_types, args.count)
    if not sensors:
        log.error("No valid sensors created — nothing to publish.")
        sys.exit(1)

    duration_label = "infinite" if args.duration == 0 else f"{args.duration}s"
    log.info(f"Publishing {len(sensors)} sensor(s) at {args.rate} msg/s | duration: {duration_label}")

    interval = 1.0 / args.rate
    start_time = time.monotonic()
    iteration = 0

    while _running:
        loop_start = time.monotonic()

        for sensor in sensors:
            if not _running:
                break
            payload = publish_payload(client, sensor)

            # log every 10th reading to keep the console readable
            if iteration % 10 == 0:
                log.info(
                    f"→ {sensor.topic:45s} | "
                    f"{payload['value']:>8.3f} {payload['unit']}"
                )

        iteration += 1

        if args.duration > 0 and (time.monotonic() - start_time) >= args.duration:
            log.info(f"Duration limit reached ({args.duration}s)")
            break

        sleep_time = interval - (time.monotonic() - loop_start)
        if sleep_time > 0:
            time.sleep(sleep_time)

    client.loop_stop()
    client.disconnect()
    log.info(f"Simulator stopped. Messages published: {_total_published}")


def parse_args():
    parser = argparse.ArgumentParser(
        description="EdgeGuardian Virtual Sensor Simulator",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--broker-host", default=os.getenv("MQTT_BROKER_HOST", "localhost"))
    parser.add_argument("--broker-port", type=int, default=int(os.getenv("MQTT_BROKER_PORT", 1883)))
    parser.add_argument("--rate", type=float, default=float(os.getenv("PUBLISH_RATE", 1.0)),
                        help="Messages per second per sensor")
    parser.add_argument("--sensors",
                        default=os.getenv("SENSORS", "temperature,vibration,humidity,pressure,power_consumption"),
                        help="Comma-separated sensor types")
    parser.add_argument("--duration", type=int, default=0,
                        help="Run duration in seconds (0 = run until interrupted)")
    parser.add_argument("--count", type=int, default=2,
                        help="Number of instances per sensor type")
    parser.add_argument("--client-id", default="edgeguardian-sim")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run_simulator(args)
