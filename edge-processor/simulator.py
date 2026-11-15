"""Simulador de una cámara de tránsito: genera clips sintéticos con NumPy (sin visión real).

Cada frame es una matriz uint8 (alto x ancho):
- fondo: ruido entre 0 y 29;
- vehículos: rectángulos claros (200-255) de 16x32 px que se mueven por carriles horizontales.
Los vehículos nunca se tocan (separación >= 8 px), así el conteo por manchas es exacto
incluso después de reducir la resolución 2x.
"""
import zlib

import numpy as np

import config

VEHICLE_H = 16        # alto del vehículo en px
VEHICLE_W = 32        # ancho del vehículo en px
GAP = 8               # separación mínima entre vehículos y entre carriles
LANE_PITCH = VEHICLE_H + GAP   # distancia entre el inicio de un carril y el siguiente
MIN_LEVEL = 1
MAX_LEVEL = 12
CONGESTION_PROB = 0.3          # probabilidad de que un clip tenga vehículos detenidos


class CameraSimulator:
    """Estado persistente de una cámara: su nivel de tráfico base y su generador aleatorio."""

    def __init__(self, camera_id, height=None, width=None, frames_per_clip=None):
        self.camera_id = camera_id
        self.height = height or config.FRAME_HEIGHT
        self.width = width or config.FRAME_WIDTH
        self.frames_per_clip = frames_per_clip or config.FRAMES_PER_CLIP

        # Hash estable (crc32, no hash() de Python que cambia entre ejecuciones):
        # la misma cámara siempre tiene el mismo tráfico base, entre 1 y 12 vehículos.
        semilla = zlib.crc32(camera_id.encode())
        self.base_level = semilla % MAX_LEVEL + 1
        self.rng = np.random.default_rng()

        # Carriles que entran en el frame (cada uno empieza en y par, para que
        # la reducción 2x no "parta" los vehículos en altura)
        self.lanes_y = list(range(GAP, self.height - VEHICLE_H + 1, LANE_PITCH))
        # Recorrido horizontal: x va de 0 a track-1 y el vehículo siempre entra completo
        self.track = self.width - VEHICLE_W + 1
        self.max_per_lane = max(1, self.track // (VEHICLE_W + GAP))

        self.last_vehicle_count = 0   # cuántos vehículos tuvo el último clip (útil para probar)

    def _vehicle_count(self):
        """Nivel de tráfico del clip: el base +-2, dentro de lo que entra en pantalla."""
        n = self.base_level + int(self.rng.integers(-2, 3))
        capacidad = len(self.lanes_y) * self.max_per_lane
        return int(min(max(n, MIN_LEVEL), capacidad))

    def _layout(self, n):
        """Ubica n vehículos: reparte por carriles (round robin) y los espacia parejo en cada uno."""
        por_carril = [[] for _ in self.lanes_y]
        for i in range(n):
            por_carril[i % len(self.lanes_y)].append(i)

        vehicles = []   # cada vehículo: [y, x, velocidad, brillo]
        for lane_idx, ids in enumerate(por_carril):
            if not ids:
                continue
            k = len(ids)
            espacio = self.track / k          # >= 40 px porque k <= max_per_lane
            offset = float(self.rng.uniform(0, self.track))
            speed = int(self.rng.integers(4, 13)) * int(self.rng.choice([-1, 1]))
            for j in range(k):
                x = (offset + j * espacio) % self.track
                brillo = int(self.rng.integers(200, 256))
                vehicles.append([self.lanes_y[lane_idx], x, speed, brillo])
        return vehicles

    def generate_clip(self):
        """Devuelve un clip (FRAMES_PER_CLIP, alto, ancho) uint8."""
        n = self._vehicle_count()
        self.last_vehicle_count = n
        vehicles = self._layout(n)

        # En algunos clips hay congestión: los vehículos quedan quietos varios frames
        # seguidos y el fondo se repite, así esos frames son iguales al anterior.
        quietos = set()
        if self.rng.random() < CONGESTION_PROB and self.frames_per_clip > 2:
            inicio = int(self.rng.integers(1, self.frames_per_clip - 1))
            largo = int(self.rng.integers(2, self.frames_per_clip))
            quietos = set(range(inicio, min(inicio + largo, self.frames_per_clip)))

        clip = np.empty((self.frames_per_clip, self.height, self.width), dtype=np.uint8)
        fondo = None
        for f in range(self.frames_per_clip):
            if f in quietos:
                clip[f] = clip[f - 1]        # mismo fondo y mismos vehículos que el anterior
                continue

            if f > 0:   # mover los vehículos (al salir por un borde reaparecen por el otro)
                for v in vehicles:
                    v[1] = (v[1] + v[2]) % self.track

            fondo = self.rng.integers(0, 30, size=(self.height, self.width), dtype=np.uint8)
            frame = fondo.copy()
            for y, x, _, brillo in vehicles:
                x = int(x)
                frame[y:y + VEHICLE_H, x:x + VEHICLE_W] = brillo
            clip[f] = frame
        return clip
