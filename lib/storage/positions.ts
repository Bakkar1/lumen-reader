import type { SentenceRef } from '../messages';
import type { StorageAreaLike } from './area';

/**
 * Per-page resume positions in chrome.storage.local (design §9, D12). They
 * never leave the device: local storage is not synced.
 */
export interface PositionRecord {
  sentenceIndex: number;
  /** Offset of the sentence in the extracted text. */
  charOffset: number;
  /** The start of the sentence, to check that the page still has it. */
  snippet: string;
  /** The page was read to the end; no resume is offered. */
  finished: boolean;
  /** ms since the epoch. */
  updatedAt: number;
}

/** What the session controller reports when a page read pauses, stops, is abandoned or finishes. */
export interface PositionUpdate {
  url: string;
  index: number;
  sentence: SentenceRef;
  finished: boolean;
}

export const SNIPPET_CHARS = 80;

const PREFIX = 'lumen:pos:';

const TRACKING_PARAM = /^(utm_.*|fbclid|gclid)$/;

/** The page's address without the fragment and tracking parameters, so its variants share one position. */
export function urlKey(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url.split('#')[0] ?? url;
  }
  parsed.hash = '';
  for (const name of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAM.test(name)) parsed.searchParams.delete(name);
  }
  // URLSearchParams leaves a bare "?" behind when the last parameter goes.
  if (!parsed.searchParams.size) parsed.search = '';
  return parsed.href;
}

export function positionRecord(update: Omit<PositionUpdate, 'url'>, now: number): PositionRecord {
  return {
    sentenceIndex: update.index,
    charOffset: update.sentence.start,
    snippet: update.sentence.text.slice(0, SNIPPET_CHARS),
    finished: update.finished,
    updatedAt: now,
  };
}

/** Positions not updated for this long are deleted and never offered (reading-persistence spec). */
export const POSITION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const isExpired = (record: PositionRecord, now: number) => now - record.updatedAt > POSITION_TTL_MS;

export type ResumeOffer =
  | { kind: 'resume'; index: number; total: number }
  /** The stored sentence is no longer on the page: offer to start from the beginning instead. */
  | { kind: 'changed' };

/**
 * What to offer when a page is opened again (design §9). The stored snippet
 * must still start a sentence on the page; if it repeats, the copy nearest
 * the stored offset wins. A position that cannot be verified is never used.
 */
export function resumeOffer(
  record: PositionRecord | null,
  sentences: readonly Pick<SentenceRef, 'text' | 'start'>[],
  now: number,
): ResumeOffer | null {
  if (!record || record.finished || record.sentenceIndex === 0 || isExpired(record, now)) return null;
  let best = -1;
  sentences.forEach((s, i) => {
    if (s.text.slice(0, SNIPPET_CHARS) !== record.snippet) return;
    const distance = Math.abs(s.start - record.charOffset);
    if (best === -1 || distance < Math.abs(sentences[best]!.start - record.charOffset)) best = i;
  });
  return best === -1 ? { kind: 'changed' } : { kind: 'resume', index: best, total: sentences.length };
}

function isRecord(x: unknown): x is PositionRecord {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    Number.isInteger(r.sentenceIndex) &&
    Number.isInteger(r.charOffset) &&
    typeof r.snippet === 'string' &&
    typeof r.finished === 'boolean' &&
    typeof r.updatedAt === 'number'
  );
}

/** One storage key per page, so saving one page never rewrites the others. */
export class PositionStore {
  constructor(private area: StorageAreaLike) {}

  async get(key: string): Promise<PositionRecord | null> {
    const data = await this.area.get(PREFIX + key);
    const record = data[PREFIX + key];
    return isRecord(record) ? record : null;
  }

  save(key: string, record: PositionRecord): Promise<void> {
    return this.area.set({ [PREFIX + key]: record });
  }

  /** Deletes positions not updated for more than 30 days (and malformed ones). Returns how many went. */
  async prune(now = Date.now()): Promise<number> {
    const all = await this.area.get(null);
    const stale = Object.entries(all)
      .filter(([key, value]) => key.startsWith(PREFIX) && (!isRecord(value) || isExpired(value, now)))
      .map(([key]) => key);
    if (stale.length) await this.area.remove(stale);
    return stale.length;
  }
}
