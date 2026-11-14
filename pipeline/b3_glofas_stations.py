"""B3: daily GloFAS discharge at each DanubeAlert gauge -> data/river/glofas_discharge.csv.

Each gauge is snapped to the GloFAS cell with the largest mean discharge within
+/-0.15 deg (the main channel), the usual way to match gauges to a 0.05 deg river network.
Label in the app: "modelled" (GloFAS v4 reanalysis), not observed.
"""
import glob
import pandas as pd
import xarray as xr
from config import DATA, REPO

RIVER = REPO / "data" / "river"


def main():
    parts = [xr.open_dataset(f)["avg_dis"].load() for f in sorted(glob.glob(str(DATA / "glofas" / "glofas_*.nc")))]
    q = xr.concat(parts, dim="valid_time").sortby("valid_time")
    q = q.isel(valid_time=~q.get_index("valid_time").duplicated())  # products never overlap; guard anyway
    mean = q.mean("valid_time").load()
    rows, picks = [], []
    for st in pd.read_csv(RIVER / "stations.csv").itertuples():
        box = mean.sel(latitude=slice(st.lat + 0.15, st.lat - 0.15), longitude=slice(st.lon - 0.15, st.lon + 0.15))
        idx = box.fillna(-1).argmax(dim=["latitude", "longitude"])
        la, lo = float(box.latitude[idx["latitude"]]), float(box.longitude[idx["longitude"]])
        s = q.sel(latitude=la, longitude=lo).to_series()
        picks.append((st.station, la, lo, float(s.mean())))
        rows.append(pd.DataFrame({"station": st.station, "date": s.index.strftime("%Y-%m-%d"), "discharge_m3s": s.round(1).values}))
    pd.concat(rows).dropna().to_csv(RIVER / "glofas_discharge.csv", index=False)
    pd.DataFrame(picks, columns=["station", "cell_lat", "cell_lon", "mean_m3s"]).to_csv(RIVER / "glofas_cells.csv", index=False)
    for p in picks:
        print(p)


if __name__ == "__main__":
    main()
