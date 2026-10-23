import { LUMEN_HOST_ATTR } from '../text/dom-rules';

/** A press that moves further than this is a drag (e.g. selecting text), not a click. */
const DRAG_SLOP_PX = 4;

/** Clicks on these do their own thing and are never jump targets (SPEC.md D-5). */
const NOT_A_TARGET = `a[href], button, input, select, textarea, label, summary, [contenteditable], [${LUMEN_HOST_ATTR}]`;

export interface DomPoint {
  node: Node;
  offset: number;
}

export interface ClickToJumpDeps {
  /** True only while playing (SPEC.md §10). */
  isActive(): boolean;
  /** The sentence at a DOM point, or -1 if the point is not in the text being read. */
  sentenceAt(node: Node, offset: number): number;
  onJump(index: number): void;
  /** Resolves a viewport point to a text position; defaults to the caret at that point. */
  pointAt?(x: number, y: number): DomPoint | null;
}

/**
 * Click-to-jump (design §8): while playing, clicking a word moves playback to
 * the start of that word's sentence. A capture-phase listener sees the click
 * before page handlers can stop it, and never blocks it, so links and other
 * controls keep working; drags and selections are left alone.
 */
export class ClickToJump {
  private down: { x: number; y: number } | null = null;

  constructor(
    private doc: Document,
    private deps: ClickToJumpDeps,
  ) {}

  attach(): void {
    this.doc.addEventListener('pointerdown', this.onPointerDown, true);
    this.doc.addEventListener('click', this.onClick, true);
  }

  detach(): void {
    this.doc.removeEventListener('pointerdown', this.onPointerDown, true);
    this.doc.removeEventListener('click', this.onClick, true);
    this.down = null;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  private onClick = (e: MouseEvent) => {
    const down = this.down;
    this.down = null;
    if (e.button !== 0 || !this.deps.isActive()) return;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_SLOP_PX) return;
    if (this.doc.getSelection()?.isCollapsed === false) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest(NOT_A_TARGET)) return;

    const point = (this.deps.pointAt ?? caretAt(this.doc))(e.clientX, e.clientY);
    if (!point) return;
    const index = this.deps.sentenceAt(point.node, point.offset);
    if (index >= 0) this.deps.onJump(index);
  };
}

function caretAt(doc: Document): (x: number, y: number) => DomPoint | null {
  return (x, y) => {
    const pos = doc.caretPositionFromPoint?.(x, y);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
    const range = doc.caretRangeFromPoint?.(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  };
}
