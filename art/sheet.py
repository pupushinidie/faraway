"""候选总览：python sheet.py <前缀> [倍数] → out/sheets/<前缀>.png，每张下面标序号（代码画的小号数字不需要，按行列读）。"""
import sys, pathlib, re
from PIL import Image, ImageDraw
ART = pathlib.Path(__file__).resolve().parent
R1 = ART / "out" / "r1"
pre = sys.argv[1]; sc = int(sys.argv[2]) if len(sys.argv) > 2 else 2
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 5
fs = sorted(p for p in R1.glob(f"{pre}*.png"))
ims = [Image.open(p).convert("RGBA") for p in fs]
w = max(i.width for i in ims) * sc; h = max(i.height for i in ims) * sc
rows = (len(ims) + cols - 1) // cols
S = Image.new("RGB", (cols * (w + 8) + 8, rows * (h + 20) + 8), (60, 60, 70))
for k, im in enumerate(ims):
    im = im.resize((im.width * sc, im.height * sc), Image.NEAREST)
    x, y = 8 + (k % cols) * (w + 8), 8 + (k // cols) * (h + 20)
    bg = Image.new("RGBA", im.size, (200, 200, 205, 255)); bg.alpha_composite(im)
    S.paste(bg.convert("RGB"), (x, y))
    ImageDraw.Draw(S).text((x, y + h + 2), fs[k].stem.replace(pre, '')[-28:], fill=(255, 255, 255))
(ART / "out" / "sheets").mkdir(exist_ok=True)
S.save(ART / "out" / "sheets" / f"{pre}.png")
print([p.name for p in fs])
