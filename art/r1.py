"""遥远之地正式美术第 1 轮候选（晴空奇境）。一个进程，线程池 10。
用法：PIXELLAB_PRIORITY=0 python r1.py [前缀…]
"""
import sys, pathlib
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pixellab

OUT = pixellab.ART / "out" / "r1"
NO = "no text, no letters, no numbers, no writing, no signs, no flags, no people, no border, no frame"
LOOK = "bright cheerful 16-bit fantasy RPG style, vivid saturated colors, clean dark outlines, crisp pixel art"
DAY = "daytime, bright blue sky with puffy white clouds at the top, warm sunlight from the upper left"
NIGHT = ("night time, deep purple starry night sky with a crescent moon, cool moonlight, a few tiny warm glowing "
         "fireflies or lit windows")
BIOME = {
    "red": "a forest of giant red-capped mushrooms with white spots, crimson and scarlet foliage, mossy ground, small red flowers",
    "green": "a lush green valley with a winding clear stream, a small waterfall, green trees and ferns, grassy banks",
    "blue": "a cool blue-grey stone plain with tall standing rocks, rocky mesas and glittering blue crystals, flagstone ground",
    "yellow": "golden yellow sandstone cliffs with an ancient city carved into the rock, arched doorways, towers and stairs, sandy ground",
}
VAR = {  # 每张换一点构图
    1: "", 2: ", seen from a little further away with a winding path", 3: ", with a close-up foreground and a distant view",
    4: ", wide panoramic composition", 5: ", with a small detail of interest in the center",
}
SANCT = {
    "red": "a small sacred shrine made of a giant red mushroom with a round wooden door, glowing red lanterns, crimson leaves around it",
    "green": "a small sacred shrine with a stone basin and a spring of clear water among green ferns and willow trees",
    "blue": "a small sacred shrine made of blue standing stones in a circle around a large blue crystal",
    "yellow": "a small sacred sandstone temple shrine with a golden dome and an arched doorway",
    "gray-day": "a small ancient grey stone shrine with a carved archway and a stone altar, ivy and moss, quiet ruins",
    "gray-night": "a small ancient grey stone shrine with a carved archway and a stone altar under the moon, quiet ruins",
}
RES_LOOK = ("pixel art character portrait bust, head and shoulders, facing slightly right, friendly expression, "
            "soft light from upper left, bold dark outline, vivid saturated colors, cute 16-bit fantasy RPG style, no text")
RES = {
    "red-1": "an old bearded forest forager with a wide brown leather hat and a wicker basket of red mushrooms",
    "red-2": "a wise brown owl wearing tiny round spectacles holding a small lantern",
    "red-3": "a young girl explorer with a red hooded cloak and freckles, holding a magnifying glass",
    "red-4": "a small orange salamander lizard with a leaf scarf",
    "green-1": "a green frog fisherman with a straw conical hat and a fishing rod",
    "green-2": "a young herbalist woman with long brown braided hair and a leaf crown",
    "green-3": "a brown otter with a small wooden paddle and a blue bandana",
    "green-4": "a gentle white stag deer spirit with small antlers decorated with leaves",
    "blue-1": "a small friendly stone golem made of grey-blue rocks with blue crystal eyes",
    "blue-2": "an old astronomer with a short grey beard, a blue hood and a brass telescope",
    "blue-3": "a mountain goat herder boy with curly black hair and a wool scarf",
    "blue-4": "a shiny blue crystal beetle with gem-like shell",
    "yellow-1": "a desert merchant lizard wearing a turban with a small coin pouch",
    "yellow-2": "a sandstone city guard with a bronze helmet and a short spear",
    "yellow-3": "a curious meerkat scout wearing tiny goggles",
    "yellow-4": "a caravan traveler woman with a sand-colored head scarf and golden earrings",
}
ICON_LOOK = "pixel art game icon, centered, soft light from upper left, bold dark outline, vivid saturated colors, no text"
ICON = {
    "stone": "a faceted glowing blue-white magic crystal gemstone",
    "chimera": "a cute little mythical spirit beast, small horned fox-like creature with feathered wings and a curly tail",
    "chimera2": "a cute little mythical qilin spirit beast with a single small horn, cloud-like mane and a fluffy tail, sitting",
    "thistle": "a spiky purple thistle flower with green spiky leaves",
    "clue": "a small rolled-up treasure map with a red X mark, parchment paper",
    "night": "a yellow crescent moon with a small star",
    "day": "a bright yellow sun with short rays",
    "biome-red": "a red mushroom with white spots",
    "biome-green": "a single green leaf with a water droplet",
    "biome-blue": "a blue-grey standing stone with a small blue crystal",
    "biome-yellow": "a golden sandstone tower with an arched window",
}
JOBS = {}
for b, desc in BIOME.items():
    for t, tdesc in (("day", DAY), ("night", NIGHT)):
        JOBS[f"region-{b}-{t}"] = ("/create-image-pixen", f"pixel art square card illustration, side view landscape vignette of {desc}, {tdesc}, {LOOK}, {NO}",
                                   128, 128, False, (31, 32, 33, 34, 35))
for k, desc in SANCT.items():
    tdesc = NIGHT if k.endswith("night") else DAY
    JOBS[f"sanct-{k}"] = ("/create-image-pixen", f"pixel art tall portrait card illustration of {desc}, {tdesc}, {LOOK}, {NO}",
                          80, 120, False, (41, 42, 43, 44))
JOBS["back-region"] = ("/create-image-pixflux", "pixel art back side of a square fantasy card, symmetric design, a golden compass rose emblem in the center "
                       "on a deep blue background with tiny stars, an ornamental golden frame with corner flourishes, " + LOOK + ", no text, no letters",
                       128, 128, False, (51, 52, 53, 54))
JOBS["back-sanct"] = ("/create-image-pixflux", "pixel art back side of a tall fantasy card, symmetric design, a small golden shrine arch emblem in the center "
                      "on a deep purple background with tiny stars, an ornamental golden frame with corner flourishes, " + LOOK + ", no text, no letters",
                      80, 120, False, (55, 56, 57, 58))
for k, desc in RES.items():
    JOBS[f"res-{k}"] = ("/generate-image-v2", f"{desc}, {RES_LOOK}", 40, 40, True, (61,))
for k, desc in ICON.items():
    JOBS[f"icon-{k}"] = ("/generate-image-v2", f"{desc}, {ICON_LOOK}", 24, 24, True, (71,))
JOBS["bg-day"] = ("/create-image-pixen", "pixel art wide fantasy landscape panorama: giant red mushroom forest on the far left, a green valley with a stream, "
                  "blue standing stones, golden sandstone cliff city on the far right, far in the distance, big open bright blue sky with puffy clouds "
                  "taking most of the image, soft gentle colors, " + LOOK + ", " + NO, 512, 288, False, (81, 82, 83))
JOBS["bg-night"] = ("/create-image-pixen", "pixel art wide fantasy landscape panorama at night: giant mushroom forest on the far left, a valley with a stream, "
                    "standing stones, a sandstone cliff city with a few warm lit windows on the far right, far in the distance, big deep purple starry "
                    "night sky with a large crescent moon taking most of the image, fireflies, " + LOOK + ", " + NO, 512, 288, False, (84, 85, 86))
COVER = ("a bright fantasy world seen from a hill: a forest of giant red mushrooms, a green valley with a waterfall, blue standing stones with "
         "crystals, a golden sandstone city carved into cliffs, a winding path leading into the distance, a few square illustrated cards "
         "scattered on the grass in the foreground, sunny sky with puffy clouds, cozy 16-bit pixel art game cover illustration, rich warm colors, "
         "crisp clean pixels, no text, no letters, no logo, no people")
JOBS["cover-px"] = ("/create-image-pixen", COVER, 384, 192, False, (91, 92, 93))
JOBS["cover-pf"] = ("/create-image-pixflux", COVER, 384, 192, False, (94, 95, 96))
JOBS["fx-star"] = ("/create-image-pixflux", "pixel art single golden four-pointed sparkle star with tiny sparkles around it, centered, bold outline, "
                   "vivid, no text", 48, 48, True, (97, 98))
JOBS["fx-shrine"] = ("/create-image-pixflux", "pixel art small ring of golden light beams and tiny sparkles rising upward, magical discovery effect, centered, "
                     "no text", 64, 64, True, (99, 100))


def run(name, seed):
    endpoint, prompt, w, h, transparent, _ = JOBS[name]
    try:
        if endpoint == "/generate-image-v2":
            folder = OUT / name
            if folder.exists() and any(folder.glob("*.png")):
                return
            pixellab.generate_async(name, {"description": prompt, "image_size": {"width": w, "height": h},
                                           "no_background": transparent, "seed": seed}, folder, endpoint=endpoint)
        else:
            target = f"{name}-s{seed}"
            if (OUT / f"{target}.png").exists():
                return
            body = {"description": prompt, "image_size": {"width": w, "height": h}, "seed": seed}
            if endpoint == "/create-image-pixen":
                body["detail"] = "highly detailed"
            else:
                body["no_background"] = transparent
                body["detail"] = "highly detailed"
            pixellab.generate_image(target, body, OUT, endpoint=endpoint)
        print(name, seed, "ok", flush=True)
    except Exception as e:
        print(name, seed, "失败", e, flush=True)


if __name__ == "__main__":
    prefixes = sys.argv[1:]
    names = [n for n in JOBS if not prefixes or any(n.startswith(p) for p in prefixes)]
    tasks = [(n, s) for n in names for s in JOBS[n][5]]
    print("任务", len(tasks), flush=True)
    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(lambda t: run(*t), tasks))
    print("done", flush=True)
