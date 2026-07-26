"""
Pressure Sensor – Simulates a piezoresistive pressure transducer.

Model:
  - Normal atmospheric pressure range: 1005–1025 hPa
  - Slow sinusoidal variation (pressure gradients across the day)
  - 1% anomaly rate: sudden drops or spikes (valve failure, seal breach)

Reference: IEC 60770-1: Transmitters for use in industrial-process control systems
"""
import numpy as np
from .base_sensor import BaseSensor


class PressureSensor(BaseSensor):
    """Virtual piezoresistive pressure transducer."""

    WARN_THRESHOLD = 1030.0      # hPa
    CRITICAL_THRESHOLD = 1040.0  # hPa
    WARN_LOW_THRESHOLD = 990.0   # hPa (low pressure equally concerning)

    def __init__(self, sensor_id: str = None, base_pressure: float = 1013.25):
        """
        Args:
            sensor_id:      Optional fixed ID.
            base_pressure:  Standard atmospheric pressure (hPa).
        """
        super().__init__(sensor_id)
        self._pressure = base_pressure
        self._step = 0

    @property
    def sensor_type(self) -> str:
        return "pressure"

    @property
    def unit(self) -> str:
        return "hPa"

    def _generate_value(self) -> float:
        self._step += 1
        # Slow sinusoidal variation simulating diurnal pressure cycles
        sinusoidal = 5.0 * np.sin(self._step * 0.005)
        # Gaussian noise (±0.5 hPa measurement noise)
        noise = np.random.normal(0, 0.5)
        self._pressure = 1013.25 + sinusoidal + noise

        # 1% probability of a pressure anomaly (seal failure / valve event)
        if np.random.random() < 0.01:
            self._pressure = np.random.choice([
                np.random.uniform(1042, 1060),   # over-pressure
                np.random.uniform(975, 990),      # under-pressure / vacuum
            ])

        return round(float(np.clip(self._pressure, 900.0, 1100.0)), 2)
