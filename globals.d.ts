/** True in E2E builds, where the background uses FakeTtsEngine instead of chrome.tts. */
declare const __LUMEN_FAKE_TTS__: boolean;
/** In E2E builds: whether the default fake voice sends word events. */
declare const __LUMEN_FAKE_WORD_EVENTS__: boolean;
/** True in E2E builds. The player's shadow root is then open, because Playwright and axe cannot reach closed roots. */
declare const __LUMEN_E2E__: boolean;
