"""查自带外框：外圈 1–4px 每一圈颜色几乎一样（标准差小）就算有框。"""
import sys, pathlib
from PIL import Image
import statistics as st
R1 = pathlib.Path(__file__).resolve().parent / "out" / "r1"
def ring(im, k):
    w, h = im.size; px = im.load(); out = []
    for x in range(k, w - k): out += [px[x, k], px[x, h - 1 - k]]
    for y in range(k, h - k): out += [px[k, y], px[w - 1 - k, y]]
    return out
def framed(p):
    im = Image.open(p).convert("RGB")
    res = []
    for k in range(4):
        r = ring(im, k)
        s = sum(st.pstdev([c[i] for c in r]) for i in range(3)) / 3
        res.append(round(s))
    return res, any(v < 14 for v in res)
if __name__ == "__main__":
    for p in sorted(R1.glob(f"{sys.argv[1]}*.png")):
        r, f = framed(p)
        print(("框 " if f else "   ") + p.stem, r)
