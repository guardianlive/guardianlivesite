"""One-off generator for favicons, the OG share image, and optimized screenshots."""
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(ROOT, "logos", "translucent_background.PNG")
IMAGES = os.path.join(ROOT, "images")

MAGENTA = (235, 52, 195)
RED = (235, 52, 70)


def load_logo_cropped():
    logo = Image.open(LOGO).convert("RGBA")
    bbox = logo.getchannel("A").getbbox()
    logo = logo.crop(bbox)
    # square-pad to the larger dimension
    side = max(logo.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(logo, ((side - logo.width) // 2, (side - logo.height) // 2))
    return sq


def gen_favicons(logo):
    big = logo.resize((512, 512), Image.LANCZOS)
    big.resize((192, 192), Image.LANCZOS).save(os.path.join(ROOT, "favicon.png"))
    big.resize((32, 32), Image.LANCZOS).save(os.path.join(ROOT, "favicon-32.png"))
    big.resize((256, 256), Image.LANCZOS).save(
        os.path.join(ROOT, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)]
    )
    # apple-touch-icon needs an opaque background
    apple = Image.new("RGBA", (180, 180), (10, 10, 20, 255))
    inner = big.resize((132, 132), Image.LANCZOS)
    apple.alpha_composite(inner, (24, 24))
    apple.convert("RGB").save(os.path.join(ROOT, "apple-touch-icon.png"))
    print("favicons done")


def get_font(size, weight="Bold"):
    """Inter variable font (downloaded once), falling back to Segoe UI."""
    inter_path = os.path.join(ROOT, "_inter_tmp.ttf")
    if not os.path.exists(inter_path):
        try:
            urllib.request.urlretrieve(
                "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf",
                inter_path,
            )
        except Exception as e:
            print("Inter download failed:", e)
    if os.path.exists(inter_path):
        try:
            f = ImageFont.truetype(inter_path, size)
            f.set_variation_by_name(weight)
            return f
        except Exception as e:
            print("Inter load failed:", e)
    fallback = {"Bold": "segoeuib.ttf", "SemiBold": "seguisb.ttf", "Regular": "segoeui.ttf"}
    return ImageFont.truetype("C:\\Windows\\Fonts\\" + fallback.get(weight, "segoeui.ttf"), size)


def radial_glow(size, color, alpha):
    """A blurred elliptical glow layer."""
    w, h = size
    glow = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(glow)
    d.ellipse([w * 0.3, h * 0.3, w * 0.7, h * 0.7], fill=alpha)
    glow = glow.filter(ImageFilter.GaussianBlur(min(w, h) // 8))
    layer = Image.new("RGBA", (w, h), color + (0,))
    layer.putalpha(glow)
    return layer


def gradient_text(text, font, start=MAGENTA, end=RED):
    """Render text filled with the brand 135deg gradient."""
    dummy = Image.new("RGBA", (10, 10))
    bbox = ImageDraw.Draw(dummy).textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).text((-bbox[0], -bbox[1]), text, font=font, fill=255)
    grad = Image.new("RGBA", (w, h))
    px = grad.load()
    for x in range(w):
        for y in range(h):
            t = (x / max(w - 1, 1) + y / max(h - 1, 1)) / 2
            px[x, y] = tuple(int(s + (e - s) * t) for s, e in zip(start, end)) + (255,)
    grad.putalpha(mask)
    return grad


def gen_og_image(logo):
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), (4, 4, 7))
    # vertical gradient base
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        # 040407 -> 0a0a14 -> 040407
        mix = 1 - abs(t - 0.45) * 2
        c = (int(4 + 6 * mix), int(4 + 6 * mix), int(7 + 13 * mix))
        d.line([(0, y), (W, y)], fill=c)
    img = img.convert("RGBA")
    # brand glows
    glow_m = radial_glow((700, 700), MAGENTA, 38)
    img.alpha_composite(glow_m, (-200, -250))
    glow_r = radial_glow((700, 700), RED, 30)
    img.alpha_composite(glow_r, (700, 200))

    # logo
    lg = logo.resize((240, 240), Image.LANCZOS)
    img.alpha_composite(lg, ((W - 240) // 2, 64))

    # wordmark
    f_name = get_font(86, "Bold")
    word = gradient_text("GuardianLive", f_name)
    img.alpha_composite(word, ((W - word.width) // 2, 344))

    # tagline
    f_tag = get_font(34, "SemiBold")
    tag = "Personal Safety, Intuitive & Accessible"
    tb = ImageDraw.Draw(img).textbbox((0, 0), tag, font=f_tag)
    ImageDraw.Draw(img).text(
        ((W - (tb[2] - tb[0])) // 2, 478), tag, font=f_tag, fill=(220, 220, 226, 255)
    )

    os.makedirs(IMAGES, exist_ok=True)
    img.convert("RGB").save(os.path.join(IMAGES, "og-image.png"), optimize=True)
    print("og-image done")


def optimize_screenshots():
    names = [
        "timer_view", "stream_view", "contacts_screen", "timer_alert1", "timer_alert2",
        "active_contact", "active_contact_timer1", "active_contact_timer2", "at_risk_contact",
    ]
    for n in names:
        src = Image.open(os.path.join(IMAGES, n + ".png")).convert("RGB")
        target_w = 640
        target_h = round(src.height * target_w / src.width)
        small = src.resize((target_w, target_h), Image.LANCZOS)
        small.save(os.path.join(IMAGES, f"{n}-640.webp"), quality=82, method=6)
        small.save(os.path.join(IMAGES, f"{n}-640.png"), optimize=True)
        print(n, small.size)


if __name__ == "__main__":
    logo = load_logo_cropped()
    gen_favicons(logo)
    gen_og_image(logo)
    optimize_screenshots()
    tmp = os.path.join(ROOT, "_inter_tmp.ttf")
    if os.path.exists(tmp):
        os.remove(tmp)
