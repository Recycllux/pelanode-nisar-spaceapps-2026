"""Step A1: list every NISAR L2 GCOV granule of track 065 D (frames 065, 066)
over the corridor from NASA CMR, and write data/nisar_manifest.csv."""
import csv
import re
import requests
from config import CMR, COLLECTIONS, TRACK, DIRECTION, FRAMES, START, END, MANIFEST

BBOX = "27.85,44.20,29.75,45.50"
NAME = re.compile(r"NISAR_L2_(?P<lvl>\w\w)_GCOV_(?P<cycle>\d{3})_(?P<track>\d{3})_(?P<dir>[AD])_"
                  r"(?P<frame>\d{3})_\d{4}_(?P<pol>\w{4})_\w_(?P<start>\d{8}T\d{6})_")


def search():
    rows = []
    for status, cid in COLLECTIONS.items():
        page = 1
        while True:
            r = requests.get(CMR, params={"collection_concept_id": cid, "bounding_box": BBOX,
                                          "temporal": f"{START},{END}", "page_size": 2000,
                                          "page_num": page}, timeout=60)
            r.raise_for_status()
            entries = r.json()["feed"]["entry"]
            for e in entries:
                m = NAME.match(e["title"])
                if not m or m["track"] != TRACK or m["dir"] != DIRECTION or m["frame"] not in FRAMES:
                    continue
                h5 = [l["href"] for l in e["links"] if l["href"].endswith(".h5")]
                rows.append({"date": m["start"][:8], "frame": m["frame"], "cycle": m["cycle"],
                             "polarization": m["pol"], "status": status,
                             "granule": e["title"], "url": h5[0] if h5 else ""})
            if len(entries) < 2000:
                break
            page += 1
    rows.sort(key=lambda r: (r["date"], r["frame"]))
    return rows


if __name__ == "__main__":
    rows = search()
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    with open(MANIFEST, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    dates = sorted({r["date"] for r in rows})
    print(f"{len(rows)} granules, {len(dates)} dates: {', '.join(dates)}")
