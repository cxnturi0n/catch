// Client-side PDF text extraction using pdf.js. Kept dynamic-import so the
// ~1MB worker + core only ship when a CM actually uploads a CV.

export async function extractPdfText(file: File): Promise<string> {
  try {
    const pdfjs = await import('pdfjs-dist')
    // Vite serves the worker as a URL asset via the ?url suffix.
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

    const buf = await file.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: buf }).promise
    const chunks: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const text = content.items
        .map((it) => ('str' in it ? (it as { str: string }).str : ''))
        .join(' ')
      chunks.push(text)
    }
    return chunks.join('\n\n').trim()
  } catch {
    return ''
  }
}
