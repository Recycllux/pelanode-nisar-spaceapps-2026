"""Study zones for RiverNexa (WGS84 lon/lat boxes) and helpers to map them
onto a NISAR GCOV grid (UTM 35N, 20 m)."""
from pyproj import Transformer

ZONES = {
    # name: (lon_min, lat_min, lon_max, lat_max)
    "delta": (28.60, 44.80, 29.75, 45.45),
    "cernavoda": (27.95, 44.25, 28.15, 44.42),
    "balta_mica_brailei": (27.85, 44.85, 28.10, 45.30),
}

_to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32635", always_xy=True)


def utm_bounds(zone):
    lon0, lat0, lon1, lat1 = ZONES[zone]
    xs, ys = [], []
    for lon in (lon0, lon1):
        for lat in (lat0, lat1):
            x, y = _to_utm.transform(lon, lat)
            xs.append(x)
            ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def pixel_window(zone, x0, dx, y0, dy, nx, ny):
    """Return (row0, row1, col0, col1) of the zone inside a grid whose first pixel
    centre is (x0, y0) with spacing dx (>0) and dy (<0). Clipped to the grid."""
    xmin, ymin, xmax, ymax = utm_bounds(zone)
    c0 = max(0, int((xmin - x0) / dx))
    c1 = min(nx, int((xmax - x0) / dx) + 1)
    r0 = max(0, int((ymax - y0) / dy))
    r1 = min(ny, int((ymin - y0) / dy) + 1)
    return r0, r1, c0, c1
