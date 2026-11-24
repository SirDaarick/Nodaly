import type { DocumentRow, DocumentSection, StoredDocument } from './documents';

export type ExpenseRecord = {
  id: string;
  date: string;
  concept: string;
  category: string;
  amount: string;
  collection?: string;
  data?: Record<string, unknown>;
};

export type KnowledgeSource = {
  docName: string;
  kind: 'pdf' | 'excel' | 'text';
  sections: DocumentSection[];
};

export type SourceCitation = {
  name: string;
  page?: number;
  sheet?: string;
};

const STOPWORDS = new Set([
  'que', 'qué', 'cual', 'cuál', 'cuales', 'cuáles', 'como', 'cómo', 'donde', 'dónde',
  'cuando', 'cuándo', 'cuanto', 'cuánto', 'cuantos', 'cuántos', 'cuanta', 'cuánta',
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'en', 'y', 'o',
  'a', 'al', 'por', 'para', 'con', 'sin', 'sobre', 'es', 'son', 'hay', 'tiene', 'tienen',
  'tengo', 'quiero', 'dime', 'dame', 'muestra', 'muestrame', 'muéstrame', 'ver', 'saber',
  'me', 'te', 'se', 'nos', 'mi', 'tu', 'su', 'esta', 'está', 'estan', 'están', 'este',
  'esta', 'esto', 'ese', 'esa', 'eso', 'hola', 'buenas', 'buenos', 'dias', 'días',
  'tardes', 'noches', 'porfa', 'favor', 'gracias', 'cuesta', 'cuestan', 'vale', 'valen',
  'precio', 'precios', 'stock', 'disponible', 'disponibles', 'queda', 'quedan',
  'what', 'when', 'where', 'which', 'who', 'the', 'is', 'are', 'a', 'an', 'of', 'to',
  'in', 'and', 'how', 'does', 'do', 'have', 'has', 'much', 'please', 'tell', 'me',
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function tokenize(value: string, dropStopwords = true): string[] {
  const raw = normalizeText(value).match(/[a-z0-9]+/g) ?? [];
  const filtered = dropStopwords ? raw.filter((w) => w.length > 1 && !STOPWORDS.has(w)) : raw;
  return [...new Set(filtered.map(stemToken))];
}

function formatRow(row: DocumentRow): string {
  return Object.entries(row)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}

function findColumn(row: DocumentRow, candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  return keys.find((k) => candidates.some((c) => normalizeText(k).includes(c)));
}

function parseNumeric(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function isGreeting(message: string): boolean {
  const norm = normalizeText(message).trim();
  return /^(hola|hey|hi|hello|buenos dias|buenas tardes|buenas noches|que tal|ayuda|help)[!.?,\s]*$/.test(norm);
}

/**
 * Answer a user message using connected knowledge sources (PDF, Excel/CSV, pasted text).
 */
export function answerFromSources(
  message: string,
  sources: KnowledgeSource[],
  instructions = '',
): { reply: string; citations: SourceCitation[] } {
  if (!sources.length) {
    return {
      reply: 'No hay fuentes conectadas. Conecta una Base de conocimiento con texto, PDF o Excel al Agente de IA.',
      citations: [],
    };
  }

  const normMsg = normalizeText(message);
  const queryTokens = tokenize(message, true);
  const citations: SourceCitation[] = [];
  const addCitation = (name: string, section: DocumentSection) => {
    const exists = citations.some(
      (c) => c.name === name && c.page === section.page && c.sheet === section.sheet,
    );
    if (!exists) {
      citations.push({
        name,
        ...(section.page ? { page: section.page } : {}),
        ...(section.sheet ? { sheet: section.sheet } : {}),
      });
    }
  };

  if (isGreeting(message)) {
    const names = sources.map((s) => s.docName).join(', ');
    const hint = instructions.trim() ? `\n${instructions.trim()}` : '';
    return {
      reply: `¡Hola! Estoy conectado a: ${names}. Pregúntame sobre platillos, precios o disponibilidad en inventario.${hint}`,
      citations: sources.map((s) => ({ name: s.docName })),
    };
  }

  const wantsOutOfStock = /\b(agotado|agotados|sin stock|falta|faltan|cero|acabaron|acabo)\b/.test(normMsg);
  const wantsLowStock = /\b(bajo stock|poco stock|pocos|por agotarse|minimo)\b/.test(normMsg);
  const wantsInventory = /\b(inventario|existencias|stock|almacen|bodega)\b/.test(normMsg);
  const wantsMenu = /\b(menu|carta|platillos|comida|bebidas|postres|combos|ofrecen)\b/.test(normMsg);

  const matchedRows: { score: number; docName: string; section: DocumentSection; row: DocumentRow }[] = [];
  const allRows: { docName: string; section: DocumentSection; row: DocumentRow }[] = [];

  for (const source of sources) {
    for (const section of source.sections) {
      if (!section.rows?.length) continue;
      for (const row of section.rows) {
        allRows.push({ docName: source.docName, section, row });
        const rowTokens = tokenize(Object.values(row).join(' '), false);
        const overlap = queryTokens.filter((t) =>
          rowTokens.some((rt) => rt === t || rt.includes(t) || t.includes(rt)),
        );
        if (overlap.length > 0) {
          matchedRows.push({ score: overlap.length, docName: source.docName, section, row });
        }
      }
    }
  }

  // Handle inventory-specific queries (out of stock / low stock / full inventory)
  if ((wantsOutOfStock || wantsLowStock) && allRows.length > 0) {
    const filtered = allRows.filter(({ row }) => {
      const stockKey = findColumn(row, ['stock', 'existencia', 'cantidad', 'disponible']);
      const statusKey = findColumn(row, ['estado', 'status']);
      const stockVal = stockKey ? parseNumeric(row[stockKey]) : null;
      const statusVal = statusKey ? normalizeText(row[statusKey]) : '';
      if (wantsOutOfStock) {
        return stockVal === 0 || statusVal.includes('agotado') || statusVal.includes('sin stock');
      }
      return (stockVal !== null && stockVal <= 5) || statusVal.includes('bajo');
    });

    if (filtered.length > 0) {
      filtered.forEach((item) => addCitation(item.docName, item.section));
      const lines = filtered.slice(0, 8).map((item) => `• ${formatRow(item.row)}`);
      const title = wantsOutOfStock ? 'Productos agotados en inventario:' : 'Productos con bajo stock:';
      return { reply: `${title}\n${lines.join('\n')}`, citations };
    }
    return {
      reply: wantsOutOfStock
        ? 'No encontré productos agotados en el inventario cargado.'
        : 'No encontré productos con bajo stock en el inventario cargado.',
      citations: allRows.slice(0, 1).map((r) => ({ name: r.docName, sheet: r.section.sheet })),
    };
  }

  if (wantsInventory && matchedRows.length === 0 && allRows.length > 0) {
    allRows.slice(0, 8).forEach((item) => addCitation(item.docName, item.section));
    const lines = allRows.slice(0, 8).map((item) => `• ${formatRow(item.row)}`);
    const extra = allRows.length > 8 ? `\n(Mostrando 8 de ${allRows.length} registros)` : '';
    return { reply: `Resumen de inventario:\n${lines.join('\n')}${extra}`, citations };
  }

  // Handle financial / gym movement spreadsheets (Tipo: Ingreso/Egreso, Monto, Categoría, MétodoPago)
  const hasMovements = allRows.some(({ row }) => findColumn(row, ['tipo']) && findColumn(row, ['monto', 'importe', 'total']));
  const wantsFinance = /\b(ingreso|ingresos|egreso|egresos|gasto|gastos|corte|neto|ganancia|venta|ventas|suscripcion|suscripciones|mensualidad|mensualidades|efectivo|tarjeta|transferencia|movimiento|movimientos|resumen|total|cuanto)\b/.test(normMsg);
  if (hasMovements && wantsFinance) {
    let totalIn = 0;
    let totalOut = 0;
    const matchedMovements: typeof allRows = [];

    for (const item of allRows) {
      const tipoKey = findColumn(item.row, ['tipo']);
      const montoKey = findColumn(item.row, ['monto', 'importe', 'total']);
      const tipoVal = tipoKey ? normalizeText(item.row[tipoKey]) : '';
      const montoVal = montoKey ? (parseNumeric(item.row[montoKey]) ?? 0) : 0;
      if (tipoVal.includes('ingreso')) totalIn += montoVal;
      else if (tipoVal.includes('egreso') || tipoVal.includes('gasto')) totalOut += montoVal;

      const rowNorm = normalizeText(Object.values(item.row).join(' '));
      if (
        (/\b(suscripcion|suscripciones|mensualidad|mensualidades)\b/.test(normMsg) && rowNorm.includes('suscrip')) ||
        (/\befectivo\b/.test(normMsg) && rowNorm.includes('efectivo')) ||
        (/\btarjeta\b/.test(normMsg) && rowNorm.includes('tarjeta')) ||
        (/\btransferencia\b/.test(normMsg) && rowNorm.includes('transferencia')) ||
        (/\b(egreso|egresos|gasto|gastos)\b/.test(normMsg) && (tipoVal.includes('egreso') || tipoVal.includes('gasto'))) ||
        (/\b(ingreso|ingresos)\b/.test(normMsg) && !/\b(egreso|neto|corte)\b/.test(normMsg) && tipoVal.includes('ingreso'))
      ) {
        matchedMovements.push(item);
      }
    }

    allRows.slice(0, 1).forEach((item) => addCitation(item.docName, item.section));
    if (matchedMovements.length > 0) {
      const subTotal = matchedMovements.reduce((acc, item) => {
        const mk = findColumn(item.row, ['monto', 'importe', 'total']);
        return acc + (mk ? (parseNumeric(item.row[mk]) ?? 0) : 0);
      }, 0);
      const lines = matchedMovements.map((m) => `• ${formatRow(m.row)}`);
      return {
        reply: `Encontré ${matchedMovements.length} movimientos (Total: $${subTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN):\n${lines.join('\n')}`,
        citations,
      };
    }

    const net = totalIn - totalOut;
    return {
      reply: `Resumen de movimientos del día (${allRows.length} registros):\n• Ingresos totales: $${totalIn.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN\n• Egresos totales: $${totalOut.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN\n• Corte neto del día: $${net.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`,
      citations,
    };
  }

  // Search PDF / text lines
  const matchedLines: { score: number; docName: string; section: DocumentSection; line: string }[] = [];
  for (const source of sources) {
    for (const section of source.sections) {
      if (section.rows?.length) continue; // handled above as structured rows
      const lines = section.text
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);

      for (const line of lines) {
        const lineTokens = tokenize(line, false);
        const overlap = queryTokens.filter((t) =>
          lineTokens.some((lt) => lt === t || lt.includes(t) || t.includes(rtFallback(lt, t))),
        );
        if (overlap.length > 0) {
          matchedLines.push({ score: overlap.length, docName: source.docName, section, line });
        }
      }
    }
  }

  if (wantsMenu && matchedLines.length === 0) {
    const textSections = sources.flatMap((s) =>
      s.sections.filter((sec) => !sec.rows?.length).map((sec) => ({ docName: s.docName, sec })),
    );
    if (textSections.length > 0) {
      textSections.slice(0, 2).forEach((item) => addCitation(item.docName, item.sec));
      const preview = textSections[0].sec.text.split(/\n+/).slice(0, 10).join('\n');
      return { reply: `Esto es lo que encontré en el menú:\n${preview}`, citations };
    }
  }

  matchedRows.sort((a, b) => b.score - a.score);
  matchedLines.sort((a, b) => b.score - a.score);

  const parts: string[] = [];

  if (matchedLines.length > 0) {
    const topScore = matchedLines[0].score;
    const bestLines = matchedLines
      .filter((item) => item.score >= Math.max(1, topScore - 1))
      .slice(0, 4);
    bestLines.forEach((item) => addCitation(item.docName, item.section));
    parts.push(
      bestLines.length === 1
        ? bestLines[0].line
        : `Del documento:\n${bestLines.map((l) => `• ${l.line}`).join('\n')}`,
    );
  }

  if (matchedRows.length > 0) {
    const topScore = matchedRows[0].score;
    const bestRows = matchedRows
      .filter((item) => item.score >= Math.max(1, topScore - 1))
      .slice(0, 5);
    bestRows.forEach((item) => addCitation(item.docName, item.section));
    parts.push(
      bestRows.length === 1
        ? `En inventario: ${formatRow(bestRows[0].row)}`
        : `En inventario:\n${bestRows.map((r) => `• ${formatRow(r.row)}`).join('\n')}`,
    );
  }

  if (parts.length > 0) {
    return { reply: parts.join('\n\n'), citations };
  }

  return {
    reply: 'No encontré esa información exacta en los documentos conectados. Prueba preguntar por un platillo, precio o producto del inventario.',
    citations: [],
  };
}

function rtFallback(a: string, b: string): string {
  return a.length > b.length ? a : b;
}

/**
 * Extract an expense object from a natural-language Spanish/English message.
 */
export function extractExpense(message: string): Omit<ExpenseRecord, 'id'> {
  const dateMatch = message.match(/\b\d{4}-\d{2}-\d{2}\b/);
  const day = dateMatch ? dateMatch[0] : new Date().toISOString().slice(0, 10);
  if (Number.isNaN(Date.parse(day))) {
    throw new Error('La fecha del gasto debe ser una fecha ISO válida');
  }

  const remainder = dateMatch ? message.replace(day, '') : message;
  const numbers = [...remainder.matchAll(/(?<![\w.])-?\d+(?:[.,]\d+)?(?![\w.])/g)];
  if (!numbers.length) {
    throw new Error('Falta el importe del gasto (ejemplo: "Hoy gasté 150 en insumos").');
  }

  let amountMatch = numbers[0];
  if (numbers.length > 1) {
    const marked = numbers.filter((m) => {
      const idx = m.index ?? 0;
      const before = remainder.slice(0, idx);
      const after = remainder.slice(idx + m[0].length);
      return /(?:\$|\b(?:mxn|usd))\s*$/i.test(before) || /^\s*(?:pesos?|dollars?|mxn|usd)\b/i.test(after);
    });
    if (marked.length !== 1) {
      throw new Error('El importe del gasto es ambiguo; especifica una moneda como $ o MXN.');
    }
    amountMatch = marked[0];
  }

  if (/[.,]\d{3,}$/.test(amountMatch[0])) {
    throw new Error('El importe del gasto debe tener como máximo dos decimales.');
  }

  const value = Number(amountMatch[0].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) {
    throw new Error('El importe del gasto debe ser positivo y no superar 1000000000.');
  }

  const idx = amountMatch.index ?? 0;
  const concept = (remainder.slice(0, idx) + ' ' + remainder.slice(idx + amountMatch[0].length))
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:$()]+|[\s.,;:$()]+$/g, '');

  const ignore = new Set([
    'today', 'i', 'spent', 'on', 'for', 'dollars', 'dollar', 'hoy', 'gaste', 'gasté',
    'en', 'pesos', 'peso', 'the', 'a', 'de', 'un', 'una', 'mxn', 'usd',
  ]);
  const meaningful = (normalizeText(concept).match(/[a-z]+/g) ?? []).filter((w) => !ignore.has(w));
  if (!meaningful.length) {
    throw new Error('Falta el concepto del gasto.');
  }

  const low = normalizeText(concept);
  let category = 'other';
  const categoryMap: [string, string[]][] = [
    ['food', ['food', 'lunch', 'dinner', 'comida', 'almuerzo', 'cena', 'restaurante', 'desayuno']],
    ['transport', ['transport', 'taxi', 'gasolina', 'transporte', 'uber', 'camion']],
    ['supplies', ['supplies', 'notebook', 'limpieza', 'papeleria', 'material', 'insumo', 'insumos']],
    ['utilities', ['utilities', 'electricity', 'agua', 'luz', 'internet', 'telefono']],
  ];
  for (const [cat, words] of categoryMap) {
    if (words.some((w) => low.includes(w))) {
      category = cat;
      break;
    }
  }

  return {
    date: day,
    concept: concept.slice(0, 200),
    category,
    amount: value.toFixed(2),
  };
}

/**
 * Extract period and category filters from a user query message.
 */
export function extractFilters(message: string): { period: string; category: string } {
  const low = normalizeText(message);
  let period = 'all';
  const periods: [string, string[]][] = [
    ['today', ['today', 'hoy']],
    ['week', ['week', 'semana']],
    ['month', ['month', 'mes']],
  ];
  for (const [p, words] of periods) {
    if (words.some((w) => new RegExp(`\\b${w}\\b`).test(low))) {
      period = p;
      break;
    }
  }

  const categories: [string, string[]][] = [
    ['food', ['food', 'alimentacion', 'comida', 'almuerzo']],
    ['transport', ['transport', 'transporte', 'taxi']],
    ['supplies', ['supplies', 'insumos', 'papeleria']],
    ['utilities', ['utilities', 'servicios', 'luz', 'agua']],
    ['other', ['other', 'otros']],
  ];
  const category =
    categories.find(([, words]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(low)))?.[0] ?? '';

  return { period, category };
}

export function parseFieldsSpec(raw: unknown): string[] {
  const items = Array.isArray(raw)
    ? raw.map((x) => String(x).trim()).filter(Boolean)
    : typeof raw === 'string'
      ? raw.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const k = item.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

export function isCutRequest(message: string): boolean {
  const norm = normalizeText(message);
  const hasCutVerb = /\b(corte|reporte|informe|resumen|acumulado|exporta|exportar|descargar|muestra|mostrar|listar|lista|cuanto llevamos|cuanto hemos gastado|total de gastos|todos los gastos|todos los registros)\b/.test(norm);
  const hasRegisterVerb = /\b(gaste|pague|compre|registrar|registra)\b|cliente\s*:/.test(norm);
  return hasCutVerb && !hasRegisterVerb;
}

export function extractQuoteFromConversation(
  message: string,
  history: { role: string; content: string }[] = [],
  replyText: string,
  fieldNames: string[] = ['cliente', 'paquetes', 'total', 'anticipo'],
): Record<string, string> | null {
  const userTurns = [
    ...history.filter((h) => h.role === 'user').map((h) => h.content),
    message,
  ].join('\n');

  const nameMatch =
    userTurns.match(/\b(?:soy|me llamo|mi nombre es|a nombre de|cliente\s*:?)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+)?)/i);
  const customerName = nameMatch?.[1]?.trim() ?? '';
  if (!customerName) return null;

  const normMsg = normalizeText(userTurns);
  const hasPackageIntent = /\b(mesa|paquete|cotiz|arco|fuente|exhibidor|bolsa|envio|servicio|plan)\b/.test(normMsg);
  if (!hasPackageIntent) return null;

  // Extract dollar/MXN amounts from replyText or userTurns.
  const priceMatches = [...replyText.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g)]
    .map((m) => Number(m[1].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  const totalNum = priceMatches.length ? Math.max(...priceMatches) : 0;
  const totalStr = totalNum > 0 ? totalNum.toFixed(2) : '0.00';
  const anticipoStr = totalNum > 0 ? (totalNum / 2).toFixed(2) : '0.00';

  const cleanPackages = message
    .replace(/\b(?:soy|me llamo|mi nombre es|a nombre de)\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+)?[,.\s]*/gi, '')
    .replace(/\b(?:cotizame|cotízame|quiero|necesito|por favor)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || message.trim();

  const out: Record<string, string> = {};
  for (const f of fieldNames) {
    const low = f.toLowerCase();
    if (low === 'cliente' || low === 'nombre') out[f] = customerName;
    else if (low.includes('paquete') || low.includes('concepto') || low.includes('servicio') || low.includes('detalle')) out[f] = cleanPackages.slice(0, 200);
    else if (low === 'total' || low === 'monto' || low === 'importe' || low === 'amount') out[f] = totalStr;
    else if (low.includes('anticipo')) out[f] = anticipoStr;
    else if (low === 'fecha' || low === 'date') out[f] = new Date().toISOString().slice(0, 10);
    else out[f] = cleanPackages.slice(0, 120);
  }
  if (!('date' in out)) out.date = new Date().toISOString().slice(0, 10);
  return out;
}

export function formatRecordSummaryLine(r: ExpenseRecord): string {
  if (r.data && Object.keys(r.data).length > 0) {
    const col = r.collection || 'registro';
    const parts = Object.entries(r.data)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([k, v]) => `${k}: ${String(v)}`);
    return `[${col}] ${parts.join(' | ')}`;
  }
  return `Fecha: ${r.date} | Concepto: ${r.concept} | Categoría: ${r.category} | Importe: $${r.amount}`;
}

export function extractCustomRecord(message: string, fieldNames: string[]): Record<string, string> {
  const text = (message || '').trim();
  if (!text) throw new Error('El mensaje está vacío para extraer datos.');
  const dateMatch = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  const day = dateMatch ? dateMatch[0] : new Date().toISOString().slice(0, 10);

  const kvMap = new Map<string, string>();
  for (const match of text.matchAll(/([\wáéíóúÁÉÍÓÚñÑ\s]{1,40}?)\s*[:=]\s*([^,;\n]+)/g)) {
    const k = match[1].trim().toLowerCase();
    const v = match[2].trim();
    if (k && v) kvMap.set(k, v);
  }
  const parts = text.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
  const nums = [...text.matchAll(/(?<![\w.])\d+(?:[.,]\d{1,2})?(?![\w.])/g)].map((m) => m[0]);
  let usedPos = 0;

  const result: Record<string, string> = {};
  for (const fname of fieldNames) {
    const low = fname.toLowerCase();
    if (kvMap.has(low)) {
      result[fname] = kvMap.get(low)!;
    } else if (low === 'fecha' || low === 'date') {
      result[fname] = day;
    } else if (/(monto|importe|precio|total|cantidad|valor|amount|cost|costo)/.test(low) && nums.length > 0) {
      result[fname] = nums[0].replace(',', '.');
    } else if (parts.length >= fieldNames.length && usedPos < parts.length) {
      result[fname] = parts[usedPos].replace(/^[\wáéíóúÁÉÍÓÚñÑ\s]{1,30}\s*[:=]\s*/, '').trim();
      usedPos += 1;
    } else if (usedPos === 0) {
      result[fname] = text.slice(0, 300);
      usedPos += 1;
    } else {
      result[fname] = '';
    }
  }
  if (!('date' in result) && !fieldNames.some((f) => f.toLowerCase() === 'fecha')) {
    result.date = day;
  }
  const hasContent = Object.entries(result).some(([k, v]) => k !== 'date' && k.toLowerCase() !== 'fecha' && v.trim() !== '');
  if (!hasContent) throw new Error('No se encontraron datos válidos para registrar en el mensaje.');
  return result;
}

export function queryExpenseRecords(
  records: ExpenseRecord[],
  cfg: Record<string, unknown>,
  previous: unknown,
): ExpenseRecord[] {
  const prev = previous && typeof previous === 'object' ? (previous as Record<string, unknown>) : {};
  const cfgPeriod = String(cfg.period ?? 'all');
  const period = cfgPeriod !== 'all' ? cfgPeriod : String(prev.period ?? 'all');
  const category = String(cfg.category ?? '') || String(prev.category ?? '');
  const collection = String(cfg.collection ?? 'expenses').trim() || 'expenses';

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  let startIso: string | null = null;
  if (period === 'today') {
    startIso = todayIso;
  } else if (period === 'week') {
    const dayOfWeek = (now.getDay() + 6) % 7;
    const start = new Date(now);
    start.setDate(now.getDate() - dayOfWeek);
    startIso = start.toISOString().slice(0, 10);
  } else if (period === 'month') {
    startIso = `${todayIso.slice(0, 8)}01`;
  }

  const catLow = category.trim().toLowerCase();
  return records.filter((r) => {
    const rCol = (r.collection || 'expenses').toLowerCase();
    if (collection !== 'all' && rCol !== collection.toLowerCase()) return false;
    if (startIso && !(r.date >= startIso && r.date <= todayIso)) return false;
    if (catLow) {
      const directMatch = r.category.toLowerCase() === catLow;
      const anyMatch =
        r.concept.toLowerCase().includes(catLow) ||
        (r.data ? Object.values(r.data).some((v) => String(v ?? '').toLowerCase().includes(catLow)) : false);
      if (!directMatch && !anyMatch) return false;
    }
    return true;
  });
}

export function buildExpenseReport(rows: ExpenseRecord[], cfg: Record<string, unknown>) {
  const amountField = String(cfg.amount_field ?? 'amount').trim() || 'amount';
  const groupBy = String(cfg.group_by ?? 'category').trim() || 'category';
  const groupTotals = new Map<string, { category: string; cents: number; count: number }>();
  let totalCents = 0;

  for (const row of rows) {
    const rawVal = row.data && amountField in row.data ? row.data[amountField] : (row as Record<string, unknown>)[amountField] ?? row.amount;
    const parsedNum = Number(String(rawVal ?? '0').replace(/[^\d.,-]/g, '').replace(/,/g, ''));
    const cents = Number.isFinite(parsedNum) ? Math.round(parsedNum * 100) : 0;
    totalCents += cents;

    const rawGroup =
      groupBy === 'none'
        ? 'General'
        : row.data && groupBy in row.data
          ? String(row.data[groupBy] ?? row.category ?? 'General')
          : String((row as Record<string, unknown>)[groupBy] ?? row.category ?? 'General');
    const groupKey = rawGroup || 'General';
    const group = groupTotals.get(groupKey) ?? { category: groupKey, cents: 0, count: 0 };
    group.cents += cents;
    group.count += 1;
    groupTotals.set(groupKey, group);
  }

  return {
    title: String(cfg.title ?? 'Informe de gastos'),
    total: (totalCents / 100).toFixed(2),
    count: rows.length,
    groups:
      groupBy !== 'none'
        ? [...groupTotals.values()].map(({ category, count, cents }) => ({
            category,
            count,
            total: (cents / 100).toFixed(2),
          }))
        : [],
  };
}

/**
 * Default sample documents preloaded in browser showcase mode (Menu PDF + Inventory Excel).
 */
export function createSampleDocuments(): StoredDocument[] {
  const menuText = [
    'MENÚ - TAQUERÍA LA ESQUINA',
    'Horario de atención: Lunes a Domingo de 1:00 PM a 11:00 PM.',
    'Sucursal Centro: Av. Reforma 240, CDMX. Teléfono de pedidos: 55-1020-3040.',
    'TACOS:',
    'Taco al pastor - $25 MXN (carne al pastor con piña, cilantro y cebolla)',
    'Taco de bistec - $28 MXN (bistec asado a la plancha con cebolla caramelizada)',
    'Taco vegetariano - $24 MXN (nopales, champiñones y queso panela asado)',
    'ESPECIALIDADES:',
    'Queso fundido con chorizo - $85 MXN (incluye 4 tortillas de harina o maíz)',
    'Guacamole con totopos - $75 MXN (preparado al momento con pico de gallo)',
    'COMBOS:',
    'Combo Godín (3 tacos al pastor + agua de horchata) - $90 MXN',
    'BEBIDAS:',
    'Agua de horchata 500ml - $25 MXN',
    'Refresco 355ml - $22 MXN',
    'POSTRES:',
    'Flan napolitano - $45 MXN',
  ].join('\n');

  const menuPage2 = [
    'POLÍTICAS DE SERVICIO Y ENVÍOS - TAQUERÍA LA ESQUINA',
    'Envío a domicilio: Gratis en pedidos mayores a $250 MXN dentro de 4 km; costo estándar de $35 MXN.',
    'Tiempo estimado de entrega: 25 a 35 minutos en horario normal.',
    'Alérgenos: El flan napolitano contiene lácteos y huevo; las tortillas de maíz son 100% libres de gluten.',
    'Promoción martes y jueves: 2x1 en Tacos al pastor en consumo en sucursal de 2:00 PM a 6:00 PM.',
  ].join('\n');

  const inventoryRows: DocumentRow[] = [
    { SKU: 'TAC-01', Producto: 'Taco al pastor', Categoría: 'Tacos', Precio: '$25', Stock: '42', StockMínimo: '10', Proveedor: 'Carnicería Central', Estado: 'Disponible' },
    { SKU: 'TAC-02', Producto: 'Taco de bistec', Categoría: 'Tacos', Precio: '$28', Stock: '18', StockMínimo: '8', Proveedor: 'Carnicería Central', Estado: 'Disponible' },
    { SKU: 'TAC-03', Producto: 'Taco vegetariano', Categoría: 'Tacos', Precio: '$24', Stock: '4', StockMínimo: '6', Proveedor: 'Huerta Local', Estado: 'Bajo stock' },
    { SKU: 'ESP-01', Producto: 'Queso fundido con chorizo', Categoría: 'Especialidades', Precio: '$85', Stock: '9', StockMínimo: '4', Proveedor: 'Lácteos del Valle', Estado: 'Disponible' },
    { SKU: 'ESP-02', Producto: 'Guacamole con totopos', Categoría: 'Especialidades', Precio: '$75', Stock: '14', StockMínimo: '5', Proveedor: 'Huerta Local', Estado: 'Disponible' },
    { SKU: 'CMB-01', Producto: 'Combo Godín', Categoría: 'Combos', Precio: '$90', Stock: '12', StockMínimo: '5', Proveedor: 'Interno', Estado: 'Disponible' },
    { SKU: 'BEB-01', Producto: 'Agua de horchata 500ml', Categoría: 'Bebidas', Precio: '$25', Stock: '12', StockMínimo: '6', Proveedor: 'Interno', Estado: 'Disponible' },
    { SKU: 'BEB-02', Producto: 'Refresco 355ml', Categoría: 'Bebidas', Precio: '$22', Stock: '0', StockMínimo: '12', Proveedor: 'Embotelladora Norte', Estado: 'Agotado' },
    { SKU: 'POS-01', Producto: 'Flan napolitano', Categoría: 'Postres', Precio: '$45', Stock: '6', StockMínimo: '4', Proveedor: 'Repostería Luz', Estado: 'Disponible' },
  ];

  const sandraRows: DocumentRow[] = [
    { Código: 'MD-CLA', Paquete: 'Mesa clásica (30 invitados)', Categoría: 'Mesas', Precio: '$1800 MXN', Anticipo: '$900 MXN', Incluye: 'Mantel, 15 bases acrílicas, letrero y 6 kg de dulces' },
    { Código: 'MD-PRE', Paquete: 'Mesa premium (60 invitados)', Categoría: 'Mesas', Precio: '$3200 MXN', Anticipo: '$1600 MXN', Incluye: 'Decoración temática, 30 bases, backlight y 12 kg de dulces' },
    { Código: 'MD-IMP', Paquete: 'Mesa imperial (100 invitados)', Categoría: 'Mesas', Precio: '$5200 MXN', Anticipo: '$2600 MXN', Incluye: 'Montaje panorámico, 45 bases, fuente de chocolate y 20 kg de dulces' },
    { Código: 'MD-CHA', Paquete: 'Mesa de charcutería y quesos (40 invitados)', Categoría: 'Salado', Precio: '$3800 MXN', Anticipo: '$1900 MXN', Incluye: 'Tablas de madera, quesos maduros, uvas, frutos secos y pan artesanal' },
    { Código: 'RN-EXH', Paquete: 'Set de 5 exhibidores acrílicos', Categoría: 'Renta', Precio: '$450 MXN', Anticipo: '$225 MXN', Incluye: 'Alquiler por evento (24h)' },
    { Código: 'EX-ARC', Paquete: 'Arco orgánico de globos (3m)', Categoría: 'Extras', Precio: '$950 MXN', Anticipo: '$475 MXN', Incluye: 'Paleta de 3 colores a elegir e instalación en sitio' },
    { Código: 'EX-FUE', Paquete: 'Fuente de chocolate o chamoy', Categoría: 'Extras', Precio: '$1100 MXN', Anticipo: '$550 MXN', Incluye: 'Insumos para 50 personas, brochetas y operador 2h' },
    { Código: 'EX-BOL', Paquete: 'Bolsa de dulces personalizada', Categoría: 'Extras', Precio: '$35 MXN', Anticipo: '$17.50 MXN', Incluye: 'Etiqueta con nombre y fecha del evento (mínimo 15 pzas)' },
    { Código: 'LOG-01', Paquete: 'Envío y montaje CDMX', Categoría: 'Logística', Precio: '$250 MXN', Anticipo: '$250 MXN', Incluye: 'Traslado, instalación y recolección al día siguiente' },
  ];

  const sandraMdSec1 = [
    '# Políticas de Cotización y Descuentos',
    '- **Descuento por volumen:** Si el subtotal de paquetes y extras supera **$4,500 MXN**, aplica un **10% de descuento** automático (no aplica sobre logística/envío).',
    '- **Apartado de fecha:** Se requiere un **anticipo del 50%** para bloquear fecha en agenda; el 50% restante se liquida **48 horas antes** del evento.',
  ].join('\n');
  const sandraMdSec2 = [
    '## Cobertura y Costos de Envío',
    '- **CDMX Centro y Sur:** $250 MXN (incluye montaje y recolección).',
    '- **CDMX Norte, Poniente y Área Metropolitana:** $450 MXN.',
    '- **Horario de montaje:** Llegamos 2 horas antes del inicio del evento.',
  ].join('\n');
  const sandraMdSec3 = [
    '## Personalización y Tiempos de Reserva',
    '- Reservar con mínimo **7 días de anticipación** para diseños personalizados.',
    '- Las mesas Premium e Imperial incluyen diseño gráfico personalizado sin costo adicional.',
  ].join('\n');

  const soporteText1 = [
    'GUÍA DE SOPORTE - PLATAFORMA DE CAPACITACIÓN (PÁG. 1)',
    'Inscripciones: Entra a Mis Cursos > Catálogo, selecciona el programa y haz clic en Inscribirme.',
    'Constancias y Certificados DC-3: Se descargan en PDF con código QR desde Mi Progreso al completar el 100% del curso y aprobar la evaluación final (>= 80%).',
    'Recuperar contraseña: Haz clic en ¿Olvidaste tu contraseña? en el inicio de sesión; el enlace expira en 15 minutos.',
    'Horario de atención humana: Lunes a Viernes de 9:00 AM a 6:00 PM (hora CDMX).',
  ].join('\n');

  const soporteText2 = [
    'FACTURACIÓN, SSO EMPRESARIAL Y REEMBOLSOS (PÁG. 2)',
    'Facturación CFDI 4.0: Solicítala dentro del mismo mes de pago en Cuenta > Facturación adjuntando Constancia de Situación Fiscal.',
    'Acceso Empresarial / SSO: Si tu empresa usa inicio único (Azure AD / Google Workspace) y falla el acceso, clasifica como Incidencia Técnica con correo corporativo y matrícula.',
    'Reembolsos: Aplican dentro de los primeros 7 días naturales siempre que el avance del curso sea menor al 15%.',
  ].join('\n');

  const soporteMdSec1 = [
    '# Matriz de Severidad y SLA de Soporte',
    'Clasifica cada ticket según su impacto antes de responder al estudiante o empresa.',
  ].join('\n');
  const soporteMdSec2 = [
    '## Nivel S1 - Crítico (SLA: < 1 hora)',
    '- Fallo de pago con cargo duplicado, caída de examen final o bloqueo masivo de acceso SSO empresarial.',
    '- Acción: Escalar de inmediato a Ingeniería de Soporte solicitando correo, matrícula y captura del error.',
  ].join('\n');
  const soporteMdSec3 = [
    '## Nivel S2 y S3 - Operativo y Consultas (SLA: 4 h / Inmediato)',
    '- **S2 (4 horas):** Corrección de nombre en constancia DC-3 o refacturación CFDI.',
    '- **S3 (Inmediato):** Dudas de inscripción, descarga de constancia o recuperación de contraseña.',
  ].join('\n');

  const evogymRows: DocumentRow[] = [
    { Folio: 'EG-101', Hora: '07:15', Concepto: 'Suscripción Mensual Plan Black', Tipo: 'Ingreso', Categoría: 'Suscripción', Cliente: 'Carlos Méndez', MétodoPago: 'Tarjeta', Responsable: 'Recepción AM', Monto: '$899' },
    { Folio: 'EG-102', Hora: '08:30', Concepto: 'Inscripción + Mensualidad Básica', Tipo: 'Ingreso', Categoría: 'Suscripción', Cliente: 'Ana López', MétodoPago: 'Transferencia', Responsable: 'Recepción AM', Monto: '$1150' },
    { Folio: 'EG-103', Hora: '09:45', Concepto: 'Paquete 10 Sesiones Coach Personal', Tipo: 'Ingreso', Categoría: 'Entrenamiento', Cliente: 'Jorge Salinas', MétodoPago: 'Tarjeta', Responsable: 'Coach Mario', Monto: '$2400' },
    { Folio: 'EG-104', Hora: '10:05', Concepto: 'Pase Diario Visitante', Tipo: 'Ingreso', Categoría: 'Pase Diario', Cliente: 'Luis Torres', MétodoPago: 'Efectivo', Responsable: 'Recepción AM', Monto: '$120' },
    { Folio: 'EG-105', Hora: '11:40', Concepto: 'Proteína Whey + Agua', Tipo: 'Ingreso', Categoría: 'Tienda', Cliente: 'Mostrador', MétodoPago: 'Efectivo', Responsable: 'Barra', Monto: '$185' },
    { Folio: 'EG-106', Hora: '13:20', Concepto: 'Suscripción Mensual Plan Básico', Tipo: 'Ingreso', Categoría: 'Suscripción', Cliente: 'Sofía Ramírez', MétodoPago: 'Tarjeta', Responsable: 'Recepción PM', Monto: '$599' },
    { Folio: 'EG-107', Hora: '14:10', Concepto: 'Reposición toallas y limpieza', Tipo: 'Egreso', Categoría: 'Operación', Cliente: 'Proveedor Limpieza', MétodoPago: 'Efectivo', Responsable: 'Gerencia', Monto: '$420' },
    { Folio: 'EG-108', Hora: '16:00', Concepto: 'Mantenimiento caminadora #3', Tipo: 'Egreso', Categoría: 'Mantenimiento', Cliente: 'Técnico GymFix', MétodoPago: 'Transferencia', Responsable: 'Gerencia', Monto: '$650' },
    { Folio: 'EG-109', Hora: '17:30', Concepto: 'Compra de garrafones y sanitizante', Tipo: 'Egreso', Categoría: 'Operación', Cliente: 'Distribuidora Sur', MétodoPago: 'Efectivo', Responsable: 'Recepción PM', Monto: '$310' },
    { Folio: 'EG-110', Hora: '19:15', Concepto: 'Renovación Plan Dúo Anual (mensualidad)', Tipo: 'Ingreso', Categoría: 'Suscripción', Cliente: 'Valeria y Diego', MétodoPago: 'Transferencia', Responsable: 'Recepción PM', Monto: '$1450' },
  ];

  const crmMdSec1 = [
    '# Catálogo de Planes y Servicios CRM',
    '- **Consultoría Express ($2,400 MXN):** Diagnóstico de procesos y diseño de 1 flujo automatizado (entrega en 48 h).',
    '- **Plan Anual VIP ($4,200 MXN):** Soporte prioritario 24/7, hasta 10 flujos conectados a Telegram y respaldos semanales.',
    '- **Implementación IA ($18,500 MXN):** Despliegue integral con base de conocimiento empresarial, tablas personalizadas y capacitación de equipo.',
  ].join('\n');
  const crmMdSec2 = [
    '## Reglas de Seguimiento de Clientes',
    '- **Estado Pagado:** Activar servicio el mismo día y enviar bienvenida con accesos.',
    '- **Estado Anticipo 50%:** Programar sesión de arranque (kickoff) dentro de las siguientes 24 horas hábiles.',
    '- **Estado Pendiente:** Enviar recordatorio de pago amable a las 48 horas.',
  ].join('\n');
  const crmMdSec3 = [
    '## Garantías y Soporte',
    '- Todos los planes incluyen 30 días de ajustes sin costo adicional sobre los flujos entregados.',
    '- Los datos capturados en la tabla de clientes pueden consultarse en tiempo real desde cualquier agente de Nodaly.',
  ].join('\n');

  return [
    {
      id: 'sample-menu-pdf',
      name: 'Menu_Restaurante.pdf',
      kind: 'pdf',
      text_length: menuText.length + menuPage2.length,
      sections: [
        { label: 'Menu_Restaurante.pdf, pág. 1', page: 1, text: menuText },
        { label: 'Menu_Restaurante.pdf, pág. 2', page: 2, text: menuPage2 },
      ],
    },
    {
      id: 'sample-inventory-xlsx',
      name: 'Inventario_Cocina.xlsx',
      kind: 'excel',
      text_length: inventoryRows.map(formatRow).join('\n').length,
      sections: [
        {
          label: 'Inventario_Cocina.xlsx (Inventario)',
          sheet: 'Inventario',
          text: inventoryRows.map(formatRow).join('\n'),
          rows: inventoryRows,
        },
      ],
    },
    {
      id: 'sample-sandra-xlsx',
      name: 'Catalogo_Mesas_Sandra.xlsx',
      kind: 'excel',
      text_length: sandraRows.map(formatRow).join('\n').length,
      sections: [
        {
          label: 'Catalogo_Mesas_Sandra.xlsx (Precios)',
          sheet: 'Precios',
          text: sandraRows.map(formatRow).join('\n'),
          rows: sandraRows,
        },
      ],
    },
    {
      id: 'sample-sandra-md',
      name: 'Manual_Operativo_Sandra.md',
      kind: 'text',
      text_length: sandraMdSec1.length + sandraMdSec2.length + sandraMdSec3.length,
      sections: [
        { label: 'Manual_Operativo_Sandra.md (Políticas de Cotización y Descuentos)', text: sandraMdSec1 },
        { label: 'Manual_Operativo_Sandra.md (Cobertura y Costos de Envío)', text: sandraMdSec2 },
        { label: 'Manual_Operativo_Sandra.md (Personalización y Tiempos de Reserva)', text: sandraMdSec3 },
      ],
    },
    {
      id: 'sample-soporte-pdf',
      name: 'Guia_Soporte_Cursos.pdf',
      kind: 'pdf',
      text_length: soporteText1.length + soporteText2.length,
      sections: [
        { label: 'Guia_Soporte_Cursos.pdf, pág. 1', page: 1, text: soporteText1 },
        { label: 'Guia_Soporte_Cursos.pdf, pág. 2', page: 2, text: soporteText2 },
      ],
    },
    {
      id: 'sample-soporte-md',
      name: 'Playbook_SLA_Soporte.md',
      kind: 'text',
      text_length: soporteMdSec1.length + soporteMdSec2.length + soporteMdSec3.length,
      sections: [
        { label: 'Playbook_SLA_Soporte.md (Matriz de Severidad y SLA)', text: soporteMdSec1 },
        { label: 'Playbook_SLA_Soporte.md (Nivel S1 - Crítico)', text: soporteMdSec2 },
        { label: 'Playbook_SLA_Soporte.md (Nivel S2 y S3)', text: soporteMdSec3 },
      ],
    },
    {
      id: 'sample-evogym-xlsx',
      name: 'Movimientos_EvoGym_Dia.xlsx',
      kind: 'excel',
      text_length: evogymRows.map(formatRow).join('\n').length,
      sections: [
        {
          label: 'Movimientos_EvoGym_Dia.xlsx (Movimientos)',
          sheet: 'Movimientos',
          text: evogymRows.map(formatRow).join('\n'),
          rows: evogymRows,
        },
      ],
    },
    {
      id: 'sample-crm-md',
      name: 'Manual_CRM_Servicios.md',
      kind: 'text',
      text_length: crmMdSec1.length + crmMdSec2.length + crmMdSec3.length,
      sections: [
        { label: 'Manual_CRM_Servicios.md (Catálogo de Planes y Servicios CRM)', text: crmMdSec1 },
        { label: 'Manual_CRM_Servicios.md (Reglas de Seguimiento de Clientes)', text: crmMdSec2 },
        { label: 'Manual_CRM_Servicios.md (Garantías y Soporte)', text: crmMdSec3 },
      ],
    },
  ];
}
