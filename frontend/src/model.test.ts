import { describe, it, expect } from 'vitest';
import { defaultConfig } from './model';
import { parseDocumentFile } from './documents';
import { buildExpenseReport, extractCustomRecord, queryExpenseRecords } from './engine';

describe('node configuration', () => {
  it('creates independent knowledge document lists', () => {
    const first = defaultConfig('knowledge');
    (first.document_ids as string[]).push('one');
    expect(defaultConfig('knowledge').document_ids).toEqual([]);
  });
  it('uses contract defaults for query and report', () => {
    expect(defaultConfig('query')).toEqual({ collection: 'expenses', period: 'all', category: '' });
    expect(defaultConfig('report')).toEqual({ amount_field: 'amount', group_by: 'category', title: 'Informe de gastos' });
  });
});

describe('markdown and generic records', () => {
  it('parses markdown files into heading sections', async () => {
    const file = new File(['# Intro\nHola mundo\n\n## Precios\nPlan Pro: $299'], 'guia.md', { type: 'text/markdown' });
    const parsed = await parseDocumentFile(file);
    expect(parsed.kind).toBe('text');
    expect(parsed.sections.length).toBe(2);
    expect(parsed.sections[1].label).toContain('Precios');
  });

  it('extracts, queries, and reports custom collection records', () => {
    const extracted = extractCustomRecord('nombre: Luis, producto: Mesa, monto: 1500', ['nombre', 'producto', 'monto']);
    expect(extracted.nombre).toBe('Luis');
    expect(extracted.monto).toBe('1500');

    const rows = [
      { id: '1', date: extracted.date, concept: 'Luis', category: 'clientes', amount: '1500', collection: 'clientes', data: extracted },
    ];
    const queried = queryExpenseRecords(rows, { collection: 'clientes', period: 'all', category: 'Mesa' }, {});
    expect(queried.length).toBe(1);

    const rep = buildExpenseReport(queried, { amount_field: 'monto', group_by: 'producto', title: 'Ventas' });
    expect(rep.total).toBe('1500.00');
    expect(rep.groups[0].category).toBe('Mesa');
  });
});
