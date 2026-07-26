"""
Power Consumption Sensor – Simulates a smart energy meter on industrial equipment.

Model:
  - Normal load: 120–280 W (machine in operation)
  - Step function: machines turn on/off, creating discrete load levels
  - Startup surge: brief spike when machine starts (>400 W)
  - 2.5% anomaly rate: electrical fault causing >450 W sustained draw

Reference: IEC 61557-12: Performance measuring and monitoring devices
"""
import numpy as np
from .base_sensor import BaseSensor


class PowerConsumptionSensor(BaseSensor):
    """Virtual smart energy meter for industrial load monitoring."""

    WARN_THRESHOLD = 350.0      # W
    CRITICAL_THRESHOLD = 450.0  # W

    # Discrete machine load levels (W)
    LOAD_LEVELS = [0.0, 80.0, 150.0, 220.0, 280.0]

    def __init__(self, sensor_id: str = None):
        super().__init__(sensor_id)
        # Start at a random normal load level
        self._load_level = np.random.choice(self.LOAD_LEVELS[2:])
        self._steps_at_level = 0
        self._in_surge = False
        self._surge_steps = 0

    @property
    def sensor_type(self) -> str:
        return "power_consumption"

    @property
    def unit(self) -> str:
        return "W"

    def _generate_value(self) -> float:
        self._steps_at_level += 1

        # Handle startup surge (lasts 3–5 steps)
        if self._in_surge:
            self._surge_steps -= 1
            surge_value = np.random.uniform(380, 430)
            if self._surge_steps <= 0:
                self._in_surge = False
            return round(float(surge_value), 1)

        # Randomly switch load level every ~30 steps (30 seconds at 1Hz)
        if self._steps_at_level > np.random.randint(20, 50):
            self._steps_at_level = 0
            new_level = np.random.choice(self.LOAD_LEVELS)
            # Simulate startup surge when machine switches on from idle
            if self._load_level < 50 and new_level > 100:
                self._in_surge = True
                self._surge_steps = np.random.randint(3, 6)
            self._load_level = new_level

        # Measurement noise around current load level
        noise = np.random.normal(0, 5.0)
        value = self._load_level + noise

        # 2.5% electrical fault anomaly
        if np.random.random() < 0.025:
            value = np.random.uniform(460, 520)

        return round(float(np.clip(value, 0.0, 600.0)), 1)
