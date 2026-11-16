import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readExport, reportMarkdown } from './kanka-import.ts';
import { buildPlan, convertMentions, htmlToMarkdown } from './lib.ts';

const fixture = path.resolve(import.meta.dirname, 'fixtures/kanka-export');

describe('htmlToMarkdown', () => {
  it('keeps structure, drops scripts, images and raw HTML', () => {
    const stats = { droppedImages: 0 };
    const md = htmlToMarkdown('<h2>Title</h2><p>A <strong>bold</strong> &amp; <em>fine</em> day.</p><script>alert(1)</script><img src="x"><ul><li>One</li><li>Two</li></ul><a href="javascript:alert(1)">bad</a> <a href="https://example.com">ok</a>', stats);
    expect(md).toContain('### Title');
    expect(md).toContain('A **bold** & *fine* day.');
    expect(md).toContain('- One\n- Two');
    expect(md).not.toMatch(/<|alert|javascript/);
    expect(md).toContain('[ok](https://example.com)');
    expect(stats.droppedImages).toBe(1);
  });

  it('numbers ordered lists and quotes blockquotes', () => {
    expect(htmlToMarkdown('<ol><li>a</li><li>b</li></ol>')).toBe('1. a\n2. b');
    expect(htmlToMarkdown('<blockquote>Mind the docks.</blockquote>')).toBe('> Mind the docks.');
  });
});

describe('convertMentions', () => {
  it('rewrites known mentions to wiki links and reports unknown ones', () => {
    const unknown: number[] = [];
    const out = convertMentions('See [location:2|the port], [note:3] and [character:9].', (id) =>
      ({ 2: { slug: 'port', title: 'Port' }, 3: { slug: 'plan', title: 'The Plan' } } as Record<number, { slug: string; title: string }>)[id], unknown);
    expect(out).toBe('See [[port|the port]], [[plan|The Plan]] and (unknown reference).');
    expect(unknown).toEqual([9]);
  });
});

describe('buildPlan (default: nothing is trusted)', () => {
  const read = readExport(fixture);
  const plan = buildPlan(read.records, { trustPublicEntities: false });

  it('reads the export and reports unreadable files and skipped modules', () => {
    expect(read.files).toBe(8);
    expect(read.unreadable).toEqual(['characters/broken_106.json']);
    expect(plan.report.skippedModules).toEqual({ dice_rolls: 1 });
    expect(read.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('makes everything DM-only when Kanka permissions are unknown', () => {
    expect(plan.articles).toHaveLength(4);
    expect(plan.articles.every((a) => a.visibility === 'dm')).toBe(true);
    expect(plan.articles.flatMap((a) => a.sections).every((s) => s.visibility === 'dm')).toBe(true);
    expect(plan.articles.flatMap((a) => a.infobox).every((f) => f.visibility === 'dm')).toBe(true);
    expect(plan.categories.every((c) => c.visibility === 'dm')).toBe(true);
    expect(plan.relations.every((r) => r.visibility === 'dm')).toBe(true);
    expect(plan.report.wouldBePlayersWithTrust).toBe(3);
  });

  it('gives duplicate names distinct, stable slugs and reports them', () => {
    const merrins = plan.articles.filter((a) => a.title === 'Captain Merrin').map((a) => a.slug);
    expect(merrins).toEqual(['captain-merrin', 'captain-merrin-105']);
    expect(plan.report.duplicateNames).toEqual([{ name: 'characters:captain merrin', ids: [101, 105] }]);
  });

  it('reports unknown mentions, relations to missing entities and dropped images', () => {
    expect(plan.report.unknownMentions).toEqual([999]);
    expect(plan.report.relationsMissingEnd).toBe(1);
    expect(plan.report.droppedInlineImages).toBe(1);
    expect(plan.report.imagesReferenced).toBe(1);
  });

  it('writes a readable report', () => {
    const md = reportMarkdown(plan, { source: fixture, checksum: read.checksum, files: read.files, unreadable: read.unreadable, trust: false });
    expect(md).toContain('everything is DM-only until you review it');
    expect(md).toContain('| 101 | character | Captain Merrin | captain-merrin | dm |');
  });
});

describe('buildPlan with --trust-public-entities', () => {
  const plan = buildPlan(readExport(fixture).records, { trustPublicEntities: true });
  const merrin = plan.articles.find((a) => a.kankaEntityId === 101)!;

  it('still keeps private entries, admin-only posts, private or hidden attributes DM-only', () => {
    expect(plan.articles.find((a) => a.kankaEntityId === 103)!.visibility).toBe('dm');
    expect(merrin.visibility).toBe('players');
    const byHeading = Object.fromEntries(merrin.sections.map((s) => [s.heading, s.visibility]));
    expect(byHeading).toEqual({ Overview: 'players', 'Public rumours': 'players', 'GM: true allegiance': 'dm' });
    const fields = Object.fromEntries(merrin.infobox.map((f) => [f.label, f.visibility]));
    expect(fields).toMatchObject({ Title: 'players', Rank: 'players', 'Bribe price': 'dm', 'Hidden stat': 'dm' });
    expect(plan.categories.find((c) => c.name === 'Villains')!.visibility).toBe('dm');
  });

  it('keeps relations DM-only unless visible to all and both ends are visible', () => {
    const rels = Object.fromEntries(plan.relations.map((r) => [r.label, r.visibility]));
    expect(rels).toEqual({ 'Works in': 'players', Wrote: 'dm', 'Secretly owns': 'dm' });
  });

  it('never puts secret text into a player-visible section or summary', () => {
    for (const a of plan.articles.filter((x) => x.visibility === 'players')) {
      const visible = [a.summary, ...a.sections.filter((s) => s.visibility === 'players').map((s) => s.body), ...a.infobox.filter((f) => f.visibility === 'players').map((f) => f.value)].join('\n');
      expect(visible).not.toMatch(/SECRETPOST|SECRETATTR|SECRETNOTE/);
    }
  });

  it('turns mentions into wiki links, but never names a DM-only page in player text', () => {
    expect(merrin.sections[0]!.body).toContain('[[port-vellmoor|the port]]');
    expect(merrin.sections[0]!.body).not.toMatch(/the-plan|The Plan/);
    expect(merrin.sections[0]!.body).toContain('(unrevealed)');
    expect(plan.report.mentionsRedacted).toBe(1);
  });
});
