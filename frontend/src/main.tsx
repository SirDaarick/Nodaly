/// <reference types="vite/client" />
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, useReactFlow, useNodesInitialized, Position, Background, Controls, addEdge, applyNodeChanges, applyEdgeChanges, type Node, type Edge, type NodeChange, type EdgeChange, type Connection } from '@xyflow/react';
import { Bell, BookOpen, Check, ChevronDown, CircleHelp, Database, Download, Eye, FileText, MessageCircle, Play, Presentation, Plus, Save, Send, Sparkles, Trash2, Upload, X, Zap } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './style.css';
import { createDemo } from './demo';
import { parseDocumentFile, type StoredDocument } from './documents';
import { exportPrintPdf, exportRowsToExcel } from './exports';
import { defaultConfig, kinds, runPresentation, updateDimensions, displayLabel, displayStatus, displayCategory, displayField, displayOutput, type Kind, type FlowNode, type FlowEdge, type Config } from './model';

type Flow = { id: string; name: string; description?: string; nodes: FlowNode[]; edges: FlowEdge[]; message?: string };
type Doc = { id: string; name: string; kind?: string; text_length: number };
type Step = { node_id: string; status: string; output: unknown };
type Run = {
  run_id: string;
  status: string;
  mode: string;
  used_llm?: boolean;
  llm_model?: string;
  steps: Step[];
  reply: string;
  error?: string;
  preview?: Record<string, unknown>;
  sources?: { name: string; page?: number; sheet?: string }[];
  report?: { title?: string; total: string; count: number; groups: { category: string; total: string; count: number }[] };
  export_file?: { format: 'xlsx' | 'pdf'; filename: string; title: string; rows: Record<string, string | number>[]; summary: string };
};
type RecordItem = { id: string; date: string; concept: string; category: string; amount: string; collection?: string; data?: Record<string, unknown> };
type ChatEntry = {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  time: string;
  isError?: boolean;
  run?: Run;
  isQuote?: boolean;
};
type OwnerNotification = {
  id: string;
  kind: 'Cotización' | 'Gasto de obra';
  flowName: string;
  customerOrCategory: string;
  summary: string;
  amount: string;
  time: string;
};

const showcase = import.meta.env.MODE === 'showcase';
const demo = showcase ? createDemo() : null;
const BACKEND_URL_KEY = 'nodaly.backendUrl.v1';
const NOTIFICATIONS_KEY = 'nodaly.notifications.v1';

function getInitialBackendUrl(): string {
  try {
    const param = new URLSearchParams(window.location.search).get('backend');
    if (param) {
      const clean = param.trim().replace(/\/+$/, '');
      window.localStorage.setItem(BACKEND_URL_KEY, clean);
      return clean;
    }
    const envUrl = String(import.meta.env.VITE_BACKEND_URL || '').trim().replace(/\/+$/, '');
    if (envUrl) return envUrl;
    return (window.localStorage.getItem(BACKEND_URL_KEY) || '').trim().replace(/\/+$/, '');
  } catch {
    return String(import.meta.env.VITE_BACKEND_URL || '').trim().replace(/\/+$/, '');
  }
}

async function api<T>(url: string, options?: RequestInit, backendUrl = ''): Promise<T> {
  if (!backendUrl && demo) return await demo(url, options) as T;
  const base = backendUrl ? `${backendUrl}/api` : '/api';
  const headers = new Headers(options?.headers);
  if (backendUrl) headers.set('ngrok-skip-browser-warning', 'true');

  let response: Response;
  try {
    response = await fetch(base + url, { ...options, headers });
  } catch {
    throw new Error(
      backendUrl
        ? `No se pudo conectar con el backend en ${backendUrl}. Verifica que uvicorn y ngrok estén encendidos.`
        : 'No se puede conectar con el servidor local. Inicia el servidor e inténtalo de nuevo.',
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `La solicitud falló (${response.status}).`);
  return data as T;
}
const json = (data: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const ariaLabels = {
  'node.a11yDescription.default': 'Pulsa Intro o Espacio para seleccionar un nodo. Usa las flechas para moverlo.',
  'node.a11yDescription.keyboardDisabled': 'Pulsa Intro o Espacio para seleccionar un nodo.',
  'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }: { direction: string; x: number; y: number }) => `Nodo movido ${({ up: 'arriba', down: 'abajo', left: 'a la izquierda', right: 'a la derecha' } as Record<string, string>)[direction] ?? direction}; posición ${x}, ${y}.`,
  'edge.a11yDescription.default': 'Pulsa Intro o Espacio para seleccionar una conexión.',
  'controls.ariaLabel': 'Controles del lienzo', 'controls.zoomIn.ariaLabel': 'Acercar',
  'controls.zoomOut.ariaLabel': 'Alejar', 'controls.fitView.ariaLabel': 'Ajustar vista',
  'controls.interactive.ariaLabel': 'Alternar interacción', 'minimap.ariaLabel': 'Minimapa',
  'handle.ariaLabel': 'Punto de conexión',
};
const meta = (type: Kind) => kinds.find(k => k.type === type)!;
function FitCanvas({ version, container }: { version: number; container: React.RefObject<HTMLDivElement> }) {
  const { fitView } = useReactFlow();
  const ready = useNodesInitialized();
  useEffect(() => {
    if (!ready || !container.current) return;
    let frame = 0;
    const fit = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => requestAnimationFrame(() => { void fitView({ padding: 0.2, maxZoom: 1 }); })); };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container.current);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [ready, version, fitView, container]);
  return null;
}

function App() {
  const [templates, setTemplates] = useState<Flow[]>([]); const [flows, setFlows] = useState<Flow[]>([]);
  const [nodes, setNodes] = useState<FlowNode[]>([]); const [measurements, setMeasurements] = useState<Record<string, {width:number; height:number}>>({}); const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [name, setName] = useState('Flujo sin título'); const [flowId, setFlowId] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null); const [fitVersion, setFitVersion] = useState(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(''); const [message, setMessage] = useState(''); const [lastSubmittedMessage, setLastSubmittedMessage] = useState('');
  const [docs, setDocs] = useState<Doc[]>([]); const [records, setRecords] = useState<RecordItem[]>([]);
  const [mode, setMode] = useState('connecting'); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [run, setRun] = useState<Run | null>(null); const [busy, setBusy] = useState(false); const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<'chat'|'test'|'records'|'notifications'>('chat');
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([]);
  const [notifications, setNotifications] = useState<OwnerNotification[]>(() => {
    try {
      const raw = window.localStorage.getItem(NOTIFICATIONS_KEY);
      return raw ? (JSON.parse(raw) as OwnerNotification[]) : [];
    } catch { return []; }
  });
  const [previewDoc, setPreviewDoc] = useState<StoredDocument | null>(null);
  const [backendUrl, setBackendUrl] = useState<string>(() => getInitialBackendUrl());
  const [backendInput, setBackendInput] = useState<string>(() => getInitialBackendUrl());
  const [recordsFilter, setRecordsFilter] = useState<string>('all');
  const [tgPolling, setTgPolling] = useState(false);
  const [tgStatus, setTgStatus] = useState('');
  const tgOffsetRef = useRef<number>(0);
  const presentationDialog = useRef<HTMLDialogElement>(null);
  const docDialog = useRef<HTMLDialogElement>(null);
  const ngrokDialog = useRef<HTMLDialogElement>(null);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const current = nodes.find(n => n.id === selected);
  const refreshDocs = (url = backendUrl) => api<Doc[]>('/documents', undefined, url).then(setDocs);
  const refreshRecords = (url = backendUrl) => api<RecordItem[]>('/records', undefined, url).then(setRecords);
  const refreshFlows = (url = backendUrl) => api<Flow[]>('/workflows', undefined, url).then(setFlows);

  useEffect(() => {
    setMode('connecting');
    Promise.all([
      api<{mode:string}>('/health', undefined, backendUrl),
      api<Flow[]>('/templates', undefined, backendUrl),
      api<Flow[]>('/workflows', undefined, backendUrl),
      api<Doc[]>('/documents', undefined, backendUrl),
      api<RecordItem[]>('/records', undefined, backendUrl),
    ])
      .then(([health, ts, fs, ds, rs]) => { setMode(health.mode); setTemplates(ts); setFlows(fs); setDocs(ds); setRecords(rs); if (ts[0]) load(ts[0], false); })
      .catch(e => { setMode('offline'); setError(e.message); });
  }, [backendUrl]);
  useEffect(() => { document.querySelectorAll('.library, .inspector').forEach(el => { if (busy) el.setAttribute('inert', ''); else el.removeAttribute('inert'); }); }, [busy]);
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory, tab]);

  function load(flow: Flow, saved: boolean) {
    setFitVersion(v => v + 1);
    setMeasurements({});
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setName(flow.name);
    setFlowId(saved ? flow.id : '');
    setSelected(flow.nodes[0]?.id || '');
    setMessage(flow.message || '');
    setRun(null);
    setChatHistory([]);
    setNotice('');
    setError('');
  }
  function addNode(type: Kind) { const id = `${type}-${crypto.randomUUID()}`; const item = meta(type); setNodes(ns => [...ns, {id, type, position: {x: 100 + (ns.length % 4)*210, y: 100 + Math.floor(ns.length / 4)*150}, data: {label:item.label, config:defaultConfig(type)}}]); setSelected(id); setRun(null); }
  function updateConfig(key: string, value: unknown) { setNodes(ns => ns.map(n => n.id === selected ? {...n, data: {...n.data, config: {...n.data.config, [key]: value}}} : n)); setRun(null); }
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setMeasurements(current => updateDimensions(current, changes));
    setNodes(ns => {
      const drawn = ns.map(n => ({...n, type: 'default', data: {...n.data}})) as Node[];
      const updated = applyNodeChanges(changes, drawn);
      return updated.map(n => { const original = ns.find(o => o.id === n.id)!; return {...original, position: n.position}; });
    });
    const removed = changes.filter(c => c.type === 'remove').map(c => c.id);
    if (removed.length) { setEdges(es => es.filter(e => !removed.includes(e.source) && !removed.includes(e.target))); setSelected(s => removed.includes(s) ? '' : s); }
    if (changes.some(c => c.type !== 'select' && c.type !== 'dimensions')) setRun(null);
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => { setEdges(es => applyEdgeChanges(changes, es as Edge[]) as FlowEdge[]); if (changes.some(c => c.type === 'remove')) setRun(null); }, []);
  const onConnect = useCallback((connection: Connection) => { setEdges(es => addEdge(connection, es as Edge[]) as FlowEdge[]); setRun(null); }, []);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const id = flowId || crypto.randomUUID();
      await api<Flow>(`/workflows/${id}`, { ...json({ name, nodes, edges }), method: 'PUT' }, backendUrl);
      setFlowId(id);
      await refreshFlows();
      setNotice(backendUrl ? 'Flujo guardado en tu backend local (SQLite).' : 'Flujo y nodos guardados en este navegador.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function pushNotification(entry: Omit<OwnerNotification, 'id' | 'time'>) {
    const nextItem: OwnerNotification = { ...entry, id: crypto.randomUUID(), time: nowTime() };
    setNotifications(prev => {
      const updated = [nextItem, ...prev].slice(0, 50);
      try { window.localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  }

  async function execute(confirm = false, overrideMessage?: string) {
    const activeMessage = confirm ? (overrideMessage || lastSubmittedMessage || message) : (overrideMessage ?? message);
    if (!confirm && !activeMessage.trim()) {
      setError('Escribe un mensaje para enviar al flujo.');
      return;
    }
    setRunning(true);
    setBusy(true);
    setError('');
    setNotice('');

    const historyPayload = chatHistory
      .filter(entry => !entry.isError)
      .slice(-8)
      .map(entry => ({
        role: entry.sender === 'user' ? 'user' : 'assistant',
        content: entry.text,
      }));

    if (!confirm) {
      setLastSubmittedMessage(activeMessage);
      setChatHistory(prev => [...prev, { id: crypto.randomUUID(), sender: 'user', text: activeMessage, time: nowTime() }]);
      setMessage('');
    }
    try {
      const result = await api<Run>('/run', json({
        nodes,
        edges,
        message: activeMessage,
        run_id: confirm && run ? run.run_id : crypto.randomUUID(),
        confirm,
        history: historyPayload,
      }), backendUrl);
      setRun(result);
      if (result.error) setError(result.error);
      if (confirm && result.status === 'completed') {
        await refreshRecords();
        if (result.preview) {
          const isQuote = name.toLowerCase().includes('dulces') || name.toLowerCase().includes('sandra') || 'cliente' in result.preview;
          pushNotification({
            kind: isQuote ? 'Cotización' : 'Gasto de obra',
            flowName: name,
            customerOrCategory: String(result.preview.cliente || displayCategory(String(result.preview.category || 'other'))),
            summary: String(result.preview.paquetes || result.preview.concept || activeMessage),
            amount: `$${String(result.preview.total || result.preview.amount || result.preview.monto || '0.00')}`,
          });
        }
      }

      const botText = result.status === 'error'
        ? (result.error || 'Ocurrió un error al ejecutar el flujo.')
        : result.status === 'awaiting_confirmation'
          ? (result.reply ? `${result.reply}\n\nRevisa la vista previa y confírmala para guardar el registro:` : 'Encontré estos datos. Revisa la vista previa y confírmala para guardar el registro:')
          : (result.reply || 'Flujo ejecutado.');

      const isQuoteFlow = confirm && result.status === 'completed' && (name.toLowerCase().includes('dulces') || name.toLowerCase().includes('sandra'));

      setChatHistory(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          sender: 'bot',
          text: botText,
          time: nowTime(),
          isError: result.status === 'error',
          run: result,
          isQuote: isQuoteFlow,
        },
      ]);
    } catch (e) {
      const errMsg = (e as Error).message;
      setError(errMsg);
      setChatHistory(prev => [...prev, { id: crypto.randomUUID(), sender: 'bot', text: errMsg, time: nowTime(), isError: true }]);
    } finally {
      setRunning(false);
      setBusy(false);
    }
  }

  async function verifyTelegramBot(token: string) {
    const clean = token.trim();
    if (!clean) { setError('Pega primero el token de tu bot de Telegram.'); return; }
    setBusy(true); setError(''); setTgStatus('Verificando…');
    try {
      let username = '';
      if (backendUrl || !demo) {
        const res = await api<{ ok: boolean; bot: { username?: string; first_name?: string } }>('/telegram/verify', json({ token: clean }), backendUrl);
        username = res.bot?.username || res.bot?.first_name || 'Bot';
      } else {
        const resp = await fetch(`https://api.telegram.org/bot${clean}/getMe`);
        const data = await resp.json() as { ok: boolean; description?: string; result?: { username?: string; first_name?: string } };
        if (!data.ok || !data.result) throw new Error(data.description || 'Token de Telegram no válido.');
        username = data.result.username || data.result.first_name || 'Bot';
      }
      updateConfig('telegram_bot_username', username);
      setTgStatus(`Conectado a @${username}`);
      setNotice(`Bot de Telegram verificado: @${username}`);
    } catch (e) {
      setTgStatus('');
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const msgNode = nodes.find(n => n.type === 'message');
    const tgToken = String(msgNode?.data.config?.telegram_token ?? '').trim();
    const autoConfirm = msgNode?.data.config?.telegram_auto_confirm !== false;
    if (!tgPolling || !tgToken) return;

    let cancelled = false;
    const pollOnce = async () => {
      try {
        if (backendUrl || !demo) {
          const res = await api<{ processed: { update_id: number; from_user: string; text: string; reply: string; run: Run }[]; next_offset: number }>(
            '/telegram/poll',
            json({ token: tgToken, offset: tgOffsetRef.current, nodes, edges, auto_confirm: autoConfirm }),
            backendUrl,
          );
          if (cancelled) return;
          tgOffsetRef.current = res.next_offset;
          if (res.processed.length) {
            await refreshRecords();
            setChatHistory(prev => [
              ...prev,
              ...res.processed.flatMap(p => ([
                { id: crypto.randomUUID(), sender: 'user' as const, text: `[Telegram @${p.from_user}]: ${p.text}`, time: nowTime() },
                { id: crypto.randomUUID(), sender: 'bot' as const, text: p.reply, time: nowTime(), run: p.run },
              ])),
            ]);
          }
        } else {
          const resp = await fetch(`https://api.telegram.org/bot${tgToken}/getUpdates?offset=${tgOffsetRef.current}&timeout=1`);
          const data = await resp.json() as { ok: boolean; result?: { update_id: number; message?: { text?: string; chat?: { id: number }; from?: { username?: string; first_name?: string } } }[] };
          if (!data.ok || !Array.isArray(data.result) || cancelled) return;
          for (const u of data.result) {
            if (u.update_id >= tgOffsetRef.current) tgOffsetRef.current = u.update_id + 1;
            const text = String(u.message?.text ?? '').trim();
            const chatId = u.message?.chat?.id;
            if (!text || chatId === undefined) continue;
            const fromUser = u.message?.from?.username || u.message?.from?.first_name || 'Usuario';
            const rid = `tg-${u.update_id}`;
            let runRes = await api<Run>('/run', json({ nodes, edges, message: text, run_id: rid, confirm: false, history: [] }), backendUrl);
            if (runRes.status === 'awaiting_confirmation' && autoConfirm) {
              runRes = await api<Run>('/run', json({ nodes, edges, message: text, run_id: rid, confirm: true, history: [] }), backendUrl);
            }
            const replyText = runRes.reply || runRes.error || 'Flujo ejecutado.';
            await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: replyText }),
            });
            if (cancelled) return;
            await refreshRecords();
            setChatHistory(prev => [
              ...prev,
              { id: crypto.randomUUID(), sender: 'user', text: `[Telegram @${fromUser}]: ${text}`, time: nowTime() },
              { id: crypto.randomUUID(), sender: 'bot', text: replyText, time: nowTime(), run: runRes },
            ]);
          }
        }
      } catch {
        // Keep polling silently on transient network hiccups.
      }
    };

    void pollOnce();
    const timer = window.setInterval(() => { void pollOnce(); }, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [tgPolling, nodes, edges, backendUrl]);

  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024 || !/\.(pdf|txt|md|markdown|xlsx|xls|csv)$/i.test(file.name)) {
      setError('Selecciona un archivo PDF, Excel (.xlsx, .xls), CSV, TXT o Markdown (.md) de hasta 5 MB.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let created: Doc;
      if (!backendUrl && demo) {
        const parsed = await parseDocumentFile(file);
        created = await api<Doc>('/documents', json(parsed), backendUrl);
      } else {
        const body = new FormData();
        body.append('file', file);
        created = await api<Doc>('/documents', { method: 'POST', body }, backendUrl);
      }
      await refreshDocs();
      // Auto-select the newly uploaded document if the active knowledge node has room.
      if (current?.type === 'knowledge') {
        const currentIds = (current.data.config.document_ids as string[]) || [];
        if (currentIds.length < 3 && !currentIds.includes(created.id)) {
          updateConfig('document_ids', [...currentIds, created.id]);
        }
      }
      setNotice('Documento cargado y listo para usar en el flujo.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function inspectDoc(id: string) {
    try {
      const full = await api<StoredDocument>(`/documents/${id}`, undefined, backendUrl);
      setPreviewDoc(full);
      docDialog.current?.showModal();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeDoc(id: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/documents/${id}`, { method: 'DELETE' }, backendUrl);
      setNodes(ns => ns.map(n => n.type === 'knowledge' ? { ...n, data: { ...n.data, config: { ...n.data.config, document_ids: ((n.data.config.document_ids as string[]) || []).filter(x => x !== id) } } } : n));
      await refreshDocs();
      setRun(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const activeAgentMode = String(nodes.find(n => n.type === 'agent')?.data.config?.mode ?? 'answer');
  const lowerFlowName = name.toLowerCase();
  const quickPrompts = lowerFlowName.includes('dulces') || lowerFlowName.includes('sandra')
    ? ['Hola, ¿qué paquetes de mesas tienen y qué incluyen?', 'Soy Laura, cotízame 1 mesa premium + arco de globos + envío CDMX', 'Soy Carlos, quiero 1 mesa imperial + fuente de chocolate']
    : lowerFlowName.includes('evogym') || lowerFlowName.includes('gimnasio')
      ? ['Muestra todos los gastos', 'Gastos de hoy en insumos', 'Corte de alimentación']
      : lowerFlowName.includes('soporte') || lowerFlowName.includes('fernando') || lowerFlowName.includes('cursos')
        ? ['¿Qué gastos tenemos registrados en la tabla?', 'Tengo un bloqueo masivo de SSO empresarial en mi cuenta', '¿Cómo descargo mi constancia DC-3?']
        : lowerFlowName.includes('registro crm') || lowerFlowName.includes('clientes y pedidos')
          ? ['cliente: Sofía Ramírez, telefono: 5544332211, servicio: Plan Anual VIP, monto: 4200, estado: Pagado', 'cliente: Constructora Delta, telefono: 5588990011, servicio: Implementación IA, monto: 18500, estado: Anticipo 50%', 'cliente: Marco Polo, telefono: 5511223344, servicio: Consultoría Express, monto: 2400, estado: Pendiente']
          : lowerFlowName.includes('asistente ia con tabla') || lowerFlowName.includes('asistente crm')
            ? ['¿Qué registros y clientes tenemos guardados en la tabla?', '¿Qué incluye el Plan Anual VIP y cuál es su garantía según el manual?', 'Haz un resumen de los registros guardados con sus montos']
            : activeAgentMode === 'extract'
              ? ['Hoy gasté 850 en soldadura', 'Ayer pagué $320 de transporte de acero', 'Hazme el corte de todos los gastos y exporta el Excel']
              : activeAgentMode === 'query'
                ? ['Muestra todos los gastos', 'Gastos de hoy en alimentación', 'Corte de insumos']
                : ['¿Qué tacos tienen y cuánto cuestan?', '¿Hay refresco en inventario?', '¿Qué promociones tienen y qué productos están agotados?'];

  const displayed: Node[] = nodes.map(n => { const m = meta(n.type); const step = run?.steps.find(s => s.node_id === n.id); return {id:n.id, type:'default', position:n.position, measured:measurements[n.id], sourcePosition:Position.Right, targetPosition:Position.Left, data:{label:<div className="flow-node"><span className={`node-icon ${m.color}`}>{m.icon}</span><span className="node-copy"><strong>{displayLabel(n.data.label)}</strong><small>{step ? displayStatus(step.status) : m.description}</small></span><span className={`node-status ${step?.status || ''}`}>{step ? (step.status === 'completed' ? '✓' : '!') : '·'}</span></div>}, className:`canvas-node ${selected === n.id ? 'is-selected' : ''} ${running ? 'is-running' : ''}`}; });
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><span>✦</span></span><span>Nodaly<small>ESTUDIO DE FLUJOS</small></span></div>
      <div className="top-divider"/>
      <div className="top-title"><span>Espacio de trabajo</span><strong>Editor visual de flujos</strong></div>
      <div className="top-actions">
        <button className="button secondary" onClick={() => { setBackendInput(backendUrl); ngrokDialog.current?.showModal(); }}><Database size={15} aria-hidden="true"/> {backendUrl ? 'Backend conectado' : 'Conectar ngrok'}</button>
        <button className="button secondary" onClick={() => { presentationDialog.current?.showModal(); setPresentationOpen(true); }}><Presentation size={16} aria-hidden="true"/> Presentación</button>
        <span className={`mode ${mode}`}><i/> {backendUrl ? (mode === 'live' ? 'Backend local + IA' : mode === 'offline' ? 'Backend desconectado' : 'Backend local (ngrok)') : mode === 'showcase' ? (run?.used_llm ? 'OpenRouter conectado' : 'En navegador (Vercel)') : mode === 'demo' ? 'Modo de demostración local' : mode === 'live' ? 'Modo de IA en vivo' : mode === 'offline' ? 'Servidor desconectado' : 'Conectando'}</span>
        <button className="icon-button help" title="Cómo usar" onClick={() => setNotice('Conecta tus nodos, sube un PDF o Excel en Base de conocimiento, guarda tu flujo si lo editas y conversa en el chat simulado tipo WhatsApp.')}><CircleHelp size={19}/></button>
      </div>
    </header>

    <dialog ref={ngrokDialog} className="doc-dialog" aria-labelledby="ngrok-title">
      <div className="doc-dialog-body">
        <header className="doc-dialog-head">
          <div>
            <span className="section-kicker">BACKEND LOCAL</span>
            <h2 id="ngrok-title">Conectar backend por ngrok</h2>
          </div>
          <button className="icon-button" aria-label="Cerrar" onClick={() => ngrokDialog.current?.close()}><X size={20}/></button>
        </header>
        <form
          className="doc-dialog-content"
          onSubmit={e => {
            e.preventDefault();
            const clean = backendInput.trim().replace(/\/+$/, '');
            try {
              if (clean) window.localStorage.setItem(BACKEND_URL_KEY, clean);
              else window.localStorage.removeItem(BACKEND_URL_KEY);
            } catch { /* ignore */ }
            setBackendUrl(clean);
            ngrokDialog.current?.close();
            setNotice(clean ? `Conectando con ${clean}…` : 'Volviste al modo navegador.');
          }}
        >
          <p className="field-help" style={{ margin: 0, fontSize: '12px' }}>
            Pega la URL HTTPS que te da ngrok (ejemplo: <code>https://abc123.ngrok-free.app</code>) mientras corres el backend local en el puerto 8000. Déjalo vacío para volver al modo navegador.
          </p>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>
            URL del backend (ngrok o localhost)
            <input
              type="url"
              value={backendInput}
              onChange={e => setBackendInput(e.target.value)}
              placeholder="https://tu-tunel.ngrok-free.app"
              style={{ width: '100%', marginTop: '8px', padding: '10px 12px', borderRadius: '10px', border: '1px solid #dce3ec' }}
            />
          </label>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            {backendUrl && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setBackendInput('');
                  try { window.localStorage.removeItem(BACKEND_URL_KEY); } catch { /* ignore */ }
                  setBackendUrl('');
                  ngrokDialog.current?.close();
                  setNotice('Desconectado del backend; usando modo navegador.');
                }}
              >
                Usar modo navegador
              </button>
            )}
            <button type="submit" className="button primary">Guardar y conectar</button>
          </div>
        </form>
      </div>
    </dialog>

    <dialog ref={presentationDialog} className="presentation-dialog" aria-labelledby="presentation-title" onClose={() => setPresentationOpen(false)}>
      <div className="presentation-content">
        <header className="presentation-toolbar">
          <h2 id="presentation-title">Presentación de Nodaly</h2>
          <button className="icon-button" aria-label="Cerrar presentación" onClick={() => presentationDialog.current?.close()} autoFocus><X size={20} aria-hidden="true"/></button>
        </header>
        {presentationOpen && <iframe src="./presentaciones/nodaly-fepi.html" title="Diapositivas del proyecto Nodaly" sandbox="allow-scripts" allowFullScreen />}
      </div>
    </dialog>

    <dialog ref={docDialog} className="doc-dialog" aria-labelledby="doc-preview-title" onClose={() => setPreviewDoc(null)}>
      {previewDoc && (
        <div className="doc-dialog-body">
          <header className="doc-dialog-head">
            <div>
              <span className="section-kicker">{previewDoc.kind.toUpperCase()}</span>
              <h2 id="doc-preview-title">{previewDoc.name}</h2>
            </div>
            <button className="icon-button" aria-label="Cerrar vista previa" onClick={() => docDialog.current?.close()} autoFocus><X size={20}/></button>
          </header>
          <div className="doc-dialog-content">
            {previewDoc.sections.map((sec, idx) => (
              <section key={idx} className="doc-section">
                <h3>{sec.label}</h3>
                {sec.rows?.length ? (
                  <div className="doc-table-wrap">
                    <table className="doc-table">
                      <thead>
                        <tr>{Object.keys(sec.rows[0]).map(col => <th key={col}>{col}</th>)}</tr>
                      </thead>
                      <tbody>
                        {sec.rows.map((row, rIdx) => (
                          <tr key={rIdx}>{Object.keys(sec.rows![0]).map(col => <td key={col}>{row[col] ?? ''}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <pre className="doc-pre">{sec.text}</pre>
                )}
              </section>
            ))}
          </div>
        </div>
      )}
    </dialog>

    <main className="workspace">
      <aside className={`library panel ${busy ? 'editing-disabled' : ''}`} aria-disabled={busy}>
        <div className="sidebar-heading"><div><span className="section-kicker">CREA TU FLUJO</span><h2>Biblioteca de nodos</h2></div><span className="count">7</span></div>
        <p className="muted">Arrastra o haz clic para añadir nodos a tu flujo.</p>
        <div className="library-list">{kinds.map(k => <button key={k.type} className="library-item" onClick={() => addNode(k.type)}><span className={`node-icon ${k.color}`}>{k.icon}</span><span><strong>{k.label}</strong><small>{k.description}</small></span><Plus className="add-icon" size={17}/></button>)}</div>
        <div className="library-tip"><span>✦</span><div><strong>Personaliza y guarda</strong><p>Conecta tus nodos, configura cada paso y pulsa Guardar para conservar tu flujo.</p></div></div>
      </aside>

      <section className="center">
        <div className="canvas-toolbar">
          <div>
            <div className="breadcrumb">Mi espacio de trabajo <span>/</span> <strong>Editor de flujos</strong></div>
            <input aria-label="Nombre del flujo" className="workflow-name" disabled={busy} value={displayLabel(name)} onChange={e=>setName(e.target.value)} />
          </div>
          <div className="toolbar-actions">
            <label className="select-wrap"><span className="sr-only">Elegir una plantilla</span><select disabled={busy} value="" onChange={e=>{const f=templates.find(t=>t.id===e.target.value); if(f) load(f,false);}}><option value="">Plantillas</option>{templates.map(t=><option key={t.id} value={t.id}>{displayLabel(t.name)}</option>)}</select><ChevronDown size={15}/></label>
            <label className="select-wrap"><span className="sr-only">Abrir flujo guardado</span><select disabled={busy} value="" onChange={e=>{const f=flows.find(t=>t.id===e.target.value); if(f) load(f,true);}}><option value="">Guardados ({flows.length})</option>{flows.map(f=><option key={f.id} value={f.id}>{displayLabel(f.name)}</option>)}</select><ChevronDown size={15}/></label>
            <button className="button secondary" onClick={save} disabled={busy || !nodes.length}><Save size={16}/> Guardar</button>
            <button className="button primary" onClick={()=>execute()} disabled={busy || !nodes.length || !message.trim()}><Play size={15} fill="currentColor"/> {running ? 'Ejecutando…' : 'Probar'}</button>
          </div>
        </div>

        <div className="canvas-wrap" ref={canvasRef}>
          <div className="canvas-caption"><span className="live-dot"/> Tu lienzo <span className="caption-detail">· Arrastra para mover y conecta los puntos</span></div>
          <ReactFlow ariaLabelConfig={ariaLabels} nodes={displayed} edges={edges.map(edge => ({...edge, animated: running, ariaLabel: `Conexión de ${displayLabel(nodes.find(n => n.id === edge.source)?.data.label || edge.source)} a ${displayLabel(nodes.find(n => n.id === edge.target)?.data.label || edge.target)}`})) as Edge[]} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={(_,n)=>setSelected(n.id)} onPaneClick={()=>setSelected('')} nodesDraggable={!busy} nodesConnectable={!busy} elementsSelectable={!busy} deleteKeyCode={busy ? null : ['Backspace','Delete']} minZoom={0.2}><FitCanvas version={fitVersion} container={canvasRef}/><Background gap={24} size={1.3} color="#cbd4e2"/><Controls showInteractive={false}/></ReactFlow>
          <div className="canvas-footer"><span><span className="live-dot"/> {nodes.length} nodos</span><span>{edges.length} conexiones</span></div>
        </div>

        <div className="test-panel panel">
          <div className="test-heading">
            <div>
              <span className="test-symbol">{tab === 'chat' ? <MessageCircle size={17}/> : tab === 'records' ? <Database size={17}/> : tab === 'notifications' ? <Bell size={17}/> : <Zap size={17}/>}</span>
              <div>
                <h2>{tab === 'chat' ? 'Simulador de chat (WhatsApp)' : tab === 'records' ? 'Registros guardados' : tab === 'notifications' ? 'Notificaciones y reportes del dueño' : 'Detalle técnico del flujo'}</h2>
                <p>{tab === 'chat' ? 'Habla con el bot conectado a tus nodos y documentos.' : tab === 'notifications' ? 'Cotizaciones y gastos confirmados listos para exportar a Excel o PDF.' : 'Inspecciona el estado paso a paso o revisa los registros.'}</p>
              </div>
            </div>
            <div className="tabs">
              <button className={tab==='chat'?'active':''} onClick={()=>setTab('chat')}>Chat WhatsApp</button>
              <button className={tab==='notifications'?'active':''} onClick={()=>setTab('notifications')}>Notificaciones{notifications.length ? ` (${notifications.length})` : ''}</button>
              <button className={tab==='records'?'active':''} onClick={()=>{setTab('records'); refreshRecords().catch(e=>setError(e.message));}}>Registros</button>
              <button className={tab==='test'?'active':''} onClick={()=>setTab('test')}>Detalle</button>
            </div>
          </div>

          {tab === 'chat' ? (
            <div className="wa-shell">
              <div className="wa-topbar">
                <div className="wa-avatar">✦</div>
                <div className="wa-peer">
                  <strong>{displayLabel(name)} · Bot</strong>
                  <small>{running ? 'escribiendo…' : run?.used_llm ? `en línea · OpenRouter (${run.llm_model})` : 'en línea · conectado al flujo'}</small>
                </div>
                <div className="wa-chips">
                  {quickPrompts.map(q => (
                    <button key={q} className="wa-chip" disabled={busy || !nodes.length} onClick={() => execute(false, q)}>{q}</button>
                  ))}
                </div>
                {chatHistory.length > 0 && (
                  <button className="wa-clear" onClick={() => setChatHistory([])} title="Limpiar chat">Limpiar</button>
                )}
              </div>

              <div className="wa-messages" ref={chatScrollRef}>
                {!chatHistory.length ? (
                  <div className="wa-empty">
                    <MessageCircle size={22}/>
                    <p>Envía un mensaje o haz clic en una sugerencia para conversar con el bot usando tus nodos conectados.</p>
                  </div>
                ) : (
                  chatHistory.map(item => (
                    <div key={item.id} className={`wa-row ${item.sender}`}>
                      <div className={`wa-bubble ${item.sender} ${item.isError ? 'is-error' : ''}`}>
                        <p>{item.text}</p>
                        {item.run?.preview && item.run.status !== 'error' && (
                          <div className="wa-card">
                            {Object.entries(item.run.preview).map(([k, v]) => (
                              <div key={k}><span>{displayField(k)}</span><b>{k === 'category' ? displayCategory(String(v)) : String(v)}</b></div>
                            ))}
                            {item.run.status === 'awaiting_confirmation' && run?.run_id === item.run.run_id && (
                              <button className="button primary wa-confirm" disabled={busy} onClick={() => execute(true)}>Confirmar registro</button>
                            )}
                          </div>
                        )}
                        {item.run?.report && (
                          <div className="wa-card">
                            <div><span>Registros</span><b>{item.run.report.count}</b></div>
                            <div><span>Total</span><b>${item.run.report.total}</b></div>
                            {item.run.report.groups.map(g => (
                              <div key={g.category}><span>{displayCategory(g.category)} ({g.count})</span><b>${g.total}</b></div>
                            ))}
                          </div>
                        )}
                        {item.sender === 'bot' && item.run && !item.isError && (
                          <div className="wa-badges">
                            {item.run.used_llm && <span className="wa-llm-badge"><Sparkles size={10}/> OpenRouter</span>}
                            {item.run.export_file && (
                              <button
                                type="button"
                                className="wa-doc-btn"
                                onClick={() => {
                                  const ef = item.run!.export_file!;
                                  if (ef.format === 'xlsx') {
                                    exportRowsToExcel(ef.rows, ef.filename, 'Datos');
                                  } else {
                                    exportPrintPdf(
                                      ef.title || name,
                                      `Generado a las ${item.time} desde ${name}`,
                                      [{ label: 'Flujo', value: name }, { label: 'Archivo', value: `${ef.filename}.pdf` }],
                                      ef.summary || item.text,
                                    );
                                  }
                                }}
                              >
                                <Download size={11}/> {item.run.export_file.format === 'xlsx' ? `Descargar Excel (${item.run.export_file.filename}.xlsx)` : `Descargar PDF (${item.run.export_file.filename}.pdf)`}
                              </button>
                            )}
                            {!!item.run.sources?.length && (
                              <span className="wa-sources">
                                Fuentes: {item.run.sources.map(s => `${displayLabel(s.name)}${s.page ? ` (pág. ${s.page})` : s.sheet ? ` (${s.sheet})` : ''}`).join(' · ')}
                              </span>
                            )}
                          </div>
                        )}
                        <span className="wa-meta">{item.time}{item.sender === 'user' ? ' ✓✓' : ''}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <form className="wa-composer" onSubmit={e => { e.preventDefault(); execute(); }}>
                <input
                  aria-label="Mensaje de chat"
                  disabled={busy || !nodes.length}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Escribe un mensaje como en WhatsApp…"
                />
                <button type="submit" className="button primary" disabled={busy || !nodes.length || !message.trim()}>
                  <Send size={14}/> Enviar
                </button>
              </form>
            </div>
          ) : tab === 'test' ? (
            <div className="test-content">
              <div className="message-input">
                <label htmlFor="message">Tu mensaje</label>
                <textarea id="message" disabled={busy} value={message} onChange={e=>{setMessage(e.target.value); setRun(null);}} placeholder="Escribe un mensaje para probar tu flujo…" rows={2}/>
                <button className="button primary" onClick={()=>execute()} disabled={busy || !nodes.length || !message.trim()}><Play size={14} fill="currentColor"/> {running ? 'Ejecutando…' : 'Ejecutar prueba'}</button>
              </div>
              <div className="result">
                {run ? (
                  <>
                    <div className="result-title">
                      <span className={`result-badge ${runPresentation(run.status).tone}`}>{run.status === 'completed' ? <Check size={14}/> : run.status === 'error' ? <X size={14}/> : '!'}</span>
                      <strong>{displayStatus(run.status)}</strong>
                      <span>{run.used_llm ? `OpenRouter (${run.llm_model})` : run.mode === 'showcase' ? 'Motor local' : run.mode === 'demo' ? 'Demostración local' : 'IA en vivo'}</span>
                    </div>
                    {run.reply && <p>{run.reply}</p>}
                    {run.preview && run.status !== 'error' && (
                      <div className="preview">
                        <strong>{runPresentation(run.status).confirm ? 'Revisar antes de guardar' : 'Registro completado'}</strong>
                        {Object.entries(run.preview).map(([k,v])=><div key={k}><span>{displayField(k)}</span><b>{k === 'category' ? displayCategory(String(v)) : String(v)}</b></div>)}
                        {runPresentation(run.status).confirm && <button className="button primary" disabled={busy} onClick={()=>execute(true)}>Confirmar registro</button>}
                      </div>
                    )}
                    {run.report && (
                      <div className="preview">
                        <strong>{displayLabel(String(nodes.find(n=>n.type==='report')?.data.config.title || 'Informe'))} · {run.report.count} registros</strong>
                        <div><span>Total</span><b>{run.report.total}</b></div>
                        {run.report.groups.map(g=><div key={g.category}><span>{displayCategory(g.category)} ({g.count})</span><b>{g.total}</b></div>)}
                      </div>
                    )}
                    {!!run.sources?.length && <p className="sources">Fuentes: {run.sources.map(s=>`${displayLabel(s.name)}${s.page ? `, página ${s.page}` : s.sheet ? `, hoja ${s.sheet}` : ''}`).join(' · ')}</p>}
                    {run.steps.map(s=><details key={s.node_id}><summary>{displayLabel(nodes.find(n=>n.id===s.node_id)?.data.label || s.node_id)} · {displayStatus(s.status)}</summary><pre>{typeof s.output === 'string' ? s.output : JSON.stringify(displayOutput(s.output),null,2)}</pre></details>)}
                  </>
                ) : (
                  <div className="empty-result"><span>✦</span><div><strong>Todo listo</strong><p>Ejecuta una prueba para ver el resultado aquí.</p></div></div>
                )}
              </div>
            </div>
          ) : tab === 'notifications' ? (
            <div className="records">
              <div className="export-bar">
                <button
                  className="button secondary"
                  disabled={!notifications.length}
                  onClick={() => exportRowsToExcel(
                    notifications.map(n => ({ Hora: n.time, Tipo: n.kind, Flujo: n.flowName, Detalle: n.summary, 'Cliente/Categoría': n.customerOrCategory, Monto: n.amount })),
                    'notificaciones_nodaly.xlsx',
                    'Notificaciones',
                  )}
                >
                  <Download size={14}/> Exportar Excel (.xlsx)
                </button>
                <button
                  className="button secondary"
                  disabled={!notifications.length}
                  onClick={() => exportPrintPdf(
                    'Reporte de Notificaciones — Nodaly',
                    `Total de eventos: ${notifications.length}`,
                    [{ label: 'Fecha', value: new Date().toLocaleDateString() }],
                    notifications.map(n => `[${n.time}] ${n.kind} (${n.amount}) — ${n.customerOrCategory}\n${n.summary}`).join('\n\n---\n\n'),
                  )}
                >
                  <FileText size={14}/> Exportar PDF
                </button>
                {notifications.length > 0 && (
                  <button
                    className="button secondary"
                    onClick={() => { setNotifications([]); try { window.localStorage.removeItem(NOTIFICATIONS_KEY); } catch { /* ignore */ } }}
                  >
                    Limpiar
                  </button>
                )}
              </div>
              {notifications.length ? (
                <table>
                  <thead><tr><th>Hora</th><th>Tipo</th><th>Detalle</th><th>Monto</th><th>Copia</th></tr></thead>
                  <tbody>
                    {notifications.map(n => (
                      <tr key={n.id}>
                        <td>{n.time}</td>
                        <td><strong>{n.kind}</strong><br/><small>{n.customerOrCategory}</small></td>
                        <td>{n.summary}</td>
                        <td><b>{n.amount}</b></td>
                        <td>
                          <button
                            className="wa-doc-btn"
                            onClick={() => exportPrintPdf(
                              `${n.kind} — ${n.flowName}`,
                              `Registrado a las ${n.time}`,
                              [{ label: 'Cliente / Categoría', value: n.customerOrCategory }, { label: 'Monto', value: n.amount }],
                              n.summary,
                            )}
                          >
                            <Download size={11}/> PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>Aún no hay notificaciones. Genera una cotización en Mesa de Dulces o confirma un gasto de obra para verlos aquí.</p>
              )}
            </div>
          ) : (
            <div className="records">
              {(() => {
                const colsList = [...new Set(['expenses', ...records.map(r => r.collection || 'expenses'), ...nodes.filter(n => n.type === 'register' || n.type === 'query').map(n => String(n.data.config?.collection || 'expenses')).filter(c => c && c !== 'all')])];
                const filteredRecords = recordsFilter === 'all'
                  ? records
                  : records.filter(r => (r.collection || 'expenses').toLowerCase() === recordsFilter.toLowerCase());
                const dynamicKeys = [...new Set(filteredRecords.flatMap(r => r.data ? Object.keys(r.data) : ['concept', 'category', 'amount']))];
                const exportable = filteredRecords.map((r): Record<string, string | number> => {
                  if (r.data) {
                    const row: Record<string, string | number> = { Tabla: r.collection || 'registro', Fecha: r.date };
                    for (const [k, v] of Object.entries(r.data)) row[k] = String(v ?? '');
                    return row;
                  }
                  return { Tabla: r.collection || 'expenses', Fecha: r.date, Concepto: r.concept, Categoría: displayCategory(r.category), Importe: Number(r.amount) };
                });
                return <>
                  <div className="export-bar">
                    <select aria-label="Filtrar tabla" value={recordsFilter} onChange={e => setRecordsFilter(e.target.value)} style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid #dce3ec', fontSize: '12px' }}>
                      <option value="all">Todas las tablas ({records.length})</option>
                      {colsList.map(col => <option key={col} value={col}>{col === 'expenses' ? 'Gastos (expenses)' : col}</option>)}
                    </select>
                    <button
                      className="button secondary"
                      disabled={!filteredRecords.length}
                      onClick={() => exportRowsToExcel(exportable, `registros_${recordsFilter}_nodaly.xlsx`, 'Registros')}
                    >
                      <Download size={14}/> Exportar Excel (.xlsx)
                    </button>
                    <button
                      className="button secondary"
                      disabled={!filteredRecords.length}
                      onClick={() => exportPrintPdf(
                        `Registros (${recordsFilter}) — Nodaly`,
                        `${filteredRecords.length} registros guardados`,
                        [{ label: 'Tabla', value: recordsFilter }],
                        filteredRecords.map(r => r.data ? `• [${r.collection || 'registro'}] ${Object.entries(r.data).map(([k, v]) => `${k}: ${String(v ?? '')}`).join(' | ')}` : `• ${r.date} | ${r.concept} (${displayCategory(r.category)}) — $${r.amount}`).join('\n'),
                      )}
                    >
                      <FileText size={14}/> Exportar PDF
                    </button>
                  </div>
                  {filteredRecords.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Tabla</th>
                          <th>Fecha</th>
                          {dynamicKeys.filter(k => k !== 'date' && k !== 'fecha').map(k => <th key={k}>{displayField(k)}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRecords.map(r => (
                          <tr key={r.id}>
                            <td><small>{r.collection || 'expenses'}</small></td>
                            <td>{r.date}</td>
                            {dynamicKeys.filter(k => k !== 'date' && k !== 'fecha').map(k => {
                              const raw = r.data ? r.data[k] : (r as Record<string, unknown>)[k];
                              return <td key={k}>{k === 'category' ? displayCategory(String(raw ?? '')) : String(raw ?? '—')}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p>Aún no hay registros en esta tabla.</p>}
                </>;
              })()}
            </div>
          )}
        </div>
      </section>

      <aside className={`inspector panel ${busy ? 'editing-disabled' : ''}`} aria-disabled={busy}>
        <div className="inspector-head"><div><span className="section-kicker">CONFIGURACIÓN DEL NODO</span><h2>{current ? 'Configurar nodo' : 'Selecciona un nodo'}</h2></div>{current && <button className="icon-button" aria-label="Cerrar configuración del nodo" onClick={()=>setSelected('')}><X size={18}/></button>}</div>
        {current ? <>
          <div className="selected-card"><span className={`node-icon ${meta(current.type).color}`}>{meta(current.type).icon}</span><div><strong>{displayLabel(current.data.label)}</strong><small>{meta(current.type).description}</small></div><span className="selected-dot"/></div>
          <div className="settings">
            <label>Nombre del nodo<input value={displayLabel(current.data.label)} onChange={e=>setNodes(ns=>ns.map(n=>n.id===selected?{...n,data:{...n.data,label:e.target.value}}:n))}/></label>
            <p className="settings-intro">{current.type === 'knowledge' ? 'Sube un PDF, Excel, Markdown (.md) o vincula registros guardados.' : current.type === 'agent' ? 'Elige la tarea, el modelo de OpenRouter y las instrucciones del agente.' : 'Personaliza cómo funciona este paso en tu flujo.'}</p>
            <Settings
              node={current}
              docs={docs}
              records={records}
              nodes={nodes}
              update={updateConfig}
              upload={upload}
              inspectDoc={inspectDoc}
              removeDoc={removeDoc}
              busy={busy}
              tgPolling={tgPolling}
              setTgPolling={setTgPolling}
              tgStatus={tgStatus}
              verifyTelegramBot={verifyTelegramBot}
            />
            <button className="delete-button" onClick={()=>{setNodes(ns=>ns.filter(n=>n.id!==selected));setEdges(es=>es.filter(e=>e.source!==selected&&e.target!==selected));setSelected('');setRun(null);}}><Trash2 size={15}/> Eliminar nodo</button>
          </div>
        </> : <div className="empty-inspector"><span>✧</span><p>Selecciona un nodo en el lienzo para ver su configuración.</p></div>}
        <div className="inspector-foot"><BookOpen size={16}/><span>{showcase ? 'Tus flujos y archivos se guardan automáticamente en este navegador al pulsar Guardar.' : <>Los cambios se guardan al seleccionar <strong>Guardar</strong>.</>}</span></div>
      </aside>
    </main>
    {(error || notice) && <div role="status" className={`toast ${error?'error':''}`}><span>{error || notice}</span><button aria-label="Cerrar mensaje" onClick={()=>{setError('');setNotice('');}}><X size={16}/></button></div>}
  </div>;
}

function Settings({node, docs, records, nodes, update, upload, inspectDoc, removeDoc, busy, tgPolling, setTgPolling, tgStatus, verifyTelegramBot}: {node:FlowNode; docs:Doc[]; records:RecordItem[]; nodes:FlowNode[]; update:(k:string,v:unknown)=>void; upload:(f?:File)=>void; inspectDoc:(id:string)=>void; removeDoc:(id:string)=>void; busy:boolean; tgPolling:boolean; setTgPolling:React.Dispatch<React.SetStateAction<boolean>>; tgStatus:string; verifyTelegramBot:(t:string)=>void}) {
  const c: Config = node.data.config; const value = (k:string) => String(c[k] ?? '');
  const knownCollections = [...new Set(['expenses', ...records.map(r => r.collection || 'expenses'), ...nodes.filter(n => n.type === 'register' || n.type === 'query').map(n => String(n.data.config?.collection || 'expenses')).filter(col => col && col !== 'all')])];

  if (node.type === 'message') {
    const token = value('telegram_token');
    const botUsername = value('telegram_bot_username');
    return <>
      <div className="hint"><strong>Simulador + Telegram</strong><p>Cada mensaje enviado en el chat o recibido desde tu bot de Telegram inicia el flujo aquí.</p></div>
      <label>Token del Bot de Telegram (@BotFather)
        <input type="password" value={token} onChange={e=>update('telegram_token',e.target.value)} placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"/>
      </label>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button type="button" className="button secondary" disabled={busy || !token.trim()} onClick={() => verifyTelegramBot(token)}>Verificar Bot</button>
        <button
          type="button"
          className={`button ${tgPolling ? 'primary' : 'secondary'}`}
          disabled={!token.trim()}
          onClick={() => setTgPolling(p => !p)}
        >
          {tgPolling ? 'Detener escucha Telegram' : 'Escuchar Telegram en vivo'}
        </button>
      </div>
      {(botUsername || tgStatus) && (
        <div className="hint">
          <strong>{tgStatus || `Bot vinculado: @${botUsername}`}</strong>
          <p>{tgPolling ? 'Escuchando mensajes cada 3 s y respondiendo en vivo al bot y al simulador.' : 'Pulsa "Escuchar Telegram en vivo" para recibir mensajes reales de Telegram aquí.'}</p>
        </div>
      )}
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
        <input type="checkbox" checked={c.telegram_auto_confirm !== false} onChange={e => update('telegram_auto_confirm', e.target.checked)}/>
        <span>Confirmar registros automáticamente desde Telegram</span>
      </label>
    </>;
  }

  if (node.type === 'knowledge') {
    const ids = (c.document_ids as string[]) || [];
    return <>
      <label>Texto adicional<textarea rows={3} value={value('text')} onChange={e=>update('text',e.target.value)} placeholder="Pega información extra para tu asistente…"/></label>
      <label>Usar tabla de registros como conocimiento
        <select value={value('include_collection')} onChange={e=>update('include_collection',e.target.value)}>
          <option value="">Ninguna tabla</option>
          <option value="all">Todas las tablas guardadas</option>
          {knownCollections.map(col => <option key={col} value={col}>{col === 'expenses' ? 'Gastos (expenses)' : col}</option>)}
        </select>
      </label>
      <div className="label-row"><strong>Documentos (PDF / Excel / CSV / MD / TXT)</strong><span>{ids.length}/3 activos</span></div>
      <p className="field-help">Sube tu menú en PDF, inventario en Excel o documentación en Markdown (.md). Haz clic en el ojo para ver lo que se extrajo.</p>
      <label className="upload"><Upload size={17}/> Cargar PDF, Excel, MD o TXT<input type="file" accept=".pdf,.txt,.md,.markdown,.xlsx,.xls,.csv,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" disabled={busy} onChange={e=>{upload(e.target.files?.[0]);e.target.value='';}}/></label>
      <div className="documents">
        {docs.map(d=>(
          <div className="document" key={d.id}>
            <input aria-label={`Usar ${d.name}`} type="checkbox" checked={ids.includes(d.id)} disabled={!ids.includes(d.id)&&ids.length>=3} onChange={e=>update('document_ids',e.target.checked?[...ids,d.id]:ids.filter(id=>id!==d.id))}/>
            <FileText size={16}/>
            <span title={d.name}>{d.name}<small>{d.text_length.toLocaleString()} caracteres</small></span>
            <button type="button" title="Ver contenido extraído" aria-label={`Ver ${d.name}`} onClick={()=>inspectDoc(d.id)} disabled={busy}><Eye size={15}/></button>
            <button type="button" title="Eliminar documento" aria-label={`Eliminar ${d.name}`} onClick={()=>removeDoc(d.id)} disabled={busy}><Trash2 size={15}/></button>
          </div>
        ))}
        {!docs.length && <p className="field-help">Aún no se han cargado documentos.</p>}
      </div>
    </>;
  }
  if (node.type === 'agent') return <>
    <label>Tarea del agente
      <select value={value('mode')} onChange={e=>update('mode',e.target.value)}>
        <option value="answer">Responder con la base de conocimiento</option>
        <option value="extract">Extraer datos para registro</option>
        <option value="query">Extraer filtros de consulta</option>
      </select>
    </label>
    {(value('mode') === 'answer' || value('mode') === 'extract') && (
      <label>Modelo de OpenRouter
        <select value={value('model') || 'openai/gpt-4o-mini'} onChange={e=>update('model',e.target.value)}>
          <option value="openai/gpt-4o-mini">GPT-4o mini (rápido)</option>
          <option value="google/gemini-2.0-flash-001">Gemini 2.0 Flash</option>
          <option value="anthropic/claude-3.5-haiku">Claude 3.5 Haiku</option>
          <option value="meta-llama/llama-3.3-70b-instruct">Llama 3.3 70B</option>
        </select>
      </label>
    )}
    <label>Instrucciones<textarea rows={4} value={value('instructions')} onChange={e=>update('instructions',e.target.value)} placeholder="Ej. Responde como mesero amable o extrae cliente, producto y monto…"/></label>
    <div className="hint"><strong>OpenRouter + respaldo local</strong><p>Si <code>OPENROUTER_API_KEY</code> está configurada, el agente usa IA tanto para responder como para extraer campos personalizados.</p></div>
  </>;
  if (node.type === 'reply') {
    const regNode = nodes.find(n => n.type === 'register');
    const regFields = String(regNode?.data.config?.fields ?? '').trim();
    const hints = regFields ? regFields.split(/[,;\n]+/).map(s => `{${s.trim()}}`).filter(s => s !== '{}').join(', ') : '{concept}, {amount}, {date}, {output}';
    return <>
      <label>Plantilla de respuesta<textarea rows={5} value={value('template')} onChange={e=>update('template',e.target.value)} placeholder="Deja este campo vacío para usar el resultado anterior."/><span className="field-help">Variables disponibles: {hints}</span></label>
    </>;
  }
  if (node.type === 'register') return <>
    <label>Nombre de la tabla / colección
      <input list="nodaly-collections" value={value('collection') || 'expenses'} onChange={e=>update('collection',e.target.value)} placeholder="expenses, clientes, pedidos, citas…"/>
      <datalist id="nodaly-collections">
        {knownCollections.map(col => <option key={col} value={col}/>)}
        <option value="clientes"/><option value="pedidos"/><option value="inventario"/><option value="citas"/>
      </datalist>
    </label>
    <label>Campos a registrar (separados por coma)
      <input value={value('fields')} onChange={e=>update('fields',e.target.value)} placeholder="Ej. nombre, telefono, producto, monto"/>
      <span className="field-help">Déjalo vacío en la tabla <code>expenses</code> para usar el formato clásico de gastos (fecha, concepto, categoría, importe).</span>
    </label>
  </>;
  if (node.type === 'query') return <>
    <label>Tabla / colección a consultar
      <input list="nodaly-query-collections" value={value('collection') || 'expenses'} onChange={e=>update('collection',e.target.value)} placeholder="expenses, all, clientes…"/>
      <datalist id="nodaly-query-collections">
        <option value="all"/>
        {knownCollections.map(col => <option key={col} value={col}/>)}
      </datalist>
    </label>
    <label>Período<select value={value('period')} onChange={e=>update('period',e.target.value)}><option value="all">Todo el tiempo</option><option value="today">Hoy</option><option value="week">Esta semana</option><option value="month">Este mes</option></select></label>
    <label>Categoría o filtro de búsqueda
      <input list="nodaly-query-cats" value={value('category')} onChange={e=>update('category',e.target.value)} placeholder="Todas (o escribe un término/categoría)"/>
      <datalist id="nodaly-query-cats">
        {['food','transport','supplies','utilities','other'].map(category=><option key={category} value={category}>{displayCategory(category)}</option>)}
      </datalist>
    </label>
    <p className="field-help">Puedes consultar cualquier tabla y conectarla a un Agente IA para usar sus datos como base de conocimiento.</p>
  </>;
  if (node.type === 'export') return <>
    <label>Formato de exportación<select value={value('format') || 'xlsx'} onChange={e=>update('format',e.target.value)}><option value="xlsx">Excel (.xlsx)</option><option value="pdf">Documento PDF</option></select></label>
    <label>Cuándo generar el archivo
      <select value={value('trigger_mode') || 'auto'} onChange={e=>update('trigger_mode',e.target.value)}>
        <option value="auto">Al confirmar cotización o al pedir el corte</option>
        <option value="on_cut">Solo cuando se pida el corte / reporte</option>
        <option value="always">En cada ejecución confirmada</option>
      </select>
    </label>
    <label>Nombre del archivo<input value={value('filename')} onChange={e=>update('filename',e.target.value)} placeholder="reporte-nodaly"/></label>
    <label>Título del documento<input value={value('title')} onChange={e=>update('title',e.target.value)} placeholder="Reporte Nodaly"/></label>
    <div className="hint"><strong>Exportación controlada</strong><p>El archivo se genera solo cuando se confirma el registro/cotización o cuando pides el corte acumulado.</p></div>
  </>;
  return <>
    <label>Título del informe<input value={displayLabel(value('title'))} onChange={e=>update('title',e.target.value)}/></label>
    <label>Campo numérico a sumar<input value={value('amount_field') || 'amount'} onChange={e=>update('amount_field',e.target.value)} placeholder="amount, monto, total…"/></label>
    <label>Agrupar por campo<input list="nodaly-group-by" value={value('group_by') || 'category'} onChange={e=>update('group_by',e.target.value)} placeholder="category, none, vendedor…"/>
      <datalist id="nodaly-group-by"><option value="category"/><option value="none"/></datalist>
    </label>
  </>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><ReactFlowProvider><App/></ReactFlowProvider></React.StrictMode>);
