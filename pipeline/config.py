"""Shared settings for the RiverNexa pipeline."""
import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
# Large intermediate rasters live outside the repo (never committed).
DATA = Path(os.environ.get("RIVERNEXA_DATA", REPO.parent / "rivernexa-data"))
RAW = DATA / "nisar_raw"          # per zone / date GeoTIFFs (linear gamma0)
MANIFEST = REPO / "data" / "nisar_manifest.csv"  # committed: what we used

CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
COLLECTIONS = {
    "provisional": "C2854338529-ASF",  # NISAR_L2_GCOV_PROVISIONAL_V1
    "validated": "C3622241360-ASF",    # NISAR_L2_GCOV_V1
}
TRACK = "065"
DIRECTION = "D"
FRAMES = ("065", "066")
START, END = "2026-06-01T00:00:00Z", "2026-11-14T23:59:59Z"
PIXEL = 20.0
