declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseOptions {
    max?: number;
    version?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pagerender?: (pageData: any) => Promise<string>;
  }
  interface PdfParseResult {
    numpages: number;
    text: string;
    info: unknown;
  }
  function pdfParse(data: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;
  export default pdfParse;
}
