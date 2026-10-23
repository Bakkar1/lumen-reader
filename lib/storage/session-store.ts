import { browser } from 'wxt/browser';
import type { SessionSnapshot } from '../session';

const KEY = 'lumen:session';

/** The active session in chrome.storage.session, which survives worker restarts but not the browser (design §4). */
export async function loadSnapshot(): Promise<SessionSnapshot | null> {
  const data = await browser.storage.session.get(KEY);
  return (data[KEY] as SessionSnapshot | undefined) ?? null;
}

export function saveSnapshot(snapshot: SessionSnapshot | null): Promise<void> {
  return snapshot ? browser.storage.session.set({ [KEY]: snapshot }) : browser.storage.session.remove(KEY);
}
