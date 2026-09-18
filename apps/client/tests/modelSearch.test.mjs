import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiService } from '../src/services/api.ts';

test('model search encodes provider IDs and forwards cancellation', async t => {
  const controller = new AbortController();
  const models = [{ id: 'vendor/model:free', name: 'Vendor: Model (free)' }];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/ai/models/search?q=vendor%2Fmodel%3Afree');
    assert.equal(options.signal, controller.signal);
    return Response.json({ models });
  });
  assert.deepEqual(await apiService.searchModels('vendor/model:free', controller.signal), models);
});

test('an empty model search remains empty', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ models: [] }));
  assert.deepEqual(await apiService.searchModels('missing-model'), []);
});

test('malformed model catalogs are rejected before rendering', async t => {
  const replies = [null, {}, { models: null }, { models: [{}] },
    { models: [{ id: ' ', name: 'Model' }] }, { models: [{ id: 'valid', name: 42 }] }];
  t.mock.method(globalThis, 'fetch', async () => Response.json(replies.shift()));
  for (let index = 0; index < 6; index++) {
    await assert.rejects(apiService.searchModels('model'), /invalid model catalog/);
  }
});

test('cancelled searches reject without retries', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }));
  const controller = new AbortController();
  const pending = assert.rejects(apiService.searchModels('old query', controller.signal), { name: 'AbortError' });
  controller.abort();
  await pending;
  assert.equal(fetch.mock.callCount(), 1);
});
