"""按 selection.json 把候选导出到 out/final（目录结构 = apps/web/public/art）。
selection.json：{ "<final 路径>": {"src": "<out/ 下的相对路径>", "strip": n像素外框, "fit": [w,h] 透明图裁边后放进画布底部/居中} }
另外由代码生成 region-sm/、sanctuary-sm/、back/*-sm.png（缩一半）。
"""
import json, pathlib
from PIL import Image
ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out"; F = OUT / "final"

def strip(im, n):
    """剥掉 n 像素外框：外圈用往里第 n 圈的像素向外复制。"""
    if n <= 0: return im
    w, h = im.size; inner = im.crop((n, n, w - n, h - n))
    big = inner.resize((w, h), Image.NEAREST)  # 先占位
    big.paste(inner, (n, n))
    px = big.load(); ipx = inner.load(); iw, ih = inner.size
    for x in range(w):
        for y in range(h):
            if n <= x < w - n and n <= y < h - n: continue
            px[x, y] = ipx[min(max(x - n, 0), iw - 1), min(max(y - n, 0), ih - 1)]
    return big

def despeckle(im, min_px=12):
    """去掉和主体不相连的小碎块（v2 候选常在边上带别的格子漏过来的像素）。"""
    a = im.getchannel("A"); W, H = im.size; px = a.load(); seen = set(); comps = []
    for x in range(W):
        for y in range(H):
            if px[x, y] > 8 and (x, y) not in seen:
                stack = [(x, y)]; seen.add((x, y)); comp = []
                while stack:
                    u, v = stack.pop(); comp.append((u, v))
                    for du in (-1, 0, 1):
                        for dv in (-1, 0, 1):
                            q = (u + du, v + dv)
                            if 0 <= q[0] < W and 0 <= q[1] < H and q not in seen and px[q] > 8:
                                seen.add(q); stack.append(q)
                comps.append(comp)
    out = im.copy(); op = out.load()
    for comp in comps:
        if len(comp) < min_px:
            for q in comp: op[q] = (0, 0, 0, 0)
    return out

def fit(im, w, h, anchor):
    im = despeckle(im)
    bb = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    im = im.crop(bb)
    if im.width > w or im.height > h:
        r = min(w / im.width, h / im.height); im = im.resize((int(im.width * r), int(im.height * r)), Image.NEAREST)
    c = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    y = h - im.height if anchor == "bottom" else (h - im.height) // 2
    c.alpha_composite(im, ((w - im.width) // 2, y)); return c

def main():
    sel = json.loads((ART / "selection.json").read_text())
    for dst, s in sel.items():
        if dst.startswith("_"): continue
        im = Image.open(OUT / s["src"]).convert("RGBA")
        im = strip(im, s.get("strip", 0))
        if "fit" in s: im = fit(im, *s["fit"], s.get("anchor", "center"))
        p = F / dst; p.parent.mkdir(parents=True, exist_ok=True)
        if "fit" not in s: im = im.convert("RGB")
        im.save(p)
        if dst.startswith(("region/", "sanctuary/", "back/")):
            d, name = dst.split("/")
            sm = im.reduce(2)
            if d == "back": q = F / "back" / name.replace(".png", "-sm.png")
            else: q = F / f"{d}-sm" / name
            q.parent.mkdir(parents=True, exist_ok=True); sm.save(q)
    print("导出", len([k for k in sel if not k.startswith('_')]))

if __name__ == "__main__":
    main()
