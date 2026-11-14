"""S2: open-water maps from Sentinel-1 (OPERA RTC-S1, C-band) for context and validation.

C-band barely enters reeds, so this maps open water only. Per date: 5x5 mean filter, then Otsu on
VV dB inside the JRC water domain (same domain and sea mask as the NISAR maps), clamped to
[-20, -14] dB, and VH below its own Otsu split. Specks < 6 px removed.
Writes DATA/s1_water/<zone>/<date>.tif (uint8: 0 land, 1 open water, 255 no data) and
data/s1_areas.csv (km2 per zone and date, with the Isaccea level).
"""
import sys
import numpy as np
import pandas as pd
import rasterio
from rasterio.warp import reproject, Resampling
from scipy.ndimage import uniform_filter
from skimage.filters import threshold_otsu
from skimage.morphology import remove_small_objects

from config import DATA, REPO
from zones import ZONES
from f1_water import water_domain, local_mean

RAW = DATA / "s1_raw"
OUT = DATA / "s1_water"


def domain_on(zone, prof):
    with rasterio.open(DATA / "ancillary" / f"{zone}.tif") as a:
        gsw, dem = a.read(4), a.read(3)
        dom, perm, sea = water_domain(gsw, dem)
        out = []
        for arr in (dom, sea):
            d = np.zeros((prof["height"], prof["width"]), np.uint8)
            reproject(arr.astype(np.uint8), d, src_transform=a.transform, src_crs=a.crs,
                      dst_transform=prof["transform"], dst_crs=prof["crs"], resampling=Resampling.nearest)
            out.append(d.astype(bool))
    return out


def classify(vv, vh, dom):
    valid = np.isfinite(vv) & np.isfinite(vh) & (vv > 0) & (vh > 0)
    V = 10 * np.log10(np.clip(local_mean(vv, valid, 5), 1e-6, None))
    H = 10 * np.log10(np.clip(local_mean(vh, valid, 5), 1e-6, None))
    m = valid & dom & np.isfinite(V)
    tv = float(np.clip(threshold_otsu(V[m]), -20, -14))
    th = float(np.clip(threshold_otsu(H[m]), -28, -20))
    ow = m & (V < tv) & (H < th)
    ow = remove_small_objects(ow, max_size=6)
    out = np.zeros(vv.shape, np.uint8); out[ow] = 1; out[~valid] = 255
    return out, tv, th


def main(zones):
    lv = pd.read_csv(REPO / "data" / "river" / "levels_daily.csv", parse_dates=["date"])
    isa = lv[lv.station == "isaccea"].set_index("date").level_cm
    rows = []
    for z in zones:
        files = sorted((RAW / z).glob("*.tif"))
        if not files:
            continue
        with rasterio.open(files[0]) as r:
            prof = r.profile
        dom, sea = domain_on(z, prof)
        (OUT / z).mkdir(parents=True, exist_ok=True)
        for f in files:
            with rasterio.open(f) as r:
                vv, vh = r.read(1), r.read(2)
            c, tv, th = classify(vv, vh, dom)
            p = dict(prof, count=1, dtype="uint8", nodata=255, predictor=1)
            with rasterio.open(OUT / z / f.name, "w", **p) as w:
                w.write(c, 1)
            d = pd.Timestamp(f.stem)
            rows.append(dict(zone=z, date=d.strftime("%Y-%m-%d"), open_water_km2=round(float((c == 1).sum() * 9e-4), 2),
                             valid_frac=round(float((c != 255)[dom].mean()), 3), vv_thr_db=round(tv, 2), vh_thr_db=round(th, 2),
                             isaccea_level_cm=float(isa.get(d, np.nan))))
    df = pd.DataFrame(rows).sort_values(["zone", "date"])
    df.to_csv(REPO / "data" / "s1_areas.csv", index=False)
    print(df.groupby("zone").open_water_km2.describe())


if __name__ == "__main__":
    main(sys.argv[1:] or list(ZONES))
