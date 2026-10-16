import test from 'node:test';
import assert from 'node:assert/strict';
import { pollingQuery } from '../src/utils/polling.ts';
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
test('shared polling reuses requests, preserves data on 304 and cancels when unused', async () => {
  const previousFetch = globalThis.fetch;
  let count = 0; let status = 200; let headers: HeadersInit | undefined;
  globalThis.fetch = async (_url, options) => {
    count++; headers = options?.headers;
    return new Response(status === 304 ? null : '{"value":42}', { status, headers: { ETag: '"v1"' } });
  };
  const query = pollingQuery<{ value: number }>('https://example.com/shared', 60000);
  const second = pollingQuery<{ value: number }>('https://example.com/shared', 60000);
  let notifications = 0;
  const stop = query.subscribe(() => notifications++);
  const stopSecond = second.subscribe(() => {});
  try {
    await tick(); assert.equal(count, 1); assert.equal(query.getSnapshot().data?.value, 42);
    const snapshot = query.getSnapshot(); status = 304;
    await query.refresh();
    assert.deepEqual(headers, { 'If-None-Match': '"v1"' });
    assert.equal(query.getSnapshot(), snapshot); assert.equal(notifications, 1);
  } finally { stop(); stopSecond(); await tick(); globalThis.fetch = previousFetch; }
});
test('unsubscribing aborts a pending request and suppresses stale updates', async () => {
  const previousFetch = globalThis.fetch;
  let signal: AbortSignal | undefined;
  globalThis.fetch = async (_url, options) => {
    signal = options?.signal || undefined;
    return await new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal?.reason)));
  };
  const query = pollingQuery('https://example.com/cancelled', 60000);
  let notifications = 0; const stop = query.subscribe(() => notifications++);
  try {
    stop(); await tick(); assert.equal(signal?.aborted, true); assert.equal(notifications, 0);
  } finally { globalThis.fetch = previousFetch; }
});
test('polling bounds simultaneous requests and never starts a cancelled queued request', async () => {
  const previousFetch = globalThis.fetch;
  const complete: Array<() => void> = []; let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return await new Promise<Response>(resolve => complete.push(() => resolve(new Response('[]'))));
  };
  const queries = Array.from({ length: 5 }, (_, index) => pollingQuery(`https://example.com/bounded-${index}`, 60000));
  const stops = queries.map(query => query.subscribe(() => {}));
  try {
    await tick(); assert.equal(calls, 4);
    stops[4](); await tick();
    complete.forEach(done => done()); await tick();
    assert.equal(calls, 4);
  } finally { stops.forEach(stop => stop()); await tick(); globalThis.fetch = previousFetch; }
});
