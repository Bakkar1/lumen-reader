import { test, expect } from './fixtures';

test('the extension service worker is detected', async ({ serviceWorker, extensionId }) => {
  expect(serviceWorker.url()).toBe(`chrome-extension://${extensionId}/background.js`);
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});
