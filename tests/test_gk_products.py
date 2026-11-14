"""Steps G/H/K tests: web products the app reads."""
import json
import pandas as pd
import pytest
from config import REPO

D = REPO / "docs" / "data"
pytestmark = pytest.mark.skipif(not (D / "manifest.json").exists(), reason="web products not built")


def test_manifest_and_files():
    m = json.load(open(D / "manifest.json"))
    assert set(m["zones"]) == {"delta", "cernavoda", "balta_mica_brailei"}
    for z, v in m["zones"].items():
        assert len(v["dates"]) == 11 and v["before"] in v["dates"] and v["after"] in v["dates"]
        assert v["status"]["20261028"] == "Validated"
        for d in v["dates"]:
            for suf in ("_class.png", "_hh.webp", "_hv.webp"):
                f = D / z / f"{d}{suf}"
                assert f.exists() and f.stat().st_size > 1000, f
        assert (D / z / "lost.png").exists() and (D / z / "composite.webp").exists()
        lon = [c[0] for c in v["coordinates"]]; lat = [c[1] for c in v["coordinates"]]
        w, s, e, n = v["bbox"]
        assert min(lon) <= w + 0.02 and max(lon) >= e - 0.02 and min(lat) <= s + 0.02 and max(lat) >= n - 0.02


def test_web_size_budget():
    total = sum(f.stat().st_size for f in D.rglob("*") if f.is_file())
    assert total < 60e6, total


def test_areas_table():
    a = pd.read_csv(D / "areas.csv")
    assert len(a) == 33
    assert (a.total_water_km2 - a.open_water_km2 - a.under_vegetation_km2).abs().max() < 0.05
    assert a.isaccea_level_cm.notna().all()


def test_river_json():
    r = json.load(open(D / "river.json"))
    isa = r["stations"]["isaccea"]
    assert isa["enr_cm"] == 73 and len(isa["dates"]) == len(isa["level_cm"]) == len(isa["stage"])
    assert max(isa["stage"]) == 4  # record lows present in 2026


def test_probes_inside_zones_and_simulated():
    p = json.load(open(D / "probes.json"))
    assert 3 <= len(p["features"]) <= 10
    for f in p["features"]:
        assert f["properties"]["status"] == "Simulated"
        lon, lat = f["geometry"]["coordinates"]
        assert 27.85 <= lon <= 29.75 and 44.2 <= lat <= 45.5


def test_forecast_labelled_future_and_validated():
    f = json.load(open(D / "forecast.json"))
    assert f["forecast"]["label"] == "Future"
    assert set(f["metrics"]) == {"persistence", "gradient_boosting", "tabpfn_3.5"}
    assert len(f["test_dates"]) == 5 and all(d["date"] > "2026-08-29" for d in f["test_dates"])
    fc = f["forecast"]
    assert fc["p10_km2"] <= fc["p50_km2"] <= fc["p90_km2"]


def test_sentinel1_products():
    s = json.load(open(D / "s1.json"))
    years = {int(y) for y in s["years"]}
    assert set(range(2016, 2027)) <= years
    d = s["series"]["delta"]
    assert len(d["dates"]) == len(d["open_water_km2"]) == len(d["flag_wind"])
    assert sum(x >= "2026-06-01" for x in d["dates"]) >= 25  # 6-day revisit in 2026
    dv = [v for v in s["validation"] if v["zone"] == "delta"]
    assert len(dv) >= 5 and sorted(v["iou"] for v in dv)[len(dv) // 2] > 0.6
    f = json.load(open(D / "s1_forecast.json"))
    assert set(f["tests"]) == {"2025", "2026"}
