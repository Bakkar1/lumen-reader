import { browser } from 'wxt/browser';
import { KokoroPlayer, WorkerSynthesizer } from '@/lib/tts/kokoro/player';
import { isToOffscreen, type FromOffscreen } from '@/lib/tts/kokoro/protocol';

// Hosts Kokoro for KokoroTtsEngine: the model runs in a worker, the audio plays here.
const worker = new Worker(new URL('../../lib/tts/kokoro/worker.ts', import.meta.url), { type: 'module' });

/** When each speak that starts from silence arrived, to log how long it took to be heard. */
const requested = new Map<number, number>();

const player = new KokoroPlayer(new WorkerSynthesizer(worker), (id, event) => {
  const at = requested.get(id);
  if (at !== undefined && event.type !== 'word') {
    requested.delete(id);
    if (event.type === 'start') console.debug(`[lumen] speech started ${Math.round(performance.now() - at)} ms after the request`);
  }
  // The service worker may be asleep; the message wakes it. A new instance ignores unknown ids.
  void browser.runtime
    .sendMessage({ target: 'lumen-background', type: 'event', id, event } satisfies FromOffscreen)
    .catch(() => {});
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== browser.runtime.id || !isToOffscreen(message)) return;
  switch (message.type) {
    case 'speak':
      if (!message.enqueue) requested.set(message.id, performance.now());
      player.speak(message, message.enqueue);
      break;
    case 'stop':
      player.stop();
      break;
    case 'pause':
      player.pause();
      break;
    case 'resume':
      sendResponse(player.resume());
      return;
    case 'isSpeaking':
      sendResponse(player.isSpeaking());
      return;
  }
  sendResponse(null);
});
