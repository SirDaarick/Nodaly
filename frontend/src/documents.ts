import * as XLSX from 'xlsx';

export type DocumentRow = Record<string, string>;

export type DocumentSection = {
  label: string;
  page?: number;
  sheet?: string;
  text: string;
  rows?: DocumentRow[];
};

export type StoredDocument = {
  id: string;
  name: string;
  kind: 'pdf' | 'excel' | 'text';
  text_length: number;
  sections: DocumentSection[];
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 50000;

/**
 * Parse an Excel or CSV buffer into structured sections and readable text lines.
 */
export function parseSpreadsheetBuffer(buffer: ArrayBuffer, name: string): StoredDocument {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sections: DocumentSection[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    if (!rawRows.length) continue;

    const rows: DocumentRow[] = rawRows
      .map((row) => {
        const clean: DocumentRow = {};
        for (const [key, value] of Object.entries(row)) {
          const cleanKey = String(key).trim();
          const cleanVal = String(value ?? '').trim();
          if (cleanKey && cleanVal !== '') clean[cleanKey] = cleanVal;
        }
        return clean;
      })
      .filter((row) => Object.keys(row).length > 0);

    if (!rows.length) continue;
    const text = rows
      .map((row) => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(' | '))
      .join('\n');

    sections.push({
      label: `${name} (${sheetName})`,
      sheet: sheetName,
      text,
      rows,
    });
  }

  if (!sections.length) {
    throw new Error('La hoja de cálculo está vacía o no contiene filas legibles.');
  }

  const textLength = sections.reduce((sum, s) => sum + s.text.length, 0);
  if (textLength > MAX_TEXT_CHARS) {
    throw new Error(`El documento supera el límite de ${MAX_TEXT_CHARS.toLocaleString()} caracteres.`);
  }

  return {
    id: crypto.randomUUID(),
    name,
    kind: 'excel',
    text_length: textLength,
    sections,
  };
}

/**
 * Parse a PDF buffer in the browser using pdfjs-dist, preserving line breaks.
 */
export async function parsePdfBuffer(buffer: ArrayBuffer, name: string): Promise<StoredDocument> {
  const pdfjs = await import('pdfjs-dist');
  const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;

  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await task.promise;
  const sections: DocumentSection[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let currentLine: string[] = [];
    let lastY: number | null = null;

    for (const item of content.items) {
      if (!('str' in item)) continue;
      const textItem = item as { str: string; transform?: number[] };
      const y = textItem.transform?.[5] ?? null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 4 && currentLine.length) {
        lines.push(currentLine.join(' ').replace(/\s+/g, ' ').trim());
        currentLine = [];
      }
      if (textItem.str.trim()) currentLine.push(textItem.str.trim());
      if (y !== null) lastY = y;
    }
    if (currentLine.length) {
      lines.push(currentLine.join(' ').replace(/\s+/g, ' ').trim());
    }

    const pageText = lines.filter(Boolean).join('\n');
    if (pageText.trim()) {
      sections.push({
        label: `${name}, pág. ${pageNumber}`,
        page: pageNumber,
        text: pageText,
      });
    }
  }

  if (!sections.length) {
    throw new Error('El PDF no contiene texto extraíble; no se admiten PDFs escaneados como imagen.');
  }

  const textLength = sections.reduce((sum, s) => sum + s.text.length, 0);
  if (textLength > MAX_TEXT_CHARS) {
    throw new Error(`El documento supera el límite de ${MAX_TEXT_CHARS.toLocaleString()} caracteres.`);
  }

  return {
    id: crypto.randomUUID(),
    name,
    kind: 'pdf',
    text_length: textLength,
    sections,
  };
}

/**
 * Parse a user-selected File (PDF, Excel, CSV, or TXT) in the browser.
 */
export async function parseDocumentFile(file: File): Promise<StoredDocument> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('El archivo supera los 5 MB permitidos.');
  }

  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
    return parseSpreadsheetBuffer(await file.arrayBuffer(), file.name);
  }
  if (lower.endsWith('.pdf')) {
    return parsePdfBuffer(await file.arrayBuffer(), file.name);
  }
  if (lower.endsWith('.txt')) {
    const text = (await file.text()).trim();
    if (!text) throw new Error('El archivo de texto está vacío.');
    if (text.length > MAX_TEXT_CHARS) {
      throw new Error(`El documento supera el límite de ${MAX_TEXT_CHARS.toLocaleString()} caracteres.`);
    }
    return {
      id: crypto.randomUUID(),
      name: file.name,
      kind: 'text',
      text_length: text.length,
      sections: [{ label: file.name, text }],
    };
  }

  throw new Error('Formato no compatible. Usa archivos PDF, Excel (.xlsx, .xls), CSV o TXT.');
}
