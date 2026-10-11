import { useEffect, useState } from "react";
import { iconArt } from "./art.js";
import { RegionCardView, SanctuaryCardView } from "./cards.js";

/**
 * 规则说明：一个按钮 + 像素弹窗。用自己的话写，配游戏里的卡图。内容和 README 的规则说明一致。
 */
function Icon({ name }: { name: "stone" | "chimera" | "thistle" | "clue" | "night" }) {
  return <img className="fa-ico" src={iconArt(name)} width={24} height={24} alt="" />;
}

export function RulesBody() {
  return (
    <div className="fa-rules-body">
      <section>
        <h3>一局 8 轮，总分高的赢</h3>
        <p>每轮大家<b>同时</b>从 3 张手牌里打出 1 张，排在自己出牌区的<b>最右边</b>，出了不能撤回。8 轮后出牌区正好 8 张。</p>
        <div className="fa-rules-cards">
          <RegionCardView id={45} cw={128} />
          <ul>
            <li>左上：编号（1–68），旁边是昼 / 夜、线索</li>
            <li>右上：这张卡给的资源 <Icon name="stone" />奇石 <Icon name="chimera" />灵兽 <Icon name="thistle" />蓟草</li>
            <li>右下：任务（得分方式），上面的小框是<b>前置条件</b>：资源不够，这张卡 0 分</li>
            <li>底色：地形（菌林、溪谷、石原、岩城）</li>
          </ul>
        </div>
      </section>
      <section>
        <h3>每轮三步</h3>
        <ol>
          <li><b>出牌</b>：大家都出好了一起翻开。</li>
          <li><b>发现圣所</b>：打出的编号比自己<b>上一张</b>大，就抽 1 + 线索数张圣所卡，留 1 张（其余放回）。只和紧挨着的上一张比；第 1 轮没有圣所。</li>
          <li><b>挑公共牌</b>：按这一轮打出的编号<b>从小到大</b>轮流挑 1 张补回手里。剩下的 1 张移出游戏。第 8 轮不挑。</li>
        </ol>
      </section>
      <section>
        <h3>倒序计分（最重要）</h3>
        <p>8 轮打完，从<b>最右边往左</b>一张张翻开计分：每张卡只看得到<b>自己、它右边的卡和全部圣所</b>，左边的卡不算。资源用了不会消失，可以同时满足好几张卡。</p>
        <p>所以：要求高的卡<b>早打</b>（放左边，右边会越来越多），只给资源的卡<b>晚打</b>（放右边）。</p>
        <div className="fa-rules-cards">
          <SanctuaryCardView id={11} sw={80} sh={120} />
          <ul>
            <li>圣所卡计分时一直看得到；有颜色的算一张那种地形的卡，月亮 <Icon name="night" /> 算一个夜。</li>
            <li>圣所上的线索 <Icon name="clue" /> 让以后发现圣所时多抽一张。</li>
            <li>8 张区域卡翻完，再按全部卡算圣所的任务分。</li>
          </ul>
        </div>
      </section>
      <section>
        <h3>其他</h3>
        <ul>
          <li>总分并列：出牌区里有编号最小那张卡的人赢。</li>
          <li>出牌 60 秒、挑牌和留圣所 30 秒，超时由人机替你做；连续超时 2 次转托管（人机代打），点「取消托管」交还。</li>
          <li>辅助显示（开房时可关）：手牌下标能不能拿圣所、能抽几张；出牌区每张卡下标按现在算的分，条件不够标红。</li>
        </ul>
      </section>
    </div>
  );
}

export function GameRules({ className = "quiet-button" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button className={`${className} fa-rules-button`} type="button" aria-expanded={open} onClick={() => setOpen(true)} data-tutorial="rules-button">规则</button>
      {open && (
        <div className="gm-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="gm-panel fa-rules" role="dialog" aria-modal="true" aria-labelledby="fa-rules-title">
            <div className="fa-rules-head">
              <h2 id="fa-rules-title">遥远之地 · 规则</h2>
              <button className="quiet-button" type="button" onClick={() => setOpen(false)}>关闭</button>
            </div>
            <RulesBody />
          </section>
        </div>
      )}
    </>
  );
}

export default GameRules;
