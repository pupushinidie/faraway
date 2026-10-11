"""特效精灵图：从 r2 动画里取 7 帧 + 1 帧空白收尾，横排导出到 out/final/fx/。"""
import pathlib, json
from PIL import Image
ART = pathlib.Path(__file__).resolve().parent; R2 = ART / "out" / "r2"; F = ART / "out" / "final" / "fx"
PICK = {"score": ("fx-score", 2, [0, 2, 3, 4, 5, 6, 7]), "sanctuary": ("fx-sanctuary", 3, [0, 2, 3, 4, 5, 6, 7])}
F.mkdir(parents=True, exist_ok=True)
for out, (name, seed, idx) in PICK.items():
    fr = sorted((R2 / name / f"s{seed}").glob("*.png"))
    ims = [Image.open(fr[i]).convert("RGBA") for i in idx]
    w, h = ims[0].size
    s = Image.new("RGBA", (w * 8, h))
    for k, im in enumerate(ims): s.paste(im, (k * w, 0))
    s.save(F / f"{out}.png")
    print(out, w, h, "源", [fr[i].name for i in idx])
