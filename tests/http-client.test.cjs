const assert = require('node:assert/strict');
const test = require('node:test');
const { describeError, isRetryableError, sourceBreaker } = require('../server/data-feeds.cjs');

function connectError(code, message) {
  return Object.assign(new Error(message), { code });
}

test('describes happy-eyeballs AggregateErrors that carry no message', () => {
  const error = Object.assign(
    new AggregateError([
      connectError('ETIMEDOUT', 'connect ETIMEDOUT 104.18.5.165:443'),
      connectError('ENETUNREACH', 'connect ENETUNREACH 2606:4700::6812:5a5:443'),
    ]),
    { code: 'ETIMEDOUT' }
  );

  assert.equal(error.message, '');
  assert.equal(describeError(error), 'ETIMEDOUT (ETIMEDOUT, ENETUNREACH)');
});

test('describes undici failures through their cause', () => {
  const error = Object.assign(new TypeError('fetch failed'), {
    cause: connectError('UND_ERR_CONNECT_TIMEOUT', 'Connect Timeout Error'),
  });

  assert.equal(describeError(error), 'fetch failed: Connect Timeout Error (UND_ERR_CONNECT_TIMEOUT)');
});

test('leaves useful messages alone and never returns an empty string', () => {
  assert.equal(describeError(new Error('HTTP 403: Access Denied')), 'HTTP 403: Access Denied');
  assert.equal(describeError(null), 'unknown error');
  assert.equal(describeError(new Error('')), 'unknown error');
});

test('treats transient connection faults as retryable and upstream rejections as final', () => {
  assert.equal(isRetryableError(connectError('ECONNRESET', 'socket hang up')), true);
  assert.equal(isRetryableError(new Error('Request timeout')), true);
  assert.equal(
    isRetryableError(new AggregateError([connectError('ETIMEDOUT', 'connect ETIMEDOUT')])),
    true
  );
  assert.equal(
    isRetryableError(Object.assign(new TypeError('fetch failed'), {
      cause: connectError('EAI_AGAIN', 'dns lookup failed'),
    })),
    true
  );
  assert.equal(isRetryableError(new Error('HTTP 403: Access Denied')), false);
  assert.equal(isRetryableError(new Error('Too many redirects')), false);
});

test('parks a source only after repeated failures, then backs off further', () => {
  sourceBreaker.reset();
  const { BREAKER_THRESHOLD, BREAKER_BASE_COOLDOWN_MS } = sourceBreaker;

  for (let attempt = 1; attempt < BREAKER_THRESHOLD; attempt += 1) {
    sourceBreaker.recordFailure('Example');
    assert.equal(sourceBreaker.cooldownRemaining('Example'), 0);
  }

  sourceBreaker.recordFailure('Example');
  const first = sourceBreaker.cooldownRemaining('Example');
  assert.ok(first > 0 && first <= BREAKER_BASE_COOLDOWN_MS);

  sourceBreaker.recordFailure('Example');
  assert.ok(sourceBreaker.cooldownRemaining('Example') > first);
});

test('never parks a source past the maximum cooldown', () => {
  sourceBreaker.reset();
  for (let attempt = 0; attempt < 40; attempt += 1) sourceBreaker.recordFailure('Flaky');
  assert.ok(sourceBreaker.cooldownRemaining('Flaky') <= sourceBreaker.BREAKER_MAX_COOLDOWN_MS);
});

test('a single success clears a parked source', () => {
  sourceBreaker.reset();
  for (let attempt = 0; attempt <= sourceBreaker.BREAKER_THRESHOLD; attempt += 1) {
    sourceBreaker.recordFailure('Recovering');
  }
  assert.ok(sourceBreaker.cooldownRemaining('Recovering') > 0);

  sourceBreaker.recordSuccess('Recovering');
  assert.equal(sourceBreaker.cooldownRemaining('Recovering'), 0);
});

test('breaker state is tracked per source', () => {
  sourceBreaker.reset();
  for (let attempt = 0; attempt <= sourceBreaker.BREAKER_THRESHOLD; attempt += 1) {
    sourceBreaker.recordFailure('Broken');
  }
  assert.ok(sourceBreaker.cooldownRemaining('Broken') > 0);
  assert.equal(sourceBreaker.cooldownRemaining('Healthy'), 0);
  sourceBreaker.reset();
});
