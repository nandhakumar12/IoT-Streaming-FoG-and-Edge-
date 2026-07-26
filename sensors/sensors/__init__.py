"""
EdgeGuardian Sensor Package
Provides 5 virtual industrial sensor types for simulation.
"""
from .temperature import TemperatureSensor
from .vibration import VibrationSensor
from .humidity import HumiditySensor
from .pressure import PressureSensor
from .power_consumption import PowerConsumptionSensor

SENSOR_REGISTRY = {
    "temperature": TemperatureSensor,
    "vibration": VibrationSensor,
    "humidity": HumiditySensor,
    "pressure": PressureSensor,
    "power_consumption": PowerConsumptionSensor,
}

__all__ = [
    "TemperatureSensor",
    "VibrationSensor",
    "HumiditySensor",
    "PressureSensor",
    "PowerConsumptionSensor",
    "SENSOR_REGISTRY",
]
