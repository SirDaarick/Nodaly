import { describe, it, expect } from 'vitest';
import { defaultConfig } from './model';
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
