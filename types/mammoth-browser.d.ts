declare module "mammoth/mammoth.browser" {
  interface MammothOptions {
    styleMap?: string[];
    includeDefaultStyleMap?: boolean;
    convertImage?: (image: unknown) => Promise<unknown> | unknown;
  }

  interface MammothResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  function convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: MammothOptions
  ): Promise<MammothResult>;

  export default { convertToHtml };
}
