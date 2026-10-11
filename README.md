# 遥远之地

2–6 人同时出牌、倒序计分的探险卡牌游戏，网页联机版（一个人也能加人机开局）。规则按 `~/Desktop/游戏规则/遥远之地.md` 实现；名字、美术（PixelLab「晴空奇境」）和规则说明文字都是自己的，不用原版商标名和美术。

线上地址（上线后）：<https://gulugagame.com/faraway/>（付费网关后面，要登录）

## 本地运行

```bash
npm install
npm run dev          # 服务端 :3028，网页 :5299（WEB_PORT / SERVER_PORT 可以改，另起一套服务不撞端口）
npm test             # 规则包、服务器（见下面「测试」）
npm run typecheck
BASE_PATH=/faraway/ npm run build
```

改了规则书的卡表要跑 `python scripts/gen-cards.py` 重新生成 `packages/game/src/cards-data.ts`（会和选题草稿逐张比对、打印不同），再 `npm run build:game` 并 `touch apps/server/src/index.ts`。

一个人测试：`node scripts/test-bot.mjs host 3 2` 让机器人建一个 3 人房（自己再拉 1 个机器人）并打印房间码，你在网页里用房间码加入凑满后自动开局；`node scripts/test-bot.mjs host 4 4` 四个机器人自己打完一整局。`BOT_DELAY_MS` 调思考时间，`BOT_IDLE=1` 只挂着不动（测超时和托管），`ADD_BOTS=n` 让服务器再加 n 个人机，`BOT_REMATCH=1` 打完接着再来一局，`ASSIST=0` 关掉辅助显示。

抓包：`node scripts/spy.mjs 4`（先 `npm run dev`）用 4 个 socket 加一个观战的人打完一局，检查每条 `room:updated` 里有没有别人的手牌、已出未翻开的牌、抽到的圣所、牌堆顺序和种子。

## 规则（自己的话）

- 一局 8 轮。每轮所有人**同时**从 3 张手牌里打出 1 张区域卡，排在自己出牌区的最右边；大家都出好才一起翻开。出了不能撤回。
- 卡上的数字（1–68）是探索时间：
  - **数字小先挑**：翻开后按这一轮打出的数字从小到大，每人从公共牌里挑 1 张补回手里（第 8 轮不挑）。公共牌每轮是人数 + 1 张，最后剩下的 1 张移出游戏。
  - **比自己上一张大就发现圣所**：抽 1 + 线索数张圣所卡（线索算出牌区所有卡、圣所和刚打出的这张），留 1 张正面放好，其余放回圣所牌堆底。只和紧挨着的上一张比，不是和之前所有的比。第 1 轮没有上一张，不发现。
- 终局**从最右边往左**一张张翻开计分：每张卡只看得到自己、它右边的卡和全部圣所。任务（每个奇石 2 分、每张某色卡 1 分、四色一套 10 分……）按看得到的东西算；前置条件（至少几个奇石 / 灵兽 / 蓟草）不够，这张就 0 分。资源不会被用掉，一个奇石能同时满足好几张卡。所以要求高的卡早打（放左边），给资源的卡晚打（放右边）。
- 8 张都翻完后，再按全部区域卡 + 圣所算每张圣所的任务分。总分最高的人赢；并列时，出牌区里有编号最小的那张卡的人赢。

叫法（开工拍板）：奇石 / 灵兽（规则书叫奇美拉）/ 蓟草；地形 菌林（红）、溪谷（绿）、石原（蓝）、岩城（黄）。

### 规则书没写死、这里这样处理的地方

| 情况 | 现在的做法 | 依据 |
|---|---|---|
| 圣所牌堆不够发 | 按这一轮打出的编号从小到大发，每人发到要的张数或牌堆发完为止，后面的人少拿或拿不到；不重洗；这一轮放回的要等他留好才进牌堆底，补不到后面的人 | 开工拍板（规则书 §11-1 推荐 a） |
| 出牌提交后能不能撤回 | 不能 | 开工拍板 |
| 辅助显示（手牌标能不能拿圣所、能抽几张；出牌区每张卡标按现在算的分，条件不满足标红） | 默认开，建房时或等候时房主可以关（`options.assist`） | 开工拍板 |
| 进阶开局（发 5 留 3） | 不做 | 开工拍板 |
| 平局 | 出牌区编号最小的那张更小的人赢（官方），所以一定分得出第一名 | 规则书 §7 |
| 公共牌剩下的 | 移出游戏，公开列出 | 规则书 §4.3 |
| 第 7 轮结束 | 不翻新的公共牌，第 8 轮不挑 | 规则书 §11 |
| 留圣所 | 抽到圣所的人马上就能留，不用等前面的人挑完公共牌；挑公共牌严格按顺序 | 规则书 §9.2 |
| 人数 | 2–6 人；一个人加满人机也能开局 | 规则书 §3、全站约定 |
| 第 8 轮后的 2 张手牌 | 不计分，终局也不公开 | 规则书 §4.4 |

### 超时、托管（全站约定，覆盖规则书 §9.4）

| 步骤 | 限时 | 到点 |
|---|---|---|
| 出牌（大家同时） | 60 秒 + 上一步动画 | 没出的人由人机策略代打（出错就出手里编号最小的） |
| 挑公共牌（轮到的人） | 30 秒 + 上一步动画 | 人机策略代挑（退回：最小的那张） |
| 留圣所 | 和挑公共牌共用一个倒计时：到点时还没留的人一起代留 | 人机策略代留（退回：第一张） |

- 计时 key（`stepKey`）只在换轮、换阶段、轮到下一个人挑公共牌时变：别人出牌、留圣所不会重置倒计时；到点后才轮到的人重新计时。
- 连续超时 2 次转托管，由人机代打；自己动一下或点「取消托管」交还。离线的人轮到时先等 3 秒，再由人机代打（不算超时）；用原昵称回来就交还。
- 人机叫咕噜一号、二号……带「人机」标签，只有「普通」一档；房主在等候时点空座位「加人机」，总是同意再来一局。

## 目录

| 路径 | 内容 |
|---|---|
| `packages/game/src/cards-data.ts` | 68 张区域卡 + 45 张圣所卡（`scripts/gen-cards.py` 从规则书表格生成） |
| `packages/game/src/cards.ts` | 查卡、计数 `tally`、任务分 `questScore`、前置条件 `prereqMet`、倒序计分 `scorePlayer`、发现圣所 `discoveryFor` |
| `packages/game/src/engine.ts` | 规则引擎：`apply` 纯函数、`applyCommand`（服务端，记动作序列）、`waitingFor`、`legalActions`、`stepKey`、`timeoutTurn`、`baselineCommand`、`redactGameForViewer` / `redactGameForSpectator`、`createGame` |
| `packages/game/src/scenes.ts` | 预览局面工厂（见下） |
| `packages/game/src/validate.ts` | `stateProblems`：局面自洽检查（守恒、张数、不卡死） |
| `packages/game/src/bot.ts` | 人机 `botCommand` / `botDecision`（带理由，教程「提示」用） |
| `apps/server` | Socket.IO 房间服务器（从谁是牛头王移植的同时出牌版：一步一个截止时间、每个人机座位一个计时器、迟到的点击带 step 拒收、限速、挤登录、观战、管理员解散） |
| `apps/web` | 网页 |
| `art/` | 美术（暂存目录复制来的 spec、出图脚本、`out/final` 定稿；候选图 gitignore）；定稿放在 `apps/web/public/art/` |
| `scripts/` | `test-bot.mjs` 陪玩、`spy.mjs` 抓包、`gen-cards.py` 卡表 |

## 人机（「普通」）

- 输入只用这个座位的 redact 视角。估终局分：把以后还会打的牌（手里留下的 + 这一轮要挑的公共牌 + 从没见过的牌里随机补的）接在出牌区右边，以后还会拿的圣所也随机补几张，倒序计分取平均（每个候选 60 个「可能的未来」，同一批共用）。
- 出牌时算上：比上一张大马上抽圣所（按线索抽几张、挑最有用的）、编号小早挑公共牌（按对手可能出的牌估排第几）、下一轮还能不能比它大。结果自然是要求高的卡早打、给资源的卡晚打。挑公共牌、留圣所各候选同样估分。每一步附一句理由（`botDecision(view, id).reason`）。
- 强度（`npx tsx scripts/sim-faraway.ts 300`，2026-10-11）：对随机 2 人胜 99.0%（平均 72.9 对 28.0 分）；对 greedy-now（规则书 §9.7 基线）2 人胜 94.3%、3 人 92.7%、4 人 89.7%、6 人 84.3%（公平值 50/33/25/17%），平均 72–78 分对约 40 分；自对弈 2–6 人各 300 局平均每人 71–73 分。决策平均 1.7ms、最坏 7ms。

## 测试

| 文件 | 内容 |
|---|---|
| `packages/game/test/data.test.ts` | 规则书 §2.3、§2.4 的核对数字；对照 BGA 卡图抽查 16 张（区域 10、圣所 6）写死 |
| `packages/game/test/rulebook.test.ts` | 规则书 §10 T1–T15（测试名带 `规则书#T1`…），含例 1/2/3 的 80 / 49 / 45 分和 T11 的 33 / 9 分 |
| `packages/game/test/sections.test.ts` | 规则书各节（§3、§4.1–4.4、§5、§6、§7、§9.4）的场景测试，倒序计分「左边没翻开的卡不可见」专门测 |
| `packages/game/test/random.test.ts` | 2–6 人各 300 局随机对局（含随机超时），每步查守恒、张数、轮次、不卡死，隔几步查隐藏信息 |
| `packages/game/test/scenes.test.ts` | 预览局面工厂每个局面自洽 |
| `packages/game/test/bot.test.ts` | 人机只吃 redact 视角（对手暗牌换了决定不变）、关键决策（先打 45、第 8 轮不打 68、留帮前置条件的圣所、先留后挑）、2–6 人各 30 局自对弈步步合法有理由、耗时 |
| `apps/server/test/flow.test.ts` | 建房选项、全流程到终局和再来一局、计时 key、超时和转托管、重连、迟到的点击、管理员解散、限速、抓包断言 |
| `apps/server/test/timeouts.test.ts` | 真实计时（TURN_MS=500）没人动也能打完 |
| `apps/server/test/spectate.test.ts`、`kickSession.test.ts`、`bots*.test.ts` | 观战、挤登录、人机（全站模板） |

## 对外接口（规则包 `@faraway/game`）

### 状态

- `GameState`：`phase`（`play` 出牌 / `resolve` 挑公共牌和留圣所 / `ended`）、`round`（1–8）、`players`、`market`、`removed`、`regionDeckCount`、`sanctuaryDeckCount`、`resolveOrder`（这一轮按编号从小到大的顺序）、`resolveIndex`（轮到第几个挑）、`lastReveal`（这一轮翻开的牌和谁发现了圣所）、`events`（最近一步的事件）、`finalResult`（`ranking`、`winners`、`scores[id] = { regions, prereqOk, sanctuaries, regionTotal, sanctuaryTotal, total }`、`tieBreak`）、`version`。
- `Player`：`hand`（别人看到空数组，张数看 `handCount`）、`played`、`sanctuaries`、`submitted`、`pendingPlay`（别人看到 null）、`offer`（别人看到空数组，张数看 `offerCount`）、`offerWanted`、`tookMarket`。
- 只在服务端：`regionDeck`、`sanctuaryDeck`（下标 0 是顶）、`seed`、`rngState`、`log`。
- 动作：`{ type: "play", card }`、`{ type: "take", card }`、`{ type: "keep", sanctuary }`，都可以带 `step: stepKey(game)`。
- 事件：`Submitted`、`Revealed`（plays 按编号从小到大）、`SanctuariesDrawn`（只有张数）、`MarketTaken`、`SanctuaryKept`（放回几张，不说是哪几张）、`MarketRemoved`、`RoundStarted`、`GameEnded`、`TimedOut`。
- 动画节奏 `ANIMATION`：翻牌 1.6 秒、每次抽圣所 0.5 秒、挑牌 0.6 秒、终局倒序计分 15 秒；服务器按 `animationMs(events)` 给下一步的倒计时和人机停顿留时间。

### 计分工具（界面的辅助显示也用）

- `scorePlayer(played, sanctuaries)`：倒序计分；出牌区不满 8 张也能算（就是「按现在算」）。
- `discoveryFor(played, sanctuaries, card)` → `{ discovered, count }`：打这张能不能发现圣所、抽几张。
- `tally(regions, sanctuaries)`、`questScore(quest, t)`、`prereqMet(card, t)`、`region(id)`、`sanctuary(id)`。

### 预览局面工厂

```ts
import { buildGame, createScene, createSceneRoom, playRound, takeAll, keepAll, autoAdvance, SCENE_NAMES } from "@faraway/game";

// 按名字：start / play / submitted / pick / pick-keep / keep-wait / watch-pick / round8 / round8-keep /
//         short-deck / timeout / ended / ended-tie / full（6 人第 7 轮）。「我」是 p1。
const game = createScene("pick-keep", { players: 4, seed: 11 });

// 按参数造任意精确局面（没给的随机补，牌数守恒）：
const exact = buildGame({
  players: [{ played: [15], sanctuaries: [16], hand: [49, 12, 1] }, { played: [30] }],
  round: 2,                 // 第几轮
  phase: "play",            // play / resolve / ended（ended 自动算分）
  market: [50, 51, 52],     // 可选
  sanctuaryDeck: [5, 6, 7], // 牌堆顶（sanctuaryDeckExact: true 时牌堆就只有这几张）
});
const next = keepAll(takeAll(playRound(exact, [49, 3])));     // 按指定的牌推进一轮

// 包成网页收到的房间快照（某个座位视角或观战），可以标人机、托管、离线、倒计时：
const room = createSceneRoom(game, { viewer: "p1", bots: ["p2"], auto: ["p3"], offline: ["p4"], turnRemainingMs: 8000 });
```

`createGame(players, seed, options, overrides, stack)` 的 `stack = { hands, regionDeck, sanctuaryDeck }` 可以指定发牌（教程剧本用）。

## 流水线状态

- 引擎和服务器：完成（2026-10-11）。
- 人机：完成（2026-10-11）。
- 界面：完成（2026-10-11）。预览页 `http://localhost:5299/preview.html?s=<场景>`（参数见 `apps/web/src/preview.tsx` 开头）；排版规则在 `apps/web/src/layout.ts`，卡面在 `cards.tsx`，牌桌在 `GameBoard.tsx`，样式 `faraway.css`、白天调色表 `day-palette.ts`。

## 背景音乐 / 声音

- 没有背景音乐（`NO_BGM`，全站以后统一加）；♪ 面板照样有（音效、语音音量）。
- 动作音效在 `apps/web/src/game-sfx.ts`：出牌、翻牌、发现圣所（风铃）、挑牌、留圣所、新一轮、轮到你、超时；终局翻牌每张一声（按分数高低）、输赢。房间进出、开局、聊天由 `gm-sound.tsx` 的 `useRoomSfx` 管。
