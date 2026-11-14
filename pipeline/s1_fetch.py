"""S1: Sentinel-1 context from NASA OPERA RTC-S1 (terrain-corrected gamma0, 30 m, VV + VH).

One orbit track (036, descending, ~04:12 UTC) covers all three zones. For each date we download
only the bursts that touch a zone, mosaic them onto a 30 m UTM 35N grid per zone (same extent as
the NISAR zone grid) and keep VV and VH. Burst files are deleted after use.

  python s1_fetch.py 2026            # every acquisition Jun 1 - Nov 14 2026 (6-day revisit)
  python s1_fetch.py history         # Jun 1 - Nov 14 of 2016-2025, about one date per 12 days
Writes DATA/s1_raw/<zone>/<yyyymmdd>.tif (band 1 VV, band 2 VH, linear gamma0) and data/s1_manifest.csv.
"""
import csv, io, re, sys, time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import rasterio
import requests
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling

from config import DATA, REPO
from zones import ZONES, utm_bounds

TRACK = "036"
RES = 30.0
OUT = DATA / "s1_raw"
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
S = requests.Session()


def grid(zone):
    xmin, ymin, xmax, ymax = utm_bounds(zone)
    left, top = np.floor(xmin / RES) * RES, np.ceil(ymax / RES) * RES
    return left, top, int(np.ceil((xmax - left) / RES)), int(np.ceil((top - ymin) / RES))


def search(start, end):
    out, page = [], 1
    while True:
        r = S.get(CMR, params={"short_name": "OPERA_L2_RTC-S1_V1", "bounding_box": "27.85,44.2,29.75,45.5",
                               "temporal": f"{start}T00:00:00Z,{end}T23:59:59Z", "page_size": 2000, "page_num": page},
                  timeout=120).json()["feed"]["entry"]
        if not r:
            return out
        out += r; page += 1


def burst_box(e):
    p = [float(v) for v in e["polygons"][0][0].split()]
    lats, lons = p[0::2], p[1::2]
    return min(lons), min(lats), max(lons), max(lats)


def touches(b, z):
    w, s, e, n = ZONES[z]
    return not (b[2] < w or b[0] > e or b[3] < s or b[1] > n)


def by_date(entries):
    d = defaultdict(dict)
    for e in entries:
        m = re.match(r"OPERA_L2_RTC-S1_T(\d+)-(\d+)-(IW\d)_(\d{8})T.*_(S1[A-D])_30_v([\d.]+)", e["producer_granule_id"])
        if not m or m.group(1) != TRACK:
            continue
        burst, date = f"{m.group(2)}-{m.group(3)}", m.group(4)
        bb = burst_box(e)
        if not any(touches(bb, z) for z in ZONES):
            continue
        links = {}
        for l in e["links"]:
            h = l["href"]
            for pol in ("VV", "VH"):
                if h.endswith(f"_{pol}.tif") and h.startswith("s3://asf-cumulus-prod-opera-products/"):
                    # older granules list a datapool https link we cannot reach; use the cloud copy
                    links[pol] = h.replace("s3://asf-cumulus-prod-opera-products/", "https://cumulus.asf.earthdatacloud.nasa.gov/OPERA/")
        if len(links) == 2:
            d[date][burst] = dict(box=bb, sensor=m.group(5), **links)
    return d


def get(url):
    for a in range(5):
        try:
            r = S.get(url, timeout=180); r.raise_for_status(); return r.content
        except requests.RequestException:
            time.sleep(2 ** a)
    raise RuntimeError(url)


def process(date, bursts):
    if all((OUT / z / f"{date}.tif").exists() for z in ZONES):
        return date, "skip"
    t = time.time()
    with ThreadPoolExecutor(6) as ex:
        data = {(b, pol): blob for (b, pol), blob in zip(
            [(b, p) for b in bursts for p in ("VV", "VH")],
            ex.map(get, [bursts[b][p] for b in bursts for p in ("VV", "VH")]))}
    for z in ZONES:
        left, top, nx, ny = grid(z)
        tr = from_origin(left, top, RES, RES)
        acc = np.full((2, ny, nx), np.nan, np.float32)
        for b, info in bursts.items():
            if not touches(info["box"], z):
                continue
            for i, pol in enumerate(("VV", "VH")):
                with MemoryFile(data[(b, pol)]) as m, m.open() as src:
                    dst = np.full((ny, nx), np.nan, np.float32)
                    reproject(rasterio.band(src, 1), dst, dst_transform=tr, dst_crs="EPSG:32635",
                              resampling=Resampling.average, src_nodata=src.nodata if src.nodata is not None else np.nan, dst_nodata=np.nan)
                    fill = np.isnan(acc[i]) & np.isfinite(dst) & (dst > 0)
                    acc[i][fill] = dst[fill]
        (OUT / z).mkdir(parents=True, exist_ok=True)
        prof = dict(driver="GTiff", width=nx, height=ny, count=2, dtype="float32", crs="EPSG:32635", transform=tr,
                    nodata=np.nan, compress="deflate", predictor=3, tiled=True)
        with rasterio.open(OUT / z / f"{date}.tif", "w", **prof) as w:
            w.write(acc); w.update_tags(date=date, track=TRACK, sensors=",".join(sorted({v["sensor"] for v in bursts.values()})))
    return date, f"{len(bursts)} bursts, {sum(len(v) for v in data.values()) / 1e6:.0f} MB, {time.time() - t:.0f}s"


def thin(dates, step_days=12):
    keep, last = [], None
    for d in sorted(dates):
        dt = np.datetime64(f"{d[:4]}-{d[4:6]}-{d[6:]}")
        if last is None or (dt - last) >= np.timedelta64(step_days - 2, "D"):
            keep.append(d); last = dt
    return keep


def main(mode):
    if mode == "2026":
        windows = [("2026-06-01", "2026-11-14")]
    else:
        windows = [(f"{y}-06-01", f"{y}-11-14") for y in range(2016, 2026)]
    man = REPO / "data" / "s1_manifest.csv"
    rows = list(csv.DictReader(open(man))) if man.exists() else []
    seen = {r["date"] for r in rows}
    for start, end in windows:
        d = by_date(search(start, end))
        dates = sorted(d) if mode == "2026" else thin(d)
        for date in dates:
            # need full coverage: every zone touched by at least one burst
            if not all(any(touches(v["box"], z) for v in d[date].values()) for z in ZONES):
                continue
            res = process(date, d[date])
            print(*res, flush=True)
            if date not in seen:
                rows.append(dict(date=date, track=TRACK, n_bursts=len(d[date]),
                                 sensors=",".join(sorted({v["sensor"] for v in d[date].values()}))))
                seen.add(date)
            with open(man, "w", newline="") as f:
                w = csv.DictWriter(f, ["date", "track", "n_bursts", "sensors"]); w.writeheader()
                w.writerows(sorted(rows, key=lambda r: r["date"]))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "2026")
