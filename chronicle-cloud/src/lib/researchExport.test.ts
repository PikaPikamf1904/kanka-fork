import { describe, expect, it } from 'vitest';
import { byTopic, citedNumbers, collectionMarkdown, numberSources, searchCollection, sourceList, UNAVAILABLE, type ResolvedSource } from './researchExport.ts';

const src = (id: string, position: number, page: ResolvedSource['page'], extra: Partial<ResolvedSource> = {}): ResolvedSource => ({
  id, article_id: `a-${id}`, topic: '', annotation: '', excerpt: '', position, page, ...extra,
});

const sources = numberSources([
  src('b', 2, { slug: 'port', title: 'Port Vellmoor', type: 'location' }, { topic: 'Places', excerpt: 'A busy harbour.' }),
  src('a', 1, { slug: 'captain', title: 'Visible Captain', type: 'character' }, { topic: 'People', annotation: 'Seems nervous' }),
  src('c', 3, null, { topic: 'People', excerpt: 'HIDDENEXCERPT' }),
]);

describe('Knowledge Studio helpers', () => {
  it('numbers sources by position and groups them by topic', () => {
    expect(sources.map((s) => [s.id, s.n])).toEqual([['a', 1], ['b', 2], ['c', 3]]);
    expect(byTopic(sources).map((g) => [g.topic, g.sources.map((s) => s.n)])).toEqual([['People', [1, 3]], ['Places', [2]]]);
  });

  it('finds citations, and never names an unavailable source', () => {
    expect(citedNumbers('As [1] says, and [2, 3] agree; not [x].')).toEqual([1, 2, 3]);
    const list = sourceList(sources, 'https://c.example');
    expect(list).toContain('[1] Visible Captain — https://c.example/wiki/captain');
    expect(list).toContain(`[3] ${UNAVAILABLE}`);
  });

  it('exports readable Markdown with provenance and without unavailable excerpts', () => {
    const md = collectionMarkdown({ title: 'Who funds the cult?', description: 'Leads so far.' }, sources,
      [{ id: 's', title: 'Summary', body: 'The captain is involved [1].', version: 1, updated_at: '' }], 'https://c.example', '17 November 2026');
    expect(md).toMatch(/^# Who funds the cult\?/);
    expect(md).toContain('### Summary');
    expect(md).toContain('> A busy harbour.');
    expect(md).toContain('Note: Seems nervous');
    expect(md).not.toContain('HIDDENEXCERPT');
  });

  it('searches titles, topics, notes and summaries', () => {
    const r = searchCollection(sources, [{ id: 's', title: 'Harbour theory', body: '', version: 1, updated_at: '' }], 'harbour');
    expect(r.sources.map((s) => s.id)).toEqual(['b']);
    expect(r.summaries).toHaveLength(1);
    expect(searchCollection(sources, [], 'hiddenexcerpt').sources).toEqual([]);
  });
});
