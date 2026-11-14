"""K2: TabPFN-3.5 short-term prediction of Delta water fraction (about 12 days ahead), with
time-blocked validation against baselines. Output is labelled Future in the app.

Target: fraction of the cell that is water under vegetation (reeds, floodplain forest).
Unit: 500 m cell in the Delta zone that held water on at least one date (f_tot > 0.05).
Sample: one transition t -> t+1 between consecutive NISAR dates (12 days, 24 across the Jul-Aug gap).
Features at t (nothing from t+1 is used): water fractions (total, open, under vegetation) at t and
t-1, Isaccea level at t and its change over the previous 12 days, days ahead, and static cell
descriptors (HAND, JRC occurrence, WorldCover shares).
Validation: train on transitions that end on or before 29 Aug, test on the five that end
10 Sep - 28 Oct (never shuffled across time). Baselines: persistence and gradient boosting.
"""
import json
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from tabpfn_client import TabPFNRegressor, set_access_token

from config import DATA, REPO
from k1_change_probes import levels

OUT = REPO / "docs" / "data"
SPLIT = pd.Timestamp("2026-08-29")
FEATS = ["f_tot", "f_ow", "f_fv", "f_tot_prev", "lvl", "dlvl12", "days_ahead",
         "hand_m", "gsw_occ", "wc_wetland", "wc_water", "wc_tree", "wc_crop"]
N_TRAIN = 8000
TARGET = "f_fv"  # water under vegetation: the hydrological signal; open water is dominated by wind noise


def build(lv):
    t = pd.read_parquet(DATA / "cells.parquet")
    t = t[t.zone == "delta"]
    keep = t.groupby("cell").f_tot.max() > 0.05
    t = t[t.cell.isin(keep[keep].index)].sort_values(["cell", "date"])
    dates = sorted(t.date.unique())
    g = t.groupby("cell")
    t["f_tot_prev"] = g.f_tot.shift(1)
    t["y"] = g[TARGET].shift(-1)
    t["date_next"] = g.date.shift(-1)
    t["lvl"] = t.date.map(lambda d: lv[d])
    t["dlvl12"] = t.date.map(lambda d: lv[d] - lv[d - pd.Timedelta(days=12)])
    t["days_ahead"] = (t.date_next - t.date).dt.days
    t["f_tot_prev"] = t.f_tot_prev.fillna(t.f_tot)
    return t, dates


def main():
    set_access_token("dummy")  # the environment proxy injects the real Prior Labs key
    lv = levels()
    t, dates = build(lv)
    last = t[t.date == dates[-1]].copy()
    s = t.dropna(subset=["y"])
    tr, te = s[s.date_next <= SPLIT], s[s.date_next > SPLIT]
    trs = tr.sample(min(N_TRAIN, len(tr)), random_state=0)
    res = {"n_cells": int(t.cell.nunique()), "n_train_all": int(len(tr)), "n_train_used": int(len(trs)), "n_test": int(len(te))}

    res["target"] = TARGET
    preds = {"persistence": te[TARGET].values}
    hgb = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, random_state=0).fit(tr[FEATS], tr.y)
    preds["gradient_boosting"] = np.clip(hgb.predict(te[FEATS]), 0, 1)
    pfn = TabPFNRegressor(model_path="v3.5_default", random_state=0)
    pfn.fit(trs[FEATS], trs.y)
    p_te = []
    for i in range(0, len(te), 10000):
        p_te.append(pfn.predict(te[FEATS].iloc[i:i + 10000]))
    preds["tabpfn_3.5"] = np.clip(np.concatenate(p_te), 0, 1)

    metrics = {}
    for k, p in preds.items():
        e = p - te.y.values
        per_date = pd.DataFrame({"d": te.date_next.values, "p": p * 0.25, "y": te.y.values * 0.25}).groupby("d").sum()
        metrics[k] = dict(cell_mae=round(float(np.abs(e).mean()), 4), cell_rmse=round(float(np.sqrt((e ** 2).mean())), 4),
                          area_mae_km2=round(float((per_date.p - per_date.y).abs().mean()), 1))
    res["metrics"] = metrics
    per = pd.DataFrame({"date": te.date_next.dt.strftime("%Y-%m-%d").values, "observed": te.y.values * 0.25,
                        **{k: v * 0.25 for k, v in preds.items()}}).groupby("date").sum().round(1)
    res["test_dates"] = per.reset_index().to_dict(orient="records")

    # Future: 12 days after the last date, trained on all transitions
    alls = s.sample(min(N_TRAIN, len(s)), random_state=1)
    pfn2 = TabPFNRegressor(model_path="v3.5_default", random_state=0).fit(alls[FEATS], alls.y)
    last["f_tot_prev"] = last.f_tot_prev.fillna(last.f_tot)
    last["days_ahead"] = 12
    q = pfn2.predict(last[FEATS], output_type="quantiles", quantiles=[0.1, 0.5, 0.9])
    q = [np.clip(np.asarray(a), 0, 1) for a in q]
    nd = (pd.Timestamp(dates[-1]) + pd.Timedelta(days=12)).strftime("%Y-%m-%d")
    res["forecast"] = dict(date=nd, from_date=pd.Timestamp(dates[-1]).strftime("%Y-%m-%d"),
                           last_observed_km2=round(float(last[TARGET].sum() * 0.25), 1),
                           p10_km2=round(float(q[0].sum() * 0.25), 1), p50_km2=round(float(q[1].sum() * 0.25), 1),
                           p90_km2=round(float(q[2].sum() * 0.25), 1), label="Future",
                           note="Sum of per-cell quantiles; a rough band, not a joint interval.")
    json.dump(res, open(OUT / "forecast.json", "w"), indent=1)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
