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
} from './engine';
import type { FlowEdge, FlowNode } from './model';

type RunRequest = { nodes: FlowNode[]; edges: FlowEdge[]; message: string; run_id: string; confirm: boolean };
type SavedWorkflow = { id: string; name: string; nodes: FlowNode[]; edges: FlowEdge[] };

const today = () => new Date().toISOString().slice(0, 10);

export function createDemo() {
  const records: ExpenseRecord[] = [
    { id: 'lunch', date: today(), concept: 'Almuerzo ficticio', category: 'food', amount: '12.50' },
    { id: 'notebooks', date: today(), concept: 'Cuadernos ficticios', category: 'supplies', amount: '23.75' },
  ];
  const documents: StoredDocument[] = createSampleDocuments();
  const workflows = new Map<string, SavedWorkflow>();
  const pendingConfirmations = new Map<string, { fingerprint: string; preview: Omit<ExpenseRecord, 'id'>; committed: boolean }>();

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
      return saved;
    }

    if (method === 'GET' && path === '/documents') {
      return documents.map(({ id, name, text_length }) => ({ id, name, text_length }));
    }
    if (method === 'POST' && path === '/documents') {
      const doc = JSON.parse(String(options?.body ?? '{}')) as StoredDocument;
      if (!doc || !doc.name || !Array.isArray(doc.sections) || !doc.sections.length) {
        throw new Error('El documento no contiene datos válidos.');
      }
      const entry: StoredDocument = { ...doc, id: doc.id || crypto.randomUUID() };
      documents.push(entry);
      return { id: entry.id, name: entry.name, text_length: entry.text_length };
    }
    if (method === 'DELETE' && path.startsWith('/documents/')) {
      const id = path.slice('/documents/'.length);
      const idx = documents.findIndex((d) => d.id === id);
      if (idx === -1) throw new Error('Documento no encontrado.');
      documents.splice(idx, 1);
      return { deleted: true };
    }

    if (method === 'GET' && path === '/records') return [...records];
    if (path !== '/run') throw new Error('Esta acción no está disponible en este modo.');

    const { nodes, edges, message, run_id, confirm } = JSON.parse(String(options?.body)) as RunRequest;
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
            const { reply, citations } = answerFromSources(message, sources, String(cfg.instructions ?? ''));
            output = reply;
            result.sources = citations;
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
