"""从规则书 §2.3、§2.4 的表格生成卡牌数据 packages/game/src/cards-data.ts，并和选题 agent 的 JSON 草稿比对。

用法：python scripts/gen-cards.py [规则书路径] [草稿 JSON 路径]
规则书表格为准；和草稿不一致的地方打印出来（不影响生成）。
"""
import json, os, re, sys

BOOK = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Desktop/游戏规则/遥远之地.md")
DRAFT = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser("~/projects/pipeline/games/faraway/assets/scout/faraway-cards.json")
OUT = os.path.join(os.path.dirname(__file__), "..", "packages", "game", "src", "cards-data.ts")

COLOR = {"红": "red", "绿": "green", "蓝": "blue", "黄": "yellow", "无": None}
WONDER = {"石": "stone", "兽": "chimera", "蓟": "thistle"}
ICON = {"奇石": "stone", "奇美拉": "chimera", "蓟草": "thistle", "线索": "clue", "夜": "night"}


def counts(cell):
    cell = cell.strip()
    if cell in ("—", "-", ""):
        return {}
    out = {}
    for part in cell.split("、"):
        m = re.fullmatch(r"(石|兽|蓟)×(\d)", part.strip())
        assert m, f"看不懂：{cell!r}"
        out[WONDER[m.group(1)]] = int(m.group(2))
    return out


def quest(cell):
    cell = cell.strip()
    if cell in ("—", "-", ""):
        return None
    m = re.fullmatch(r"固定 (\d+)", cell)
    if m:
        return {"type": "flat", "points": int(m.group(1))}
    m = re.fullmatch(r"每个(奇石|奇美拉|蓟草|线索|夜) (\d+)", cell)
    if m:
        return {"type": "perIcon", "points": int(m.group(2)), "icon": ICON[m.group(1)]}
    m = re.fullmatch(r"每张(.)(?:/(.))?色 (\d+)", cell)
    if m:
        colors = [COLOR[m.group(1)]] + ([COLOR[m.group(2)]] if m.group(2) else [])
        return {"type": "perColor", "points": int(m.group(3)), "colors": colors}
    m = re.fullmatch(r"每套四色 (\d+)", cell)
    if m:
        return {"type": "perColorSet", "points": int(m.group(1))}
    raise AssertionError(f"看不懂任务：{cell!r}")


text = open(BOOK, encoding="utf-8").read()
regions, sanctuaries = [], []
for line in text.splitlines():
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    if len(cells) == 7 and re.fullmatch(r"\d+", cells[0]):
        regions.append({
            "id": int(cells[0]), "color": COLOR[cells[1]], "night": cells[2] == "夜",
            "clues": 1 if cells[3] == "1" else 0, "wonders": counts(cells[4]),
            "prereq": counts(cells[5]), "quest": quest(cells[6]),
        })
    elif len(cells) == 6 and re.fullmatch(r"S\d\d", cells[0]):
        sanctuaries.append({
            "id": int(cells[0][1:]), "color": COLOR[cells[1]], "night": cells[2] == "夜",
            "clues": 1 if cells[3] == "1" else 0, "wonders": counts(cells[4]), "quest": quest(cells[5]),
        })

assert [r["id"] for r in regions] == list(range(1, 69)), "区域卡编号不连续"
assert [s["id"] for s in sanctuaries] == list(range(1, 46)), "圣所卡编号不连续"

if os.path.exists(DRAFT):
    draft = json.load(open(DRAFT, encoding="utf-8"))
    diffs = 0
    for kind, mine in (("regions", regions), ("sanctuaries", sanctuaries)):
        theirs = {c["id"]: c for c in draft[kind]}
        for card in mine:
            other = theirs.get(card["id"])
            if other is None:
                print(f"草稿缺 {kind} {card['id']}"); diffs += 1; continue
            for key, value in card.items():
                if other.get(key) != value:
                    print(f"{kind} {card['id']} {key}: 规则书 {value} / 草稿 {other.get(key)}"); diffs += 1
    print(f"和草稿比对：{diffs} 处不同")

def ts(value):
    return json.dumps(value, ensure_ascii=False, separators=(", ", ": "))

with open(OUT, "w", encoding="utf-8") as f:
    f.write("// 由 scripts/gen-cards.py 从规则书 §2.3、§2.4 的表格生成，不要手改。\n")
    f.write('import type { RegionCard, SanctuaryCard } from "./types.js";\n\n')
    f.write("export const REGION_CARDS: readonly RegionCard[] = [\n")
    for r in regions:
        f.write(f"  {ts(r)},\n")
    f.write("];\n\nexport const SANCTUARY_CARDS: readonly SanctuaryCard[] = [\n")
    for s in sanctuaries:
        f.write(f"  {ts(s)},\n")
    f.write("];\n")
print(f"写好 {OUT}：区域 {len(regions)} 张，圣所 {len(sanctuaries)} 张")
