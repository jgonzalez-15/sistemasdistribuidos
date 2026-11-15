"""Preprocesamiento liviano en el edge: descartar frames sin cambios y reducir resolución."""
import numpy as np

import config


def discard_static(frames, threshold):
    """Conserva el primer frame y cada frame que difiera lo suficiente del último conservado."""
    conservados = [frames[0]]
    for frame in frames[1:]:
        diff = np.mean(np.abs(frame.astype(np.int16) - conservados[-1].astype(np.int16)))
        if diff >= threshold:
            conservados.append(frame)
    return np.stack(conservados)


def downscale(frames, factor):
    """Reduce la resolución promediando bloques de factor x factor píxeles."""
    if factor <= 1:
        return frames
    n, h, w = frames.shape
    h2, w2 = h // factor, w // factor
    recorte = frames[:, :h2 * factor, :w2 * factor]   # por si el tamaño no es múltiplo
    bloques = recorte.reshape(n, h2, factor, w2, factor)
    return bloques.mean(axis=(2, 4)).astype(np.uint8)


def preprocess(frames):
    """Aplica ambos pasos y devuelve el clip final (frames, alto, ancho)."""
    frames = discard_static(frames, config.DIFF_THRESHOLD)
    return downscale(frames, config.DOWNSCALE)
