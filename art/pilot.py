import sys, pathlib
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pixellab
O = pixellab.ART / "out" / "pilot"
D = ("pixel art square card illustration, side view landscape vignette of a forest of giant red-capped mushrooms with white spots "
     "and crimson foliage, mossy ground, daytime sunlit blue sky with puffy clouds at the top, bright cheerful 16-bit fantasy RPG style, "
     "vivid saturated colors, clean dark outlines, no text, no letters, no people, no border, no frame")
def a():
    pixellab.generate_image("pf-red", {"description": D, "image_size": {"width": 128, "height": 128}, "detail": "highly detailed",
        "color_image": pixellab.b64_image(O / "day-1-s7.png"), "seed": 21}, O)
def b():
    pixellab.generate_image("pf-red-nocol", {"description": D, "image_size": {"width": 128, "height": 128}, "detail": "highly detailed", "seed": 21}, O)
def c():
    pixellab.generate_image("px-red", {"description": D, "image_size": {"width": 128, "height": 128}, "detail": "highly detailed", "seed": 21}, O, endpoint="/create-image-pixen")
def d():
    pixellab.generate_image("px-red256", {"description": D, "image_size": {"width": 256, "height": 256}, "detail": "highly detailed", "seed": 21}, O, endpoint="/create-image-pixen")
def run(f):
    try: f(); print(f.__name__, "ok", flush=True)
    except Exception as e: print(f.__name__, "失败", e, flush=True)
with ThreadPoolExecutor(4) as ex: list(ex.map(run, [a, b, c, d]))
