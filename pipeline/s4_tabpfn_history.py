"""S4: TabPFN-3.5 trained on ten years of Sentinel-1 open water in the Delta (Future layer support).

Unit: 510 m cell (17 x 17 px at 30 m) that held open water on at least one date.
Sample: one transition t -> next S1 date (6-12 days) within the same Jun-Nov season.
Features at t: open-water fraction at t and at the previous date, Isaccea level at t and its change
over 12 days, day of year, days ahead, JRC occurrence. Nothing from t+1.
Validation (time-blocked): train 2016-2024, test 2025 and 2026 separately. Baselines: persistence and
gradient boosting. Writes docs/data/s1_forecast.json.
"""
import json
import numpy as np
import pandas as pd
import rasterio
from rasterio.warp import reproject, Resampling
from sklearn.ensemble import HistGradientBoostingRegressor
from tabpfn_client import TabPFNRegressor, set_access_token

from config import DATA, REPO
from k1_change_probes import levels

B = 17
FEATS = ["f", "f_prev", "lvl", "dlvl12", "doy", "days_ahead", "gsw"]
OUT = REPO / "docs" / "data"


def block(a):
    h, w = (a.shape[0] // B) * B, (a.shape[1] // B) * B
    return a[:h, :w].reshape(h // B, B, w // B, B).mean(axis=(1, 3))


def table(lv):
    files = sorted((DATA / "s1_water" / "delta").glob("*.tif"))
    with rasterio.open(files[0]) as r:
        prof = r.profile
    with rasterio.open(DATA / "ancillary" / "delta.tif") as a:
        g = np.zeros((prof["height"], prof["width"]), np.float32)
        reproject(a.read(4), g, src_transform=a.transform, src_crs=a.crs, dst_transform=prof["transform"],
                  dst_crs=prof["crs"], resampling=Resampling.average)
    gsw = block(g).ravel()
    rows = []
    for f in files:
        with rasterio.open(f) as r:
            c = r.read(1)
        valid = block((c != 255).astype(float)).ravel()
        frac = block((c == 1).astype(float)).ravel()
        d = pd.Timestamp(f.stem)
        rows.append(pd.DataFrame(dict(cell=np.arange(len(frac)), date=d, f=frac, valid=valid, gsw=gsw)))
    t = pd.concat(rows)
    t = t[t.valid > 0.9]
    t["year"] = t.date.dt.year
    keep = t.groupby("cell").f.max() > 0.05
    t = t[t.cell.isin(keep[keep].index)].sort_values(["cell", "date"])
    g = t.groupby(["cell", "year"])
    t["f_prev"] = g.f.shift(1); t["f_prev"] = t.f_prev.fillna(t.f)
    t["y"] = g.f.shift(-1); t["date_next"] = g.date.shift(-1)
    t["lvl"] = t.date.map(lambda d: lv.get(d, np.nan))
    t["dlvl12"] = t.date.map(lambda d: lv.get(d, np.nan) - lv.get(d - pd.Timedelta(days=12), np.nan))
    t["doy"] = t.date.dt.dayofyear
    t["days_ahead"] = (t.date_next - t.date).dt.days
    return t


def main():
    set_access_token("dummy")
    lv = levels()
    t = table(lv).dropna(subset=["lvl", "dlvl12"])
    s = t.dropna(subset=["y"])
    tr = s[s.year <= 2024]
    trs = tr.sample(min(9000, len(tr)), random_state=0)
    res = dict(n_cells=int(t.cell.nunique()), n_train_all=int(len(tr)), n_train_used=int(len(trs)), years_train="2016-2024")
    hgb = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, random_state=0).fit(tr[FEATS], tr.y)
    pfn = TabPFNRegressor(model_path="v3.5_default", random_state=0).fit(trs[FEATS], trs.y)
    res["tests"] = {}
    for yr in (2025, 2026):
        te = s[s.year == yr]
        if te.empty:
            continue
        preds = dict(persistence=te.f.values, gradient_boosting=np.clip(hgb.predict(te[FEATS]), 0, 1),
                     **{"tabpfn_3.5": np.clip(np.concatenate([pfn.predict(te[FEATS].iloc[i:i + 10000]) for i in range(0, len(te), 10000)]), 0, 1)})
        m = {}
        for k, p in preds.items():
            e = p - te.y.values
            per = pd.DataFrame(dict(d=te.date_next.values, p=p * 0.2601, y=te.y.values * 0.2601)).groupby("d").sum()
            m[k] = dict(cell_mae=round(float(np.abs(e).mean()), 4), area_mae_km2=round(float((per.p - per.y).abs().mean()), 1))
        res["tests"][str(yr)] = dict(n=int(len(te)), metrics=m)
    json.dump(res, open(OUT / "s1_forecast.json", "w"), indent=1)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
