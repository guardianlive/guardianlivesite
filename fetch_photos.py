"""Download the six use-case lifestyle photos from Unsplash and crop them for card headers."""
import io
import os
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "images", "use-cases")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36"}

# NOTE: "rideshares" is intentionally omitted. Its card image is a custom
# generated photo (assets/rideshare_generated.png, cropped to
# images/use-cases/rideshares.{webp,jpg}) and must NOT be overwritten by this
# Unsplash fetch.
PHOTOS = {
    "walking-alone": "photo-1762806883673-510ffe58aede",
    "first-dates": "photo-1604881991405-b273c7a4386a",
    "solo-activities": "photo-1733077151233-294545fedc3e",
    "home-service": "photo-1758523670564-d1d6a734dc0b",
    "marketplace": "photo-1772909650181-a351eda9cbc7",
}

TARGET_W, TARGET_H = 800, 500

# vertical crop bias per photo: 0 = top, 1 = bottom (default 1/3)
CROP_BIAS = {}


def fetch(photo_id):
    url = f"https://images.unsplash.com/{photo_id}?w=1200&q=85&fm=jpg&fit=max"
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def center_crop(img, bias=1 / 3):
    target_ratio = TARGET_W / TARGET_H
    w, h = img.size
    if w / h > target_ratio:
        new_w = int(h * target_ratio)
        x = (w - new_w) // 2
        img = img.crop((x, 0, x + new_w, h))
    else:
        new_h = int(w / target_ratio)
        y = int((h - new_h) * bias)
        img = img.crop((0, y, w, y + new_h))
    return img.resize((TARGET_W, TARGET_H), Image.LANCZOS)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, pid in PHOTOS.items():
        img = center_crop(fetch(pid), CROP_BIAS.get(name, 1 / 3))
        img.save(os.path.join(OUT, f"{name}.webp"), quality=80, method=6)
        img.save(os.path.join(OUT, f"{name}.jpg"), quality=82, optimize=True)
        print(name, "ok")
