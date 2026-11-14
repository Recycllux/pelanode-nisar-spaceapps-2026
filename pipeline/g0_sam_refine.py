"""G0: SAM 2.1 refinement of the open-water seed mask (runs in its own venv with PyTorch).

For each zone/date the filtered HH, HV and HH-HV ratio form a 3-channel image. The image is cut
into 1024 px tiles; each seed water body (connected component >= MIN_PX) in a tile becomes a
box + interior-point prompt. SAM 2.1 (hiera base+) returns a mask; it is accepted only if it
agrees with the physics seed inside the box (IoU >= IOU_MIN) and stays in the water domain.
Accepted masks replace the seed there (sharper shores, filled speckle holes); elsewhere the
seed is kept. Water under vegetation (class 2) is not touched: it has no object shape.
Writes DATA/water_sam/<zone>/<date>.tif (same classes as the seed) and sam_stats.json.
"""
import json, sys, time
from pathlib import Path
import numpy as np
import rasterio
import torch
from scipy.ndimage import label, find_objects, distance_transform_edt
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

DATA = Path("/home/user/rivernexa-data")
CKPT = DATA / "models" / "sam2.1_hiera_base_plus.pt"
TILE, MIN_PX, IOU_MIN, MAX_PROMPTS = 1024, 40, 0.5, 64


def scale(x, a, b):
    return np.nan_to_num(np.clip((x - a) / (b - a) * 255, 0, 255)).astype(np.uint8)


def refine(pred, hh, hv, seed, domain):
    img = np.dstack([scale(hh, -20, -2), scale(hv, -22, -6), scale(hh - hv, -2, 10)])
    out = seed.copy(); acc = rej = 0
    H, W = seed.shape
    for y0 in range(0, H, TILE):
        for x0 in range(0, W, TILE):
            sl = (slice(y0, min(y0 + TILE, H)), slice(x0, min(x0 + TILE, W)))
            s = seed[sl] == 1
            lab, n = label(s)
            if n == 0:
                continue
            sizes = np.bincount(lab.ravel())[1:]
            ids = [i + 1 for i in np.argsort(-sizes)[:MAX_PROMPTS] if sizes[i] >= MIN_PX]
            if not ids:
                continue
            with torch.inference_mode():
                pred.set_image(img[sl])
            objs = find_objects(lab)
            for i in ids:
                ys, xs = objs[i - 1]
                comp = lab[ys, xs] == i
                dist = distance_transform_edt(comp)
                py, px = np.unravel_index(np.argmax(dist), comp.shape)
                box = np.array([xs.start, ys.start, xs.stop - 1, ys.stop - 1])
                with torch.inference_mode():
                    m, sc, _ = pred.predict(point_coords=np.array([[xs.start + px, ys.start + py]]),
                                            point_labels=np.array([1]), box=box, multimask_output=False)
                m = m[0].astype(bool)
                inbox = np.zeros_like(m); inbox[ys, xs] = True
                seedbox = s & inbox
                iou = (m & seedbox).sum() / max((m | seedbox).sum(), 1)
                if iou >= IOU_MIN:
                    m &= inbox & domain[sl]
                    tile = out[sl]
                    tile[seedbox & ~m & (tile == 1)] = 0
                    tile[m & (tile != 255)] = 1
                    acc += 1
                else:
                    rej += 1
    return out, acc, rej


def main(zones):
    torch.set_num_threads(4)
    pred = SAM2ImagePredictor(build_sam2("configs/sam2.1/sam2.1_hiera_b+.yaml", str(CKPT), device="cpu"))
    stats = {}
    for z in zones:
        with rasterio.open(DATA / "ancillary" / f"{z}.tif") as a:
            gsw = a.read(4)
        from scipy.ndimage import binary_dilation
        domain = binary_dilation(gsw > 0, iterations=10)
        (DATA / "water_sam" / z).mkdir(parents=True, exist_ok=True)
        for f in sorted((DATA / "water" / z).glob("2026*.tif")):
            t = time.time()
            with rasterio.open(f) as r:
                seed, prof = r.read(1), r.profile
            with rasterio.open(DATA / "filtered" / z / f.name) as r:
                hh, hv = r.read(1), r.read(2)
            out, acc, rej = refine(pred, hh, hv, seed, domain)
            with rasterio.open(DATA / "water_sam" / z / f.name, "w", **prof) as w:
                w.write(out, 1)
            px = prof["transform"].a ** 2 / 1e6
            stats.setdefault(z, {})[f.stem] = dict(seed_ow_km2=round(float((seed == 1).sum() * px), 2),
                                                   sam_ow_km2=round(float((out == 1).sum() * px), 2),
                                                   accepted=acc, rejected=rej, seconds=round(time.time() - t))
            print(z, f.stem, stats[z][f.stem], flush=True)
            json.dump(stats, open(DATA / "water_sam" / "sam_stats.json", "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1:] or ["cernavoda", "balta_mica_brailei", "delta"])
