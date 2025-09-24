declare module "pdfjs-dist/legacy/build/pdf" {
  export interface PDFTextItem {
    str?: string;
  }

  export interface PDFTextContent {
    items: PDFTextItem[];
  }

  export interface PDFPageProxy {
    getTextContent(): Promise<PDFTextContent>;
  }

  export interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
  }

  export interface PDFDocumentLoadingTask {
    promise: Promise<PDFDocumentProxy>;
  }

  export const GlobalWorkerOptions: {
    workerSrc: string;
  };

  export function getDocument(options: {
    data: ArrayBuffer | Uint8Array | string;
  }): PDFDocumentLoadingTask;
}
