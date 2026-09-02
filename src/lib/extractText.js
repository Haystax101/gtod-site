// Turns an uploaded CV / cover letter into plain text in the browser, so the
// file itself never leaves the user's machine. Parsers are loaded on demand.

const MAX_BYTES = 8 * 1024 * 1024

export async function extractText(file) {
  if (file.size > MAX_BYTES) throw new Error('That file is over 8 MB. Try exporting a smaller version.')
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return { kind: 'pdf', text: await fromPdf(file) }
  if (name.endsWith('.docx')) return { kind: 'docx', text: await fromDocx(file) }
  if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) return { kind: 'text', text: await file.text() }
  throw new Error('Please upload a PDF, Word (.docx) or plain text file.')
}

async function fromPdf(file) {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages = []
  for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    let line = ''
    let lastY = null
    for (const item of content.items) {
      if (!('str' in item)) continue
      const y = item.transform?.[5]
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        pages.push(line.trim())
        line = ''
      }
      line += item.str + (item.hasEOL ? '\n' : ' ')
      lastY = y
    }
    pages.push(line.trim())
  }
  return pages.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

async function fromDocx(file) {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return result.value.replace(/\n{3,}/g, '\n\n').trim()
}
