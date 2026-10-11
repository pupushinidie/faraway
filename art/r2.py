"""第 2 轮：特效动画（animate-with-text-v3，一次性播放，只给首帧）+ 无色夜晚圣所重画（第 1 轮都带框）。一个进程。"""
import sys, pathlib
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pixellab
from r1 import NIGHT, LOOK, NO, SANCT
R1 = pixellab.ART / "out" / "r1"; OUT = pixellab.ART / "out" / "r2"
FX = {"fx-score": ("fx-star-s98.png", "the golden star spins and bursts into many small sparkles that scatter outward"),
      "fx-sanctuary": ("fx-shrine-s100.png", "the golden ring of light expands outward and small sparkles drift upward and scatter")}
def anim(name, seed):
    folder = OUT / name / f"s{seed}"
    if folder.exists() and any(folder.glob("*.png")): return
    pixellab.animate(f"{name}-s{seed}", {"first_frame": pixellab.b64_image(R1 / FX[name][0]), "action": FX[name][1],
                                         "frame_count": 8, "no_background": True, "seed": 300 + seed}, folder)
def sanct(seed):
    t = f"sanct-gray-night-s{seed}"
    if (OUT / f"{t}.png").exists(): return
    pixellab.generate_image(t, {"description": f"pixel art tall portrait illustration of {SANCT['gray-night']}, {NIGHT}, {LOOK}, "
                                f"full bleed scene that fills the whole image edge to edge, {NO}",
                                "image_size": {"width": 80, "height": 120}, "detail": "highly detailed", "seed": seed}, OUT, endpoint="/create-image-pixen")
def run(t):
    try:
        (anim(*t[1:]) if t[0] == "a" else sanct(t[1])); print(t, "ok", flush=True)
    except Exception as e: print(t, "失败", e, flush=True)
if __name__ == "__main__":
    tasks = [("a", n, s) for n in FX for s in (1, 2, 3)] + [("s", s) for s in (45, 46, 47, 48)]
    with ThreadPoolExecutor(max_workers=10) as p: list(p.map(run, tasks))
    print("done", flush=True)
