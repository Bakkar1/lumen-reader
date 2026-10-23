import { LUMEN_HOST_ATTR } from '@/lib/text/dom-rules';

/**
 * Inline `!important` declarations on the host beat any page rule, even
 * `* { all: unset !important }`. The host is a zero-size fixed box; the
 * player inside positions itself against the viewport.
 */
const HOST_STYLE = [
  'all: initial',
  'position: fixed',
  'top: 0',
  'left: 0',
  'width: 0',
  'height: 0',
  'overflow: visible',
  'display: block',
  'z-index: 2147483647',
]
  .map((d) => `${d} !important`)
  .join('; ');

export interface UiHost {
  host: HTMLElement;
  root: ShadowRoot;
}

/**
 * Creates Lumen Reader's single UI host (design §7): an element on
 * `document.documentElement` with a closed shadow root and the bundled
 * styles adopted into it, so page CSS and player CSS never meet.
 */
export function createUiHost(doc: Document, css: string): UiHost {
  const host = doc.createElement('lumen-reader');
  host.setAttribute(LUMEN_HOST_ATTR, '');
  host.setAttribute('style', HOST_STYLE);
  const root = host.attachShadow({ mode: __LUMEN_E2E__ ? 'open' : 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [sheet];
  doc.documentElement.append(host);
  return { host, root };
}
