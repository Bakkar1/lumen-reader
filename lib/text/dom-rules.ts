/**
 * Shared DOM classification rules for extraction (design §5, SPEC.md §13).
 */

/** Marks Lumen Reader's own UI host, which extraction never reads. */
export const LUMEN_HOST_ATTR = 'data-lumen-reader';

/** Elements whose content is never read. */
const NEVER_READ = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'LINK',
  'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'PICTURE',
  'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'DATALIST',
]);

/** Page furniture skipped when reading a whole page (not a selection). */
const BOILERPLATE_TAGS = new Set(['NAV', 'ASIDE', 'DIALOG']);
const BOILERPLATE_ROLES = new Set([
  'navigation', 'banner', 'complementary', 'contentinfo', 'dialog', 'alertdialog',
  'menu', 'menubar', 'toolbar', 'search',
]);
const BOILERPLATE_TOKENS = new Set([
  'nav', 'navbar', 'navigation', 'menu', 'sidebar', 'footer', 'breadcrumb', 'breadcrumbs',
  'cookie', 'cookies', 'consent', 'share', 'social', 'related', 'ad', 'ads', 'advert',
  'advertisement', 'sponsored', 'promo', 'newsletter', 'subscribe', 'widget',
]);

/** Sectioning elements that scope a <header>/<footer> to themselves rather than the page. */
const SECTIONING = new Set(['ARTICLE', 'MAIN', 'SECTION', 'ASIDE', 'NAV']);

export const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'CAPTION', 'DD', 'DETAILS', 'DIALOG', 'DIV',
  'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5',
  'H6', 'HEADER', 'HGROUP', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY',
  'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

const BLOCK_DISPLAY = /^(block|flex|grid|list-item|table|table-row|table-cell|table-caption|flow-root)$/;

export function isBlock(el: Element): boolean {
  if (BLOCK_TAGS.has(el.tagName)) return true;
  const display = el.ownerDocument.defaultView?.getComputedStyle(el).display ?? '';
  return BLOCK_DISPLAY.test(display);
}

export function isNeverRead(el: Element): boolean {
  return (
    NEVER_READ.has(el.tagName.toUpperCase()) ||
    el.hasAttribute(LUMEN_HOST_ATTR) ||
    el.getAttribute('aria-hidden') === 'true'
  );
}

/** Rendered at all (display, content-visibility). Visibility is checked per text node. */
export function isDisplayed(el: Element): boolean {
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
}

export function isTextVisible(el: Element): boolean {
  return typeof el.checkVisibility === 'function'
    ? el.checkVisibility({ visibilityProperty: true })
    : true;
}

function tokens(el: Element): string[] {
  const raw = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`;
  return raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** True for this element itself being navigation, sidebars, banners, cookie notices and the like. */
export function isBoilerplate(el: Element): boolean {
  if (BOILERPLATE_TAGS.has(el.tagName)) return true;
  const role = el.getAttribute('role');
  if (role && BOILERPLATE_ROLES.has(role)) return true;
  if ((el.tagName === 'HEADER' || el.tagName === 'FOOTER') && !hasSectioningAncestor(el)) return true;
  return tokens(el).some((t) => BOILERPLATE_TOKENS.has(t));
}

function hasSectioningAncestor(el: Element): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (SECTIONING.has(p.tagName)) return true;
  }
  return false;
}

/** True if the element or any ancestor up to (excluding) `root` is boilerplate or never read. */
export function isInsideExcluded(el: Element, root: Element | null = null): boolean {
  for (let e: Element | null = el; e && e !== root; e = e.parentElement) {
    if (isBoilerplate(e) || isNeverRead(e)) return true;
  }
  return false;
}
