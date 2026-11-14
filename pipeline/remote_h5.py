"""Read-only, seekable file object over HTTP range requests.

Lets h5py open a remote NISAR GCOV HDF5 granule and read only the bytes
of the datasets/windows we need, instead of downloading ~1.8 GB.
Authentication to NASA Earthdata is handled by the environment's proxy.
"""
import io
import time
import requests


class HTTPRangeFile(io.RawIOBase):
    def __init__(self, url, block_size=4 * 1024 * 1024, session=None):
        self.session = session or requests.Session()
        # Resolve redirects once (ASF -> signed CloudFront URL).
        r = self.session.get(url, headers={"Range": "bytes=0-0"}, timeout=60, allow_redirects=True)
        r.raise_for_status()
        self.url = r.url
        self.size = int(r.headers["Content-Range"].split("/")[-1])
        self.pos = 0
        self.block_size = block_size
        self.cache = {}
        self.bytes_fetched = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            self.pos = offset
        elif whence == io.SEEK_CUR:
            self.pos += offset
        else:
            self.pos = self.size + offset
        return self.pos

    def tell(self):
        return self.pos

    def _block(self, i):
        if i not in self.cache:
            start = i * self.block_size
            end = min(start + self.block_size, self.size) - 1
            for attempt in range(6):  # connection resets happen on long pulls
                try:
                    r = self.session.get(self.url, headers={"Range": f"bytes={start}-{end}"}, timeout=120)
                    r.raise_for_status()
                    data = r.content
                    if len(data) != end - start + 1:
                        raise IOError(f"short read {len(data)}")
                    break
                except (requests.RequestException, IOError):
                    if attempt == 5:
                        raise
                    time.sleep(2 ** attempt)
            self.cache[i] = data
            self.bytes_fetched += len(data)
            if len(self.cache) > 256:  # cap memory at ~1 GB
                self.cache.pop(next(iter(self.cache)))
        return self.cache[i]

    def readinto(self, b):
        if self.pos >= self.size:
            return 0
        n = min(len(b), self.size - self.pos)
        out = bytearray()
        while len(out) < n:
            i, off = divmod(self.pos + len(out), self.block_size)
            blk = self._block(i)
            out += blk[off:off + n - len(out)]
        b[:n] = out
        self.pos += n
        return n
