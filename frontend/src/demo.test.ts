import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createDemo } from './demo';
import { parseSpreadsheetBuffer } from './documents';
import type fixture from './demo-templates.json';

describe('browser showcase', () => {
  it('runs all three templates with real knowledge, extraction, and reporting', async () => {
    const api = createDemo();
    const templates = await api('/templates') as typeof fixture;
    expect(templates.map(({ id }: { id: string }) => id)).toEqual(['assistant', 'capture', 'report']);
    const run = (id: string, confirm = false, message?: string) => {
      const template = templates.find((flow: { id: string }) => flow.id === id)!;
      return api('/run', { body: JSON.stringify({ ...template, ...(message ? { message } : {}), run_id: id, confirm }) });
    };

    const assistantRes = await run('assistant') as { status: string; mode: string; reply: string; sources: { name: string }[] };
    expect(assistantRes).toMatchObject({ status: 'completed', mode: 'showcase' });
    expect(assistantRes.reply).toContain('Taco al pastor');
    expect(assistantRes.sources.length).toBeGreaterThan(0);

    expect(await run('capture')).toMatchObject({ status: 'awaiting_confirmation' });
    expect(await run('capture', true)).toMatchObject({ status: 'completed' });
    expect(await run('report')).toMatchObject({ report: { count: 3, total: '48.75' } });
    expect(await createDemo()('/records')).toHaveLength(2);
  });

  it('parses an Excel spreadsheet, uploads it, and answers inventory questions', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([
      { Producto: 'Café americano', Precio: '$35', Stock: '0', Estado: 'Agotado' },
      { Producto: 'Croissant', Precio: '$40', Stock: '15', Estado: 'Disponible' },
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    const parsed = parseSpreadsheetBuffer(buffer, 'cafeteria.xlsx');
    expect(parsed.kind).toBe('excel');
    expect(parsed.sections[0]?.rows).toHaveLength(2);

    const api = createDemo();
    const uploaded = await api('/documents', { method: 'POST', body: JSON.stringify(parsed) }) as { id: string; name: string };
    expect(uploaded.name).toBe('cafeteria.xlsx');

    const [assistant] = await api('/templates') as typeof fixture;
    const customNodes = assistant.nodes.map((n) =>
      n.type === 'knowledge' ? { ...n, data: { ...n.data, config: { text: '', document_ids: [uploaded.id] } } } : n,
    );
    const res = await api('/run', {
      method: 'POST',
      body: JSON.stringify({
        nodes: customNodes,
        edges: assistant.edges,
        message: '¿Qué productos están agotados?',
        run_id: 'excel-test',
        confirm: false,
      }),
    }) as { status: string; reply: string };

    expect(res.status).toBe('completed');
    expect(res.reply).toContain('Café americano');
  });

  it('does not simulate success for a disconnected flow or empty document upload', async () => {
    const api = createDemo();
    const [template] = await api('/templates') as typeof fixture;
    expect(await api('/run', { body: JSON.stringify({ ...template, edges: [], run_id: 'broken' }) }))
      .toMatchObject({ status: 'error' });
    await expect(api('/documents', { method: 'POST', body: '{}' })).rejects.toThrow();
  });

  it('runs differentiated FEPI workflows with export_file and query-to-agent table lookup', async () => {
    const api = createDemo();
    const workflows = await api('/workflows') as { id: string; nodes: unknown[]; edges: unknown[] }[];
    const evogym = workflows.find((w) => w.id === 'fepi-3-reportes-evogym')!;
    const evoRes = await api('/run', {
      method: 'POST',
      body: JSON.stringify({ ...evogym, message: 'Muestra todos los gastos', run_id: 'evo-1', confirm: false }),
    }) as { status: string; export_file?: { format: string; rows: unknown[] }; reply: string };
    expect(evoRes.status).toBe('completed');
    expect(evoRes.export_file?.format).toBe('xlsx');
    expect(evoRes.export_file?.rows).toHaveLength(2);
    expect(evoRes.reply).toContain('Corte administrativo EvoGym');

    const fernando = workflows.find((w) => w.id === 'fepi-4-soporte-cursos')!;
    const ferRes = await api('/run', {
      method: 'POST',
      body: JSON.stringify({ ...fernando, message: 'Almuerzo ficticio', run_id: 'fer-1', confirm: false }),
    }) as { status: string; reply: string; sources?: { name: string }[] };
    expect(ferRes.status).toBe('completed');
    expect(ferRes.sources?.some((s) => s.name === 'Registros guardados')).toBe(true);
  });

  it('gates quote export behind confirmation and runs expense cuts only on cut request', async () => {
    const api = createDemo();
    const workflows = await api('/workflows') as { id: string; nodes: unknown[]; edges: unknown[] }[];

    const sandra = workflows.find((w) => w.id === 'fepi-1-cotizaciones')!;
    const casual = await api('/run', {
      method: 'POST',
      body: JSON.stringify({ ...sandra, message: 'Hola, ¿qué mesas tienen?', run_id: 'sandra-q', confirm: false }),
    }) as { status: string; preview?: unknown; export_file?: unknown };
    expect(casual.status).toBe('completed');
    expect(casual.preview).toBeUndefined();
    expect(casual.export_file).toBeUndefined();

    const ready = await api('/run', {
      method: 'POST',
      body: JSON.stringify({ ...sandra, message: 'Soy Laura, cotízame 1 mesa clásica', run_id: 'sandra-c', confirm: false }),
    }) as { status: string; preview?: Record<string, string>; export_file?: unknown };
    expect(ready.status).toBe('awaiting_confirmation');
    expect(ready.preview?.cliente).toBe('Laura');
    expect(ready.export_file).toBeUndefined();

    const confirmed = await api('/run', {
      method: 'POST',
      body: JSON.stringify({ ...sandra, message: 'Soy Laura, cotízame 1 mesa clásica', run_id: 'sandra-c', confirm: true }),
    }) as { status: string; export_file?: { format: string } };
    expect(confirmed.status).toBe('completed');
    expect(confirmed.export_file?.format).toBe('pdf');

    const julio = workflows.find((w) => w.id === 'fepi-2-gastos-obra')!;
    await api('/run', {
      method: 'POST',
      body: JSON.stringify({ ...julio, message: 'Hoy gasté 850 en soldadura', run_id: 'julio-1', confirm: false }),
    });
    const saved = await api('/run', {
      method: 'POST',
      body: JSON.stringify({ ...julio, message: 'Hoy gasté 850 en soldadura', run_id: 'julio-1', confirm: true }),
    }) as { status: string; export_file?: unknown };
    expect(saved.status).toBe('completed');
    expect(saved.export_file).toBeUndefined();

    const cut = await api('/run', {
      method: 'POST',
      body: JSON.stringify({ ...julio, message: 'Hazme el corte de todos los gastos', run_id: 'julio-cut', confirm: false }),
    }) as { status: string; export_file?: { format: string }; report?: { count: number } };
    expect(cut.status).toBe('completed');
    expect(cut.export_file?.format).toBe('xlsx');
    expect(cut.report?.count).toBeGreaterThanOrEqual(3);
  });
});
