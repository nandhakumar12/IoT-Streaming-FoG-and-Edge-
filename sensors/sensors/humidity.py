"""
Humidity Sensor – Simulates a capacitive humidity sensor in an industrial hall.

Model:
  - Normal range: 35–65 % RH (relative humidity)
  - Bounded random walk (humidity cannot exceed 0–100%)
  - Slow drift (humidity changes gradually, not rapidly)
  - 1.5% anomaly rate (condensation/water ingress events)

Reference: ASHRAE Standard 62.1-2019 ventilation for acceptable indoor air quality
"""
import numpy as np
from .base_sensor import BaseSensor


class HumiditySensor(BaseSensor):
    """Virtual capacitive humidity sensor for environment monitoring."""

    WARN_THRESHOLD = 75.0      # %RH
    CRITICAL_THRESHOLD = 90.0  # %RH

    def __init__(self, sensor_id: str = None, initial_rh: float = 50.0):
        """
        Args:
            sensor_id:   Optional fixed ID.
            initial_rh:  Starting relative humidity (%).
        """
        super().__init__(sensor_id)
        self._rh = initial_rh
        self._target = initial_rh

    @property
    def sensor_type(self) -> str:
        return "humidity"

    @property
    def unit(self) -> str:
        return "%RH"

    def _generate_value(self) -> float:
        # Occasionally shift the target humidity (simulates HVAC changes)
        if np.random.random() < 0.02:
            self._target = np.random.uniform(35.0, 65.0)

        # Slow drift toward target (humidity is slow to change)
        self._rh += (self._target - self._rh) * 0.08
        # Add small measurement noise
        self._rh += np.random.normal(0, 0.5)
        self._rh = float(np.clip(self._rh, 5.0, 99.5))

        # 1.5% condensation anomaly
        if np.random.random() < 0.015:
            self._rh = np.random.uniform(92.0, 99.0)

        return round(self._rh, 1)
