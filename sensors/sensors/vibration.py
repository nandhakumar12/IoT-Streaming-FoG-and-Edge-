"""
Vibration Sensor – Simulates a MEMS accelerometer on industrial machinery.

Model:
  - Normal operation: background vibration 0.1–1.5 g (gravity)
  - Periodic sinusoidal component (machine rotation at ~50 Hz simulated)
  - Anomaly: sudden spike > 8 g (bearing failure, imbalance event)
  - 3% anomaly rate — higher than temperature (mechanical failures are common)

Reference: ISO 10816-1: Mechanical vibration – evaluation of machine vibration
"""
import numpy as np
from .base_sensor import BaseSensor


class VibrationSensor(BaseSensor):
    """Virtual MEMS accelerometer for industrial machinery monitoring."""

    WARN_THRESHOLD = 6.0      # g
    CRITICAL_THRESHOLD = 9.0  # g

    def __init__(self, sensor_id: str = None, base_vibration: float = 0.8):
        """
        Args:
            sensor_id:       Optional fixed ID.
            base_vibration:  Normal background vibration level (g).
        """
        super().__init__(sensor_id)
        self._base = base_vibration
        self._phase = np.random.uniform(0, 2 * np.pi)  # random phase offset
        self._step = 0

    @property
    def sensor_type(self) -> str:
        return "vibration"

    @property
    def unit(self) -> str:
        return "g"

    def _generate_value(self) -> float:
        self._step += 1
        # Sinusoidal component representing machine rotation
        sine_component = 0.3 * np.sin(0.1 * self._step + self._phase)
        # Gaussian noise around base vibration
        noise = np.random.normal(0, 0.15)
        value = abs(self._base + sine_component + noise)

        # 3% probability of mechanical fault spike
        if np.random.random() < 0.03:
            value = np.random.uniform(8.5, 12.0)

        return round(float(np.clip(value, 0.0, 15.0)), 3)
