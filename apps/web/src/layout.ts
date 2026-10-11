/**
 * 牌桌排版：按可视区域和人数算卡的边长（像素），保证桌面三种尺寸一屏放下、手机第一屏有手牌和按钮。
 *
 * 桌面（宽 ≥ 900）从上到下：顶栏 | 对手条 | 中间行（状态 + 公共牌）| 我的出牌区（8 格）| 手牌行（手牌 3 张 + 操作 + 我的圣所）。
 * 三行卡用同一个边长 cw（底图 1 倍居中裁切，最大 128），圣所宽 sw ≈ 0.625 cw、高 = cw。
 * 对手条：每位对手一块（名字和分数 + 出牌区小牌 + 圣所小块），按宽度排几列。
 * 手机：竖着排，允许往下滚；第一屏是 状态条 → 手牌 → 操作按钮 → 公共牌 → 我的出牌区。
 */
export type Mode = "desk" | "phone";

export interface Layout {
  readonly mode: Mode;
  /** 公共牌、出牌区、手牌的边长。 */
  readonly cw: number;
  /** 手机上手牌更大一点。 */
  readonly handCw: number;
  /** 手机上公共牌、出牌区各自的边长。 */
  readonly marketCw: number;
  readonly rowCw: number;
  /** 圣所卡宽、高。 */
  readonly sw: number;
  readonly sh: number;
  /** 对手条几列。 */
  readonly oppColumns: number;
  /** 状态栏宽、操作区宽（桌面）。 */
  readonly statusW: number;
  readonly actionW: number;
}

const TOPBAR = 52;
const TAG = 28;
/** 除了三行卡本身以外的固定高度：顶栏、三行的标签/分数条/内边距、行间距、底边。 */
const FIXED_H = 252;
const OPP_H = 104;
const OPP_MIN_W = 272;
const MAX_CW = 128;
const GAP = 12;

function clampCw(value: number, max = MAX_CW): number {
  return Math.max(40, Math.min(max, Math.floor(value / 2) * 2));
}

export function pickLayout(vw: number, vh: number, players: number): Layout {
  const others = Math.max(1, players - 1);
  if (vw < 900 || vh < 520) {
    const inner = vw - 24;
    const handCw = clampCw(Math.min(120, inner / 3 - 12));
    const marketCw = clampCw(Math.min(100, inner / (players + 1) - GAP));
    const rowCw = Math.max(36, Math.min(72, Math.floor((inner - 8 - 7 * 8) / 8)));
    const sw = Math.max(40, Math.min(56, Math.floor((inner - 6 * 10) / 7)));
    return { mode: "phone", cw: handCw, handCw, marketCw, rowCw, sw, sh: Math.round(sw * 1.5), oppColumns: 1, statusW: inner, actionW: inner };
  }
  const inner = vw - 32;
  const oppColumns = Math.max(1, Math.min(others, Math.floor((inner + 6) / (OPP_MIN_W + 6))));
  const oppRows = Math.ceil(others / oppColumns);
  const oppH = oppRows * OPP_H + (oppRows - 1) * 6;
  const statusW = vw >= 1600 ? 300 : vw >= 1300 ? 260 : 220;
  const actionW = vw >= 1300 ? 240 : 200;
  const byHeight = (vh - FIXED_H - oppH) / 3;
  const byMarket = (inner - statusW - 40) / (players + 1) - GAP;
  const byRow = (inner - 150) / 8 - GAP;
  // 手牌行：3 张手牌 + 操作 + 最多 7 张圣所（圣所最窄 40）
  const byHand = (inner - actionW - 60 - 7 * (40 + GAP)) / 3 - GAP;
  // 大屏（≥1700）卡可以放大到 176：底图换成 2 倍再居中裁切
  const cw = clampCw(Math.min(byHeight, byMarket, byRow, byHand), vw >= 1700 ? 176 : MAX_CW);
  const sanctRoom = inner - actionW - 60 - 3 * (cw + GAP);
  const sw = Math.max(40, Math.min(Math.round(cw * 0.625), Math.floor(sanctRoom / 7 - GAP)));
  return { mode: "desk", cw, handCw: cw, marketCw: cw, rowCw: cw, sw, sh: cw, oppColumns, statusW, actionW };
}

/** 终局结算表：每人一行 8 张 + 圣所，按人数和可视区域挑卡的边长。 */
export function pickFinalCw(vw: number, vh: number, players: number): number {
  if (vw < 900) return Math.max(36, Math.min(56, Math.floor((vw - 40) / 8) - 4));
  const byHeight = (vh - TOPBAR - 150) / players - TAG - 16;
  const byWidth = (Math.min(vw, 1600) - 64 - 200 - 7 * 44) / 8 - 6;
  return clampCw(Math.min(byHeight, byWidth, 112));
}
