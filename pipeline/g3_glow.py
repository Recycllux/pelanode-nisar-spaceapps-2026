"""G3: 'Water glow' layers for the app: a smooth neon picture of where water stayed, was lost or appeared.

For every zone and NISAR date, the water mask (open water + water under vegetation, from F1/G0) is
smoothed into a water share field (Gaussian, sigma 30 m) and compared with the first date (18 Jun):
  kept   = min(now, first)   -> neon cyan
  lost   = first - now  (>0) -> neon magenta
  gained = now - first  (>0) -> neon lime
Colour is the mix of the three, opacity grows with the amount of water involved, and a wider soft halo
is added so the layer glows over the basemap. Written as WebP on the same Web Mercator grid as the
water-class layers: docs/data/<zone>/<date>_glow.webp, corners in docs/data/glow.json
"""
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import calculate_default_transform, reproject
from scipy.ndimage import gaussian_filter

import json
from PIL import Image
from rasterio.warp import transform_bounds

from config import DATA, REPO
from g1_products import water_path
from zones import ZONES

OUT = REPO / "docs" / "data"
GLOW_RES = {"delta": 100.0, "cernavoda": 30.0, "balta_mica_brailei": 50.0}  # m; the field is smooth anyway
CYAN = np.array([0, 229, 255], float)
MAGENTA = np.array([255, 46, 196], float)
LIME = np.array([170, 255, 40], float)
SIGMA_M = 30.0
HALO_M = 160.0


def share(path, sigma_px):
    with rasterio.open(path) as src:
        c = src.read(1)
        prof = src.profile
    valid = c != 255
    w = gaussian_filter(((c == 1) | (c == 2)).astype(np.float32), sigma_px)
    return np.where(valid, w, np.nan).astype(np.float32), prof


def to_merc(a, prof, res):
    tr, w, h = calculate_default_transform(prof["crs"], "EPSG:3857", prof["width"], prof["height"],
                                          *rasterio.transform.array_bounds(prof["height"], prof["width"], prof["transform"]),
                                          resolution=res)
    dst = np.full((h, w), np.nan, np.float32)
    reproject(a, dst, src_transform=prof["transform"], src_crs=prof["crs"], dst_transform=tr, dst_crs="EPSG:3857",
              resampling=Resampling.average, src_nodata=np.nan, dst_nodata=np.nan)
    l, b, r, t = transform_bounds("EPSG:3857", "EPSG:4326", *rasterio.transform.array_bounds(h, w, tr))
    return dst, [[l, t], [r, t], [r, b], [l, b]]


def colourise(first, now, halo_px):
    f, n = np.nan_to_num(first), np.nan_to_num(now)
    kept, lost, gained = np.minimum(f, n), np.clip(f - n, 0, None), np.clip(n - f, 0, None)
    tot = kept + lost + gained
    rgb = (kept[..., None] * CYAN + lost[..., None] * MAGENTA * 1.0 + gained[..., None] * LIME) / np.maximum(tot, 1e-6)[..., None]
    # emphasise change: lost/gained water counts double for opacity
    amt = np.clip(kept * 0.8 + 1.6 * (lost + gained), 0, 1)
    halo = gaussian_filter(amt, halo_px) * 0.55
    alpha = np.clip(np.maximum(amt, halo), 0, 1)
    # halo pixels take the colour of their neighbourhood
    w = gaussian_filter(amt, halo_px)[..., None] + 1e-6
    rgb_halo = np.dstack([gaussian_filter(rgb[..., i] * amt, halo_px) for i in range(3)]) / w
    mix = (amt / np.maximum(alpha, 1e-6))[..., None]
    rgb = np.clip(rgb * mix + rgb_halo * (1 - mix), 0, 255)
    alpha = np.where(np.isnan(now), 0, alpha)
    return np.dstack([rgb.astype(np.uint8), (alpha * 235).astype(np.uint8)])


def main():
    meta = {"source": "G3 water glow, change since the first NISAR date", "zones": {}}
    for z in ZONES:
        dates = sorted(p.stem for p in (DATA / "water" / z).glob("2026*.tif"))
        res = GLOW_RES[z]
        first = None
        for d in dates:
            s, prof = share(water_path(z, d), SIGMA_M / 20.0)
            m, coords = to_merc(s, prof, res)
            if first is None:
                first = m
            rgba = colourise(first, m, HALO_M / res)
            Image.fromarray(rgba, "RGBA").save(OUT / z / f"{d}_glow.webp", quality=55, method=6)
        meta["zones"][z] = {"dates": dates, "coordinates": [[round(x, 6), round(y, 6)] for x, y in coords]}
        print(z, len(dates), "dates", rgba.shape)
    (OUT / "glow.json").write_text(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
