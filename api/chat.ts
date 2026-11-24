type SourcePayload = {
  name: string;
  page?: number;
  sheet?: string;
  text: string;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatRequestBody = {
  message?: string;
  instructions?: string;
  model?: string;
  mode?: 'answer' | 'extract';
  fields?: string[];
  collection?: string;
  history?: ChatMessage[];
  sources?: SourcePayload[];
};

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'OPENROUTER_API_KEY_MISSING' });
    return;
  }

  const body: ChatRequestBody = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const message = String(body.message ?? '').trim();
  if (!message) {
    res.status(400).json({ error: 'El mensaje está vacío.' });
    return;
  }

  const sources = Array.isArray(body.sources) ? body.sources : [];
  const instructions = String(body.instructions ?? '').trim();
  const model = String(body.model ?? '').trim() || DEFAULT_MODEL;
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const mode = body.mode === 'extract' ? 'extract' : 'answer';
  const fields = Array.isArray(body.fields) ? body.fields.map((f) => String(f).trim()).filter(Boolean) : [];
  const collection = String(body.collection ?? 'registros').trim() || 'registros';

  if (mode === 'extract' && fields.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const extractPrompt = [
      `Eres un extractor de datos estructurados para la tabla "${collection}".`,
      `Extrae del mensaje del usuario exactamente estos campos: ${fields.join(', ')}.`,
      `Responde ÚNICAMENTE con un objeto JSON válido (sin bloques markdown ni texto adicional) cuyas claves sean esos campos exactos y "date" en formato YYYY-MM-DD (usa "${today}" si no se indica fecha).`,
      instructions ? `Instrucciones adicionales:\n${instructions}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://nodaly.vercel.app',
          'X-Title': 'Nodaly Flow Studio',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: extractPrompt },
            { role: 'user', content: message },
          ],
          temperature: 0.1,
          max_tokens: 400,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errMsg = data?.error?.message || `OpenRouter respondió con estado ${response.status}`;
        res.status(502).json({ error: errMsg });
        return;
      }
      const raw = String(data?.choices?.[0]?.message?.content ?? '').trim();
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        res.status(502).json({ error: 'OpenRouter no devolvió un JSON válido.' });
        return;
      }
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      const extracted: Record<string, string> = {};
      for (const f of fields) {
        extracted[f] = String(parsed[f] ?? '');
      }
      extracted.date = String(parsed.date || today).slice(0, 10);
      res.status(200).json({ extracted, model, used_llm: true });
      return;
    } catch {
      res.status(502).json({ error: 'No se pudo extraer los datos con OpenRouter.' });
      return;
    }
  }

  const contextBlock = sources.length
    ? sources
        .map((s) => {
          const meta = s.page ? `página ${s.page}` : s.sheet ? `hoja ${s.sheet}` : '';
          return `[Fuente: ${s.name}${meta ? ` (${meta})` : ''}]\n${s.text}`;
        })
        .join('\n\n---\n\n')
    : 'No hay documentos conectados.';

  const systemPrompt = [
    'Eres un asistente útil en un chat de WhatsApp conectado a un flujo de Nodaly.',
    'Responde siempre en español, de forma clara, amable y concisa.',
    'Usa únicamente la información de las fuentes proporcionadas cuando respondas sobre menú, precios o inventario. Si un dato no aparece en las fuentes, dilo claramente.',
    instructions ? `Instrucciones adicionales del agente:\n${instructions}` : '',
    `FUENTES CONECTADAS:\n${contextBlock}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: String(h.content) })),
    { role: 'user', content: message },
  ];

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nodaly.vercel.app',
        'X-Title': 'Nodaly Flow Studio',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        max_tokens: 700,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errMsg = data?.error?.message || `OpenRouter respondió con estado ${response.status}`;
      res.status(502).json({ error: errMsg });
      return;
    }

    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      res.status(502).json({ error: 'OpenRouter no devolvió una respuesta válida.' });
      return;
    }

    res.status(200).json({ reply, model, used_llm: true });
  } catch {
    res.status(502).json({ error: 'No se pudo conectar con OpenRouter.' });
  }
}
