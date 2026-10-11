"""v2 的 64 个候选拼一张：python grid.py <文件夹名…> [--sc N] → out/sheets/grid-<名>.png，格子左上角是序号（文件名 -N）。"""
import sys, pathlib, re
from PIL import Image, ImageDraw
ART = pathlib.Path(__file__).resolve().parent; R1 = ART / "out" / "r1"
args = sys.argv[1:]; sc = 2
if "--sc" in args: i = args.index("--sc"); sc = int(args[i + 1]); del args[i:i + 2]
for name in args:
    fs = sorted(R1.joinpath(name).glob("*.png"), key=lambda p: int(re.search(r"-(\d+)$", p.stem).group(1)) if re.search(r"-\d+$", p.stem) and p.stem != name else 0)
    ims = [Image.open(p).convert("RGBA") for p in fs]
    w = ims[0].width * sc + 4; h = ims[0].height * sc + 12
    cols = 8; rows = (len(ims) + cols - 1) // cols
    S = Image.new("RGB", (cols * w, rows * h), (205, 200, 190)); d = ImageDraw.Draw(S)
    for k, im in enumerate(ims):
        x, y = (k % cols) * w, (k // cols) * h
        S.paste(im.resize((im.width * sc, im.height * sc), Image.NEAREST), (x + 2, y + 10), im.resize((im.width * sc, im.height * sc), Image.NEAREST))
        d.text((x + 2, y), str(k), fill=(160, 0, 0))
    S.save(ART / "out" / "sheets" / f"grid-{name}.png")
