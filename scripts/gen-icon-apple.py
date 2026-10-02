#!/usr/bin/env python3
"""Apple-style app icon: liquid-glass quota gauge squircle → PNG + ICO."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math
import os

S = 1024
SS = 2  # supersample
N = S * SS


def squircle_mask(size: int, radius_ratio: float = 0.2237) -> Image.Image:
    """Continuous-curvature rounded square (Apple-like)."""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    return m


def main() -> None:
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Base: deep charcoal → navy vertical gradient
    top = (28, 32, 48)
    bottom = (12, 14, 24)
    for y in range(N):
        t = y / (N - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        draw.line([(0, y), (N, y)], fill=(r, g, b, 255))

    # Soft top light
    glow = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([N * 0.15, -N * 0.35, N * 0.85, N * 0.45], fill=(255, 255, 255, 36))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=N // 8))
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)

    cx = cy = N / 2
    # Outer gauge track
    track_r = N * 0.32
    track_w = int(N * 0.072)
    draw.ellipse(
        [cx - track_r, cy - track_r, cx + track_r, cy + track_r],
        outline=(255, 255, 255, 28),
        width=track_w,
    )

    # Progress arc (~72% remaining) — green-cyan
    start = -220  # degrees
    end = start + int(360 * 0.72)
    steps = 240
    for i in range(steps):
        t = i / (steps - 1)
        ang = math.radians(start + (end - start) * t)
        # color: cyan-green → brighter green at tip
        cr = int(48 + 30 * t)
        cg = int(220 - 20 * (1 - t))
        cb = int(180 - 40 * t)
        x1 = cx + math.cos(ang) * (track_r - track_w / 2)
        y1 = cy + math.sin(ang) * (track_r - track_w / 2)
        x2 = cx + math.cos(ang) * (track_r + track_w / 2)
        y2 = cy + math.sin(ang) * (track_r + track_w / 2)
        # draw small segment as rounded cap via ellipse at points
        rr = track_w * 0.52
        draw.ellipse([x1 - rr, y1 - rr, x1 + rr, y1 + rr], fill=(cr, cg, cb, 255))
        draw.ellipse([x2 - rr, y2 - rr, x2 + rr, y2 + rr], fill=(cr, cg, cb, 255))
        mx = (x1 + x2) / 2
        my = (y1 + y2) / 2
        draw.ellipse([mx - rr, my - rr, mx + rr, my + rr], fill=(cr, cg, cb, 255))

    # Soft glow under arc
    glow2 = img.filter(ImageFilter.GaussianBlur(radius=N // 48))
    glow2 = glow2.point(lambda p: p)
    # blend glow slightly
    img = Image.blend(img, Image.alpha_composite(Image.new("RGBA", (N, N), (0, 0, 0, 0)), glow2), 0.12)
    draw = ImageDraw.Draw(img)

    # Inner glass disc
    disc_r = N * 0.22
    disc = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    dd = ImageDraw.Draw(disc)
    dd.ellipse(
        [cx - disc_r, cy - disc_r, cx + disc_r, cy + disc_r],
        fill=(255, 255, 255, 22),
        outline=(255, 255, 255, 50),
        width=int(N * 0.008),
    )
    disc = disc.filter(ImageFilter.GaussianBlur(radius=N // 200))
    img = Image.alpha_composite(img, disc)
    draw = ImageDraw.Draw(img)

    # Center needle / mark: small polished bar
    needle_len = N * 0.12
    needle_w = int(N * 0.028)
    ang = math.radians(-40)
    nx = cx + math.cos(ang) * needle_len
    ny = cy + math.sin(ang) * needle_len
    draw.line([(cx, cy), (nx, ny)], fill=(255, 255, 255, 230), width=needle_w)
    hub = int(N * 0.038)
    draw.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=(255, 255, 255, 245))

    # Specular highlight strip (glass)
    spec = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    sd = ImageDraw.Draw(spec)
    sd.ellipse(
        [N * 0.12, N * 0.04, N * 0.88, N * 0.38],
        fill=(255, 255, 255, 40),
    )
    spec = spec.filter(ImageFilter.GaussianBlur(radius=N // 12))
    img = Image.alpha_composite(img, spec)

    # Squircle mask
    mask = squircle_mask(N)
    out = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)

    # Thin inner hairline
    d2 = ImageDraw.Draw(out)
    r = int(N * 0.2237)
    d2.rounded_rectangle([2, 2, N - 3, N - 3], radius=r, outline=(255, 255, 255, 40), width=max(2, N // 220))

    final = out.resize((S, S), Image.Resampling.LANCZOS)

    os.makedirs("src-tauri/icons", exist_ok=True)
    os.makedirs("docs/ui", exist_ok=True)
    png_path = "docs/ui/icon-1024.png"
    final.save(png_path, "PNG")
    print("wrote", png_path)

    # ICO multi-size
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_path = "src-tauri/icons/icon.ico"
    final.save(ico_path, format="ICO", sizes=sizes)
    print("wrote", ico_path)

    # Also store source 1024 for tauri icon tooling
    final.save("src-tauri/icons/icon.png", "PNG")


if __name__ == "__main__":
    main()
