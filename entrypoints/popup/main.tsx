import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { BackgroundToTab, ControlAction, PlaybackState, PopupRequest, VoiceInfo } from '@/lib/messages';
import { MAX_RATE, MIN_RATE, RATE_PRESETS, RATE_STEP, normaliseRate } from '@/lib/tts/caps';
import { DEFAULT_SETTINGS, SettingsSync, THEMES, type Theme } from '@/lib/storage/settings';
import './style.css';

const POLL_MS = 400;

const request = <T,>(message: PopupRequest) => browser.runtime.sendMessage(message) as Promise<T>;

/** The tab to control: `?tabId=` (used by E2E tests) or the active tab. */
async function targetTabId(): Promise<number | null> {
  const fromQuery = Number(new URLSearchParams(location.search).get('tabId'));
  if (Number.isInteger(fromQuery) && fromQuery > 0) return fromQuery;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

const STATUS_TEXT: Record<PlaybackState['status'], string> = {
  idle: 'Ready to read this page',
  playing: 'Reading',
  paused: 'Paused',
  stopped: 'Stopped',
};

const THEME_LABELS: Record<Theme, string> = { system: 'Match system', light: 'Light', dark: 'Dark' };

// The popup writes the theme itself; voice and speed go through the background.
const settings = new SettingsSync(browser.storage.sync, browser.storage.onChanged);

function Popup() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [state, setState] = useState<PlaybackState | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [theme, setThemeState] = useState<Theme>(DEFAULT_SETTINGS.theme);

  useEffect(() => {
    void settings.load().then((s) => setThemeState(s.theme), () => {});
    return settings.onChange((patch) => {
      if (patch.theme) setThemeState(patch.theme);
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    void settings.save({ theme: next }).catch(() => {});
  };

  const refresh = useCallback(async () => {
    if (tabId === null) return;
    setState(await request<PlaybackState>({ type: 'popup:getState', tabId }));
  }, [tabId]);

  useEffect(() => {
    void targetTabId().then((id) => {
      setTabId(id);
      // A toolbar click brings back a player the user closed in that tab (SPEC.md D-1).
      if (id !== null) browser.tabs.sendMessage(id, { type: 'showPlayer' } satisfies BackgroundToTab).catch(() => {});
    });
    void request<VoiceInfo[]>({ type: 'popup:getVoices' }).then((v) => setVoices(v ?? []));
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const control = async (action: ControlAction) => {
    if (tabId === null) return;
    setState(await request<PlaybackState>({ type: 'popup:control', tabId, action }));
  };

  const setRate = async (rate: number) => {
    await request({ type: 'popup:setRate', rate: normaliseRate(rate) });
    void refresh();
  };

  const setVoice = async (voiceName: string) => {
    await request({ type: 'popup:setVoice', voiceName });
    void refresh();
  };

  if (tabId === null || !state) return <main class="popup">Loading…</main>;

  const playing = state.status === 'playing';
  const capped = state.effectiveRate < state.rate;

  return (
    <main class="popup">
      <header>
        <h1>Lumen Reader</h1>
        <p class="status" role="status" data-status={state.status} data-index={state.index}>
          {STATUS_TEXT[state.status]}
          {state.total > 0 && state.status !== 'idle' && ` · sentence ${state.index + 1} of ${state.total}`}
        </p>
      </header>

      <div class="transport">
        <button class="primary" onClick={() => control('toggle')} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => control('stop')} disabled={state.status === 'idle'} aria-label="Stop">
          Stop
        </button>
      </div>

      <fieldset class="speed">
        <legend>Speed</legend>
        <div class="stepper">
          <button
            onClick={() => setRate(state.rate - RATE_STEP)}
            disabled={state.rate <= MIN_RATE}
            aria-label="Slower"
          >
            −
          </button>
          <output aria-label="Speed" data-rate={state.rate}>
            {state.rate.toFixed(1)}×
          </output>
          <button
            onClick={() => setRate(state.rate + RATE_STEP)}
            disabled={state.rate >= MAX_RATE}
            aria-label="Faster"
          >
            +
          </button>
        </div>
        <div class="presets">
          {RATE_PRESETS.map((p) => (
            <button key={p} aria-pressed={state.rate === p} onClick={() => setRate(p)}>
              {p}×
            </button>
          ))}
        </div>
        {capped && (
          <p class="notice">This voice tops out at {state.effectiveRate.toFixed(1)}×.</p>
        )}
      </fieldset>

      <label class="voice">
        <span>Voice</span>
        <select value={state.voiceName ?? ''} onChange={(e) => setVoice(e.currentTarget.value)}>
          {state.voiceName === null && <option value="">Browser default</option>}
          {voices.map((v) => (
            <option key={v.voiceName} value={v.voiceName}>
              {v.voiceName}
              {v.lang ? ` (${v.lang})` : ''}
            </option>
          ))}
        </select>
      </label>
      {state.voiceUnavailable && <p class="notice">Your saved voice isn't available, so a default voice is used.</p>}

      <label class="voice">
        <span>Theme</span>
        <select value={theme} onChange={(e) => setTheme(e.currentTarget.value as Theme)}>
          {THEMES.map((t) => (
            <option key={t} value={t}>
              {THEME_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
    </main>
  );
}

render(<Popup />, document.getElementById('app')!);
