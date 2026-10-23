import { browser } from 'wxt/browser';
import { KokoroPlayer, WorkerSynthesizer } from '@/lib/tts/kokoro/player';
import { isToOffscreen, type FromOffscreen } from '@/lib/tts/kokoro/protocol';

// Hosts Kokoro for KokoroTtsEngine: the model runs in a worker, the audio plays here.
const worker = new Worker(new URL('../../lib/tts/kokoro/worker.ts', import.meta.url), { type: 'module' });

const player = new KokoroPlayer(new WorkerSynthesizer(worker), (id, event) => {
  // The service worker may be asleep; the message wakes it. A new instance ignores unknown ids.
  void browser.runtime
    .sendMessage({ target: 'lumen-background', type: 'event', id, event } satisfies FromOffscreen)
    .catch(() => {});
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== browser.runtime.id || !isToOffscreen(message)) return;
  switch (message.type) {
    case 'speak':
      player.speak(message, message.enqueue);
      break;
    case 'stop':
      player.stop();
      break;
    case 'pause':
      player.pause();
      break;
    case 'resume':
      player.resume();
      break;
    case 'isSpeaking':
      sendResponse(player.isSpeaking());
      return;
  }
  sendResponse(null);
});
