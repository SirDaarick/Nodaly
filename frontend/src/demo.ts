import templates from './demo-templates.json';
import type { StoredDocument } from './documents';
import {
  answerFromSources,
  buildExpenseReport,
  createSampleDocuments,
  extractExpense,
  extractFilters,
  queryExpenseRecords,
  type ExpenseRecord,
  type KnowledgeSource,
  type SourceCitation,
} from './engine';
import type { FlowEdge, FlowNode } from './model';

type ChatTurn = { role: 'user' | 'assistant'; content: string };
type RunRequest = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  message: string;
  run_id: string;
  confirm: boolean;
  history?: ChatTurn[];
};
type SavedWorkflow = { id: string; name: string; nodes: FlowNode[]; edges: FlowEdge[] };

const WORKFLOWS_KEY = 'nodaly.showcase.workflows.v1';
const DOCUMENTS_KEY = 'nodaly.showcase.documents.v1';
const today = () => new Date().toISOString().slice(0, 10);

function readStorage<T>(key: string, fallback: T): T {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota/storage errors in restricted environments.
  }
}

async function tryOpenRouter(
  message: string,
  instructions: string,
  model: string,
  history: ChatTurn[],
  sources: KnowledgeSource[],
): Promise<{ reply: string; model: string } | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;

  const flatSources = sources.flatMap((s) =>
    s.sections.map((sec) => ({
      name: s.docName,
      ...(sec.page ? { page: sec.page } : {}),
      ...(sec.sheet ? { sheet: sec.sheet } : {}),
      text: sec.text,
    })),
  );

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        instructions,
        model: model || undefined,
        history,
        sources: flatSources,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { reply?: string; model?: string; used_llm?: boolean };
    if (data.used_llm && data.reply) {
      return { reply: data.reply, model: data.model || model || 'openrouter' };
    }
    return null;
  } catch {
    return null;
  }
}

function createSampleWorkflows(): SavedWorkflow[] {
  const [assistant, capture, report] = templates as { id: string; nodes: FlowNode[]; edges: FlowEdge[] }[];
  const clone = <T,>(v: T): T => structuredClone(v);

  const fepi1: SavedWorkflow = {
    id: 'fepi-1-cotizaciones',
    name: '1. Cotizador Mesas de Dulces (Sandra)',
    nodes: clone(assistant.nodes).map((n) =>
      n.type === 'knowledge'
        ? {
            ...n,
            data: {
              ...n.data,
              config: {
                text: 'LISTA DE PRECIOS - MESAS DE DULCES SANDRA\nMesa clásica (30 invitados): $1,800 MXN.\nMesa premium (60 invitados): $3,200 MXN.\nRenta de exhibidores acrílicos (set de 5): $450 MXN.\nBolsa de dulces personalizada: $35 MXN c/u.\nEnvío y montaje en CDMX: $250 MXN.',
                document_ids: [],
              },
            },
          }
        : n.type === 'agent'
          ? {
              ...n,
              data: {
                ...n.data,
                config: {
                  mode: 'answer',
                  instructions: 'Atiende como asistente de Sandra Díaz (Mesas de Dulces). Responde con precios actualizados y arma cotizaciones claras.',
                },
              },
            }
          : n,
    ),
    edges: clone(assistant.edges),
  };

  const fepi2: SavedWorkflow = {
    id: 'fepi-2-gastos-obra',
    name: '2. Control de Obra y Gastos (Julio)',
    nodes: clone(capture.nodes),
    edges: clone(capture.edges),
  };

  const fepi3: SavedWorkflow = {
    id: 'fepi-3-reportes-evogym',
    name: '3. Cortes y Reportes EvoGym (Gimnasio)',
    nodes: clone(report.nodes).map((n) =>
      n.type === 'report'
        ? { ...n, data: { ...n.data, config: { ...n.data.config, title: 'Corte administrativo EvoGym' } } }
        : n,
    ),
    edges: clone(report.edges),
  };

  const fepi4: SavedWorkflow = {
    id: 'fepi-4-soporte-cursos',
    name: '4. Soporte y Cursos en Línea (Fernando)',
    nodes: clone(assistant.nodes).map((n) =>
      n.type === 'knowledge'
        ? {
            ...n,
            data: {
              ...n.data,
              config: {
                text: 'SOPORTE PLATAFORMA DE CAPACITACIÓN\nInscripciones: Entra a Mis Cursos > Catálogo y haz clic en Inscribirme.\nConstancias: Se descargan automáticamente en PDF al completar el 100% del curso.\nRecuperar contraseña: Usa el enlace ¿Olvidaste tu contraseña? en el inicio de sesión.\nIncidencias de pago o acceso empresarial: Se escalan al equipo de soporte técnico con correo y número de matrícula.\nHorario de soporte humano: Lunes a Viernes de 9:00 AM a 6:00 PM.',
                document_ids: [],
              },
            },
          }
        : n.type === 'agent'
          ? {
              ...n,
              data: {
                ...n.data,
                config: {
                  mode: 'answer',
                  instructions: 'Atiende como mesa de soporte de la plataforma de capacitación. Clasifica si la solicitud es duda general o incidencia técnica y responde con pasos claros.',
                },
              },
            }
          : n,
    ),
    edges: clone(assistant.edges),
  };

  return [fepi1, fepi2, fepi3, fepi4];
}

export function createDemo() {
  const records: ExpenseRecord[] = [
    { id: 'lunch', date: today(), concept: 'Almuerzo ficticio', category: 'food', amount: '12.50' },
    { id: 'notebooks', date: today(), concept: 'Cuadernos ficticios', category: 'supplies', amount: '23.75' },
  ];

  const samples = createSampleDocuments();
  const savedDocs = readStorage<StoredDocument[]>(DOCUMENTS_KEY, []);
  const documents: StoredDocument[] = [
    ...samples,
    ...savedDocs.filter((d) => !samples.some((s) => s.id === d.id)),
  ];

  const defaultWorkflows = createSampleWorkflows();
  const savedWorkflows = readStorage<SavedWorkflow[]>(WORKFLOWS_KEY, []);
  const workflows = new Map<string, SavedWorkflow>([
    ...defaultWorkflows.map((w) => [w.id, w] as [string, SavedWorkflow]),
    ...savedWorkflows.map((w) => [w.id, w] as [string, SavedWorkflow]),
  ]);
  const pendingConfirmations = new Map<string, { fingerprint: string; preview: Omit<ExpenseRecord, 'id'>; committed: boolean }>();

  const persistDocs = () => {
    const customDocs = documents.filter((d) => !samples.some((s) => s.id === d.id));
    writeStorage(DOCUMENTS_KEY, customDocs);
  };
  const persistWorkflows = () => writeStorage(WORKFLOWS_KEY, [...workflows.values()]);

  return async (path: string, options?: RequestInit) => {
    const method = (options?.method ?? 'GET').toUpperCase();

    if (method === 'GET' && path === '/health') return { mode: 'showcase' };
    if (method === 'GET' && path === '/templates') return structuredClone(templates);
    if (method === 'GET' && path === '/workflows') return [...workflows.values()];
    if (method === 'PUT' && path.startsWith('/workflows/')) {
      const id = path.slice('/workflows/'.length);
      const body = JSON.parse(String(options?.body)) as { name: string; nodes: FlowNode[]; edges: FlowEdge[] };
      const saved: SavedWorkflow = { id, name: body.name, nodes: body.nodes, edges: body.edges };
      workflows.set(id, saved);
      persistWorkflows();
      return saved;
    }

    if (method === 'GET' && path === '/documents') {
      return documents.map(({ id, name, kind, text_length }) => ({ id, name, kind, text_length }));
    }
    if (method === 'GET' && path.startsWith('/documents/')) {
      const id = path.slice('/documents/'.length);
      const doc = documents.find((d) => d.id === id);
      if (!doc) throw new Error('Documento no encontrado.');
      return doc;
    }
    if (method === 'POST' && path === '/documents') {
      const doc = JSON.parse(String(options?.body ?? '{}')) as StoredDocument;
      if (!doc || !doc.name || !Array.isArray(doc.sections) || !doc.sections.length) {
        throw new Error('El documento no contiene datos válidos.');
      }
      const entry: StoredDocument = { ...doc, id: doc.id || crypto.randomUUID() };
      documents.push(entry);
      persistDocs();
      return { id: entry.id, name: entry.name, kind: entry.kind, text_length: entry.text_length };
    }
    if (method === 'DELETE' && path.startsWith('/documents/')) {
      const id = path.slice('/documents/'.length);
      const idx = documents.findIndex((d) => d.id === id);
      if (idx === -1) throw new Error('Documento no encontrado.');
      documents.splice(idx, 1);
      persistDocs();
      return { deleted: true };
    }

    if (method === 'GET' && path === '/records') return [...records];
    if (path !== '/run') throw new Error('Esta acción no está disponible en este modo.');

    const { nodes, edges, message, run_id, confirm, history = [] } = JSON.parse(String(options?.body)) as RunRequest;
    const steps: { node_id: string; status: string; output: unknown }[] = [];
    const result: Record<string, unknown> = { run_id, mode: 'showcase', steps, status: 'completed', reply: '' };
    const failRun = (msg: string) => ({ ...result, status: 'error', error: msg });
    const addStep = (node: FlowNode, output: unknown, status = 'completed') => steps.push({ node_id: node.id, status, output });

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const actions = nodes.filter((node) => node.type !== 'knowledge');
    const starts = actions.filter((node) => node.type === 'message');
    if (starts.length !== 1) return failRun('El grafo necesita exactamente un nodo Recibir mensaje.');

    const out = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    const contexts = new Map<string, string[]>();
    for (const n of actions) {
      out.set(n.id, []);
      incoming.set(n.id, []);
      contexts.set(n.id, []);
    }

    const seenEdges = new Set<string>();
    for (const edge of edges) {
      const src = byId.get(edge.source);
      const tgt = byId.get(edge.target);
      if (!src || !tgt) return failRun('Una conexión hace referencia a un nodo inexistente.');
      const key = `${edge.source}->${edge.target}`;
      if (seenEdges.has(key) || edge.source === edge.target) return failRun('Conexión duplicada o cíclica.');
      seenEdges.add(key);

      if (src.type === 'knowledge') {
        if (tgt.type !== 'agent') return failRun('La base de conocimiento solo puede conectarse a un agente de IA.');
        contexts.get(tgt.id)?.push(src.id);
      } else {
        if (tgt.type === 'knowledge' || tgt.type === 'message' || src.type === 'reply') {
          return failRun('Conexión incompatible entre nodos.');
        }
        out.get(src.id)?.push(tgt.id);
        incoming.get(tgt.id)?.push(src.id);
      }
    }

    if ([...out.values()].some((v) => v.length > 1) || [...incoming.values()].some((v) => v.length > 1)) {
      return failRun('La ejecución debe seguir una sola ruta conectada.');
    }

    const knowledgeNodes = nodes.filter((n) => n.type === 'knowledge');
    const connectedKnowledgeIds = new Set([...contexts.values()].flat());
    if (knowledgeNodes.some((n) => !connectedKnowledgeIds.has(n.id))) {
      return failRun('Tienes un nodo de Base de conocimiento desconectado.');
    }

    const order: FlowNode[] = [];
    let currentId: string | undefined = starts[0].id;
    while (currentId) {
      const current = byId.get(currentId);
      if (!current || order.includes(current)) return failRun('El grafo contiene un ciclo.');
      order.push(current);
      const nextIds: string[] = out.get(currentId) ?? [];
      currentId = nextIds[0];
    }

    if (order.length !== actions.length || order[order.length - 1]?.type !== 'reply') {
      return failRun('Conecta todas las acciones desde Recibir mensaje hasta Responder.');
    }

    const fingerprint = JSON.stringify({ nodes, edges, message });
    let previous: unknown = message;
    let pendingToCommit: Omit<ExpenseRecord, 'id'> | null = null;

    try {
      for (let i = 0; i < order.length; i++) {
        const node = order[i];
        const cfg = node.data.config ?? {};
        let output: unknown = previous;

        if (node.type === 'message') {
          output = message;
        } else if (node.type === 'agent') {
          const mode = String(cfg.mode ?? 'answer');
          const contextIds = contexts.get(node.id) ?? [];
          const sources: KnowledgeSource[] = [];

          for (const cid of contextIds) {
            const kn = byId.get(cid);
            if (!kn) continue;
            const kcfg = kn.data.config ?? {};
            const pasted = String(kcfg.text ?? '').trim();
            const docIds = Array.isArray(kcfg.document_ids) ? (kcfg.document_ids as string[]) : [];
            let countForNode = 0;

            if (pasted) {
              sources.push({
                docName: 'Texto pegado',
                kind: 'text',
                sections: [{ label: 'Texto pegado', text: pasted }],
              });
              countForNode += 1;
            }
            for (const did of docIds) {
              const doc = documents.find((d) => d.id === did);
              if (doc) {
                sources.push({ docName: doc.name, kind: doc.kind, sections: doc.sections });
                countForNode += doc.sections.length;
              }
            }
            addStep(kn, { sources: countForNode });
          }

          if (mode === 'answer') {
            const instructions = String(cfg.instructions ?? '');
            const model = String(cfg.model ?? '');
            const llm = await tryOpenRouter(message, instructions, model, history, sources);
            if (llm) {
              output = llm.reply;
              result.used_llm = true;
              result.llm_model = llm.model;
              const citations: SourceCitation[] = sources.map((s) => ({ name: s.docName }));
              result.sources = citations;
            } else {
              const { reply, citations } = answerFromSources(message, sources, instructions);
              output = reply;
              result.used_llm = false;
              result.sources = citations;
            }
          } else if (mode === 'extract') {
            output = extractExpense(message);
          } else if (mode === 'query') {
            output = extractFilters(message);
          } else {
            throw new Error('Elige un modo válido para el agente de IA.');
          }
        } else if (node.type === 'register') {
          if (i === 0 || order[i - 1].type !== 'agent' || order[i - 1].data.config?.mode !== 'extract') {
            throw new Error('El registro requiere un agente de extracción inmediatamente antes.');
          }
          const saved = pendingConfirmations.get(run_id);
          if (saved && saved.fingerprint !== fingerprint) {
            throw new Error('El identificador de ejecución pertenece a otra solicitud.');
          }
          let preview: Omit<ExpenseRecord, 'id'>;
          if (!saved) {
            if (confirm) throw new Error('Revisa esta ejecución antes de confirmarla.');
            preview = previous as Omit<ExpenseRecord, 'id'>;
            pendingConfirmations.set(run_id, { fingerprint, preview, committed: false });
          } else {
            preview = saved.preview;
          }
          result.preview = preview;
          output = preview;
          if (!confirm) {
            result.status = 'awaiting_confirmation';
            addStep(node, preview, 'awaiting_confirmation');
            return result;
          }
          pendingToCommit = preview;
        } else if (node.type === 'query') {
          output = queryExpenseRecords(records, cfg, previous);
        } else if (node.type === 'report') {
          if (i === 0 || order[i - 1].type !== 'query') {
            throw new Error('El informe requiere una consulta inmediatamente antes.');
          }
          const report = buildExpenseReport(previous as ExpenseRecord[], cfg);
          output = report;
          result.report = report;
        } else if (node.type === 'reply') {
          const template = String(cfg.template ?? '');
          if (template) {
            const values =
              previous && typeof previous === 'object' && !Array.isArray(previous)
                ? (previous as Record<string, unknown>)
                : { output: String(previous) };
            output = template.replace(/\{([a-z_]+)\}/g, (match, key) =>
              key in values ? String(values[key]) : match,
            );
          } else if (previous && typeof previous === 'object' && !Array.isArray(previous) && 'amount' in previous) {
            const p = previous as Omit<ExpenseRecord, 'id'>;
            output = `Gasto registrado: ${p.concept}, importe $${p.amount}, fecha ${p.date}.`;
          } else if (previous && typeof previous === 'object' && !Array.isArray(previous) && 'groups' in previous) {
            const r = previous as unknown as { title: string; count: number; total: string };
            output = `${r.title || 'Informe de gastos'}: ${r.count} gastos, total $${r.total}.`;
          } else if (Array.isArray(previous)) {
            output = `Se encontraron ${previous.length} registros.`;
          } else {
            output = String(previous ?? '');
          }
          result.reply = output;
        }

        addStep(node, output);
        previous = output;
      }

      if (pendingToCommit) {
        const saved = pendingConfirmations.get(run_id);
        if (saved && !saved.committed) {
          records.push({ id: run_id, ...pendingToCommit });
          saved.committed = true;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Error al ejecutar el flujo.';
      return failRun(errMsg);
    }

    return result;
  };
}
