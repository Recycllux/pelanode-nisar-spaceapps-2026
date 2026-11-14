"""G1: web products for the app (docs/data/), from the water maps and filtered backscatter.

Per zone, everything is warped to Web Mercator (EPSG:3857) so MapLibre can drape it as an image:
  <zone>/<date>_class.png   water classes (transparent land, blue open water, green water under vegetation)
  <zone>/<date>_hh.webp, _hv.webp  filtered backscatter, grey scale -22..-2 dB (HH) / -24..-8 dB (HV)
  <zone>/lost.png           before vs driest: red = water lost, blue = water kept, green = gained
  <zone>/composite.webp      radar colour composite: R = before HH, G = B = driest HH
Tables: areas.csv (km2 per zone and date, with river levels), manifest.json (bounds, dates, labels).
Water maps come from SAM 2.1 refinement when present, otherwise from the physics seed.
"""
import json
import numpy as np
import pandas as pd
import rasterio
from PIL import Image
from rasterio.warp import calculate_default_transform, reproject, Resampling, transform_bounds

from config import DATA, REPO
from zones import ZONES

OUT = REPO / "docs" / "data"
WEB_RES = {"delta": 40.0, "cernavoda": 20.0, "balta_mica_brailei": 30.0}     # water classes
RADAR_RES = {"delta": 60.0, "cernavoda": 20.0, "balta_mica_brailei": 40.0}   # HH/HV backdrops (WebP)
PAIRS = {  # before, after for the lost-water layer and composite
    "delta": ("20260618", "20261016"),
    "balta_mica_brailei": ("20260618", "20261016"),
    "cernavoda": ("20260724", "20260817"),
}
GAUGE = {"delta": "isaccea", "balta_mica_brailei": "braila", "cernavoda": "cernavoda"}
STATUS = {"20261028": "Validated"}  # all other dates are Provisional


def water_path(zone, date):
    p = DATA / "water_sam" / zone / f"{date}.tif"
    return p if p.exists() else DATA / "water" / zone / f"{date}.tif"


def to_mercator(src_path, band, res, resampling, nodata):
    with rasterio.open(src_path) as src:
        tr, w, h = calculate_default_transform(src.crs, "EPSG:3857", src.width, src.height, *src.bounds, resolution=res)
        dst = np.full((h, w), nodata, dtype=np.float32)
        reproject(rasterio.band(src, band), dst, dst_transform=tr, dst_crs="EPSG:3857",
                  resampling=resampling, src_nodata=src.nodata, dst_nodata=nodata)
        b = rasterio.transform.array_bounds(h, w, tr)
        lonlat = transform_bounds("EPSG:3857", "EPSG:4326", *b)
    return dst, lonlat


def grey(db, lo, hi):
    v = np.clip((db - lo) / (hi - lo), 0, 1)
    a = np.where(np.isfinite(db), 255, 0).astype(np.uint8)
    g = (np.nan_to_num(v) * 255).astype(np.uint8)
    return np.dstack([g, g, g, a])


def save(rgba, path):
    """Photo-like layers as lossy WebP with alpha; class layers as small palette PNGs."""
    if path.suffix == ".webp":
        Image.fromarray(rgba, "RGBA").save(path, quality=75, method=4)
        return
    flat = rgba.reshape(-1, 4)
    cols, idx = np.unique(flat, axis=0, return_inverse=True)
    assert len(cols) <= 256
    im = Image.fromarray(idx.reshape(rgba.shape[:2]).astype(np.uint8), "P")
    im.putpalette(cols[:, :3].ravel().tolist())
    im.save(path, transparency=bytes(cols[:, 3].tolist()))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    levels = pd.read_csv(REPO / "data" / "river" / "levels_daily.csv", parse_dates=["date"])
    rows, manifest = [], {"zones": {}, "labels": {"water": "Real", "probes": "Simulated", "forecast": "Future"}}
    for z in ZONES:
        dates = sorted(p.stem for p in (DATA / "water" / z).glob("2026*.tif"))
        res = WEB_RES[z]
        (OUT / z).mkdir(exist_ok=True)
        cls_m = {}
        for d in dates:
            c, bounds = to_mercator(water_path(z, d), 1, res, Resampling.nearest, 255)
            cls_m[d] = c
            rgba = np.zeros(c.shape + (4,), np.uint8)
            rgba[c == 1] = [37, 99, 235, 220]; rgba[c == 2] = [22, 163, 74, 220]
            save(rgba, OUT / z / f"{d}_class.png")
            hh, rb = to_mercator(DATA / "filtered" / z / f"{d}.tif", 1, RADAR_RES[z], Resampling.average, np.nan)
            hv, _ = to_mercator(DATA / "filtered" / z / f"{d}.tif", 2, RADAR_RES[z], Resampling.average, np.nan)
            save(grey(hh, -22, -2), OUT / z / f"{d}_hh.webp"); save(grey(hv, -24, -8), OUT / z / f"{d}_hv.webp")
            with rasterio.open(water_path(z, d)) as r:
                a = r.read(1); px = r.transform.a ** 2 / 1e6
            g = levels[(levels.station == GAUGE[z]) & (levels.date == d)].level_cm
            isa = levels[(levels.station == "isaccea") & (levels.date == d)].level_cm
            rows.append(dict(zone=z, date=f"{d[:4]}-{d[4:6]}-{d[6:]}", status=STATUS.get(d, "Provisional"),
                             open_water_km2=round(float((a == 1).sum() * px), 2),
                             under_vegetation_km2=round(float((a == 2).sum() * px), 2),
                             total_water_km2=round(float(((a == 1) | (a == 2)).sum() * px), 2),
                             gauge=GAUGE[z], gauge_level_cm=int(g.iloc[0]) if len(g) else None,
                             isaccea_level_cm=int(isa.iloc[0]) if len(isa) else None))
        b, a_ = PAIRS[z]
        wb, wa = np.isin(cls_m[b], [1, 2]), np.isin(cls_m[a_], [1, 2])
        lost = np.zeros(wb.shape + (4,), np.uint8)
        lost[wb & ~wa] = [220, 38, 38, 235]; lost[wb & wa] = [37, 99, 235, 150]; lost[~wb & wa] = [22, 163, 74, 200]
        save(lost, OUT / z / "lost.png")
        hb, _ = to_mercator(DATA / "filtered" / z / f"{b}.tif", 1, res, Resampling.average, np.nan)
        ha, _ = to_mercator(DATA / "filtered" / z / f"{a_}.tif", 1, res, Resampling.average, np.nan)
        n = lambda x: (np.nan_to_num(np.clip((x + 20) / 18, 0, 1)) * 255).astype(np.uint8)
        comp = np.dstack([n(hb), n(ha), n(ha), np.where(np.isfinite(hb), 255, 0).astype(np.uint8)])
        save(comp, OUT / z / "composite.webp")
        w, s, e, nn = bounds
        manifest["zones"][z] = dict(
            dates=dates, before=b, after=a_, gauge=GAUGE[z], bbox=ZONES[z],
            coordinates=[[w, nn], [e, nn], [e, s], [w, s]],
            radar_coordinates=[[rb[0], rb[3]], [rb[2], rb[3]], [rb[2], rb[1]], [rb[0], rb[1]]],
            status={d: STATUS.get(d, "Provisional") for d in dates},
            refined_with_sam=all((DATA / "water_sam" / z / f"{d}.tif").exists() for d in dates))
        print(z, "done", bounds, flush=True)
    pd.DataFrame(rows).to_csv(OUT / "areas.csv", index=False)
    json.dump(manifest, open(OUT / "manifest.json", "w"), indent=1)


if __name__ == "__main__":
    main()
