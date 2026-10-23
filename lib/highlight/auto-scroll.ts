/** The sentence may sit anywhere in this vertical band of the viewport before we scroll. */
const BAND_TOP = 0.15;
const BAND_BOTTOM = 0.8;

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

export interface AutoScrollerOptions {
  /** Told when following stops (user scrolled) or starts again. */
  onFollowChange?(following: boolean): void;
}

/**
 * Keeps the current sentence in view (design §6). A scroll by the user
 * (wheel, touch or scroll key) turns following off until `resume()`.
 */
export class AutoScroller {
  private following = true;
  private attached = false;
  private last: Range | null = null;

  constructor(
    private win: Window,
    private options: AutoScrollerOptions = {},
  ) {}

  get isFollowing(): boolean {
    return this.following;
  }

  /** Listens for user scrolling; call while playing. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.win.addEventListener('wheel', this.onUserScroll, { capture: true, passive: true });
    this.win.addEventListener('touchmove', this.onUserScroll, { capture: true, passive: true });
    this.win.addEventListener('keydown', this.onKey, { capture: true, passive: true });
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.win.removeEventListener('wheel', this.onUserScroll, { capture: true });
    this.win.removeEventListener('touchmove', this.onUserScroll, { capture: true });
    this.win.removeEventListener('keydown', this.onKey, { capture: true });
  }

  /** Brings the range into the comfort band if it has left it. */
  follow(range: Range): void {
    this.last = range;
    if (this.following) this.scrollTo(range, false);
  }

  /** Turns following back on and scrolls to the last range ("Back to reading"). */
  resume(): void {
    this.setFollowing(true);
    if (this.last) this.scrollTo(this.last, true);
  }

  /** Follows again from scratch (a new reading action). */
  reset(): void {
    this.last = null;
    this.setFollowing(true);
  }

  private scrollTo(range: Range, force: boolean): void {
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const h = this.win.innerHeight;
    if (!force && rect.top >= h * BAND_TOP && rect.bottom <= h * BAND_BOTTOM) return;
    const el = range.startContainer.parentElement;
    if (el && el.getBoundingClientRect().height < h * 0.5) {
      // Also scrolls nested scroll containers.
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else {
      this.win.scrollBy({ top: rect.top + rect.height / 2 - h / 2, behavior: 'smooth' });
    }
  }

  private setFollowing(on: boolean): void {
    if (this.following === on) return;
    this.following = on;
    this.options.onFollowChange?.(on);
  }

  private onUserScroll = () => this.setFollowing(false);

  private onKey = (e: KeyboardEvent) => {
    if (!SCROLL_KEYS.has(e.key)) return;
    const t = e.target as HTMLElement | null;
    if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '')) return;
    this.setFollowing(false);
  };
}
