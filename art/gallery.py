"""生成画廊拍板 JSON（~/projects/pipeline/games/faraway/assets/gallery-decision.json）和放大后的选项图 out/gallery/。"""
import json, pathlib
from PIL import Image, ImageDraw
ART = pathlib.Path(__file__).resolve().parent; OUT = ART / "out"; G = OUT / "gallery"; G.mkdir(exist_ok=True)
DEST = pathlib.Path.home() / "projects/pipeline/games/faraway/assets/gallery-decision.json"

def v2(folder, i): return f"r1/{folder}/{folder}.png" if i == 0 else f"r1/{folder}/{folder}-{i}.png"
def big(srcs, name, sc, bg=(232, 224, 206)):
    ims = [Image.open(OUT / s).convert("RGBA") for s in srcs]
    ims = [i.resize((i.width * sc, i.height * sc), Image.NEAREST) for i in ims]
    W = sum(i.width for i in ims) + 8 * (len(ims) + 1); H = max(i.height for i in ims) + 16
    c = Image.new("RGBA", (W, H), bg + (255,)); x = 8
    for i in ims: c.alpha_composite(i, (x, 8)); x += i.width + 8
    p = G / f"{name}.png"; c.convert("RGB").save(p); return str(p)
def fxstrip(folder, name, sc=2):
    fr = sorted((OUT / folder).glob("*.png"))
    return big([str(f.relative_to(OUT)) for f in fr], name, sc, bg=(40, 32, 60))

Q = []
def q(id_, question, opts, desc=""):
    Q.append({"id": id_, "type": "choice", "question": question, "options": opts, "allowOther": True, "required": False, **({"help": desc} if desc else {})})
def opt(value, label, images, rec=False, d=""):
    o = {"value": value, "label": label, "images": images}
    if rec: o["recommended"] = True
    if d: o["description"] = d
    return o

q("preview", "牌桌效果示意（定稿拼的，只看不用选；卡框、编号、任务框由界面用代码画，这里只是示意）",
  [opt("ok", "整体可以", [str(OUT / "preview-night.png"), str(OUT / "preview-day.png"), str(OUT / "preview-zoom.png")], True)])

REG = {"red-day": ([32, 33, 35], [31, 34]), "red-night": ([31, 33, 35], [32, 34]), "green-day": ([31, 33, 34], [32, 35]),
       "green-night": ([31, 32, 33], [34, 35]), "blue-day": ([31, 32, 35], [33, 34]), "blue-night": ([32, 33, 34], [31, 35]),
       "yellow-day": ([31, 32, 33], [34, 35]), "yellow-night": ([31, 32, 33], [34, 35])}
NAME = {"red": "菌林（红）", "green": "溪谷（绿）", "blue": "石原（蓝）", "yellow": "岩城（黄）"}
for k, (pick, rest) in REG.items():
    b, t = k.split("-")
    q(f"region-{k}", f"区域卡底图：{NAME[b]}·{'夜晚' if t == 'night' else '白天'}（3 张变体轮流用）",
      [opt("pick", "这 3 张", [big([f"r1/region-{k}-s{s}.png" for s in pick], f"region-{k}-pick", 2)], True,
           "构图各不相同、没有自带外框、左上右上留得出徽章位置"),
       opt("all", "从全部 5 张里换（备注写换哪张）", [big([f"r1/region-{k}-s{s}.png" for s in pick + rest], f"region-{k}-all", 2)],
           d="顺序：" + "、".join(f"s{s}" for s in pick + rest) + "（后两张带框或构图偏弱，没选）")])

RES = {"red-1": ([19, 10, 27], "森林采菇老人"), "red-2": ([43, 7, 35], "提灯猫头鹰"), "red-3": ([3, 11, 25], "红斗篷小探险家"),
       "red-4": ([0, 24, 32], "叶领红蝾螈"), "green-1": ([12, 24, 11], "斗笠青蛙渔夫"), "green-2": ([9, 1, 8], "叶冠草药师"),
       "green-3": ([2, 26, 24], "蓝领巾水獭"), "green-4": ([35, 0, 34], "白鹿灵"), "blue-1": ([15, 47, 6], "水晶石像"),
       "blue-2": ([9, 13, 29], "观星老人"), "blue-3": ([11, 33, 35], "牧羊少年"), "blue-4": ([20, 3, 19], "水晶甲虫"),
       "yellow-1": ([0, 9, 1], "头巾蜥蜴商人"), "yellow-2": ([2, 0, 25], "岩城守卫"), "yellow-3": ([0, 13, 7], "护目镜狐獴斥候"),
       "yellow-4": ([12, 2, 4], "商队旅人")}
for k, (ids, nm) in RES.items():
    b = k.split("-")[0]
    q(f"resident-{k}", f"居民头像 {NAME[b]} {k[-1]}：{nm}（40×40）",
      [opt(f"i{i}", f"候选 {i}", [big([v2(f'res-{k}', i)], f"res-{k}-{i}", 4)], n == 0,
           "挑定：轮廓清楚、缩到卡上 40px 也认得出，不像已知角色" if n == 0 else "") for n, i in enumerate(ids)])

ICO = {"stone": ([0, 6, 16], "奇石"), "chimera": ([32, 0, 2], "灵兽"), "thistle": ([12, 20, 4], "蓟草"), "clue": ([2, 19, 27], "线索"),
       "night": ([34, 20, 36], "夜（月亮）"), "day": ([3, 0, 8], "昼（太阳）"), "biome-red": ([0, 8, 16], "菌林徽记"),
       "biome-green": ([24, 3, 13], "溪谷徽记"), "biome-blue": ([5, 20, 13], "石原徽记"), "biome-yellow": ([24, 8, 18], "岩城徽记")}
for k, (ids, nm) in ICO.items():
    note = {"chimera": "灵兽选了粉翅小橙狐，没挑红色带角的（像小恶魔）", "night": "没用带五角星的弯月（像星月旗）",
            "day": "没用带脸的太阳"}.get(k, "24px 下最好认")
    q(f"icon-{k}", f"图标：{nm}（24×24）",
      [opt(f"i{i}", f"候选 {i}", [big([v2(f'icon-{k}', i)], f"icon-{k}-{i}", 6)], n == 0, note if n == 0 else "") for n, i in enumerate(ids)])

SAN = {"red": (["r1/sanct-red-s43.png", "r1/sanct-red-s42.png", "r1/sanct-red-s44.png"], "红色圣所（蘑菇神龛）"),
       "green": (["r1/sanct-green-s42.png", "r1/sanct-green-s43.png", "r1/sanct-green-s41.png"], "绿色圣所（泉水神龛）"),
       "blue": (["r1/sanct-blue-s42.png", "r1/sanct-blue-s43.png", "r1/sanct-blue-s44.png"], "蓝色圣所（水晶石阵）"),
       "yellow": (["r1/sanct-yellow-s43.png", "r1/sanct-yellow-s42.png", "r1/sanct-yellow-s44.png"], "黄色圣所（金顶神殿）"),
       "gray-day-1": (["r1/sanct-gray-day-s42.png", "r1/sanct-gray-day-s43.png", "r1/sanct-gray-day-s44.png"], "无色圣所（白天）1"),
       "gray-day-2": (["r1/sanct-gray-day-s41.png", "r1/sanct-gray-day-s44.png", "r1/sanct-gray-day-s43.png"], "无色圣所（白天）2"),
       "gray-night": (["r2/sanct-gray-night-s47.png", "r2/sanct-gray-night-s46.png", "r1/sanct-gray-night-s43.png"], "无色圣所（夜晚，带月亮）")}
for k, (srcs, nm) in SAN.items():
    q(f"sanct-{k}", f"圣所卡底图：{nm}（80×120）",
      [opt(f"c{n}", f"候选 {n + 1}", [big([s], f"sanct-{k}-{n}", 3)], n == 0, "自带的细外框导出时会剥掉" if n == 0 else "") for n, s in enumerate(srcs)])

for k, srcs, nm in (("region", ["r1/back-region-s51.png", "r1/back-region-s54.png", "r1/back-region-s53.png"], "区域卡背（128×128）"),
                    ("sanct", ["r1/back-sanct-s58.png", "r1/back-sanct-s56.png", "r1/back-sanct-s55.png"], "圣所卡背（80×120）")):
    q(f"back-{k}", nm, [opt(f"c{n}", f"候选 {n + 1}", [big([s], f"back-{k}-{n}", 3)], n == 0) for n, s in enumerate(srcs)])
for t, seeds, nm in (("night", [84, 86, 85], "夜间牌桌背景（默认主题）"), ("day", [82, 81, 83], "白天牌桌背景")):
    q(f"bg-{t}", f"{nm}（512×288，界面放大 3 倍铺满，上面盖半透明面板）",
      [opt(f"s{s}", f"候选 s{s}", [str(OUT / f"r1/bg-{t}-s{s}.png")], n == 0) for n, s in enumerate(seeds)])
q("fx-score", "特效：翻开计分时的星光（48×48，横排 8 帧，一次性）",
  [opt(f"s{s}", f"种子 {s}", [fxstrip(f"r2/fx-score/s{s}", f"fx-score-s{s}")], s == 2, "星星收缩后炸成碎光散开，最干净" if s == 2 else "") for s in (2, 1, 3)])
q("fx-sanctuary", "特效：发现圣所的光环（64×64，横排 8 帧，一次性）",
  [opt(f"s{s}", f"种子 {s}", [fxstrip(f"r2/fx-sanctuary/s{s}", f"fx-sanctuary-s{s}")], s == 3, "光环散成碎光，没有整片发白的帧" if s == 3 else "") for s in (3, 2, 1)])
q("cover", "大厅封面（384×192，不画字不画人）",
  [opt(s, f"候选 {s}", [str(OUT / f"covers/faraway-{s}.png")], n == 0) for n, s in enumerate(["px-s91", "px-s93", "pf-s96"])])
q("swatch", "地形花纹色条（代码画，只看不用选）：红=圆点（蘑菇斑）、绿=波纹（溪水）、蓝=斜纹（石纹）、黄=砖格（城墙）、灰=细点；色盲也能靠花纹分清",
  [opt("ok", "可以", [big(["final/swatch/red.png", "final/swatch/green.png", "final/swatch/blue.png", "final/swatch/yellow.png", "final/swatch/gray.png", "final/icon/colorset.png"], "swatch", 6)], True)])

doc = {"id": "art-gallery", "title": "遥远之地：正式美术画廊", "stage": "art", "blocking": False,
       "intro": "遥远之地正式美术（方向「晴空奇境」）的候选，每样一题。标「推荐」的是美术自查后挑定、已经导出到 art/out/final 的那张，不选就按推荐上线；想换哪张随时来换，都不满意选「其他」写备注，美术重画。\n\n图上没有任何文字和数字：编号、昼夜徽章、奇观徽章、任务框、分数都由界面用代码叠上。第一题是用定稿拼的牌桌示意（夜间、白天、手牌放大 2 倍）。",
       "questions": Q}
DEST.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
print("题数", len(Q))
