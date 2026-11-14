"""Step B tests: DanubeAlert levels, thresholds, stations."""
import pandas as pd
import pytest
from config import REPO

RIVER = REPO / "data" / "river"
STATIONS = {"cernavoda", "harsova", "braila", "galati", "isaccea", "tulcea", "sulina"}


@pytest.fixture(scope="module")
def levels():
    return pd.read_csv(RIVER / "levels_daily.csv", parse_dates=["date"])


def test_all_stations_full_history(levels):
    assert set(levels.station) == STATIONS
    g = levels.groupby("station").date
    assert (g.min() <= "2015-01-02").all() and (g.max() >= "2026-11-01").all()
    assert (g.count() > 4200).all()  # >97% of days 2015-2026


def test_no_duplicates_and_plausible_range(levels):
    assert not levels.duplicated(["station", "date"]).any()
    assert levels.level_cm.between(-400, 900).all()


def test_2026_drought_visible(levels):
    """Summer-autumn 2026 at Isaccea should sit well below its 2015-2025 median."""
    isa = levels[levels.station == "isaccea"].set_index("date").level_cm
    clim = isa[:"2025-12-31"]
    s26 = isa["2026-08-01":"2026-10-31"]
    assert s26.median() < clim.quantile(0.10)


def test_thresholds_have_low_water_for_delta_gauges():
    t = pd.read_csv(RIVER / "thresholds.csv")
    ldc = t[t.type == "ldc"].set_index("station").value
    for s in ["isaccea", "tulcea", "galati", "braila", "harsova", "cernavoda"]:
        assert s in ldc.index
    assert ldc["isaccea"] == 73 and ldc["cernavoda"] == -71


def test_stations_coordinates():
    s = pd.read_csv(RIVER / "stations.csv")
    assert set(s.station) == STATIONS
    assert s.lat.between(44.2, 45.6).all() and s.lon.between(27.8, 29.8).all()
