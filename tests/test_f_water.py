"""Step F tests: water classes, adaptive references, and the Delta drying signal."""
import json
import numpy as np
import pytest
from config import DATA
from zones import ZONES

STATS = DATA / "water" / "seed_stats.json"
pytestmark = pytest.mark.skipif(not STATS.exists(), reason="water maps not built on this machine")


@pytest.fixture(scope="module")
def stats():
    return json.load(open(STATS))["stats"]


def test_all_zones_all_dates(stats):
    assert set(stats) == set(ZONES)
    assert all(len(v) == 11 for v in stats.values())


def test_reference_water_is_dark(stats):
    for z in stats.values():
        for s in z.values():
            assert -18 < s["ref_water_hh_db"] < -12 and -19 < s["ref_water_hv_db"] < -12


def test_open_water_stable_and_plausible(stats):
    ow = [s["ow_km2"] for s in stats["delta"].values()]
    assert 700 < min(ow) and max(ow) < 1400          # lakes/channels of the Delta zone, no sea
    assert max(ow) / min(ow) < 1.5                     # not driven by wind or noise floor


def test_delta_water_under_reeds_collapses(stats):
    fv = stats["delta"]
    assert fv["20260618"]["fv_km2"] > 3 * fv["20261016"]["fv_km2"]


def test_classes_valid_values():
    import rasterio
    with rasterio.open(DATA / "water" / "cernavoda" / "20260817.tif") as r:
        assert set(np.unique(r.read(1)).tolist()) <= {0, 1, 2, 255}
