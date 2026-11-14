"""S3: what Sentinel-1 adds.

1. Validation: NISAR open water vs Sentinel-1 open water on the closest S1 date (<= 3 days),
   inside the water domain at 30 m: areas, agreement (IoU), and both against the river level.
2. History: Delta open-water area each Jun-Nov 2016-2026 and the Isaccea level on those dates,
   so 2026 can be ranked against the previous ten years (2022 was the last big drought).
   Windy dates (open water far below the running median) are flagged and left out of the ranking.
Writes docs/data/s1.json.
"""
import json
import numpy as np
import pandas as pd
import rasterio
from rasterio.warp import reproject, Resampling

from config import DATA, REPO
from g1_products import water_path
from s2_water import domain_on

OUT = REPO / "docs" / "data"


def validation(s1):
    rows = []
    for z in s1.zone.unique():
        s1d = pd.to_datetime(s1[s1.zone == z].date)
        for f in sorted((DATA / "water" / z).glob("2026*.tif")):
            d = pd.Timestamp(f.stem)
            gap = (s1d - d).abs()
            if gap.min() > pd.Timedelta(days=3):
                continue
            sd = s1d[gap.idxmin()]
            with rasterio.open(DATA / "s1_water" / z / f"{sd:%Y%m%d}.tif") as r:
                s, prof = r.read(1), r.profile
            n = np.full(s.shape, 255, np.uint8)
            with rasterio.open(water_path(z, f.stem)) as r:
                reproject(r.read(1), n, src_transform=r.transform, src_crs=r.crs, dst_transform=prof["transform"],
                          dst_crs=prof["crs"], resampling=Resampling.mode, src_nodata=255, dst_nodata=255)
            dom, _ = domain_on(z, prof)
            ok = dom & (s != 255) & (n != 255)
            a, b = ok & (n == 1), ok & (s == 1)
            rows.append(dict(zone=z, nisar_date=d.strftime("%Y-%m-%d"), s1_date=sd.strftime("%Y-%m-%d"),
                             days_apart=int(gap.min().days), nisar_open_km2=round(float(a.sum() * 9e-4), 1),
                             s1_open_km2=round(float(b.sum() * 9e-4), 1),
                             iou=round(float((a & b).sum() / max((a | b).sum(), 1)), 3)))
    return pd.DataFrame(rows)


def main():
    s1 = pd.read_csv(REPO / "data" / "s1_areas.csv").sort_values(["zone", "date"])
    # C-band open water collapses on windy dates (rough lakes look like land): flag dates far below
    # the running median of their zone, or where the VV split hit the clamp
    med = s1.groupby("zone").open_water_km2.transform(lambda x: x.rolling(7, center=True, min_periods=3).median())
    s1["flag_wind"] = (s1.open_water_km2 < 0.85 * med) | (s1.vv_thr_db >= -14.0)
    v = validation(s1[~s1.flag_wind])
    print(v.to_string())
    d = s1[(s1.zone == "delta") & ~s1.flag_wind].copy(); d["date"] = pd.to_datetime(d.date); d["year"] = d.date.dt.year
    yr = d.groupby("year").agg(min_km2=("open_water_km2", "min"), median_km2=("open_water_km2", "median"),
                               min_level_cm=("isaccea_level_cm", "min"), n=("date", "size")).round(1)
    print(yr.to_string())
    out = dict(
        track="036", source="NASA OPERA RTC-S1 (Sentinel-1, C-band, 30 m)",
        series={z: dict(dates=g.date.tolist(), open_water_km2=g.open_water_km2.tolist(), level_cm=g.isaccea_level_cm.tolist(),
                         flag_wind=g.flag_wind.astype(bool).tolist())
                for z, g in s1.sort_values("date").groupby("zone")},
        years={int(y): r.to_dict() for y, r in yr.iterrows()},
        validation=v.to_dict(orient="records"),
        flagged_dates=int(s1.flag_wind.sum()),
        validation_summary=dict(median_iou=round(float(v.iou.median()), 3) if len(v) else None,
                                pairs=int(len(v))))
    json.dump(out, open(OUT / "s1.json", "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
