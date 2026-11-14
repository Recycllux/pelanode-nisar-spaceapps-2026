"""H1: river context table for the app (docs/data/river.json) and data/river/river_summary.csv.

For each gauge: daily 2026 level, the 2015-2025 day-of-year climatology (p10, p50, p90, min),
the official low-water mark (ENR/LDC) and a drought stage per day:
  0 normal (>= p25) | 1 low (< p25) | 2 very low (< p10) | 3 below the low-water mark (< ENR)
  | 4 record low (below the 2015-2025 minimum for that day of year).
"""
import json
import numpy as np
import pandas as pd
from config import REPO

RIVER = REPO / "data" / "river"
OUT = REPO / "docs" / "data"


def main():
    lv = pd.read_csv(RIVER / "levels_daily.csv", parse_dates=["date"])
    th = pd.read_csv(RIVER / "thresholds.csv")
    enr = th[th.type == "ldc"].set_index("station").value.to_dict()
    att = th[th.type == "ca"].set_index("station").value.to_dict()
    out, summary = {"stations": {}}, []
    for st, g in lv.groupby("station"):
        s = g.set_index("date").level_cm.sort_index()
        hist = s[:"2025-12-31"]
        doy = hist.groupby(hist.index.day_of_year)
        # smooth climatology with a +/-7 day window
        clim = {}
        for q, name in [(0.10, "p10"), (0.25, "p25"), (0.50, "p50"), (0.90, "p90")]:
            c = doy.quantile(q).reindex(range(1, 367)).interpolate()
            clim[name] = pd.concat([c.iloc[-7:], c, c.iloc[:7]]).rolling(15, center=True).mean().iloc[7:-7]
        cmin = doy.min().reindex(range(1, 367)).interpolate()
        y = s["2026-01-01":]
        d = y.index.day_of_year
        stage = np.zeros(len(y), int)
        stage[y.values < clim["p25"].loc[d].values] = 1
        stage[y.values < clim["p10"].loc[d].values] = 2
        if st in enr:
            stage[y.values < enr[st]] = 3
        stage[y.values < cmin.loc[d].values] = 4
        out["stations"][st] = dict(
            enr_cm=enr.get(st), attention_cm=att.get(st),
            dates=y.index.strftime("%Y-%m-%d").tolist(), level_cm=y.values.tolist(), stage=stage.tolist(),
            p10=clim["p10"].loc[d].round(1).tolist(), p50=clim["p50"].loc[d].round(1).tolist(),
            p90=clim["p90"].loc[d].round(1).tolist(), hist_min_cm=int(hist.min()),
            hist_min_date=hist.idxmin().strftime("%Y-%m-%d"))
        summ = y["2026-06-01":]
        summary.append(dict(station=st, enr_cm=enr.get(st), min_2026_cm=int(summ.min()),
                            min_2026_date=summ.idxmin().strftime("%Y-%m-%d"),
                            days_below_enr_since_jun=int((summ < enr[st]).sum()) if st in enr else None,
                            first_day_below_enr=(summ[summ < enr[st]].index.min().strftime("%Y-%m-%d")
                                                 if st in enr and (summ < enr[st]).any() else None),
                            record_low_days=int((stage[-len(summ):] == 4).sum()),
                            hist_min_2015_2025_cm=int(hist.min()), hist_min_date=hist.idxmin().strftime("%Y-%m-%d")))
    out["stage_names"] = ["Normal", "Low", "Very low", "Below low-water mark", "Record low"]
    OUT.mkdir(parents=True, exist_ok=True)
    json.dump(out, open(OUT / "river.json", "w"), separators=(",", ":"))
    pd.DataFrame(summary).to_csv(RIVER / "river_summary.csv", index=False)
    print(pd.DataFrame(summary).to_string())


if __name__ == "__main__":
    main()
