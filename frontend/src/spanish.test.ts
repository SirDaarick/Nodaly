import { describe, it, expect } from 'vitest';
import { displayLabel, displayStatus, displayCategory, displayOutput } from './model';
describe('Spanish display labels', () => {
  it('translates known labels while preserving custom text', () => {
    expect(displayLabel('Receive message')).toBe('Recibir mensaje');
    expect(displayLabel('My custom node')).toBe('My custom node');
    expect(displayStatus('awaiting_confirmation')).toBe('Pendiente de confirmación');
    expect(displayCategory('food')).toBe('Alimentación');
    expect(displayCategory('custom')).toBe('custom');
    expect(displayOutput({ period: 'week', id: 'abc' })).toEqual({ 'Período': 'Esta semana', Identificador: 'abc' });
    expect(displayOutput({ category: 'food', amount: '12.50', concept: 'My lunch' })).toEqual({ Categoría: 'Alimentación', Importe: '12.50', Concepto: 'My lunch' });
  });
});
