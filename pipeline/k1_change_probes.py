"""K1: change cells, flooding-threshold map, lag analysis and proposed probe sites.

- cells.parquet: every 500 m cell (25 x 25 px) x date with open-water, under-vegetation and total
  water fractions plus static descriptors (HAND, JRC occurrence, WorldCover shares). Input to K2.
- Flooding threshold (per 20 m pixel, Delta): the Isaccea level above which the pixel is wet.
  Taken as the midpoint between the highest level at which it was dry and the lowest level at which
  it was wet, kept only where wet/dry separate cleanly by level (rank AUC >= 0.9).
  -> docs/data/delta/flood_threshold.png (+ legend values in manifest_extra.json)
- Lag: Spearman correlation of Delta water area with the Isaccea level shifted 0-45 days earlier.
- Probe sites (Simulated): cells that lost the largest water fraction between the before and driest
  dates, at least 4 km apart; in the Delta only reed/forest cells that are not permanent open water
  (wind can make a lagoon look dry) and not on the zone edge. -> docs/data/probes.json
"""
import json
import numpy as np
import pandas as pd
import rasterio
from PIL import Image
from rasterio.warp import transform as warp_xy
from scipy.stats import spearmanr

from config import DATA, REPO
from zones import ZONES
from g1_products import PAIRS, water_path, to_mercator, save, WEB_RES
from rasterio.warp import Resampling

CELL = 25  # px -> 500 m
OUT = REPO / "docs" / "data"


def levels(station="isaccea"):
    lv = pd.read_csv(REPO / "data" / "river" / "levels_daily.csv", parse_dates=["date"])
    return lv[lv.station == station].set_index("date").level_cm.asfreq("D").interpolate()


def block(a, f):
    h, w = (a.shape[0] // f) * f, (a.shape[1] // f) * f
    return a[:h, :w].reshape(h // f, f, w // f, f).mean(axis=(1, 3))


def cells_table():
    rows = []
    for z in ZONES:
        dates = sorted(p.stem for p in (DATA / "water" / z).glob("2026*.tif"))
        with rasterio.open(DATA / "ancillary" / f"{z}.tif") as a:
            wc, hand, gsw = a.read(1), a.read(2), a.read(4)
            tr = a.transform
        hand = np.where(hand < -1000, np.nan, hand)
        stat = dict(hand_m=block(np.nan_to_num(hand, nan=50), CELL), gsw_occ=block(gsw, CELL),
                    wc_wetland=block((wc == 90).astype(float), CELL), wc_water=block((wc == 80).astype(float), CELL),
                    wc_tree=block((wc == 10).astype(float), CELL), wc_crop=block((wc == 40).astype(float), CELL))
        ny, nx = stat["hand_m"].shape
        jj, ii = np.meshgrid(np.arange(nx), np.arange(ny))
        xs = tr.c + (jj + 0.5) * CELL * tr.a; ys = tr.f + (ii + 0.5) * CELL * tr.e
        lon, lat = warp_xy("EPSG:32635", "EPSG:4326", xs.ravel(), ys.ravel())
        base = pd.DataFrame({k: v.ravel() for k, v in stat.items()})
        base["zone"] = z; base["cell"] = np.arange(base.shape[0]); base["lon"] = lon; base["lat"] = lat
        for d in dates:
            with rasterio.open(water_path(z, d)) as r:
                c = r.read(1)
            valid = block((c != 255).astype(float), CELL)
            df = base.copy(); df["date"] = pd.Timestamp(d)
            df["f_ow"] = block((c == 1).astype(float), CELL).ravel()
            df["f_fv"] = block((c == 2).astype(float), CELL).ravel()
            df["valid"] = valid.ravel()
            rows.append(df)
    t = pd.concat(rows, ignore_index=True)
    t = t[t.valid > 0.9]
    t["f_tot"] = t.f_ow + t.f_fv
    t.to_parquet(DATA / "cells.parquet")
    return t


def flood_threshold(lv):
    z = "delta"
    dates = sorted(p.stem for p in (DATA / "water" / z).glob("2026*.tif"))
    L = np.array([lv[pd.Timestamp(d)] for d in dates], float)
    W = np.stack([np.isin(rasterio.open(water_path(z, d)).read(1), [1, 2]) for d in dates])
    prof = rasterio.open(water_path(z, dates[0])).profile
    nwet = W.sum(0)
    changing = (nwet > 0) & (nwet < len(dates))
    order = np.argsort(L)
    Ls, Ws = L[order], W[order]
    # rank AUC: P(level when wet > level when dry), via Mann-Whitney on ranks
    ranks = np.argsort(np.argsort(Ls)) + 1.0
    rsum_wet = np.tensordot(ranks, Ws.astype(float), axes=1)
    n1 = nwet.astype(float); n0 = len(dates) - n1
    auc = np.where(changing, (rsum_wet - n1 * (n1 + 1) / 2) / np.maximum(n1 * n0, 1), np.nan)
    hi_dry = np.max(np.where(~Ws, Ls[:, None, None], -1e9), axis=0)
    lo_wet = np.min(np.where(Ws, Ls[:, None, None], 1e9), axis=0)
    thr = np.where(changing & (auc >= 0.9), (hi_dry + lo_wet) / 2, np.nan).astype(np.float32)
    p = dict(prof, dtype="float32", nodata=np.nan, count=1)
    (DATA / "k1").mkdir(exist_ok=True)
    with rasterio.open(DATA / "k1" / "delta_flood_threshold.tif", "w", **p) as w:
        w.write(thr, 1)
    m, _ = to_mercator(DATA / "k1" / "delta_flood_threshold.tif", 1, WEB_RES[z], Resampling.nearest, np.nan)
    lo, hi = 0.0, 100.0
    v = np.clip((m - lo) / (hi - lo), 0, 1)
    # light yellow (wet even at low water) -> deep purple (needs high water)
    c0, c1 = np.array([253, 231, 37]), np.array([68, 1, 84])
    rgb = (c0[None, None] * (1 - v[..., None]) + c1[None, None] * v[..., None])
    rgba = np.dstack([np.nan_to_num(rgb), np.where(np.isfinite(m), 230, 0)]).astype(np.uint8)
    q = np.round(rgba / 16) * 16  # quantise to keep the palette PNG small
    save(np.clip(q, 0, 255).astype(np.uint8), OUT / z / "flood_threshold.png")
    ok = np.isfinite(thr)
    return dict(km2=round(float(ok.sum() * 4e-4), 1), median_cm=round(float(np.nanmedian(thr)), 1),
                p10_cm=round(float(np.nanpercentile(thr, 10)), 1), p90_cm=round(float(np.nanpercentile(thr, 90)), 1),
                legend_cm=[lo, hi])


def lag_analysis(t, lv):
    a = t[t.zone == "delta"].groupby("date").apply(lambda g: (g.f_tot * 0.25).sum(), include_groups=False)
    v = t[t.zone == "delta"].groupby("date").apply(lambda g: (g.f_fv * 0.25).sum(), include_groups=False)
    out = []
    for lag in range(0, 46, 3):
        l = [lv[d - pd.Timedelta(days=lag)] for d in a.index]
        out.append(dict(lag_days=lag, rho_total=round(spearmanr(l, a.values)[0], 3), rho_under_veg=round(spearmanr(l, v.values)[0], 3)))
    return out


def probes(t):
    feats = []
    for z, n in [("delta", 5), ("cernavoda", 1)]:
        b, a = PAIRS[z]
        tb = t[(t.zone == z) & (t.date == pd.Timestamp(b))].set_index("cell")
        ta = t[(t.zone == z) & (t.date == pd.Timestamp(a))].set_index("cell")
        loss = (tb.f_tot - ta.f_tot).dropna()
        if z == "delta":  # vegetated, not permanent open water (wind can blank a lagoon), away from the zone edge
            w, s_, e, n_ = ZONES[z]
            ok = ((tb.wc_wetland + tb.wc_tree) >= 0.5) & (tb.gsw_occ < 80) & tb.lon.between(w + 0.04, e - 0.04) & tb.lat.between(s_ + 0.03, n_ - 0.03)
            loss = loss[ok.reindex(loss.index, fill_value=False)]
        loss = loss.sort_values(ascending=False)
        chosen = []
        for c in loss.index:
            r = tb.loc[c]
            if all(((r.lon - q.lon) * 71) ** 2 + ((r.lat - q.lat) * 111) ** 2 > 16 for q in chosen):
                chosen.append(r)
            if len(chosen) == n:
                break
        for i, r in enumerate(chosen):
            cid = r.name
            lab = f"P{len(feats) + 1}"
            kind = "reed bed" if r.wc_wetland > 0.5 else ("floodplain forest" if r.wc_tree > 0.4 else ("channel / sandbank" if z == "cernavoda" else "wetland"))
            feats.append(dict(type="Feature", geometry=dict(type="Point", coordinates=[round(float(r.lon), 5), round(float(r.lat), 5)]),
                              properties=dict(label=lab, zone=z, kind=kind,
                                              lost_pct=round(100 * float(loss[cid])),
                                              text=f"{kind}, {round(100 * float(loss[cid]))}% of the 500 m cell lost water ({b[6:]}/{b[4:6]} → {a[6:]}/{a[4:6]}). Proposed: water-level logger + soil-moisture probe.",
                                              status="Simulated")))
    fc = dict(type="FeatureCollection", features=feats)
    json.dump(fc, open(OUT / "probes.json", "w"), indent=1)
    return fc


def main():
    lv = levels()
    t = cells_table()
    ft = flood_threshold(lv)
    lag = lag_analysis(t, lv)
    pr = probes(t)
    extra = dict(flood_threshold=ft, lag=lag)
    json.dump(extra, open(OUT / "analysis.json", "w"), indent=1)
    print("cells", len(t), "flood threshold", ft)
    print(pd.DataFrame(lag).to_string())
    for f in pr["features"]:
        print(f["properties"]["label"], f["geometry"]["coordinates"], f["properties"]["kind"], f["properties"]["lost_pct"])


if __name__ == "__main__":
    main()
