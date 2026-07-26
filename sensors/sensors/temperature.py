"""
Temperature Sensor – Simulates an NTC thermistor in an industrial environment.

Model:
  - Normal operating range: 15–40 °C (machine ambient temperature)
  - Uses autocorrelated random walk (more realistic than i.i.d. gaussian)
  - 2% chance of an anomaly spike (>80 °C) to simulate overheating events

Reference: ISA-5.1-2009 Instrumentation Symbols and Identification
"""
import numpy as np
from .base_sensor import BaseSensor


class TemperatureSensor(BaseSensor):
    """Virtual NTC thermistor for industrial environment monitoring."""

    # Sensor thresholds (used by fog prioritiser)
    WARN_THRESHOLD = 60.0    # °C
    CRITICAL_THRESHOLD = 80.0  # °C

    def __init__(self, sensor_id: str = None, mean: float = 22.0, std: float = 3.0):
        """
        Args:
            sensor_id: Optional fixed ID.
            mean:      Normal operating temperature (°C).
            std:       Standard deviation of normal variation (°C).
        """
        super().__init__(sensor_id)
        self._mean = mean
        self._std = std
        self._current = mean  # maintain autocorrelated state

    @property
    def sensor_type(self) -> str:
        return "temperature"

    @property
    def unit(self) -> str:
        return "°C"

    def _generate_value(self) -> float:
        # Random walk: each reading is close to the previous one (autocorrelated)
        delta = np.random.normal(0.0, self._std * 0.25)
        self._current = np.clip(self._current + delta, -10.0, 100.0)

        # Drift back toward mean (mean-reversion) to stay realistic over time
        self._current += (self._mean - self._current) * 0.05

        # 2% probability of overheating anomaly
        if np.random.random() < 0.02:
            self._current = np.random.uniform(82.0, 98.0)

        return round(float(self._current), 2)
