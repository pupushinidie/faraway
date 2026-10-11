import { describe, expect, it } from "vitest";
import { REGION_CARDS, SANCTUARY_CARDS, region, sanctuary, type Quest } from "../src/index.js";

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const typeCounts = (quests: (Quest | null)[]) => {
  const out: Record<string, number> = {};
  for (const quest of quests) if (quest) out[quest.type] = (out[quest.type] ?? 0) + 1;
  return out;
};

describe("规则书§2.3 区域卡核对数字", () => {
  it("68 张，编号 1–68 连续", () => {
    expect(REGION_CARDS.map((card) => card.id)).toEqual(Array.from({ length: 68 }, (_, i) => i + 1));
  });
  it("四种颜色各 17 张", () => {
    for (const color of ["red", "green", "blue", "yellow"] as const) expect(REGION_CARDS.filter((card) => card.color === color).length).toBe(17);
  });
  it("夜晚卡正好是 20–40 这 21 张；夜晚卡颜色 红7 黄7 绿4 蓝3", () => {
    const night = REGION_CARDS.filter((card) => card.night);
    expect(night.map((card) => card.id)).toEqual(Array.from({ length: 21 }, (_, i) => i + 20));
    const by = (color: string) => night.filter((card) => card.color === color).length;
    expect([by("red"), by("yellow"), by("green"), by("blue")]).toEqual([7, 7, 4, 3]);
  });
  it("18 张有线索，编号对得上", () => {
    expect(REGION_CARDS.filter((card) => card.clues).map((card) => card.id)).toEqual([6, 8, 12, 15, 20, 22, 33, 46, 49, 55, 58, 59, 60, 62, 63, 64, 65, 67]);
  });
  it("奇观：35 张卡上 奇石 18 + 灵兽 14 + 蓟草 10 = 42", () => {
    expect(REGION_CARDS.filter((card) => Object.keys(card.wonders).length).length).toBe(35);
    expect(sum(REGION_CARDS.map((card) => card.wonders.stone ?? 0))).toBe(18);
    expect(sum(REGION_CARDS.map((card) => card.wonders.chimera ?? 0))).toBe(14);
    expect(sum(REGION_CARDS.map((card) => card.wonders.thistle ?? 0))).toBe(10);
  });
  it("任务：61 张有、7 张没有（1 2 4 6 7 8 12）；每个X 28、固定 17、每张某色 12、四色套 4", () => {
    expect(REGION_CARDS.filter((card) => !card.quest).map((card) => card.id)).toEqual([1, 2, 4, 6, 7, 8, 12]);
    expect(typeCounts(REGION_CARDS.map((card) => card.quest))).toEqual({ perIcon: 28, flat: 17, perColor: 12, perColorSet: 4 });
  });
  it("37 张有前置条件，编号对得上", () => {
    const expected = [17, 20, 21, 24, 32, 34, 36, 37, 38, 39, 40, 41, 42, 44, 45, 46, 47, ...Array.from({ length: 20 }, (_, i) => i + 49)];
    expect(REGION_CARDS.filter((card) => Object.keys(card.prereq).length).map((card) => card.id)).toEqual(expected);
  });
});

describe("规则书§2.4 圣所卡核对数字", () => {
  it("45 张；颜色 红绿蓝黄各 5、无色 25", () => {
    expect(SANCTUARY_CARDS.map((card) => card.id)).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
    for (const color of ["red", "green", "blue", "yellow"] as const) expect(SANCTUARY_CARDS.filter((card) => card.color === color).length).toBe(5);
    expect(SANCTUARY_CARDS.filter((card) => card.color === null).length).toBe(25);
  });
  it("夜 4 张（S42 红，S43–S45 无色）；线索 8 张", () => {
    expect(SANCTUARY_CARDS.filter((card) => card.night).map((card) => card.id)).toEqual([42, 43, 44, 45]);
    expect(sanctuary(42).color).toBe("red");
    expect(SANCTUARY_CARDS.filter((card) => card.clues).map((card) => card.id)).toEqual([16, 21, 25, 26, 27, 28, 33, 38]);
  });
  it("奇观 奇石 9 + 灵兽 7 + 蓟草 5 = 21", () => {
    expect(sum(SANCTUARY_CARDS.map((card) => card.wonders.stone ?? 0))).toBe(9);
    expect(sum(SANCTUARY_CARDS.map((card) => card.wonders.chimera ?? 0))).toBe(7);
    expect(sum(SANCTUARY_CARDS.map((card) => card.wonders.thistle ?? 0))).toBe(5);
  });
  it("任务 26 张：每个X 13、每张某色 10、四色套 2、固定 1（S24 固定 5）", () => {
    expect(SANCTUARY_CARDS.filter((card) => card.quest).length).toBe(26);
    expect(typeCounts(SANCTUARY_CARDS.map((card) => card.quest))).toEqual({ perIcon: 13, perColor: 10, perColorSet: 2, flat: 1 });
    expect(sanctuary(24).quest).toEqual({ type: "flat", points: 5 });
  });
});

/**
 * 规则书§11-6：对照 BGA 卡图（assets/scout/ref/cards，不进仓库）抽查。2026-10-11 开发 agent 拼图逐张看过这 16 张，
 * 颜色、昼夜、线索、奇观、前置条件、任务全部和表一致；这里把看到的写死，防止以后改表改错。
 */
describe("规则书§11-6 对照卡图抽查 16 张", () => {
  it("区域卡 10 张", () => {
    expect(region(17)).toEqual({ id: 17, color: "blue", night: false, clues: 0, wonders: { stone: 1 }, prereq: { chimera: 2 }, quest: { type: "perIcon", points: 3, icon: "stone" } });
    expect(region(24)).toEqual({ id: 24, color: "blue", night: true, clues: 0, wonders: { stone: 1 }, prereq: { chimera: 1 }, quest: { type: "perIcon", points: 2, icon: "night" } });
    expect(region(32)).toEqual({ id: 32, color: "red", night: true, clues: 0, wonders: { stone: 1, chimera: 1 }, prereq: { stone: 3 }, quest: { type: "flat", points: 7 } });
    expect(region(38)).toEqual({ id: 38, color: "green", night: true, clues: 0, wonders: { stone: 1 }, prereq: { chimera: 1, thistle: 1 }, quest: { type: "perIcon", points: 3, icon: "clue" } });
    expect(region(41)).toEqual({ id: 41, color: "green", night: false, clues: 0, wonders: { thistle: 1 }, prereq: { stone: 2, chimera: 1 }, quest: { type: "perIcon", points: 4, icon: "night" } });
    expect(region(47)).toEqual({ id: 47, color: "yellow", night: false, clues: 0, wonders: {}, prereq: { chimera: 1, thistle: 1 }, quest: { type: "perColor", points: 2, colors: ["yellow", "red"] } });
    expect(region(50)).toEqual({ id: 50, color: "yellow", night: false, clues: 0, wonders: { stone: 1 }, prereq: { thistle: 2 }, quest: { type: "perColor", points: 4, colors: ["green"] } });
    expect(region(55)).toEqual({ id: 55, color: "blue", night: false, clues: 1, wonders: { stone: 1 }, prereq: { chimera: 1, thistle: 2 }, quest: { type: "perIcon", points: 3, icon: "stone" } });
    expect(region(59)).toEqual({ id: 59, color: "yellow", night: false, clues: 1, wonders: {}, prereq: { stone: 1, chimera: 3 }, quest: { type: "perColor", points: 3, colors: ["yellow", "red"] } });
    expect(region(64)).toEqual({ id: 64, color: "blue", night: false, clues: 1, wonders: {}, prereq: { stone: 2, thistle: 2 }, quest: { type: "flat", points: 18 } });
  });
  it("圣所卡 6 张", () => {
    expect(sanctuary(11)).toEqual({ id: 11, color: "blue", night: false, clues: 0, wonders: { chimera: 1 }, quest: null });
    expect(sanctuary(22)).toEqual({ id: 22, color: "yellow", night: false, clues: 0, wonders: {}, quest: { type: "perColorSet", points: 4 } });
    expect(sanctuary(33)).toEqual({ id: 33, color: null, night: false, clues: 1, wonders: {}, quest: { type: "perColorSet", points: 4 } });
    expect(sanctuary(35)).toEqual({ id: 35, color: null, night: false, clues: 0, wonders: { stone: 1 }, quest: { type: "perIcon", points: 1, icon: "night" } });
    expect(sanctuary(42)).toEqual({ id: 42, color: "red", night: true, clues: 0, wonders: {}, quest: null });
    expect(sanctuary(43)).toEqual({ id: 43, color: null, night: true, clues: 0, wonders: { stone: 1 }, quest: null });
  });
});
