"""B1: pull DanubeAlert daily water levels (2015-2026) and official thresholds.

Source: DanubeAlert API (https://danubealert.arcm.ro), CC BY 4.0.
Writes data/river/stations.csv, levels_daily.csv (long format) and thresholds.csv.
"""
import csv, io, json, sys, time
from pathlib import Path
import requests

from config import REPO

BASE = "https://danubealert.arcm.ro/api/v1"
STATIONS = ["cernavoda", "harsova", "braila", "galati", "isaccea", "tulcea", "sulina"]
FROM, TO = "2015-01-01T00:00:00Z", "2026-11-14T23:59:59Z"
OUT = REPO / "data" / "river"


def get(url, **params):
    for attempt in range(5):
        r = requests.get(url, params=params, timeout=120)
        if r.status_code == 429:
            time.sleep(15 * (attempt + 1)); continue
        r.raise_for_status()
        return r
    raise RuntimeError(f"rate limited: {url}")


def fetch_stations():
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "stations.csv", "w", newline="") as f:
        w = csv.writer(f); w.writerow(["station", "name", "lat", "lon", "rkm"])
        for s in STATIONS:
            d = get(f"{BASE}/stations/{s}").json()
            d = d.get("data", d)
            w.writerow([s, d.get("name") or d.get("nume") or s, d["latitude"], d["longitude"], d.get("rkm")])
            time.sleep(1)


def main():
    fetch_stations()
    rows = []
    for s in STATIONS:
        r = get(f"{BASE}/stations/{s}/observations", interval="daily", **{"from": FROM, "to": TO}, format="csv")
        n = 0
        for rec in csv.DictReader(io.StringIO(r.text)):
            if rec["level_cm"] not in ("", None):
                rows.append({"station": s, "date": rec["observed_at"][:10], "level_cm": int(float(rec["level_cm"]))}); n += 1
        print(f"{s}: {n} days", flush=True)
        time.sleep(7)  # heavy route: 10/min
    with open(OUT / "levels_daily.csv", "w", newline="") as f:
        w = csv.DictWriter(f, ["station", "date", "level_cm"]); w.writeheader(); w.writerows(rows)

    keep = []
    for s in STATIONS:
        keep += [t for t in get(f"{BASE}/thresholds", station=s).json()["data"] if t.get("activ")]
        time.sleep(1)
    with open(OUT / "thresholds.csv", "w", newline="") as f:
        cols = ["station", "source", "type", "name", "value", "unit", "ref_date", "url"]
        w = csv.writer(f); w.writerow(cols)
        for t in sorted(keep, key=lambda t: (t["statie_slug"], t["tip"])):
            w.writerow([t["statie_slug"], t["sursa"], t["tip"], t["nume"], t["valoare"], t["unitate"], (t["data"] or "")[:10], t["url"]])
    print(f"thresholds: {len(keep)}")


if __name__ == "__main__":
    main()
