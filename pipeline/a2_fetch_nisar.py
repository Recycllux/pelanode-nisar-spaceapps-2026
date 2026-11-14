"""Step A2: for every date in the manifest, read only our three zones from the
NISAR GCOV granules (HTTP range reads, no full download), mosaic frames 065+066
onto one fixed 20 m UTM-35N grid per zone, and save a GeoTIFF per zone/date:
band 1 = HH gamma0 (linear), band 2 = HV gamma0 (linear), band 3 = valid mask."""
import csv
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import h5py
import numpy as np
import rasterio
from rasterio.transform import from_origin

from config import MANIFEST, RAW, PIXEL
from remote_h5 import HTTPRangeFile
from zones import ZONES, utm_bounds

GRID = "science/LSAR/GCOV/grids/frequencyA"


def zone_grid(zone):
    """Fixed grid snapped so pixel centres sit at 10 m offsets, like NISAR's grid."""
    xmin, ymin, xmax, ymax = utm_bounds(zone)
    left = np.floor(xmin / PIXEL) * PIXEL
    top = np.ceil(ymax / PIXEL) * PIXEL
    nx = int(np.ceil((xmax - left) / PIXEL))
    ny = int(np.ceil((top - ymin) / PIXEL))
    return left, top, nx, ny


def read_granule_into(url, zone_arrays):
    f = HTTPRangeFile(url)
    with h5py.File(f, "r") as h:
        g = h[GRID]
        x = g["xCoordinates"][:]
        y = g["yCoordinates"][:]
        has_hv = "HVHV" in g
        for zone, (left, top, nx, ny, hh_out, hv_out, ok_out) in zone_arrays.items():
            # grid pixel centres of the zone
            zx = left + PIXEL / 2 + PIXEL * np.arange(nx)
            zy = top - PIXEL / 2 - PIXEL * np.arange(ny)
            ci = np.round((zx - x[0]) / PIXEL).astype(int)
            ri = np.round((y[0] - zy) / PIXEL).astype(int)
            cin = (ci >= 0) & (ci < len(x))
            rin = (ri >= 0) & (ri < len(y))
            if not cin.any() or not rin.any():
                continue
            c0, c1 = ci[cin].min(), ci[cin].max() + 1
            r0, r1 = ri[rin].min(), ri[rin].max() + 1
            hh = g["HHHH"][r0:r1, c0:c1]
            hv = g["HVHV"][r0:r1, c0:c1] if has_hv else np.full_like(hh, np.nan)
            m = g["mask"][r0:r1, c0:c1]
            zr = np.where(rin)[0]
            zc = np.where(cin)[0]
            sub_hh = hh[np.ix_(ri[zr] - r0, ci[zc] - c0)]
            sub_hv = hv[np.ix_(ri[zr] - r0, ci[zc] - c0)]
            sub_m = m[np.ix_(ri[zr] - r0, ci[zc] - c0)]
            # NISAR mask: 0 = invalid, 255 = fill; anything else is valid data
            valid = np.isfinite(sub_hh) & (sub_hh > 0) & (sub_m != 0) & (sub_m != 255)
            tgt = np.ix_(zr, zc)
            take = valid & ~ok_out[tgt]
            hh_out[tgt] = np.where(take, sub_hh, hh_out[tgt])
            hv_out[tgt] = np.where(take, sub_hv, hv_out[tgt])
            ok_out[tgt] |= valid
    return f.bytes_fetched


def process_date(date, granules):
    t = time.time()
    arrays = {}
    for zone in ZONES:
        left, top, nx, ny = zone_grid(zone)
        arrays[zone] = (left, top, nx, ny, np.full((ny, nx), np.nan, np.float32),
                        np.full((ny, nx), np.nan, np.float32), np.zeros((ny, nx), bool))
    mb = 0
    for gr in granules:
        mb += read_granule_into(gr["url"], arrays) / 1e6
    out = []
    for zone, (left, top, nx, ny, hh, hv, ok) in arrays.items():
        d = RAW / zone
        d.mkdir(parents=True, exist_ok=True)
        path = d / f"{date}.tif"
        with rasterio.open(path, "w", driver="GTiff", width=nx, height=ny, count=3, dtype="float32",
                           crs="EPSG:32635", transform=from_origin(left, top, PIXEL, PIXEL),
                           compress="deflate", predictor=3, tiled=True, nodata=np.nan) as dst:
            dst.write(hh, 1)
            dst.write(hv, 2)
            dst.write(ok.astype(np.float32), 3)
            dst.update_tags(date=date, polarization=granules[0]["polarization"],
                            status=granules[0]["status"], granules=";".join(g["granule"] for g in granules))
        out.append(f"{zone}:{100 * ok.mean():.1f}%")
    return f"{date} {' '.join(out)} {mb:.0f} MB {time.time() - t:.0f}s"


if __name__ == "__main__":
    only = set(sys.argv[1:])
    by_date = defaultdict(list)
    with open(MANIFEST) as f:
        for r in csv.DictReader(f):
            if not only or r["date"] in only:
                by_date[r["date"]].append(r)
    with ThreadPoolExecutor(max_workers=3) as ex:
        for line in ex.map(lambda kv: process_date(*kv), sorted(by_date.items())):
            print(line, flush=True)
