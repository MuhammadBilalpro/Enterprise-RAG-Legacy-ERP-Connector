import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion } from '../src/answer.js';
test('generation is optional, grounded in supplied evidence and falls back on errors', async () => {
  const results = [{ title: 'Allowed invoice', text: 'Acme overdue' }];
  assert.equal((await answerQuestion('Acme', results, { baseUrl: '', model: '' })).mode, 'local-extractive');
  let called = false;
  const request = async (url, options) => {
    called = true; assert.equal(url, 'http://local-model/api/chat');
    const payload = JSON.parse(options.body);
    assert.equal(payload.stream, false); assert.equal(payload.tools, undefined);
    assert.deepEqual(JSON.parse(payload.messages[1].content).evidence, [{ citation: 1, title: 'Allowed invoice', text: 'Acme overdue' }]);
    return { ok: true, json: async () => ({ message: { content: 'Acme is overdue [1].' } }) };
  };
  assert.equal((await answerQuestion('Acme', results, { baseUrl: 'http://local-model', model: 'test-model', request })).mode, 'ollama-rag');
  assert.ok(called);
  const fallback = await answerQuestion('Acme', results, { baseUrl: 'http://local-model', model: 'test-model', request: async () => { throw new Error('offline'); } });
  assert.equal(fallback.mode, 'local-extractive'); assert.ok(fallback.warning);
  called = false;
  await answerQuestion('secret', [], { baseUrl: 'http://local-model', model: 'test-model', request });
  assert.equal(called, false);
});
