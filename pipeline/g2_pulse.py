"""G2: 'Water pulse' layer for the app: 500 m cells with their water share on every NISAR date.

Reads cells.parquet (K1) and writes docs/data/pulse.json:
  {dates:[...], zones:{zone:{east:[dlon,dlat], north:[dlon,dlat], cells:[[lon,lat,t0..tN,v0..vN],...]}}}
t = total water share (open + under vegetation), v = water under vegetation share, both in percent.
east/north are the lon/lat offsets of half a cell (250 m) along the UTM 35N grid axes, so the app can
draw each cell as a square without storing its corners. Cells that never hold more than 5 % water are
left out to keep the file small.
"""
import json
import numpy as np
import pandas as pd
from pyproj import Transformer

from config import DATA, REPO

OUT = REPO / "docs" / "data" / "pulse.json"
HALF = 250.0  # m, half of a 500 m cell
MIN_MAX_SHARE = 0.05


def half_cell_vectors(lon, lat):
    to_utm = Transformer.from_crs(4326, 32635, always_xy=True)
    to_ll = Transformer.from_crs(32635, 4326, always_xy=True)
    x, y = to_utm.transform(lon, lat)
    e = np.subtract(to_ll.transform(x + HALF, y), (lon, lat))
    n = np.subtract(to_ll.transform(x, y + HALF), (lon, lat))
    return [round(float(v), 7) for v in e], [round(float(v), 7) for v in n]


def build(cells: pd.DataFrame) -> dict:
    dates = sorted(cells.date.dt.strftime("%Y%m%d").unique())
    out = {"dates": dates, "cell_m": 2 * HALF, "zones": {}}
    for zone, d in cells.groupby("zone"):
        d = d.assign(key=d.date.dt.strftime("%Y%m%d"))
        t = d.pivot_table(index="cell", columns="key", values="f_tot").reindex(columns=dates)
        v = d.pivot_table(index="cell", columns="key", values="f_fv").reindex(columns=dates)
        ll = d.groupby("cell")[["lon", "lat"]].first()
        keep = t.max(axis=1) > MIN_MAX_SHARE
        t, v, ll = t[keep], v[keep], ll[keep]
        east, north = half_cell_vectors(float(ll.lon.mean()), float(ll.lat.mean()))
        tt = np.rint(t.to_numpy() * 100).astype(int)
        vv = np.rint(v.to_numpy() * 100).astype(int)
        rows = [[round(float(lo), 5), round(float(la), 5), *map(int, a), *map(int, b)]
                for lo, la, a, b in zip(ll.lon, ll.lat, tt, vv)]
        out["zones"][zone] = {"east": east, "north": north, "cells": rows}
    return out


def main():
    cells = pd.read_parquet(DATA / "cells.parquet")
    data = build(cells)
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    for z, v in data["zones"].items():
        print(z, len(v["cells"]), "cells")
    print(OUT, round(OUT.stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
