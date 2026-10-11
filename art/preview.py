"""用定稿拼一个牌桌示意（夜间/白天背景各一张）：out/preview-night.png、out/preview-day.png。卡框、数字、任务框都是代码画的，只是示意界面怎么叠。"""
import pathlib
from PIL import Image, ImageDraw
ART = pathlib.Path(__file__).resolve().parent; F = ART / "out" / "final"
INK = (43, 29, 20); FRAME = (244, 228, 193); BADGE = (255, 250, 236)
COL = {"red": (196, 52, 44), "green": (74, 160, 70), "blue": (62, 112, 196), "yellow": (226, 178, 48), "gray": (138, 132, 128)}
FONT = {"0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001",
        "5": "111100111001111", "6": "111100111101111", "7": "111001001001001", "8": "111101111101111", "9": "111101111001111",
        "x": "000101010101000"}
def L(p): return Image.open(F / p).convert("RGBA")
def digits(d, s, x, y, col, sc=2):
    for ci, ch in enumerate(str(s)):
        for i, b in enumerate(FONT[ch]):
            if b == "1":
                px, py = x + ci * 4 * sc + (i % 3) * sc, y + (i // 3) * sc
                d.rectangle([px, py, px + sc - 1, py + sc - 1], fill=col)
def tile(img, w, h):
    t = Image.new("RGBA", (w, h))
    for x in range(0, w, img.width):
        for y in range(0, h, img.height): t.paste(img, (x, y))
    return t
def badge(c, d, x, y, icon, w=26):
    d.rounded_rectangle([x, y, x + w - 1, y + w - 1], 5, fill=BADGE, outline=INK)
    c.alpha_composite(icon, (x + (w - icon.width) // 2, y + (w - icon.height) // 2))
def region(id_, color, night, wonders=(), clue=False, prereq=(), task=None):
    B, S = 4, 128; W, H = S + 2 * B, S + 2 * B + 10
    c = Image.new("RGBA", (W, H), FRAME + (255,)); d = ImageDraw.Draw(c)
    c.paste(L(f"region/{color}-{'night' if night else 'day'}-{id_ % 3 + 1}.png"), (B, B))
    c.alpha_composite(tile(L(f"swatch/{color}.png"), S, 8), (B, S + B + 1))
    d.rectangle([0, 0, W - 1, H - 1], outline=INK); d.rectangle([B - 1, B - 1, B + S, B + S], outline=INK)
    cx, cy, r = B + 15, B + 14, 12
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BADGE, outline=INK)
    digits(d, id_, cx - (len(str(id_)) * 8 - 2) // 2, cy - 5, INK)
    x = cx + r + 2
    badge(c, d, x, cy - 13, L("icon/night.png" if night else "icon/day.png")); x += 28
    if clue: badge(c, d, x, cy - 13, L("icon/clue.png"))
    x = W - B - 28
    for wn in wonders: badge(c, d, x, B + 2, L(f"icon/{wn}.png")); x -= 28
    if task:
        c.alpha_composite(L(f"resident/{color}-{id_ % 4 + 1}.png"), (B + 2, B + S - 40))
        icon, pts = task
        bw = 30 + (len(str(pts)) * 8) + (28 if icon else 0)
        bx, by = W - B - bw - 2, B + S - 30
        d.rounded_rectangle([bx, by, bx + bw, by + 27], 6, fill=BADGE, outline=INK)
        digits(d, pts, bx + 7, by + 8, INK)
        if icon: c.alpha_composite(L(f"icon/{icon}.png"), (bx + 8 + len(str(pts)) * 8 + 2, by + 2))
        if prereq:
            pw = 6 + 26 * len(prereq); px = W - B - pw - 2; py = by - 30
            d.rounded_rectangle([px, py, px + pw, py + 27], 6, fill=(255, 240, 200), outline=INK)
            for k, p in enumerate(prereq): c.alpha_composite(L(f"icon/{p}.png"), (px + 4 + k * 26, py + 2))
    return c
def sanct(kind, color, night=False, wonders=(), clue=False, task=None):
    B, w, h = 4, 80, 120; W, H = w + 2 * B, h + 2 * B + 10
    c = Image.new("RGBA", (W, H), FRAME + (255,)); d = ImageDraw.Draw(c)
    c.paste(L(f"sanctuary/{kind}.png"), (B, B))
    c.alpha_composite(tile(L(f"swatch/{color}.png"), w, 8), (B, h + B + 1))
    d.rectangle([0, 0, W - 1, H - 1], outline=INK); d.rectangle([B - 1, B - 1, B + w, B + h], outline=INK)
    x = B + 2
    if night: badge(c, d, x, B + 2, L("icon/night.png")); x += 28
    if clue: badge(c, d, x, B + 2, L("icon/clue.png"))
    for wn in wonders: badge(c, d, W - B - 28, B + 2, L(f"icon/{wn}.png"))
    if task:
        icon, pts = task; bw = 58
        d.rounded_rectangle([B + 6, B + h - 32, B + 6 + bw, B + h - 5], 6, fill=BADGE, outline=INK)
        digits(d, pts, B + 13, B + h - 24, INK); c.alpha_composite(L(f"icon/{icon}.png"), (B + 12 + len(str(pts)) * 8 + 4, B + h - 30))
    return c
CARDS = [region(17, "blue", False, ["stone"], prereq=["chimera", "chimera"], task=("stone", 3)),
         region(5, "green", False, ["chimera"], task=(None, 2)),
         region(23, "red", True, ["stone", "chimera"], task=("colorset", 10)),
         region(28, "red", True, ["stone"], task=("chimera", 3)),
         region(33, "yellow", True, clue=True, task=("thistle", 3)),
         region(12, "yellow", False, ["thistle"], clue=True),
         region(41, "green", True, ["thistle"], task=("night", 2), prereq=["stone"]),
         region(58, "blue", False, task=("biome-yellow", 2), prereq=["thistle", "stone", "chimera"])]
SAN = [sanct("blue", "blue", task=("biome-blue" if (F / "icon/biome-blue.png").exists() else "stone", 1)),
       sanct("gray-day-2", "gray", wonders=["chimera"], clue=True), sanct("gray-night", "gray", night=True, wonders=["chimera"]),
       sanct("yellow", "yellow", task=("colorset", 4)), sanct("red", "red"), sanct("gray-day-1", "gray", task=("stone", 2))]
HAND = [region(9, "blue", False, task=(None, 5)), region(30, "red", True, ["stone"], task=("stone", 2)), region(64, "yellow", True, task=(None, 18), prereq=["stone", "stone", "thistle"])]
for theme in ("night", "day"):
    bg = Image.open(F / f"bg/{theme}.png").convert("RGBA")
    bg = bg.resize((bg.width * 3, bg.height * 3), Image.NEAREST).crop((48, 37, 48 + 1440, 37 + 790))
    veil = Image.new("RGBA", bg.size, (20, 14, 30, 110) if theme == "night" else (255, 250, 240, 90)); bg.alpha_composite(veil)
    x = 20
    for c in CARDS: bg.alpha_composite(c, (x, 330)); x += c.width + 8
    x = 20
    for c in SAN: bg.alpha_composite(c, (x, 500)); x += c.width + 8
    x = 900
    for c in HAND: bg.alpha_composite(c.resize((c.width, c.height), Image.NEAREST), (x, 620 - 0)); x += c.width + 10
    # 别人的缩略出牌区
    x = 20
    for c in CARDS[:6]: bg.alpha_composite(c.reduce(2), (x, 80)); x += c.width // 2 + 4
    bg.convert("RGB").save(ART / "out" / f"preview-{theme}.png")
# 大图：手牌一张 ×2
big = HAND[2].resize((HAND[2].width * 2, HAND[2].height * 2), Image.NEAREST); big.save(ART / "out" / "preview-zoom.png")
print("ok")
