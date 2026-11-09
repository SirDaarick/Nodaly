import { describe, expect, it } from 'vitest';
import { createDemo } from './demo';
import type fixture from './demo-templates.json';

describe('browser showcase', () => {
  it('runs all three classroom templates and forgets confirmed records on reload', async () => {
    const api = createDemo();
    const templates = await api('/templates') as typeof fixture;
    expect(templates.map(({ id }: { id: string }) => id)).toEqual(['assistant', 'capture', 'report']);
    const run = (id: string, confirm = false) => {
      const template = templates.find((flow: { id: string }) => flow.id === id);
      return api('/run', { body: JSON.stringify({ ...template, run_id: id, confirm }) });
    };
    expect(await run('assistant')).toMatchObject({ status: 'completed', mode: 'showcase' });
    expect(await run('capture')).toMatchObject({ status: 'awaiting_confirmation' });
    expect(await run('capture', true)).toMatchObject({ status: 'completed' });
    await run('capture', true);
    expect(await run('report')).toMatchObject({ report: { count: 3, total: '48.75' } });
    expect(await createDemo()('/records')).toHaveLength(2);
  });

  it('does not simulate success for a disconnected flow or allow file uploads', async () => {
    const api = createDemo();
    const [template] = await api('/templates') as typeof fixture;
    expect(await api('/run', { body: JSON.stringify({ ...template, edges: [], run_id: 'broken' }) }))
      .toMatchObject({ status: 'error' });
    await expect(api('/documents', { method: 'POST' })).rejects.toThrow();
  });
});
