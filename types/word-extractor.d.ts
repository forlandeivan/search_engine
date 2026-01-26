declare module 'word-extractor' {
  interface Document {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(): string;
    getFooters(): string;
    getAnnotations(): string;
  }

  class WordExtractor {
    constructor();
    extract(input: string | Buffer): Promise<Document>;
  }

  export = WordExtractor;
}
