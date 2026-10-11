/**
 * 卡面：底图（PixelLab 定稿，整数倍、居中裁切）+ 代码画的编号、昼夜、线索、奇观、前置条件、任务。
 * 尺寸 cw 是卡的边长（像素）：≥104 是大卡（图标 24px、有居民），64–103 是中卡（图标 12px），<64 是小卡（只画编号和奇观）。
 * 文字都是 12 的整数倍：编号和任务分 24px。
 */
import type { CSSProperties, ReactNode } from "react";
import { region, sanctuary, type Color, type Quest, type Wonder } from "@faraway/game";
import { biomeArt, COLOR_NAME, ICON_NAME, iconArt, regionArt, residentArt, sanctuaryArt } from "./art.js";

type Tier = "lg" | "md" | "sm";

export function tierOf(cw: number): Tier {
  return cw >= 104 ? "lg" : cw >= 64 ? "md" : "sm";
}

function Img({ src, size, alt = "" }: { src: string; size: number; alt?: string }) {
  return <img className="fa-ico" src={src} width={size} height={size} alt={alt} draggable={false} />;
}

function wonderIcons(wonders: Partial<Record<Wonder, number>>, size: number): ReactNode[] {
  const out: ReactNode[] = [];
  for (const wonder of ["stone", "chimera", "thistle"] as const) {
    for (let i = 0; i < (wonders[wonder] ?? 0); i += 1) out.push(<Img key={`${wonder}${i}`} src={iconArt(wonder)} size={size} alt={ICON_NAME[wonder]} />);
  }
  return out;
}

/** 任务框：分数 + 图标（固定分只有分数）。 */
export function QuestBox({ quest, icon }: { quest: Quest; icon: number }) {
  let icons: ReactNode = null;
  if (quest.type === "perIcon") icons = <Img src={iconArt(quest.icon)} size={icon} alt={`每个${ICON_NAME[quest.icon]}`} />;
  if (quest.type === "perColor") icons = quest.colors.map((color) => <Img key={color} src={biomeArt(color)} size={icon} alt={`每张${COLOR_NAME[color]}`} />);
  if (quest.type === "perColorSet") icons = <Img src={iconArt("colorset")} size={icon} alt="每套四色" />;
  return (
    <span className={`fa-quest ${quest.type === "flat" ? "flat" : "per"}`}>
      <b>{quest.points}</b>
      {icons}
    </span>
  );
}

function questIcon(quest: Quest): ReactNode {
  if (quest.type === "perIcon") return <Img src={iconArt(quest.icon)} size={12} alt={ICON_NAME[quest.icon]} />;
  if (quest.type === "perColor") return quest.colors.map((color) => <Img key={color} src={biomeArt(color)} size={12} alt={COLOR_NAME[color]} />);
  if (quest.type === "perColorSet") return <Img src={iconArt("colorset")} size={12} alt="四色" />;
  return null;
}

/** 用大白话说一张区域卡（详情弹窗、选中时的说明、读屏）。 */
export function describeQuest(quest: Quest | null): string {
  if (!quest) return "没有任务";
  switch (quest.type) {
    case "flat":
      return `得 ${quest.points} 分`;
    case "perIcon":
      return `每个${ICON_NAME[quest.icon]} ${quest.points} 分`;
    case "perColor":
      return `每张${quest.colors.map((color) => COLOR_NAME[color]).join("或")}卡 ${quest.points} 分`;
    case "perColorSet":
      return `每凑齐一套四种地形 ${quest.points} 分`;
  }
}

export function describeRegion(id: number): string {
  const card = region(id);
  const parts: string[] = [`${id} 号 · ${COLOR_NAME[card.color]} · ${card.night ? "夜" : "昼"}`];
  const gives = (["stone", "chimera", "thistle"] as const).filter((w) => card.wonders[w]).map((w) => `${ICON_NAME[w]}×${card.wonders[w]}`);
  if (card.clues) gives.push("线索");
  if (gives.length) parts.push(`给：${gives.join("、")}`);
  const need = (["stone", "chimera", "thistle"] as const).filter((w) => card.prereq[w]).map((w) => `${ICON_NAME[w]}×${card.prereq[w]}`);
  if (card.quest) parts.push(`任务：${describeQuest(card.quest)}${need.length ? `（要先有 ${need.join("、")}）` : ""}`);
  else parts.push("没有任务");
  return parts.join("；");
}

export function describeSanctuary(id: number): string {
  const card = sanctuary(id);
  const parts: string[] = [card.color ? `圣所 · ${COLOR_NAME[card.color]}色` : "圣所 · 无色"];
  const gives = (["stone", "chimera", "thistle"] as const).filter((w) => card.wonders[w]).map((w) => ICON_NAME[w]);
  if (card.clues) gives.push("线索");
  if (card.night) gives.push("夜");
  if (gives.length) parts.push(`给：${gives.join("、")}`);
  parts.push(card.quest ? `任务：${describeQuest(card.quest)}` : "没有任务");
  return parts.join("；");
}

export interface CardProps {
  readonly cw: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly onClick?: () => void;
  readonly title?: string;
  readonly tutorial?: string;
  readonly children?: ReactNode;
  readonly disabled?: boolean;
}

/** 一张区域卡。back = 背面朝上。 */
export function RegionCardView({ id, back = false, ...props }: CardProps & { id: number; back?: boolean }) {
  const { cw } = props;
  const tier = tierOf(cw);
  const card = region(id);
  const icon = tier === "lg" ? 24 : 12;
  const prereqCount = Object.values(card.prereq).reduce((a, b) => a + (b ?? 0), 0);
  const prereqIcon = tier === "lg" && prereqCount <= 3 ? 24 : 12;
  const small = cw <= 64;
  const style = {
    ...props.style,
    "--cw": `${cw}px`,
    "--art": back ? (small ? "var(--region-back-sm)" : "var(--region-back)") : `url(${regionArt(id, small)})`,
    "--art-size": cw > 128 ? "256px" : small ? "64px" : "128px",
    "--swatch": `var(--swatch-${card.color})`,
  } as CSSProperties;
  const resident = tier === "lg" && !back ? residentArt(id) : null;
  const Tag = props.onClick ? "button" : "div";
  return (
    <Tag
      className={`fa-rc t-${tier} c-${card.color}${back ? " back" : ""}${props.className ? ` ${props.className}` : ""}`}
      style={style}
      onClick={props.onClick}
      title={props.title ?? (back ? "背面" : describeRegion(id))}
      aria-label={back ? "背面朝上的区域卡" : describeRegion(id)}
      data-tutorial={props.tutorial}
      data-card={back ? undefined : id}
      disabled={Tag === "button" ? props.disabled : undefined}
      type={Tag === "button" ? "button" : undefined}
    >
      {!back && (
        <>
          <span className="fa-rc-top">
            <span className="fa-num">{id}</span>
            {tier !== "sm" && <Img src={iconArt(card.night ? "night" : "day")} size={icon} alt={card.night ? "夜" : "昼"} />}
            {tier !== "sm" && card.clues > 0 && <Img src={iconArt("clue")} size={icon} alt="线索" />}
          </span>
          <span className="fa-wonders">
            {tier === "sm" && card.night && <Img src={iconArt("night")} size={12} alt="夜" />}
            {wonderIcons(card.wonders, icon)}
          </span>
          {resident && <img className="fa-resident" src={resident} width={40} height={40} alt="" draggable={false} />}
          {tier !== "sm" && (prereqCount > 0 || card.quest) && (
            <span className="fa-rc-bottom">
              {prereqCount > 0 && <span className="fa-req">{wonderIcons(card.prereq, prereqIcon)}</span>}
              {card.quest && <QuestBox quest={card.quest} icon={icon} />}
            </span>
          )}
        </>
      )}
      {props.children}
    </Tag>
  );
}

/** 一张圣所卡（宽 sw，高 sh）。 */
export function SanctuaryCardView({ id, sw, sh, back = false, ...props }: Omit<CardProps, "cw"> & { id: number; sw: number; sh: number; back?: boolean }) {
  const card = sanctuary(id);
  const small = sw <= 40;
  const icon = sw >= 72 ? 24 : 12;
  const style = {
    ...props.style,
    "--sw": `${sw}px`,
    "--sh": `${sh}px`,
    "--art": back ? "var(--sanctuary-back)" : `url(${sanctuaryArt(id, small)})`,
    "--art-size": small ? "40px 60px" : sw > 80 || sh > 128 ? "160px 240px" : "80px 120px",
    "--swatch": `var(--swatch-${card.color ?? "gray"})`,
  } as CSSProperties;
  const Tag = props.onClick ? "button" : "div";
  const tops: ReactNode[] = [];
  if (card.night) tops.push(<Img key="n" src={iconArt("night")} size={icon} alt="夜" />);
  if (card.clues) tops.push(<Img key="c" src={iconArt("clue")} size={icon} alt="线索" />);
  return (
    <Tag
      className={`fa-sc ${sw >= 72 ? "t-lg" : "t-md"} c-${card.color ?? "gray"}${back ? " back" : ""}${props.className ? ` ${props.className}` : ""}`}
      style={style}
      onClick={props.onClick}
      title={props.title ?? describeSanctuary(id)}
      aria-label={back ? "圣所卡背面" : describeSanctuary(id)}
      data-tutorial={props.tutorial}
      data-sanctuary={back ? undefined : id}
      disabled={Tag === "button" ? props.disabled : undefined}
      type={Tag === "button" ? "button" : undefined}
    >
      {!back && (
        <>
          {tops.length > 0 && <span className="fa-sc-top">{tops}</span>}
          <span className="fa-wonders">{wonderIcons(card.wonders, icon)}</span>
          {card.quest && (
            <span className="fa-rc-bottom">
              <QuestBox quest={card.quest} icon={icon} />
            </span>
          )}
        </>
      )}
      {props.children}
    </Tag>
  );
}

/** 对手出牌区的小牌：地形色底 + 编号 + 奇观（点开看大图）。 */
export function RegionChip({ id, onClick, className }: { id: number; onClick?: () => void; className?: string }) {
  const card = region(id);
  return (
    <button type="button" className={`fa-chip c-${card.color}${card.night ? " night" : ""}${className ? ` ${className}` : ""}`} style={{ "--swatch": `var(--swatch-${card.color})` } as CSSProperties} onClick={onClick} title={describeRegion(id)} data-card={id}>
      <b>{id}</b>
      <span>{wonderIcons(card.wonders, 12)}{card.clues ? <Img src={iconArt("clue")} size={12} alt="线索" /> : null}</span>
    </button>
  );
}

/** 对手的圣所小方块。 */
export function SanctuaryChip({ id, onClick }: { id: number; onClick?: () => void }) {
  const card = sanctuary(id);
  return (
    <button type="button" className={`fa-schip c-${card.color ?? "gray"}`} style={{ "--swatch": `var(--swatch-${card.color ?? "gray"})` } as CSSProperties} onClick={onClick} title={describeSanctuary(id)} data-sanctuary={id}>
      {wonderIcons(card.wonders, 12)}
      {card.night && <Img src={iconArt("night")} size={12} alt="夜" />}
      {card.clues > 0 && <Img src={iconArt("clue")} size={12} alt="线索" />}
      {card.quest && <span className="fa-sq"><i>{card.quest.points}</i>{questIcon(card.quest)}</span>}
    </button>
  );
}

export const colorName = (color: Color) => COLOR_NAME[color];
