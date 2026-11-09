import templates from './demo-templates.json';
import type { FlowEdge, FlowNode } from './model';

type RunRequest = { nodes: FlowNode[]; edges: FlowEdge[]; message: string; run_id: string; confirm: boolean };
const today = () => new Date().toISOString().slice(0, 10);
const expense = (concept: string, category: string, amount: string) => ({ date: today(), concept, category, amount });

export function createDemo() {
  const records = [
    { id: 'lunch', ...expense('Almuerzo ficticio', 'food', '12.50') },
    { id: 'notebooks', ...expense('Cuadernos ficticios', 'supplies', '23.75') },
  ];
  const preview = expense('Almuerzo de ejemplo', 'food', '12.50');
  const reviewed = new Set<string>();

  return async (path: string, options?: RequestInit) => {
    if (!options && path === '/health') return { mode: 'showcase' };
    if (!options && path === '/templates') return structuredClone(templates);
    if (!options && (path === '/workflows' || path === '/documents')) return [];
    if (!options && path === '/records') return [...records];
    if (path !== '/run') throw new Error('Esta acción no está disponible en la demostración web.');

    const { nodes, edges, message, run_id, confirm } = JSON.parse(String(options?.body)) as RunRequest;
    const steps: { node_id: string; status: string; output: unknown }[] = [];
    const result = { run_id, mode: 'showcase', steps, status: 'completed', reply: '' };
    const invalid = () => ({ ...result, status: 'error', error: 'Para simular, conecta los nodos como en una de las tres plantillas.' });
    const actions = nodes.filter(node => node.type !== 'knowledge');
    const order: FlowNode[] = [];
    let next = actions.find(node => node.type === 'message');
    while (next && !order.includes(next)) {
      order.push(next);
      const links = edges.filter(edge => edge.source === next?.id);
      if (links.length > 1) return invalid();
      next = actions.find(node => node.id === links[0]?.target);
    }
    if (next || order.length !== actions.length) return invalid();
    const pathTypes = order.map(node => node.type).join('/');
    const add = (node: FlowNode, output: unknown, status = 'completed') => steps.push({ node_id: node.id, status, output });
    if (pathTypes !== 'message/agent/reply' && pathTypes !== 'message/agent/register/reply' && pathTypes !== 'message/agent/query/report/reply') return invalid();
    const [messageNode, agent, action, reportNode, reportReply] = order;
    add(messageNode, message);

    // shortcut: example outputs show the classroom paths, not a second workflow engine.
    if (pathTypes === 'message/agent/reply') {
      const source = nodes.find(node => node.type === 'knowledge' && edges.some(edge => edge.source === node.id && edge.target === agent.id));
      const context = String(source?.data.config.text || '').trim();
      if (source) add(source, { sources: context ? 1 : 0 });
      const reply = context || 'Conecta una base de conocimiento con texto para mostrar una respuesta de ejemplo.';
      add(agent, reply);
      add(action, reply);
      return { ...result, reply, sources: context ? [{ name: 'Texto de conocimiento' }] : [] };
    }
    if (pathTypes === 'message/agent/register/reply') {
      add(agent, preview);
      if (!confirm) {
        reviewed.add(run_id);
        add(action, preview, 'awaiting_confirmation');
        return { ...result, status: 'awaiting_confirmation', preview };
      }
      if (!reviewed.has(run_id)) return invalid();
      if (!records.some(record => record.id === run_id)) records.push({ id: run_id, ...preview });
      const reply = 'Gasto de ejemplo registrado solo en esta pestaña.';
      add(action, preview);
      add(reportNode, reply);
      return { ...result, reply, preview };
    }
    const groupTotals = new Map<string, { category: string; cents: number; count: number }>();
    for (const record of records) {
      const group = groupTotals.get(record.category) ?? { category: record.category, cents: 0, count: 0 };
      group.cents += Math.round(Number(record.amount) * 100);
      group.count++;
      groupTotals.set(group.category, group);
    }
    const total = ([...groupTotals.values()].reduce((sum, group) => sum + group.cents, 0) / 100).toFixed(2);
    const report = { count: records.length, total, groups: [...groupTotals.values()].map(({ category, count, cents }) => ({ category, count, total: (cents / 100).toFixed(2) })) };
    const reply = `Informe de ejemplo: ${report.count} gastos, total ${report.total}.`;
    add(agent, 'Todos los gastos de ejemplo');
    add(action, [...records]);
    add(reportNode, report);
    add(reportReply, reply);
    return { ...result, reply, report };
  };
}
