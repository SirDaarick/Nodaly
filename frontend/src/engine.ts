import type { DocumentRow, DocumentSection, StoredDocument } from './documents';

export type ExpenseRecord = {
  id: string;
  date: string;
  concept: string;
  category: string;
  amount: string;
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

export function queryExpenseRecords(
  records: ExpenseRecord[],
  cfg: Record<string, unknown>,
  previous: unknown,
): ExpenseRecord[] {
  const prev = previous && typeof previous === 'object' ? (previous as Record<string, unknown>) : {};
  const cfgPeriod = String(cfg.period ?? 'all');
  const period = cfgPeriod !== 'all' ? cfgPeriod : String(prev.period ?? 'all');
  const category = String(cfg.category ?? '') || String(prev.category ?? '');

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

  return records.filter(
    (r) =>
      (!startIso || (r.date >= startIso && r.date <= todayIso)) &&
      (!category || r.category.toLowerCase() === category.toLowerCase()),
  );
}

export function buildExpenseReport(rows: ExpenseRecord[], cfg: Record<string, unknown>) {
  const groupTotals = new Map<string, { category: string; cents: number; count: number }>();
  let totalCents = 0;

  for (const row of rows) {
    const cents = Math.round(Number(row.amount) * 100);
    totalCents += cents;
    const group = groupTotals.get(row.category) ?? { category: row.category, cents: 0, count: 0 };
    group.cents += cents;
    group.count += 1;
    groupTotals.set(row.category, group);
  }

  const groupBy = String(cfg.group_by ?? 'category');
  return {
    title: String(cfg.title ?? 'Informe de gastos'),
    total: (totalCents / 100).toFixed(2),
    count: rows.length,
    groups:
      groupBy === 'category'
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
    'TACOS:',
    'Taco al pastor - $25 MXN (carne al pastor con piña, cilantro y cebolla)',
    'Taco de bistec - $28 MXN (bistec asado a la plancha)',
    'Taco vegetariano - $24 MXN (nopales, champiñones y queso panela)',
    'COMBOS:',
    'Combo Godín (3 tacos al pastor + agua de horchata) - $90 MXN',
    'BEBIDAS:',
    'Agua de horchata 500ml - $25 MXN',
    'Refresco 355ml - $22 MXN',
    'POSTRES:',
    'Flan napolitano - $45 MXN',
  ].join('\n');

  const inventoryRows: DocumentRow[] = [
    { Producto: 'Taco al pastor', Categoría: 'Tacos', Precio: '$25', Stock: '42', Estado: 'Disponible' },
    { Producto: 'Taco de bistec', Categoría: 'Tacos', Precio: '$28', Stock: '18', Estado: 'Disponible' },
    { Producto: 'Taco vegetariano', Categoría: 'Tacos', Precio: '$24', Stock: '4', Estado: 'Bajo stock' },
    { Producto: 'Agua de horchata 500ml', Categoría: 'Bebidas', Precio: '$25', Stock: '12', Estado: 'Disponible' },
    { Producto: 'Refresco 355ml', Categoría: 'Bebidas', Precio: '$22', Stock: '0', Estado: 'Agotado' },
    { Producto: 'Flan napolitano', Categoría: 'Postres', Precio: '$45', Stock: '6', Estado: 'Disponible' },
  ];

  const sandraRows: DocumentRow[] = [
    { Paquete: 'Mesa clásica (30 invitados)', Categoría: 'Mesas', Precio: '$1800 MXN', Incluye: 'Mantel, 15 bases y letrero' },
    { Paquete: 'Mesa premium (60 invitados)', Categoría: 'Mesas', Precio: '$3200 MXN', Incluye: 'Decoración temática y 30 bases' },
    { Paquete: 'Set de 5 exhibidores acrílicos', Categoría: 'Renta', Precio: '$450 MXN', Incluye: 'Alquiler por evento (24h)' },
    { Paquete: 'Bolsa de dulces personalizada', Categoría: 'Extras', Precio: '$35 MXN', Incluye: 'Etiqueta con nombre del evento' },
    { Paquete: 'Envío y montaje CDMX', Categoría: 'Logística', Precio: '$250 MXN', Incluye: 'Traslado e instalación en sitio' },
  ];

  const soporteText = [
    'GUÍA DE SOPORTE - PLATAFORMA DE CAPACITACIÓN',
    'Inscripciones: Entra a Mis Cursos > Catálogo y haz clic en Inscribirme.',
    'Constancias: Se descargan en PDF desde Mi Progreso al completar el 100% del curso.',
    'Recuperar contraseña: Haz clic en ¿Olvidaste tu contraseña? en la pantalla de inicio de sesión.',
    'Incidencia de pago o acceso empresarial: Clasificar como Soporte Técnico y escalar con correo y número de matrícula.',
    'Horario de atención humana: Lunes a Viernes de 9:00 AM a 6:00 PM.',
  ].join('\n');

  const evogymRows: DocumentRow[] = [
    { Hora: '07:15', Concepto: 'Suscripción Mensual Plan Black', Tipo: 'Ingreso', Categoría: 'Suscripción', Cliente: 'Carlos Méndez', MétodoPago: 'Tarjeta', Monto: '$899' },
    { Hora: '08:30', Concepto: 'Inscripción + Mensualidad Básica', Tipo: 'Ingreso', Categoría: 'Suscripción', Cliente: 'Ana López', MétodoPago: 'Transferencia', Monto: '$1150' },
    { Hora: '10:05', Concepto: 'Pase Diario Visitante', Tipo: 'Ingreso', Categoría: 'Pase Diario', Cliente: 'Luis Torres', MétodoPago: 'Efectivo', Monto: '$120' },
    { Hora: '11:40', Concepto: 'Proteína Whey + Agua', Tipo: 'Ingreso', Categoría: 'Tienda', Cliente: 'Mostrador', MétodoPago: 'Efectivo', Monto: '$185' },
    { Hora: '13:20', Concepto: 'Suscripción Mensual Plan Básico', Tipo: 'Ingreso', Categoría: 'Suscripción', Cliente: 'Sofía Ramírez', MétodoPago: 'Tarjeta', Monto: '$599' },
    { Hora: '14:10', Concepto: 'Reposición toallas y limpieza', Tipo: 'Egreso', Categoría: 'Operación', Cliente: 'Proveedor Limpieza', MétodoPago: 'Efectivo', Monto: '$420' },
    { Hora: '16:00', Concepto: 'Mantenimiento caminadora #3', Tipo: 'Egreso', Categoría: 'Mantenimiento', Cliente: 'Técnico GymFix', MétodoPago: 'Transferencia', Monto: '$650' },
  ];

  return [
    {
      id: 'sample-menu-pdf',
      name: 'Menu_Restaurante.pdf',
      kind: 'pdf',
      text_length: menuText.length,
      sections: [{ label: 'Menu_Restaurante.pdf, pág. 1', page: 1, text: menuText }],
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
      id: 'sample-soporte-pdf',
      name: 'Guia_Soporte_Cursos.pdf',
      kind: 'pdf',
      text_length: soporteText.length,
      sections: [{ label: 'Guia_Soporte_Cursos.pdf, pág. 1', page: 1, text: soporteText }],
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
  ];
}
