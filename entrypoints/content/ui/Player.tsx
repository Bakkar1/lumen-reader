import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PlaybackState, VoiceInfo } from '@/lib/messages';
import type { ParagraphTarget } from '@/lib/text/paragraphs';
import { MAX_RATE, MIN_RATE, RATE_PRESETS, RATE_STEP } from '@/lib/tts/caps';
import { clampTop, formatRemaining } from '@/lib/player/layout';
import type { Settings } from '@/lib/storage/settings';
import type { ResumeOffer } from '@/lib/storage/positions';
import { Store, useStore } from './store';
import {
  CloseIcon,
  CollapseIcon,
  GripIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ReturnIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from './icons';

export interface ParagraphIconState {
  target: ParagraphTarget;
  /** Viewport coordinates of the icon's left edge and vertical centre. */
  x: number;
  y: number;
}

export interface UiState {
  /** Null until the background has reported this tab's state. */
  playback: PlaybackState | null;
  voices: VoiceInfo[];
  /** False after the user scrolled away during playback ("Back to reading"). */
  following: boolean;
  /** The page has enough readable text, or a session ran here. */
  visible: boolean;
  /** Closed by the user for this tab (SPEC.md D-1). */
  closed: boolean;
  remainingMs: number | null;
  paragraphIcon: ParagraphIconState | null;
  /** The synced settings: theme and position, and voice and speed until the background reports state. */
  settings: Settings;
  /** Offered when the page is opened again after a read that did not finish. */
  resume: ResumeOffer | null;
}

export interface PlayerActions {
  toggle(): void;
  skip(action: 'skipBack' | 'skipForward'): void;
  setRate(rate: number): void;
  setVoice(voiceName: string): void;
  /** Called the first time the player expands. */
  loadVoices(): void;
  backToReading(): void;
  /** The user moved the player to this top edge (px). */
  movePlayer(top: number): void;
  close(): void;
  playParagraph(target: ParagraphTarget): void;
  resume(): void;
  startOver(): void;
  dismissResume(): void;
}

interface Props {
  store: Store<UiState>;
  actions: PlayerActions;
}

const HOVER_EXPAND_MS = 250;
const COLLAPSE_AFTER_MS = 2000;
const DRAG_THRESHOLD_PX = 10;
const KEY_MOVE_PX = 24;
const PARA_ICON_SIZE = 28;

const STATUS_TEXT: Record<PlaybackState['status'], string> = {
  idle: 'Ready to read this page',
  playing: 'Reading',
  paused: 'Paused',
  stopped: 'Stopped',
};

export function App({ store, actions }: Props) {
  const ui = useStore(store);
  return (
    <div class="root" data-theme={ui.settings.theme}>
      {ui.visible && <Player ui={ui} actions={actions} />}
      {ui.paragraphIcon && !ui.closed && <ParagraphIcon icon={ui.paragraphIcon} actions={actions} />}
    </div>
  );
}

function ParagraphIcon({ icon, actions }: { icon: ParagraphIconState; actions: PlayerActions }) {
  return (
    <button
      class="para-play"
      style={{ left: `${icon.x}px`, top: `${icon.y - PARA_ICON_SIZE / 2}px` }}
      aria-label="Read from this paragraph"
      onClick={() => actions.playParagraph(icon.target)}
    >
      <PlayIcon />
    </button>
  );
}

/** Sits beside the player when a page is reopened; clicks in it never expand the player. */
function ResumeCard({ offer, actions }: { offer: ResumeOffer; actions: PlayerActions }) {
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div class="offer" role="group" aria-label="Resume reading" data-kind={offer.kind} onClick={(e) => e.stopPropagation()}>
      {offer.kind === 'resume' ? (
        <>
          <p class="offer-text">
            Pick up where you left off?
            <span class="offer-detail">
              Sentence {offer.index + 1} of {offer.total}
            </span>
          </p>
          <div class="offer-actions">
            <button class="offer-primary" onClick={stop(actions.resume)}>
              Resume
            </button>
            <button class="offer-secondary" onClick={stop(actions.startOver)}>
              Start over
            </button>
          </div>
        </>
      ) : (
        <>
          <p class="offer-text">This page has changed since you last listened, so your place could not be found.</p>
          <div class="offer-actions">
            <button class="offer-primary" onClick={stop(actions.startOver)}>
              Start from the beginning
            </button>
          </div>
        </>
      )}
      <button class="icon offer-close" aria-label="Dismiss" onClick={stop(actions.dismissResume)}>
        <CloseIcon />
      </button>
    </div>
  );
}

/**
 * The docked player (floating-player spec, SPEC.md §3): a compact bar on the
 * right edge that expands on hover, click or keyboard focus, and can be
 * dragged vertically.
 */
function Player({ ui, actions }: { ui: UiState; actions: PlayerActions }) {
  const [expanded, setExpanded] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** The top edge while a drag is in progress; afterwards the synced `playerY` holds it. */
  const [dragTop, setDragTop] = useState<number | null>(null);
  const [height, setHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);

  const ref = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const collapseTimer = useRef<number | undefined>(undefined);
  const pointerInside = useRef(false);
  const speedOpenNow = useRef(false);
  speedOpenNow.current = speedOpen;
  const voicesRequested = useRef(false);
  const drag = useRef<{ startY: number; startTop: number; top: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const rateButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    setHeight(el.offsetHeight);
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      clearTimeout(hoverTimer.current);
      clearTimeout(collapseTimer.current);
    };
  }, []);

  // Re-clamped on every render, so a resize or an expand never pushes it off-screen.
  const top = clampTop(dragTop ?? ui.settings.playerY ?? (viewportHeight - height) / 2, height, viewportHeight);

  const expand = () => {
    clearTimeout(hoverTimer.current);
    clearTimeout(collapseTimer.current);
    setExpanded(true);
    if (!voicesRequested.current) {
      voicesRequested.current = true;
      actions.loadVoices();
    }
  };

  const blurInside = () => {
    const active = (ref.current?.getRootNode() as ShadowRoot | undefined)?.activeElement;
    if (active instanceof HTMLElement && ref.current?.contains(active)) active.blur();
  };

  const collapse = () => {
    clearTimeout(hoverTimer.current);
    clearTimeout(collapseTimer.current);
    setExpanded(false);
    setSpeedOpen(false);
    blurInside();
  };

  /** An open panel, a focused voice list or keyboard focus keeps the player expanded. */
  const heldOpen = () => {
    if (speedOpenNow.current) return true;
    const active = (ref.current?.getRootNode() as ShadowRoot | undefined)?.activeElement;
    if (!(active instanceof HTMLElement) || !ref.current?.contains(active)) return false;
    return active.tagName === 'SELECT' || active.matches(':focus-visible');
  };

  const scheduleCollapse = () => {
    clearTimeout(collapseTimer.current);
    collapseTimer.current = window.setTimeout(() => {
      if (!pointerInside.current && !heldOpen()) collapse();
    }, COLLAPSE_AFTER_MS);
  };

  const toggleSpeed = () => {
    const open = !speedOpen;
    setSpeedOpen(open);
    speedOpenNow.current = open;
    if (!open && !pointerInside.current) scheduleCollapse();
  };

  // ---- Dragging (vertical only, SPEC.md §3) ----

  const onGripPointerDown = (e: PointerEvent) => {
    // A press on the grip is a possible drag, not a click that expands.
    e.stopPropagation();
    if (e.button !== 0) return;
    clearTimeout(hoverTimer.current);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startTop: top, top, moved: false };
  };

  const onGripPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
    }
    d.top = clampTop(d.startTop + dy, height, viewportHeight);
    setDragTop(d.top);
  };

  const onGripPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    justDragged.current = d?.moved ?? false;
    if (d?.moved) actions.movePlayer(d.top);
    setDragTop(null);
    if (d && !d.moved) expand();
  };

  /** The click that ends a drag must not reach the player and expand it. */
  const onGripClick = (e: MouseEvent) => {
    if (!justDragged.current) return;
    justDragged.current = false;
    e.stopPropagation();
  };

  const onGripKeyDown = (e: KeyboardEvent) => {
    const delta = { ArrowUp: -KEY_MOVE_PX, ArrowDown: KEY_MOVE_PX }[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    actions.movePlayer(clampTop(top + delta, height, viewportHeight));
  };

  // ---- Rendering ----

  const pb = ui.playback;
  const status = pb?.status ?? 'idle';
  const playing = status === 'playing';
  const inSession = status === 'playing' || status === 'paused';
  const rate = pb?.rate ?? ui.settings.rate;
  const voiceName = pb ? pb.voiceName : ui.settings.voiceName;
  const time = ui.remainingMs !== null ? formatRemaining(ui.remainingMs) : null;

  let statusText = STATUS_TEXT[status];
  if (inSession && pb) statusText += ` · sentence ${pb.index + 1} of ${pb.total}`;
  if (time) statusText += ` · ${time} left`;

  return (
    <div
      ref={ref}
      class="player"
      hidden={ui.closed}
      role="region"
      aria-label="Lumen Reader player"
      data-expanded={String(expanded)}
      data-status={status}
      data-dragging={String(dragging)}
      style={{ top: `${top}px` }}
      onPointerEnter={() => {
        pointerInside.current = true;
        clearTimeout(collapseTimer.current);
        if (!expanded && !drag.current) hoverTimer.current = window.setTimeout(expand, HOVER_EXPAND_MS);
      }}
      onPointerLeave={() => {
        pointerInside.current = false;
        clearTimeout(hoverTimer.current);
        if (expanded && !drag.current) scheduleCollapse();
      }}
      // Expanding moves the controls. On a press it would move the button out
      // from under the pointer before the click lands, so a click expands
      // after the fact, and a press cancels a pending hover expand.
      onPointerDown={() => clearTimeout(hoverTimer.current)}
      onClick={expand}
      onFocusIn={(e) => {
        if ((e.target as HTMLElement).matches(':focus-visible')) expand();
      }}
      onFocusOut={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node | null) && !pointerInside.current) scheduleCollapse();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        if (!speedOpen) return collapse();
        toggleSpeed();
        // The focused preset is going away; keep focus on the control that opened them.
        rateButton.current?.focus();
      }}
    >
      <button
        class="grip"
        aria-label="Move player"
        title="Drag, or use the arrow keys, to move the player"
        onPointerDown={onGripPointerDown}
        onPointerMove={onGripPointerMove}
        onPointerUp={onGripPointerUp}
        onPointerCancel={onGripPointerUp}
        onClick={onGripClick}
        onKeyDown={onGripKeyDown}
      >
        <GripIcon />
      </button>

      {expanded && (
        <div class="head">
          <span class="title">Lumen Reader</span>
          <button
            class="icon"
            aria-label="Collapse player"
            onClick={(e) => {
              e.stopPropagation();
              collapse();
            }}
          >
            <CollapseIcon />
          </button>
          <button class="icon" aria-label="Close player for this tab" onClick={actions.close}>
            <CloseIcon />
          </button>
        </div>
      )}

      <div class="transport">
        {expanded && (
          <button class="icon" aria-label="Previous sentence" disabled={!inSession} onClick={() => actions.skip('skipBack')}>
            <SkipBackIcon />
          </button>
        )}
        <button class="play" aria-label={playing ? 'Pause' : 'Play'} onClick={actions.toggle}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        {expanded && (
          <button class="icon" aria-label="Next sentence" disabled={!inSession} onClick={() => actions.skip('skipForward')}>
            <SkipForwardIcon />
          </button>
        )}
      </div>

      {!expanded && time && <span class="time">{time}</span>}

      {expanded && (
        <>
          <p class="status" role="status" data-index={pb?.index ?? 0}>
            {statusText}
          </p>

          <div class="row">
            <span class="label" id="lumen-speed-label">
              Speed
            </span>
            <div class="stepper">
              <button
                class="step"
                aria-label="Slower"
                disabled={rate <= MIN_RATE}
                onClick={() => actions.setRate(rate - RATE_STEP)}
              >
                <MinusIcon />
              </button>
              <button
                ref={rateButton}
                class="rate"
                id="lumen-rate"
                aria-labelledby="lumen-speed-label lumen-rate"
                aria-expanded={speedOpen}
                aria-controls={speedOpen ? 'lumen-presets' : undefined}
                data-rate={rate}
                onClick={toggleSpeed}
              >
                {rate.toFixed(1)}×
              </button>
              <button
                class="step"
                aria-label="Faster"
                disabled={rate >= MAX_RATE}
                onClick={() => actions.setRate(rate + RATE_STEP)}
              >
                <PlusIcon />
              </button>
            </div>
          </div>

          {speedOpen && (
            <div class="presets" id="lumen-presets" role="group" aria-label="Speed presets">
              {RATE_PRESETS.map((p) => (
                <button key={p} class="preset" aria-pressed={rate === p} onClick={() => actions.setRate(p)}>
                  {p}×
                </button>
              ))}
            </div>
          )}

          {pb && pb.effectiveRate < pb.rate && (
            <p class="notice">This voice tops out at {pb.effectiveRate.toFixed(1)}×, so that is the speed you hear.</p>
          )}

          <label class="voice">
            <span class="label">Voice</span>
            <select value={voiceName ?? ''} onChange={(e) => actions.setVoice(e.currentTarget.value)}>
              {!voiceName && <option value="">Browser default</option>}
              {voiceName && !ui.voices.some((v) => v.voiceName === voiceName) && (
                <option value={voiceName}>{voiceName}</option>
              )}
              {ui.voices.map((v) => (
                <option key={v.voiceName} value={v.voiceName}>
                  {v.voiceName}
                  {v.lang ? ` (${v.lang})` : ''}
                </option>
              ))}
            </select>
          </label>

          {pb?.voiceUnavailable && <p class="notice">Your saved voice isn't available, so a default voice is used.</p>}
        </>
      )}

      {ui.resume && !playing && <ResumeCard offer={ui.resume} actions={actions} />}

      {playing && !ui.following && (
        <button
          class="chip"
          onClick={(e) => {
            e.stopPropagation();
            actions.backToReading();
          }}
        >
          <ReturnIcon />
          Back to reading
        </button>
      )}
    </div>
  );
}
