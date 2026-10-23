/**
 * Draws the sentence and word highlights with the CSS Custom Highlight API
 * (decision D11, design §6). Adds no nodes and changes no attributes: the
 * styles go in through document.adoptedStyleSheets.
 */

export const SENTENCE_HIGHLIGHT = 'lumen-sentence';
export const WORD_HIGHLIGHT = 'lumen-word';

/** The parts of the Highlight API we use, injectable for unit tests. */
export interface HighlightApi {
  registry: { set(name: string, highlight: unknown): void; delete(name: string): boolean };
  create(): { add(range: Range): unknown; clear(): void };
}

// Lumen Reader's own "lamplight" palette: warm amber on light pages, a softer glow on dark ones.
const STYLES = `
::highlight(${SENTENCE_HIGHLIGHT}) { background-color: rgba(255, 196, 77, 0.28); }
::highlight(${WORD_HIGHLIGHT}) { background-color: rgba(240, 150, 20, 0.6); color: inherit; }
@media (prefers-color-scheme: dark) {
  ::highlight(${SENTENCE_HIGHLIGHT}) { background-color: rgba(255, 210, 120, 0.2); }
  ::highlight(${WORD_HIGHLIGHT}) { background-color: rgba(255, 186, 73, 0.5); }
}
`;

const sheets = new WeakMap<Document, CSSStyleSheet>();

function defaultApi(): HighlightApi {
  return {
    registry: CSS.highlights,
    create: () => new Highlight(),
  };
}

export class HighlightRenderer {
  private sentence: ReturnType<HighlightApi['create']>;
  private word: ReturnType<HighlightApi['create']>;

  constructor(
    private doc: Document,
    private api: HighlightApi = defaultApi(),
  ) {
    this.sentence = api.create();
    this.word = api.create();
    api.registry.set(SENTENCE_HIGHLIGHT, this.sentence);
    api.registry.set(WORD_HIGHLIGHT, this.word);
    this.installStyles();
  }

  /** Shows these ranges; null clears that highlight. */
  show(sentence: Range | null, word: Range | null): void {
    this.showSentence(sentence);
    this.showWord(word);
  }

  showSentence(range: Range | null): void {
    this.sentence.clear();
    if (range) this.sentence.add(range);
  }

  showWord(range: Range | null): void {
    this.word.clear();
    if (range) this.word.add(range);
  }

  clear(): void {
    this.sentence.clear();
    this.word.clear();
  }

  private installStyles(): void {
    let sheet = sheets.get(this.doc);
    if (!sheet) {
      const View = this.doc.defaultView?.CSSStyleSheet ?? CSSStyleSheet;
      sheet = new View();
      sheet.replaceSync(STYLES);
      sheets.set(this.doc, sheet);
    }
    if (!this.doc.adoptedStyleSheets.includes(sheet)) {
      this.doc.adoptedStyleSheets = [...this.doc.adoptedStyleSheets, sheet];
    }
  }
}
