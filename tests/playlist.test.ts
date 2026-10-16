import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaylist, nextStory, similarHeadline } from '../src/utils/playlist.ts';
import type { FeedItem } from '../src/types.ts';

const now = Date.parse('2026-10-16T12:00:00Z');
const story = (id: string, title: string, source = 'BBC', kind: FeedItem['sourceType'] = 'news'): FeedItem => ({
  id, title, source, sourceType: kind, category: kind, timestamp: new Date(now - 3600000).toISOString(), link: `https://example.com/${id}`,
});
test('playlist balances categories, suppresses duplicate headlines and excludes expired news', () => {
  const items = [story('a', 'Central bank announces lower interest rates after inflation falls'),
    story('b', 'Central bank announces lower interest rates after inflation falls', 'NPR'),
    story('c', 'Scientists discover a previously unknown ocean ecosystem', 'NASA', 'science'),
    story('d', 'Alexandria opens new waterfront park for residents', 'ALXnow', 'local'),
    { ...story('old', 'An old report about an election'), timestamp: new Date(now - 9 * 86400000).toISOString() }];
  const playlist = buildPlaylist(items, 48, now);
  assert.equal(playlist.length, 3);
  assert.deepEqual(new Set(playlist.map(x => x.sourceType)), new Set(['news', 'science', 'local']));
  assert.equal(playlist.some(x => x.id === 'old'), false);
  assert.equal(similarHeadline('Senate debates an energy bill amid economic concerns', 'Senate debates a privacy bill amid economic concerns'), false);
});
test('rotation skips already seen stories and rechecks expiry at the slide boundary', () => {
  const items = [story('a', 'First story'), story('b', 'Second story'), story('c', 'Third story')];
  assert.equal(nextStory(items, 'b', new Set(['a', 'b']), now)?.id, 'c');
  assert.equal(nextStory(items, 'a', new Set(['a', 'b', 'c']), now)?.id, 'b');
  assert.equal(nextStory(items, 'a', new Set(), now + 8 * 86400000), null);
});
