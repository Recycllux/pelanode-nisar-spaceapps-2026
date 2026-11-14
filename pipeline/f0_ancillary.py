"""F0: ancillary layers on each zone's 20 m NISAR grid.

- ESA WorldCover 2021 v200 (10 m, CC BY 4.0): land-cover classes.
- Copernicus GLO-30 HAND (height above nearest drainage, ASF/AWS open data).
- Copernicus GLO-30 DEM (for the 3D terrain and stage-area context).
- JRC Global Surface Water v1.4 occurrence 1984-2021 (%, Pekel et al. 2016): the "water domain"
  (anywhere that was ever water) and the long-term prior used to judge 2026 losses.
Read as Cloud-Optimised GeoTIFFs over HTTP (only our windows) and warped to the zone grid.
Writes DATA/ancillary/<zone>.tif with bands: worldcover, hand_m, dem_m, gsw_occurrence_pct.
"""
import math, os
import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling

from config import DATA, PIXEL
from zones import ZONES
from a2_fetch_nisar import zone_grid

os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
OUT = DATA / "ancillary"


def wc_url(lat, lon):  # 3x3 degree tiles named by SW corner
    la, lo = 3 * math.floor(lat / 3), 3 * math.floor(lon / 3)
    return f"https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N{la:02d}E{lo:03d}_Map.tif"


def cop_tag(lat, lon):
    return f"N{math.floor(lat):02d}_00_E{math.floor(lon):03d}_00"


def hand_url(lat, lon):
    return f"https://glo-30-hand.s3.us-west-2.amazonaws.com/v1/2021/Copernicus_DSM_COG_10_{cop_tag(lat, lon)}_HAND.tif"


def dem_url(lat, lon):
    t = cop_tag(lat, lon)
    return f"https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{t}_DEM/Copernicus_DSM_COG_10_{t}_DEM.tif"


GSW = "https://storage.googleapis.com/global-surface-water/downloads2021/occurrence/occurrence_20E_50Nv1_4_2021.tif"


def tiles(zone, fn, step):
    w, s, e, n = ZONES[zone]
    lats = np.arange(math.floor(s / step) * step, n, step)
    lons = np.arange(math.floor(w / step) * step, e, step)
    return sorted({fn(la + 1e-6, lo + 1e-6) for la in lats for lo in lons})


def warp(urls, zone, resampling, dtype, nodata):
    left, top, nx, ny = zone_grid(zone)
    tr = from_origin(left, top, PIXEL, PIXEL)
    out = np.full((ny, nx), nodata, dtype=dtype)
    for u in urls:
        with rasterio.open("/vsicurl/" + u) as src, WarpedVRT(
                src, crs=CRS.from_epsg(32635), transform=tr, width=nx, height=ny,
                resampling=resampling, src_nodata=src.nodata, nodata=nodata) as v:
            a = v.read(1)
            fill = (out == nodata) & (a != nodata)
            out[fill] = a[fill]
    return out, tr


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for z in ZONES:
        wc, tr = warp(tiles(z, wc_url, 3), z, Resampling.mode, np.uint8, 0)
        hand, _ = warp(tiles(z, hand_url, 1), z, Resampling.bilinear, np.float32, -9999)
        dem, _ = warp(tiles(z, dem_url, 1), z, Resampling.bilinear, np.float32, -9999)
        gsw, _ = warp([GSW], z, Resampling.average, np.float32, -9999)
        gsw = np.where((gsw < 0) | (gsw > 100), 0, gsw)  # 255 = no data -> treat as never water
        prof = dict(driver="GTiff", width=wc.shape[1], height=wc.shape[0], count=4, dtype="float32",
                    crs="EPSG:32635", transform=tr, compress="deflate", tiled=True, nodata=-9999)
        with rasterio.open(OUT / f"{z}.tif", "w", **prof) as d:
            d.write(wc.astype(np.float32), 1); d.write(hand, 2); d.write(dem, 3)
            d.set_band_description(1, "worldcover"); d.set_band_description(2, "hand_m"); d.set_band_description(3, "dem_m")
            d.write(gsw, 4); d.set_band_description(4, "gsw_occurrence_pct")
        cls, cnt = np.unique(wc, return_counts=True)
        print(z, wc.shape, "WC classes", dict(zip(cls.tolist(), (cnt / cnt.sum()).round(3).tolist())),
              "HAND<10m", round(float((hand[hand > -9999] < 10).mean()), 3), "DEM range", float(dem[dem > -9999].min()), float(dem.max()),
              "GSW>0", round(float((gsw > 0).mean()), 3), "GSW>50", round(float((gsw > 50).mean()), 3), flush=True)


if __name__ == "__main__":
    main()
