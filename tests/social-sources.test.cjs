const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeBlueskyPost,
  normalizeMastodonLink,
} = require('../server/data-feeds.cjs');

const NOW = Date.parse('2026-07-29T16:00:00.000Z');

test('normalizes a current Bluesky Discover post without credentials', () => {
  const result = normalizeBlueskyPost({
    post: {
      uri: 'at://did:plc:example/app.bsky.feed.post/3example',
      author: { handle: 'reporter.example', displayName: 'Reporter' },
      record: {
        text: 'A current social report with useful context',
        createdAt: '2026-07-29T15:00:00.000Z',
        langs: ['en'],
      },
      likeCount: 12,
      repostCount: 4,
      replyCount: 3,
    },
  }, NOW);

  assert.equal(result.source, 'Bluesky Discover');
  assert.equal(result.score, 16);
  assert.equal(result.comments, 3);
  assert.equal(result.url, 'https://bsky.app/profile/reporter.example/post/3example');
});

test('rejects stale and mature-labeled Bluesky posts', () => {
  const base = {
    uri: 'at://did:plc:example/app.bsky.feed.post/3example',
    author: { handle: 'reporter.example' },
    record: {
      text: 'A post',
      createdAt: '2026-07-29T15:00:00.000Z',
    },
  };

  assert.equal(normalizeBlueskyPost({
    post: { ...base, labels: [{ val: 'sexual' }] },
  }, NOW), null);
  assert.equal(normalizeBlueskyPost({
    post: {
      ...base,
      record: { ...base.record, createdAt: '2026-07-01T15:00:00.000Z' },
    },
  }, NOW), null);
});

test('normalizes a current Mastodon trending link from public usage history', () => {
  const result = normalizeMastodonLink({
    url: 'https://example.com/current-story',
    title: 'A story shared across Mastodon',
    description: 'A useful summary.',
    provider_name: 'Example News',
    history: [
      { day: String(Date.parse('2026-07-29T00:00:00.000Z') / 1000), uses: '14', accounts: '11' },
      { day: String(Date.parse('2026-07-28T00:00:00.000Z') / 1000), uses: '6', accounts: '5' },
    ],
  }, NOW);

  assert.equal(result.source, 'Mastodon Trending');
  assert.equal(result.score, 20);
  assert.equal(result.timestamp, '2026-07-29T00:00:00.000Z');
  assert.equal(result.url, 'https://example.com/current-story');
});

test('rejects malformed and inactive Mastodon links', () => {
  assert.equal(normalizeMastodonLink({
    url: 'javascript:alert(1)',
    title: 'Unsafe',
    history: [{ day: String(NOW / 1000), uses: '2', accounts: '2' }],
  }, NOW), null);
  assert.equal(normalizeMastodonLink({
    url: 'https://example.com/unused',
    title: 'Inactive',
    history: [{ day: String(NOW / 1000), uses: '0', accounts: '0' }],
  }, NOW), null);
});
