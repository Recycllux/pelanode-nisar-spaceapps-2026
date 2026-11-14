"""B2: GloFAS v4 river discharge (modelled reanalysis), 2015-2026, Lower Danube box.

Source: Copernicus EMS GloFAS historical (EWDS). Writes RAW glofas/<year>.nc
then extracts daily discharge at each DanubeAlert station to data/river/glofas_discharge.csv.
"""
import sys
import cdsapi, requests
from config import DATA

OUT = DATA / "glofas"
AREA = [45.6, 27.8, 44.1, 29.8]  # N, W, S, E


CONSTRAINTS = "https://ewds.climate.copernicus.eu/api/retrieve/v1/processes/cems-glofas-historical/constraints"
VAR = "average_river_discharge_in_the_last_24_hours"


def months_available(year, product):
    out = []
    for m in range(1, 13):
        r = requests.post(CONSTRAINTS, json={"inputs": {"system_version": ["version_4_0"], "product_type": [product], "timespan": ["time_mean"],
                          "year": [str(year)], "month": [f"{m:02d}"], "variable": [VAR]}}, timeout=60)
        if r.ok and r.json().get("day"):
            out.append(f"{m:02d}")
    return out


def fetch(year, product, months):
    OUT.mkdir(parents=True, exist_ok=True)
    f = OUT / f"glofas_{year}_{product}.nc"
    if f.exists():
        return f
    cdsapi.Client(quiet=True).retrieve("cems-glofas-historical", {
        "system_version": ["version_4_0"], "hydrological_model": ["lisflood"],
        "product_type": [product], "timespan": ["time_mean"], "variable": [VAR],
        "year": [str(year)], "month": months, "day": [f"{d:02d}" for d in range(1, 32)],
        "data_format": "netcdf", "download_format": "unarchived", "area": AREA}, str(f))
    return f


if __name__ == "__main__":
    for y in (int(a) for a in sys.argv[1:]):
        done = set()
        for p in ("consolidated", "intermediate"):
            ms = [m for m in months_available(y, p) if m not in done]
            if not ms:
                continue
            try:
                print(y, p, ms, fetch(y, p, ms), flush=True); done |= set(ms)
            except Exception as e:
                print(y, p, "ERR", str(e)[:300], flush=True)
