"""Step A tests: zones, grid snapping, range reader, manifest, raw rasters."""
import csv
import io
import os
from pathlib import Path

import numpy as np
import pytest

from config import MANIFEST, PIXEL, RAW
from zones import ZONES, utm_bounds
from a2_fetch_nisar import zone_grid
from remote_h5 import HTTPRangeFile

DATES = ["20260618", "20260630", "20260712", "20260724", "20260817", "20260829",
         "20260910", "20260922", "20261004", "20261016", "20261028"]


def test_zones_inside_corridor():
    for name, (w, s, e, n) in ZONES.items():
        assert 27.85 <= w < e <= 29.75 and 44.2 <= s < n <= 45.5, name


@pytest.mark.parametrize("zone", list(ZONES))
def test_grid_snapped_and_covers_zone(zone):
    left, top, nx, ny = zone_grid(zone)
    assert left % PIXEL == 0 and top % PIXEL == 0
    xmin, ymin, xmax, ymax = utm_bounds(zone)
    assert left <= xmin and top >= ymax
    assert left + nx * PIXEL >= xmax and top - ny * PIXEL <= ymin


class FakeResp:
    def __init__(self, content, total, url):
        self.content, self.url, self.status_code = content, url, 206
        self.headers = {"Content-Range": f"bytes 0-{len(content)-1}/{total}"}

    def raise_for_status(self):
        pass


class FakeSession:
    def __init__(self, data):
        self.data, self.calls = data, 0

    def get(self, url, headers, **kw):
        self.calls += 1
        a, b = headers["Range"].split("=")[1].split("-")
        return FakeResp(self.data[int(a):int(b) + 1], len(self.data), url)


def test_range_file_reads_match_bytes():
    data = os.urandom(10_000)
    sess = FakeSession(data)
    f = HTTPRangeFile("http://x", block_size=1024, session=sess)
    assert f.size == len(data)
    f.seek(1500); assert f.read(3000) == data[1500:4500]
    f.seek(-10, io.SEEK_END); assert f.read(100) == data[-10:]
    f.seek(0); assert io.BufferedReader(f).read() == data


def test_manifest_has_22_granules_11_dates():
    rows = list(csv.DictReader(open(MANIFEST)))
    assert len(rows) == 22
    assert sorted({r["date"] for r in rows}) == DATES
    assert {r["frame"] for r in rows} == {"065", "066"}
    assert {r["polarization"] for r in rows} == {"DHDH"}  # dual-pol HH+HV on every date
    assert {r["date"] for r in rows if r["status"] == "validated"} == {"20261028"}


raw_ready = all((RAW / z / f"{d}.tif").exists() for z in ZONES for d in DATES)


@pytest.mark.skipif(not raw_ready, reason="raw rasters not fetched on this machine")
@pytest.mark.parametrize("zone", list(ZONES))
@pytest.mark.parametrize("date", DATES)
def test_raw_raster_sane(zone, date):
    import rasterio
    with rasterio.open(RAW / zone / f"{date}.tif") as r:
        assert r.count == 3 and r.crs.to_epsg() == 32635
        assert abs(r.res[0] - PIXEL) < 1e-6
        hh, hv, valid = r.read(1), r.read(2), r.read(3).astype(bool)
    assert valid.mean() > 0.8
    hh_db, hv_db = 10 * np.log10(hh[valid]), 10 * np.log10(hv[valid])
    assert -16 < np.median(hh_db) < -4, np.median(hh_db)
    assert -22 < np.median(hv_db) < -8, np.median(hv_db)
    assert np.median(hh_db) > np.median(hv_db)  # co-pol brighter than cross-pol
