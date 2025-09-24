declare module "jspdf" {
  export interface JsPDFOptions {
    unit?: string;
    format?: string | number[];
  }

  export class jsPDF {
    constructor(options?: JsPDFOptions);
    addFileToVFS(fileName: string, data: string): void;
    addFont(postScriptName: string, id: string, style: string): void;
    setFont(fontName?: string, fontStyle?: string): void;
    setFontSize(size: number): void;
    splitTextToSize(text: string, maxSize: number): string[];
    text(text: string | string[], x: number, y: number): void;
    addPage(): void;
    save(filename?: string): void;
    internal: {
      pageSize: {
        getWidth(): number;
        getHeight(): number;
      };
    };
  }
}
