"""
Base Sensor – Abstract class for all EdgeGuardian virtual sensors.

All concrete sensor classes must inherit from this and implement:
    - sensor_type (property): e.g. "temperature"
    - unit (property): e.g. "°C"
    - _generate_value(): returns a float reading

Design note: The abstract pattern enforces a consistent MQTT payload
structure across all sensor types, simplifying fog-node validation.
"""
from abc import ABC, abstractmethod
from datetime import datetime, timezone
import uuid


class BaseSensor(ABC):
    """Abstract base class for all virtual industrial sensors."""

    def __init__(self, sensor_id: str = None):
        # Auto-generate a unique ID if not provided (e.g. "TEMP-A3F2")
        self.sensor_id = sensor_id or f"{self.sensor_type[:4].upper()}-{str(uuid.uuid4())[:4].upper()}"
        self._reading_count = 0

    # ── Abstract interface ──────────────────────────────────────────────────

    @property
    @abstractmethod
    def sensor_type(self) -> str:
        """Sensor category string used in MQTT topic and payload."""
        ...

    @property
    @abstractmethod
    def unit(self) -> str:
        """Physical unit of measurement (e.g. '°C', 'g', '%RH')."""
        ...

    @abstractmethod
    def _generate_value(self) -> float:
        """Return the next simulated sensor reading."""
        ...

    # ── Public API ──────────────────────────────────────────────────────────

    @property
    def topic(self) -> str:
        """MQTT topic in format: sensors/{type}/{sensor_id}"""
        return f"sensors/{self.sensor_type}/{self.sensor_id}"

    def generate(self) -> dict:
        """
        Produce a single timestamped sensor reading.

        Returns:
            dict: JSON-serialisable payload with fields:
                  sensor_id, type, value, unit, timestamp, seq
        """
        self._reading_count += 1
        return {
            "sensor_id": self.sensor_id,
            "type": self.sensor_type,
            "value": self._generate_value(),
            "unit": self.unit,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "seq": self._reading_count,         # sequence number for ordering
        }

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} id={self.sensor_id}>"
