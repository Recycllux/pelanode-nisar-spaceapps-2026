"""One neon palette for every map layer (mirrored in web/src/rivernexa/config.ts)."""
import numpy as np

CYAN = (0, 229, 255)      # open water / water kept
YELLOW = (255, 214, 10)   # water under reeds and trees
MAGENTA = (255, 46, 196)  # water lost
LIME = (170, 255, 40)     # water appeared
VIOLET = (110, 40, 255)   # high end of the flood-threshold ramp
# Radar backscatter: night-blue ramp instead of plain grey, so it sits with the neon layers.
RADAR_STOPS = [(0.0, (4, 8, 20)), (0.5, (40, 66, 112)), (1.0, (205, 228, 255))]


def ramp(v, stops):
    """Piecewise-linear colour ramp; v in 0..1 (NaN -> 0)."""
    v = np.nan_to_num(np.clip(v, 0, 1))
    xs = [s[0] for s in stops]
    return np.dstack([np.interp(v, xs, [s[1][i] for s in stops]) for i in range(3)])
