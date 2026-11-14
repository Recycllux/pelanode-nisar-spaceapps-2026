"""F1/G1: physics seed water maps per zone and date.

1. Quegan multitemporal speckle filter over all dates (HH and HV separately).
2. Water domain: anywhere JRC Global Surface Water saw water 1984-2021, plus 200 m, minus the
   open sea. Outside it, dry harvested fields look as dark as water at L-band (both sit near the
   noise floor), so we never call them water.
3. Open water (OW): per date, the HH/HV level of deep permanent water (JRC >= 95 %, eroded) is
   measured, and pixels within +1.5 dB (HH) and +2 dB (HV) of it are water. This adapts to the
   noise floor and calibration of each date. Wind roughens HH much more than HV, so inside
   permanent water a dark HV alone is enough.
4. Water under vegetation (FV, "water under reeds"): L-band double bounce makes flooded reeds and
   forest bright in HH with a high HH/HV ratio. Only where WorldCover says wetland/tree/shrub and
   HAND < 5 m.
5. Cleanup: drop specks smaller than MIN_PX.
Writes DATA/water/<zone>/<date>.tif (uint8: 0 land, 1 open water, 2 water under vegetation, 255 no data)
and DATA/filtered/<zone>/<date>.tif (HH dB, HV dB, float32) for the app and SAM refinement.
"""
import json
import sys
import numpy as np
import rasterio
from scipy.ndimage import binary_dilation, binary_erosion, label, uniform_filter
from skimage.morphology import remove_small_objects

from config import DATA, RAW
from zones import ZONES

PARAMS = dict(win=7, domain_buffer_px=10, perm_occ=95, perm_erode_px=5, ow_dh=1.5, ow_dv=2.0, wind_dv=1.5,
              wind_hh_max=-8.0, fv_hh_db=-7.0, fv_ratio_db=5.0, fv_classes=(10, 20, 90, 95), fv_hand=5.0,
              min_px=6)
NODATA = 255


def dates_for(zone):
    return sorted(p.stem for p in (RAW / zone).glob("*.tif"))


def load_stack(zone, dates):
    hh, hv, va = [], [], []
    for d in dates:
        with rasterio.open(RAW / zone / f"{d}.tif") as r:
            hh.append(r.read(1)); hv.append(r.read(2)); va.append(r.read(3) > 0)
            prof = r.profile
    return np.stack(hh), np.stack(hv), np.stack(va), prof


def local_mean(img, valid, win):
    num = uniform_filter(np.where(valid, img, 0).astype(np.float32), win)
    den = uniform_filter(valid.astype(np.float32), win)
    return np.where(den > 0.2, num / np.maximum(den, 1e-6), np.nan)


def quegan(stack, valid, win):
    """J_t = E[I_t] / N * sum_k I_k / E[I_k]   (Quegan & Yu 2001)."""
    means = np.stack([local_mean(stack[t], valid[t], win) for t in range(len(stack))])
    ratio = np.where(valid, stack / means, np.nan)
    s = np.nansum(ratio, axis=0); n = np.sum(valid & np.isfinite(ratio), axis=0)
    return means * (s / np.maximum(n, 1))[None]


def to_db(x):
    return 10 * np.log10(np.clip(x, 1e-5, None))


def water_domain(gsw, dem, p=PARAMS):
    dom = binary_dilation(gsw > 0, iterations=p["domain_buffer_px"])
    lab, _ = label(gsw >= p["perm_occ"])
    edge = np.unique(lab[:, -1]); edge = edge[edge > 0]
    sea = np.isin(lab, edge) & (dem <= 1)  # permanent water touching the east edge at sea level
    perm = binary_erosion(gsw >= p["perm_occ"], iterations=p["perm_erode_px"]) & ~sea
    return dom & ~sea, perm, sea


def classify(hh_db, hv_db, valid, wc, hand, dom, perm, p=PARAMS):
    ref_h, ref_v = float(np.nanmedian(hh_db[perm & valid])), float(np.nanmedian(hv_db[perm & valid]))
    ok = valid & dom & np.isfinite(hh_db)
    ow = ok & (((hh_db < ref_h + p["ow_dh"]) & (hv_db < ref_v + p["ow_dv"]))
               | (perm & (hv_db < ref_v + p["wind_dv"]) & (hh_db < p["wind_hh_max"])))
    fv_zone = valid & np.isin(wc, p["fv_classes"]) & (hand < p["fv_hand"])
    fv = fv_zone & (hh_db > p["fv_hh_db"]) & ((hh_db - hv_db) > p["fv_ratio_db"]) & ~ow
    ow = remove_small_objects(ow, max_size=p["min_px"]); fv = remove_small_objects(fv, max_size=p["min_px"])
    out = np.zeros(hh_db.shape, np.uint8); out[ow] = 1; out[fv] = 2; out[~valid] = NODATA
    return out, {"ref_water_hh_db": round(ref_h, 2), "ref_water_hv_db": round(ref_v, 2)}


def run_zone(zone):
    dates = dates_for(zone)
    hh, hv, va, prof = load_stack(zone, dates)
    with rasterio.open(DATA / "ancillary" / f"{zone}.tif") as a:
        wc, hand, dem, gsw = a.read(1), a.read(2), a.read(3), a.read(4)
    hand = np.where(hand < -1000, 999, hand)
    dom, perm, sea = water_domain(gsw, dem)
    hhf, hvf = to_db(quegan(hh, va, PARAMS["win"])), to_db(quegan(hv, va, PARAMS["win"]))
    del hh, hv
    (DATA / "water" / zone).mkdir(parents=True, exist_ok=True)
    (DATA / "filtered" / zone).mkdir(parents=True, exist_ok=True)
    stats = {}
    for i, d in enumerate(dates):
        cls, th = classify(hhf[i], hvf[i], va[i], wc, hand, dom, perm)
        p = dict(prof, count=1, dtype="uint8", nodata=NODATA, compress="deflate", tiled=True)
        with rasterio.open(DATA / "water" / zone / f"{d}.tif", "w", **p) as w:
            w.write(cls, 1); w.update_tags(date=d, **{k: str(v) for k, v in th.items()})
        p = dict(prof, count=2, dtype="float32", nodata=np.nan, compress="deflate", tiled=True, predictor=3)
        with rasterio.open(DATA / "filtered" / zone / f"{d}.tif", "w", **p) as w:
            w.write(np.where(va[i], hhf[i], np.nan).astype(np.float32), 1)
            w.write(np.where(va[i], hvf[i], np.nan).astype(np.float32), 2)
        px = (prof["transform"].a ** 2) / 1e6
        stats[d] = dict(th, ow_km2=round(float((cls == 1).sum() * px), 2),
                        fv_km2=round(float((cls == 2).sum() * px), 2),
                        valid_km2=round(float(va[i].sum() * px), 2))
        print(zone, d, stats[d], flush=True)
    return stats


if __name__ == "__main__":
    zones = sys.argv[1:] or list(ZONES)
    allstats = {z: run_zone(z) for z in zones}
    (DATA / "water").mkdir(parents=True, exist_ok=True)
    json.dump({"params": PARAMS, "stats": allstats}, open(DATA / "water" / "seed_stats.json", "w"), indent=1)
