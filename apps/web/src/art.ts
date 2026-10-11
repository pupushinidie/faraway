/**
 * 美术资源路径（定稿见 art/spec.md，图都放在 public/art/）。地址带 BASE_URL，部署在 /faraway/ 子路径下也对。
 * 卡面上的编号、图标、任务、分数都由界面用代码画（图上没有字）。
 */
import { region, sanctuary, type Color, type Icon } from "@faraway/game";

const ROOT = `${import.meta.env.BASE_URL}art/`;
export const art = (path: string) => `${ROOT}${path}`;

/** 区域卡底图：每种地形 × 昼夜 3 张变体，按 id % 3 选。sm 是 64×64 缩略图。 */
export function regionArt(id: number, small = false): string {
  const card = region(id);
  return `${ROOT}${small ? "region-sm" : "region"}/${card.color}-${card.night ? "night" : "day"}-${(id % 3) + 1}.png`;
}

/** 有任务的区域卡左下角的居民（40×40）。 */
export function residentArt(id: number): string | null {
  const card = region(id);
  return card.quest ? `${ROOT}resident/${card.color}-${(id % 4) + 1}.png` : null;
}

/** 圣所卡底图（80×120；sm 40×60）。 */
export function sanctuaryArt(id: number, small = false): string {
  const card = sanctuary(id);
  const dir = small ? "sanctuary-sm" : "sanctuary";
  if (card.color) return `${ROOT}${dir}/${card.color}.png`;
  if (card.night) return `${ROOT}${dir}/gray-night.png`;
  return `${ROOT}${dir}/gray-day-${(id % 2) + 1}.png`;
}

export const iconArt = (icon: Icon | "day" | "colorset") => `${ROOT}icon/${icon}.png`;
export const biomeArt = (color: Color) => `${ROOT}icon/biome-${color}.png`;
export const swatchArt = (color: Color | "gray") => `${ROOT}swatch/${color}.png`;

export const ART = {
  regionBack: `${ROOT}back/region.png`,
  regionBackSm: `${ROOT}back/region-sm.png`,
  sanctuaryBack: `${ROOT}back/sanctuary.png`,
  sanctuaryBackSm: `${ROOT}back/sanctuary-sm.png`,
  bgNight: `${ROOT}bg/night.png`,
  bgDay: `${ROOT}bg/day.png`,
  fxScore: `${ROOT}fx/score.png`,
  fxSanctuary: `${ROOT}fx/sanctuary.png`,
  cover: `${ROOT}cover.png`,
} as const;

/** 座位色（头像框、名字标签、阶段③顺序条）。和四种地形色错开。 */
export const SEATS = ["#f0c050", "#5ec8e8", "#f07ab8", "#9be06a", "#c69cf2", "#f0904a"] as const;
export const seatColor = (seat: number) => SEATS[((seat % 6) + 6) % 6]!;

export const COLOR_NAME: Record<Color, string> = { red: "菌林", green: "溪谷", blue: "石原", yellow: "岩城" };
export const ICON_NAME: Record<Icon, string> = { stone: "奇石", chimera: "灵兽", thistle: "蓟草", clue: "线索", night: "夜" };

/** 样式表里要用的图（CSS 里写死路径在子路径下会坏）：挂到 :root 的 CSS 变量上。 */
export function installArtVars(): void {
  const style = document.documentElement.style;
  style.setProperty("--bg-night", `url(${ART.bgNight})`);
  style.setProperty("--bg-day", `url(${ART.bgDay})`);
  style.setProperty("--fx-score", `url(${ART.fxScore})`);
  style.setProperty("--fx-sanctuary", `url(${ART.fxSanctuary})`);
  style.setProperty("--region-back", `url(${ART.regionBack})`);
  style.setProperty("--region-back-sm", `url(${ART.regionBackSm})`);
  style.setProperty("--sanctuary-back", `url(${ART.sanctuaryBack})`);
  for (const color of ["red", "green", "blue", "yellow", "gray"] as const) style.setProperty(`--swatch-${color}`, `url(${ROOT}swatch/${color}.png)`);
}

/** 座位头像：借用 16 个居民里的 6 个（40×40）。 */
const AVATARS = ["yellow-2", "blue-1", "red-3", "green-4", "blue-3", "red-1"] as const;
export const avatarArt = (seat: number) => `${ROOT}resident/${AVATARS[((seat % 6) + 6) % 6]}.png`;
