import { describe, it, expect } from 'vitest';
import { runPresentation } from './model';
describe('run presentation', () => {
  it('only offers confirmation while the server awaits it', () => {
    expect(runPresentation('awaiting_confirmation').confirm).toBe(true);
    expect(runPresentation('completed').confirm).toBe(false);
  });
  it('does not present an error as success', () => {
    expect(runPresentation('error').tone).toBe('error');
    expect(runPresentation('completed').tone).toBe('success');
  });
});
