"""代码画的素材：地形花纹块 swatch/*.png（16×16 可平铺）、四色套图标 icon/colorset.png。"""
import pathlib
from PIL import Image, ImageDraw
ART = pathlib.Path(__file__).resolve().parent
F = ART / "out" / "final"
COL = {"red": (196, 52, 44), "green": (74, 160, 70), "blue": (62, 112, 196), "yellow": (226, 178, 48), "gray": (138, 132, 128)}
INK = (43, 29, 20)

def on(b, u, v):
    if b == "red":    # 圆点（蘑菇斑点）
        return (u % 8, v % 8) in {(2, 2), (3, 2), (2, 3), (3, 3), (6, 6), (7, 6), (6, 7), (7, 7)}
    if b == "green":  # 波纹（溪水）
        return (v % 8) == [0, 0, 1, 2, 2, 2, 1, 0][u % 8] + 3
    if b == "blue":   # 斜线（石纹）
        return (u + v) % 8 in (0, 1)
    if b == "yellow": # 砖格（城墙）
        return v % 8 == 7 or (u % 8 == (0 if v % 16 < 8 else 4) and v % 8 != 7)
    return (u + v) % 4 == 0 and u % 2 == 0  # 灰：细点

def swatch(b, size=16):
    c = COL[b]; dark = tuple(int(x * 0.72) for x in c); lite = tuple(min(255, int(x * 1.18)) for x in c)
    im = Image.new("RGBA", (size, size), c + (255,))
    for u in range(size):
        for v in range(size):
            if on(b, u, v):
                im.putpixel((u, v), ((246, 170, 156) if b == "red" else dark) + (255,))
    return im

def main():
    (F / "swatch").mkdir(parents=True, exist_ok=True); (F / "icon").mkdir(parents=True, exist_ok=True)
    for b in COL:
        swatch(b).save(F / "swatch" / f"{b}.png")
    ic = Image.new("RGBA", (24, 24), (0, 0, 0, 0)); d = ImageDraw.Draw(ic)
    for i, b in enumerate(["red", "green", "blue", "yellow"]):
        x, y = 2 + (i % 2) * 10, 2 + (i // 2) * 10
        ic.paste(swatch(b).crop((0, 0, 10, 10)), (x, y))
    d.rectangle([1, 1, 22, 22], outline=INK); d.line([12, 1, 12, 22], fill=INK); d.line([1, 12, 22, 12], fill=INK)
    ic.save(F / "icon" / "colorset.png")
    print("ok")

if __name__ == "__main__":
    main()
