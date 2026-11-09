import { describe, it, expect } from 'vitest';
import { updateDimensions } from './model';
describe('canvas measurements', () => {
  it('retains node dimensions from React Flow changes', () => {
    expect(updateDimensions({}, [{ type: 'dimensions', id: 'a', dimensions: { width: 190, height: 60 } }])).toEqual({ a: { width: 190, height: 60 } });
  });
});
