import type { DayPalette } from "./day-theme";

/**
 * 白天版调色表（晴空奇境）：夜紫底、面板 → 白底、奶油色面板；像素描边换成深紫；浅紫字 → 深紫字。
 * 卡面（底图 + 奶油色框 + 代码画的编号和图标）、对手小牌、座位色标签、提示条在白天保持原色（keep）。
 * 牌桌背景换成白天那张图写在 src/theme-day.css。
 */
export const palette: DayPalette = {
  files: ["app-pixel.css", "fa-pages.css", "faraway.css"],
  colors: {
    "#1c1430": "#ffffff", // 底色、输入框、顶栏
    "#211839": "#fbf6ec", // 底色的棋盘纹
    "#2a1f4a": "#fbf6ee", // 面板
    "#392a5e": "#efe6d8", // 面板 2、分隔线
    "#0d0818": "#3c2a50", // 像素描边（保持深色）
    "#7a68b8": "#ffffff", // 面板亮边
    "#120c22": "#d4c6e6", // 面板暗边
    "#4a3a78": "#ece2f8", // 普通按钮
    "#9a88d8": "#ffffff", // 按钮亮边
    "#160e2a": "#b8a8d8", // 按钮暗边
    "#2a1f40": "#f6f0fb", // 管理员区
    "#3a2c10": "#fcefc6", // 金色字的底（选中项、状态牌）
    "#12452a": "#d8f0dc", // 绿色状态牌
    "#0b2614": "#7fbf8f",
    "#140e1e": "#fffaf0", // 牌桌背景的压暗层 rgba(20,14,30)
    "#c4b8e0": "#a898c8", // 空格的虚线、空小牌
  },
  text: {
    "#fff6e4": "#2a1a3a",
    "#fff4dc": "#2a1a3a",
    "#c4b8e0": "#5e4f80",
    "#8a7cb0": "#a094c0", // 输入框占位字
    "#f0c050": "#94650a",
    "#f25c5c": "#d1303f",
    "#ff8a7a": "#c0392b",
    "#7fe3a0": "#1f7a3f",
    "#b7f0c0": "#1f6b35",
    "#8ec0ff": "#1d4f9e",
    "#1c1430": "#1c1430", // 彩色标签上的深字不变
  },
  background: {
    "#1c1430": "#ffffff",
  },
  values: {
    "grayscale(0.6) brightness(0.7)": "grayscale(0.85) brightness(1.15)",
    // 牌桌面板、分数条、顺序条的半透明深底 → 半透明奶油底
    "rgba(28, 20, 48, 0.86)": "rgba(255, 250, 240, 0.88)",
    "rgba(13, 8, 24, 0.85)": "rgba(255, 244, 214, 0.95)",
    "rgba(13, 8, 24, 0.6)": "rgba(255, 244, 214, 0.9)",
    "rgba(13, 8, 24, 0.5)": "rgba(255, 250, 240, 0.85)",
    "rgba(122, 104, 184, 0.35)": "rgba(236, 226, 248, 0.95)",
  },
  textShadows: {
    "calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--edge)": "calc(var(--px) * 2) calc(var(--px) * 2) 0 #f0d890",
  },
  textVarColors: {
    "--gold": "#94650a",
    "--gold-2": "#94650a",
    "--ok": "#1f8a45",
    "--bad": "#d1303f",
  },
  keep: [
    ".fa-rc", ".fa-sc", ".fa-chip", ".fa-schip", ".fa-num", ".fa-quest", ".fa-req", ".fa-tag", ".fa-opp-name", ".fa-who",
    ".fa-hint-text", ".fa-banner", ".fa-toast", ".fa-fx-", ".fa-hero-art", ".fa-order li.now", ".fa-order li i",
  ],
};
