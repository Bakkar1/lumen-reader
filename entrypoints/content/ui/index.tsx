import { render } from 'preact';
import type { BackgroundToTab, TabToBackground } from '@/lib/messages';
import { extractPage } from '@/lib/text/extract';
import { findParagraphs } from '@/lib/text/paragraphs';
import { remainingMs } from '@/lib/player/layout';
import { DEFAULT_SETTINGS, type SettingsSync } from '@/lib/storage/settings';
import { resumeOffer, urlKey, type PositionStore } from '@/lib/storage/positions';
import type { Extraction } from '@/lib/text/extract';
import { sentenceRefs, type PageReader } from '../reader';
import { createUiHost } from './host';
import { ParagraphHover } from './paragraph-hover';
import { App, type PlayerActions, type UiState } from './Player';
import { Store } from './store';
import css from './player.css?inline';

/** The player shows on pages with at least this much readable text (SPEC.md §2). */
export const MIN_READABLE_CHARS = 100;
/** Re-checks for pages that render their text after load. */
export const READABLE_CHECKS_MS = [0, 1000, 3000];

export interface PlayerUiDeps {
  reader: PageReader;
  send(message: TabToBackground): void;
  settings: SettingsSync;
  positions: PositionStore;
}

/**
 * The content script's on-page UI (design §7): the docked player and the
 * paragraph play icons, in one shadow-root host. Playback commands go to the
 * background, which stays the single source of truth for state.
 */
export class PlayerUi {
  readonly store = new Store<UiState>({
    playback: null,
    voices: [],
    following: true,
    visible: false,
    closed: false,
    remainingMs: null,
    paragraphIcon: null,
    settings: { ...DEFAULT_SETTINGS },
    resume: null,
  });
  private hover: ParagraphHover | null = null;
  private mounted = false;
  /** The extraction the resume offer was verified against. */
  private resumeSource: Extraction | null = null;

  constructor(private deps: PlayerUiDeps) {
    // Changes from other tabs, the popup or another machine apply live (reading-persistence spec).
    deps.settings.onChange(() => this.store.set({ settings: deps.settings.get() }));
    void deps.settings.load().then(
      (settings) => this.store.set({ settings }),
      () => {},
    );
  }

  /** Shows the collapsed player once the page has enough readable text. */
  showWhenReadable(): void {
    for (const delay of READABLE_CHECKS_MS) {
      setTimeout(() => {
        if (this.store.get().visible) return;
        const extraction = extractPage(document);
        if (extraction.text.trim().length < MIN_READABLE_CHARS) return;
        this.mount();
        this.hover?.setTargets(extraction, findParagraphs(extraction));
        this.store.set({ visible: true });
        void this.offerResume(extraction);
      }, delay);
    }
  }

  /** A child frame has readable text (the page's content is in an iframe). */
  revealForFrame(): void {
    if (!this.store.get().closed) this.reveal();
  }

  /** Offers to pick up where the user left off on this page (reading-persistence spec). */
  private async offerResume(extraction: Extraction): Promise<void> {
    const record = await this.deps.positions.get(urlKey(location.href)).catch(() => null);
    const offer = resumeOffer(record, sentenceRefs(extraction), Date.now());
    // Reading may have started while storage was being read.
    if (!offer || this.store.get().playback?.status === 'playing') return;
    this.resumeSource = extraction;
    this.store.set({ resume: offer });
  }

  private startFromOffer(index: number): void {
    const extraction = this.resumeSource;
    this.resumeSource = null;
    this.store.set({ resume: null });
    if (extraction) this.deps.reader.startWith(extraction, index);
  }

  setFollowing(following: boolean): void {
    this.store.set({ following });
  }

  onMessage(message: BackgroundToTab): void {
    switch (message.type) {
      case 'state': {
        const { state } = message;
        const sentences = this.deps.reader.readingView?.extraction.sentences ?? [];
        const timed = (state.status === 'playing' || state.status === 'paused') && sentences.length > 0;
        this.store.set({
          playback: state,
          remainingMs: timed ? remainingMs(sentences, state.index, state.effectiveRate) : null,
        });
        if (state.status === 'playing') {
          // Reading started some other way: the offer is moot.
          if (this.store.get().resume) this.store.set({ resume: null });
          // A session started here (e.g. a selection on a short page) always gets a player.
          this.reveal();
        }
        break;
      }
      case 'voices':
        this.store.set({ voices: message.voices });
        break;
      case 'following':
        // From the child frame being read.
        this.setFollowing(message.following);
        break;
      case 'showPlayer':
        this.store.set({ closed: false });
        this.reveal();
        break;
    }
  }

  private reveal(): void {
    if (this.store.get().visible) return;
    this.mount();
    this.store.set({ visible: true });
  }

  private mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    const { host, root } = createUiHost(document, css);
    this.hover = new ParagraphHover(host, (paragraphIcon) => this.store.set({ paragraphIcon }));
    this.hover.attach();
    render(<App store={this.store} actions={this.actions} />, root);
  }

  private actions: PlayerActions = {
    // With no session for this tab, the background asks us to start one.
    toggle: () => this.deps.send({ type: 'control', action: 'toggle' }),
    skip: (action) => this.deps.send({ type: 'control', action }),
    setRate: (rate) => this.deps.send({ type: 'setRate', rate }),
    setVoice: (voiceName) => this.deps.send({ type: 'setVoice', voiceName }),
    loadVoices: () => this.deps.send({ type: 'getVoices' }),
    // The text being read may be in a child frame; the background routes it there.
    backToReading: () =>
      this.deps.reader.readingView ? this.deps.reader.backToReading() : this.deps.send({ type: 'backToReading' }),
    movePlayer: (top) => {
      const playerY = Math.round(top);
      this.store.set({ settings: { ...this.store.get().settings, playerY } });
      void this.deps.settings.save({ playerY }).catch(() => {});
    },
    close: () => this.store.set({ closed: true, paragraphIcon: null }),
    resume: () => {
      const offer = this.store.get().resume;
      if (offer?.kind === 'resume') this.startFromOffer(offer.index);
    },
    startOver: () => this.startFromOffer(0),
    dismissResume: () => {
      this.resumeSource = null;
      this.store.set({ resume: null });
    },
    playParagraph: (target) => {
      const extraction = this.hover?.source;
      this.hover?.hide();
      if (extraction) this.deps.reader.startWith(extraction, target.sentenceIndex);
    },
  };
}
