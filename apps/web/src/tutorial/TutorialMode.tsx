/**
 * 遥远之地的新手教程：在浏览器里按剧本（packages/game/src/tutorial.ts）打完 8 轮，
 * 牌桌就是真正对局的 GameBoard，咕噜嘎的对话框叠在上面；剧本走完可以和咕噜一号打一局练习（人机）。
 * 不连服务器，不占房间；首页、等候房间都能进来（从等候房间进来时，房主开局会自动回到牌桌，见 App.tsx）。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  anchorCandidates,
  apply,
  botCommand,
  createPracticeGame,
  createTutorialGame,
  DEFAULT_ROOM_ACCESS,
  redactGameForViewer,
  sameMove,
  selfCanAct,
  TUTORIAL_BOT,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type TutorialMove,
  type TutorialStep,
} from "@faraway/game";
import { sfx } from "../gm-sound.js";
import GameBoard from "../GameBoard.js";
import { Coach, isTouchDevice, StepPips, type CoachView } from "./Coach.js";
import { writeTutorial } from "./storage.js";
import { GAME_ID } from "./tutorialGame.js";
import { useTutorial } from "./useTutorial.js";

const SELF_MEMBER = "tutorial-self";
const TUTORIAL_CODE = "GULU01";
/** 练习局人机少算一点（快、也没那么狠）。 */
const PRACTICE_BOT = { samples: 16 };

const randomSeed = () => Math.floor(Math.random() * 2 ** 32);
const LESSONS = TUTORIAL_STEPS.map((step, at) => ({ step, at })).filter(({ step }) => step.lesson);

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function visible(anchor: string): boolean {
  const element = document.querySelector(`[data-tutorial="${anchor}"]`);
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** 终局倒序计分的动画放着的时候不说话，放完再开口。 */
function useAnimationHold(game: GameState): boolean {
  const [until, setUntil] = useState(0);
  const [, setTick] = useState(0);
  const seen = useRef(game.version);
  useEffect(() => {
    if (game.version === seen.current) return;
    seen.current = game.version;
    if (reducedMotion()) return;
    // 翻牌的入场动画很短（0.5 秒），不用停；终局倒序计分约 11 秒，放完再开口
    if (game.events.some((event) => event.type === "GameEnded")) setUntil(performance.now() + 11_600);
  }, [game.version]);
  useEffect(() => {
    const left = until - performance.now();
    if (left <= 0) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), left + 20);
    return () => window.clearTimeout(timer);
  }, [until]);
  return performance.now() < until;
}

/** 这一步实际高亮哪个锚点：两步操作选中以后挪到「确认」；数组按顺序挑看得见的第一个。没找到之前 undefined。 */
function useStepAnchor(step: TutorialStep | undefined, version: number): string | null | undefined {
  const [found, setFound] = useState<{ id: string; anchor: string | null } | null>(null);
  useEffect(() => {
    if (!step) return;
    const candidates = anchorCandidates(step);
    if (candidates.length === 0) {
      setFound({ id: step.id, anchor: null });
      return;
    }
    const resolve = () => {
      let next = candidates.find(visible) ?? candidates[0]!;
      if (step.then) {
        const element = document.querySelector(`[data-tutorial="${candidates[0]}"]`);
        if (element?.classList.contains("picked") && visible(step.then)) next = step.then;
      }
      setFound((old) => (old && old.id === step.id && old.anchor === next ? old : { id: step.id, anchor: next }));
    };
    resolve();
    const timer = window.setInterval(resolve, 150);
    return () => window.clearInterval(timer);
  }, [step?.id, version]);
  if (!step) return null;
  return found && found.id === step.id ? found.anchor : undefined;
}

export default function TutorialMode({ name, brand, themeToggle, theme, waitingRoom, onExit }: {
  name: string;
  brand: ReactNode;
  themeToggle: ReactNode;
  theme: "day" | "night";
  waitingRoom?: string | undefined;
  onExit: () => void;
}) {
  const selfName = name.trim().length >= 2 ? name.trim() : "新玩家";
  const tutorial = useTutorial<GameState, TutorialMove, TutorialStep>({
    steps: TUTORIAL_STEPS,
    self: TUTORIAL_SELF,
    start: () => createTutorialGame(selfName),
    restart: () => createPracticeGame(selfName, randomSeed()),
    apply: (state, _playerId, move) => apply(state, move.player, move.command).state,
    same: sameMove,
    actor: (state) => tutorialActor(state),
    canAct: (state) => selfCanAct(state),
    bot: (state, playerId) => {
      const command = botCommand(redactGameForViewer(state, playerId), playerId, PRACTICE_BOT);
      return command ? { player: playerId, command } : null;
    },
    botDelay: (state) => (state.events.some((event) => event.type === "Revealed") ? 1600 : 900),
    watchDelay: () => 1100,
  });
  const { game, step, index, practice, flash } = tutorial;
  useEffect(() => {
    if (flash) sfx.deny();
  }, [flash]);
  const holding = useAnimationHold(game);
  const anchor = useStepAnchor(step, game.version);

  useEffect(() => {
    if (practice || (step?.kind === "info" && step.finale)) writeTutorial(GAME_ID, "done");
  }, [practice, step?.id]);

  function leave() {
    writeTutorial(GAME_ID, "skipped");
    onExit();
  }

  const members = useMemo<LobbyMember[]>(() => [
    { id: SELF_MEMBER, playerId: TUTORIAL_SELF, name: selfName, isHost: false, connected: true },
    { id: `tutorial-${TUTORIAL_BOT.id}`, playerId: TUTORIAL_BOT.id, name: TUTORIAL_BOT.name, isHost: false, connected: true, bot: true },
  ], [selfName]);
  const room = useMemo<LobbyRoomSnapshot>(() => ({
    code: TUTORIAL_CODE,
    spectators: [],
    access: DEFAULT_ROOM_ACCESS,
    options: { assist: game.config.assist },
    capacity: 2,
    status: "playing",
    members,
    chat: [],
    voice: [],
    game: redactGameForViewer(game, TUTORIAL_SELF),
  }), [game, members]);

  let view: CoachView | null = null;
  if (step && anchor !== undefined && !holding) {
    const note = isTouchDevice() && step.noteTouch ? step.noteTouch : step.note;
    const finale = step.kind === "info" && step.finale === true;
    const lessonNow = Math.max(0, LESSONS.filter(({ at }) => at <= index).length - 1);
    view = {
      key: step.id,
      say: step.say,
      ...(note ? { note } : {}),
      ...(flash ? { flash } : {}),
      anchor,
      focus: step.kind !== "watch",
      face: flash ? "surprised" : step.face ?? "base",
      footer: (
        <>
          <StepPips index={lessonNow} total={LESSONS.length} />
          {waitingRoom && <span className="tut-room-note">房间 {waitingRoom} 开局时自动回去</span>}
          {!finale && <button className="tut-link" type="button" data-tutorial="skip" onClick={leave}>跳过教程</button>}
        </>
      ),
      actions: step.kind !== "info" ? null : finale ? (
        <>
          <button className="quiet-button" type="button" data-tutorial="end" onClick={onExit}>结束教程</button>
          <button className="primary-button tut-main" type="button" data-tutorial="practice" onClick={tutorial.newPractice}>和人机练一局</button>
        </>
      ) : (
        <button className="primary-button tut-main" type="button" data-tutorial="next" onClick={tutorial.next}>下一步 ▶</button>
      ),
    };
  }

  const onCommand = (command: GameCommand) => {
    const { step: _step, ...clean } = command as GameCommand & { step?: string };
    tutorial.onCommand({ player: TUTORIAL_SELF, command: clean as GameCommand });
  };
  // 剧本进行中终局动画放完就停在翻完的样子；练习局正常放
  const scriptFinal = !practice && game.phase === "ended" && !holding ? 10 : undefined;

  return (
    <div className={practice ? "tut-practice" : "tut-script"} style={{ display: "contents" }}>
      <GameBoard
        room={room}
        busy={false}
        error=""
        notice=""
        brand={brand}
        connection={null}
        extraTop={
          <>
            <span className="connection-status online fa-tut-tag"><span className="connection-dot" />{practice ? "练习局" : "新手教程"}</span>
            <button className="quiet-button" type="button" data-tutorial="exit" onClick={practice ? onExit : leave}>退出教程</button>
          </>
        }
        themeToggle={themeToggle}
        theme={theme}
        chat={null}
        onCommand={onCommand}
        onRematch={() => undefined}
        onAuto={() => undefined}
        onDissolve={() => undefined}
        watchId={TUTORIAL_SELF}
        onWatch={() => undefined}
        onLeave={onExit}
        selfMemberId={SELF_MEMBER}
        mode={practice ? "practice" : "tutorial"}
        {...(scriptFinal !== undefined ? { finalStep: scriptFinal } : {})}
        {...(practice ? {
          finalActions: (
            <>
              <button className="quiet-button" type="button" data-tutorial="end" onClick={onExit}>结束教程</button>
              <button className="primary-button fa-confirm" type="button" data-tutorial="again" onClick={tutorial.newPractice}>再练一局</button>
            </>
          ),
        } : {})}
      />
      {view && <Coach view={view} />}
    </div>
  );
}
