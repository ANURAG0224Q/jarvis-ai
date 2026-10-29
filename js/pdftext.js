// Extract text from a PDF in the browser (only needed for non-Gemini providers; Gemini reads PDFs natively).
const V = '6.4.299';
let lib = null;
export async function pdfToText(blob, maxPages = 200) {
  if (!lib) {
    lib = await import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${V}/build/pdf.min.mjs`);
    lib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${V}/build/pdf.worker.min.mjs`;
  }
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out.push(`[Page ${i}]\n` + tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
  }
  return out.join('\n\n');
}
