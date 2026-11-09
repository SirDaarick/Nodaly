import type { NodeChange } from '@xyflow/react';
export type Kind = 'message' | 'knowledge' | 'agent' | 'reply' | 'register' | 'query' | 'report';
export type Config = Record<string, unknown>;
export type FlowNode = { id: string; type: Kind; position: { x: number; y: number }; data: { label: string; config: Config } };
export type FlowEdge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };
export const kinds: { type: Kind; label: string; description: string; icon: string; color: string }[] = [
  { type: 'message', label: 'Recibir mensaje', description: 'Inicia con un mensaje', icon: '✉', color: 'blue' },
  { type: 'knowledge', label: 'Base de conocimiento', description: 'Añade contexto confiable', icon: '▤', color: 'teal' },
  { type: 'agent', label: 'Agente de IA', description: 'Comprende y decide', icon: '✦', color: 'purple' },
  { type: 'reply', label: 'Responder', description: 'Envía una respuesta', icon: '↗', color: 'teal' },
  { type: 'register', label: 'Registrar información', description: 'Guarda un gasto', icon: '▣', color: 'amber' },
  { type: 'query', label: 'Consultar registros', description: 'Busca gastos guardados', icon: '⌕', color: 'blue' },
  { type: 'report', label: 'Generar informe', description: 'Resume los resultados', icon: '▥', color: 'rose' },
];
export function defaultConfig(type: Kind): Config {
  switch (type) {
    case 'message': return {};
    case 'knowledge': return { text: '', document_ids: [] };
    case 'agent': return { mode: 'answer', instructions: '' };
    case 'reply': return { template: '' };
    case 'register': return { collection: 'expenses' };
    case 'query': return { collection: 'expenses', period: 'all', category: '' };
    case 'report': return { amount_field: 'amount', group_by: 'category', title: 'Informe de gastos' };
  }
}

export function runPresentation(status: string) {
  return { confirm: status === 'awaiting_confirmation', tone: status === 'completed' ? 'success' : status === 'error' ? 'error' : 'pending' };
}

export function updateDimensions(current: Record<string, {width: number; height: number}>, changes: NodeChange[]) {
  let next = current;
  for (const change of changes) {
    if (change.type === 'dimensions' && change.dimensions && (current[change.id]?.width !== change.dimensions.width || current[change.id]?.height !== change.dimensions.height)) {
      if (next === current) next = { ...current };
      next[change.id] = change.dimensions;
    }
  }
  return next;
}

const labels: Record<string, string> = {
  'Receive message': 'Recibir mensaje', 'Knowledge base': 'Base de conocimiento', 'AI Agent': 'Agente de IA',
  'Reply': 'Responder', 'Register information': 'Registrar información', 'Query records': 'Consultar registros',
  'Generate report': 'Generar informe', 'Document assistant': 'Asistente de documentos',
  'Expense registration': 'Registro de gastos', 'Expense report': 'Informe de gastos',
  'Expenses': 'Gastos', 'Pasted text': 'Texto pegado', 'Untitled workflow': 'Flujo sin título',
};
const statuses: Record<string, string> = { completed: 'Completado', error: 'Error', awaiting_confirmation: 'Pendiente de confirmación' };
const categories: Record<string, string> = { food: 'Alimentación', transport: 'Transporte', supplies: 'Insumos', utilities: 'Servicios', other: 'Otros' };
const fields: Record<string, string> = { date: 'Fecha', concept: 'Concepto', category: 'Categoría', amount: 'Importe', sources: 'Fuentes', count: 'Cantidad', total: 'Total', groups: 'Grupos', title: 'Título', period: 'Período', id: 'Identificador' };
const periods: Record<string, string> = { all: 'Todo el tiempo', today: 'Hoy', week: 'Esta semana', month: 'Este mes' };
export const displayLabel = (value: string) => labels[value] ?? value;
export const displayStatus = (value: string) => statuses[value] ?? value;
export const displayCategory = (value: string) => categories[value] ?? value;
export const displayField = (value: string) => fields[value] ?? value;

export function displayOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(displayOutput);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [displayField(key), key === 'category' && typeof item === 'string' ? displayCategory(item) : key === 'period' && typeof item === 'string' ? (periods[item] ?? item) : displayOutput(item)]));
  return value;
}
