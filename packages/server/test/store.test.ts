import { describe, expect, it } from 'vitest';
import { DerbyStore } from '../src/store.js';
import type { Derby } from '@derby/core';

describe('DerbyStore', () => {
  it('saves, lists and restores history', () => {
    const store = new DerbyStore(':memory:');
    const state = { id: 'd1', name: 'One', date: '2027-01-01' } as Derby;
    store.save(state, 'create');
    store.save({ ...state, name: 'Two' }, 'rename');
    expect(store.listDerbies()[0]).toMatchObject({ id: 'd1', name: 'Two' });
    expect(store.load('d1')?.name).toBe('Two');
    const history = store.history('d1');
    expect(history.map((h) => h.change)).toEqual(['rename', 'create']);
    expect(store.loadHistory(history[1]!.id)?.name).toBe('One');
    store.setMeta('k', 'v');
    expect(store.getMeta('k')).toBe('v');
    store.close();
  });
});
