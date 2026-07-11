declare module "pdfmake/build/pdfmake.js" {
  const pdfMake: {
    vfs: Record<string, string>;
    fonts?: Record<string, Record<string, string>>;
    createPdf: (
      docDefinition: Record<string, unknown>,
      tableLayouts?: unknown,
      fonts?: Record<string, Record<string, string>>,
      vfs?: Record<string, string>
    ) => {
      getBuffer: (callback: (buffer: Buffer) => void) => void;
    };
  };
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts.js" {
  const pdfFonts: {
    pdfMake?: { vfs: Record<string, string> };
    vfs?: Record<string, string>;
  };
  export default pdfFonts;
}
