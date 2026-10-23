import { isBlock, isBoilerplate, isDisplayed, isNeverRead, isTextVisible } from './dom-rules';

/** A run of extracted text that maps 1:1 onto consecutive characters of one text node. */
export interface TextSegment {
  node: Text;
  nodeStart: number;
  textStart: number;
  length: number;
}

export interface WalkResult {
  /** Readable text: whitespace collapsed, blocks separated by a single "\n". */
  text: string;
  /** Sorted by textStart. "\n" block boundaries are not mapped. */
  segments: TextSegment[];
}

export interface WalkOptions {
  /** Skip nav, sidebars, banners and similar (whole-page reading). */
  skipBoilerplate: boolean;
}

const WS = /\s/;

/**
 * Walks the live DOM under `root` in document order (design §5). Reads only
 * rendered text, collapses whitespace like the browser does, and emits a
 * virtual "\n" at every block boundary so blocks always end sentences.
 * Never modifies the DOM.
 */
export function walkText(root: Element, options: WalkOptions): WalkResult {
  let text = '';
  const segments: TextSegment[] = [];
  let pendingSpace: { node: Text; offset: number } | null = null;
  let pendingBreak = false;

  const append = (ch: string, node: Text, offset: number) => {
    const last = segments.at(-1);
    if (last && last.node === node && last.nodeStart + last.length === offset && last.textStart + last.length === text.length) {
      last.length++;
    } else {
      segments.push({ node, nodeStart: offset, textStart: text.length, length: 1 });
    }
    text += ch;
  };

  const blockBoundary = () => {
    if (text) pendingBreak = true;
  };

  const visitText = (node: Text) => {
    const data = node.data;
    for (let i = 0; i < data.length; i++) {
      const ch = data[i]!;
      if (WS.test(ch)) {
        if (text && !pendingBreak) pendingSpace ??= { node, offset: i };
        continue;
      }
      if (pendingBreak) {
        text += '\n';
        pendingBreak = false;
        pendingSpace = null;
      } else if (pendingSpace) {
        append(' ', pendingSpace.node, pendingSpace.offset);
        pendingSpace = null;
      }
      append(ch, node, i);
    }
  };

  const visit = (el: Element) => {
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (isTextVisible(el)) visitText(child as Text);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const c = child as Element;
      if (c.tagName === 'BR') {
        blockBoundary();
        continue;
      }
      if (isNeverRead(c) || !isDisplayed(c) || (options.skipBoilerplate && isBoilerplate(c))) continue;
      const block = isBlock(c);
      if (block) blockBoundary();
      visit(c);
      if (block) blockBoundary();
    }
  };

  visit(root);
  return { text, segments };
}
