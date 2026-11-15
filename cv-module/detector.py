"""Detección de vehículos con patrón Strategy.

El worker solo conoce la interfaz `Detector`. Hoy se usa `DetectorSimulado` (umbral + componentes
conexas); para usar un modelo real alcanza con escribir otra clase que implemente `contar` y
pasársela al worker, sin tocar nada más.
"""
from abc import ABC, abstractmethod

import numpy as np
from scipy import ndimage


class Detector(ABC):
    """Interfaz común de cualquier detector de vehículos."""

    @abstractmethod
    def contar(self, frame: np.ndarray) -> int:
        """Devuelve cuántos vehículos hay en un frame (matriz 2D)."""


class DetectorSimulado(Detector):
    """CV simulado: cada mancha brillante (componente conexa) es un vehículo.

    Se puede reemplazar por un modelo real implementando la misma interfaz `Detector`.
    """

    def __init__(self, threshold: int, min_area: int):
        self.threshold = threshold
        self.min_area = min_area

    def contar(self, frame: np.ndarray) -> int:
        # 1) Binarizar: True donde el píxel es más brillante que el umbral.
        binario = frame > self.threshold
        # 2) Etiquetar las manchas conexas: cada una recibe un número 1..n (0 es el fondo).
        etiquetas, n = ndimage.label(binario)
        if n == 0:
            return 0
        # 3) Área de cada mancha = cuántos píxeles tienen esa etiqueta.
        areas = np.bincount(etiquetas.ravel())
        # 4) Contar solo las manchas suficientemente grandes (se ignora areas[0], el fondo).
        return int(np.sum(areas[1:] >= self.min_area))
