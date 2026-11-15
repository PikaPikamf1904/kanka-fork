// Lore import: parsing, classification, matching against the wiki and change-set building.
// Synthetic campaign material only.
import { describe, expect, it } from 'vitest';
import { analyzeImport, buildChunks, emptyDecisions, importReport, markdownEntries, parseImportFiles, type WikiIndex } from './loreImport.ts';

const wiki: WikiIndex = {
  articles: [
    { id: 'id-port', slug: 'port-synthetic', title: 'Port Synthetic', type: 'location', version: 4, visibility: 'players', status: 'published' },
    { id: 'id-mira', slug: 'mira-vale', title: 'Mira Vale', type: 'character', version: 2, visibility: 'dm', status: 'draft' },
  ],
  fields: [{ article_id: 'id-mira', label: 'Race', value: 'Human' }, { article_id: 'id-mira', label: 'Class', value: 'Fighter' }],
  redirects: [{ from_slug: 'old-port', article_id: 'id-port' }],
  categories: [{ id: 'c1', slug: 'harbour-folk', name: 'Harbour folk' }],
};

const md = (name: string, text: string) => ({ name, text });

describe('reading files', () => {
  it('reads one entry per file with front matter, facts, notes and a summary', () => {
    const s = parseImportFiles([md('notes/mira.md', `---
title: Mira Vale
type: npc
canon: confirmed
tags: [Harbour folk, Smugglers]
aliases:
  - The Grey Captain
---
Captain of the *Gull*, seen at [[Port Synthetic]].

## Facts
- Race: Elf
- **Level:** 5

## History
Sailed north. Met [[Tomas Reed]].

## DM notes
Secretly a smuggler.
`)]);
    expect(s.errors).toEqual([]);
    const m = s.items[0]!;
    expect(m).toMatchObject({ slug: 'mira-vale', title: 'Mira Vale', type: 'character', typeConfidence: 'high', canon: 'confirmed', summary: 'Captain of the *Gull*, seen at [[Port Synthetic]].' });
    expect(m.infobox).toEqual([{ label: 'Race', value: 'Elf' }, { label: 'Level', value: '5' }]);
    expect(m.sections.map((x) => x.heading)).toEqual(['History']);
    expect(m.notes).toEqual([{ title: 'DM notes', body: 'Secretly a smuggler.' }]);
    expect(m.aliases).toEqual(['The Grey Captain']);
    expect(m.tags).toEqual(['Harbour folk', 'Smugglers']);
  });

  it('splits a file without front matter at each top-level heading and guesses types, saying so', () => {
    const s = parseImportFiles([md('world.md', `# The Order of the Lantern
A synthetic order of watchers.

# Session 3: The Bridge
The party crossed the bridge.

# Something Odd
No clue what this is.
`)]);
    expect(s.items.map((i) => [i.title, i.type, i.typeConfidence])).toEqual([
      ['The Order of the Lantern', 'faction', 'medium'],
      ['Session 3: The Bridge', 'session', 'medium'],
      ['Something Odd', 'lore', 'low'],
    ]);
    expect(s.items.every((i) => i.canon === 'uncertain')).toBe(true); // unconfirmed unless the file says otherwise
  });

  it('reads JSON lore packages with their stated connections', () => {
    const s = parseImportFiles([md('pack.json', JSON.stringify({
      articles: [
        { ref: 'a', slug: 'tomas-reed', title: 'Tomas Reed', type: 'character', sections: [{ heading: 'Notes', body: 'A synthetic sailor.' }] },
        { ref: 'b', slug: 'the-gull', title: 'The Gull', type: 'item', sections: [{ heading: 'Notes', body: 'A ship.' }], canon: 'rumor' },
      ],
      relations: [{ source: 'a', target: 'b', kind: 'owns', label: 'Captain' }, { source: 'a', target: 'zzz', kind: 'owns' }],
    }))]);
    expect(s.items.map((i) => i.slug)).toEqual(['tomas-reed', 'the-gull']);
    expect(s.items[1]!.canon).toBe('rumor');
    expect(s.relations).toEqual([{ source: 'tomas-reed', target: 'the-gull', kind: 'owns', label: 'Captain' }]);
    expect(s.warnings.length).toBe(1);
  });

  it('refuses bad input entry by entry and keeps the rest', () => {
    const s = parseImportFiles([
      md('a.md', '# Fine Page\nSome text.'),
      md('b.md', '# Fine Page\nThe same page again.'),
      md('c.json', '{not json'),
      md('d.pdf', 'x'),
      md('e.md', '# Control\u0007 text\nbad'),
    ]);
    expect(s.items.map((i) => i.slug)).toEqual(['fine-page']);
    expect(s.errors.map((e) => e.name)).toEqual(expect.arrayContaining(['c.json', 'd.pdf']));
    expect(s.errors.some((e) => /same page address/.test(e.message))).toBe(true);
    expect(s.errors.some((e) => /control characters/.test(e.message))).toBe(true);
  });

  it('enforces size limits before doing any work', () => {
    const big = 'x'.repeat(1_000_001);
    expect(parseImportFiles([md('big.md', big)]).errors[0]!.message).toMatch(/larger than 1 MB/);
    expect(parseImportFiles(Array.from({ length: 201 }, (_, i) => md(`${i}.md`, '# A\nb'))).errors[0]!.message).toMatch(/limit is 200/);
  });

  it('a heading-less note keeps its file name as the title', () => {
    expect(markdownEntries('lore/the-quiet-war.md', 'Long ago there was a war.').entries[0]!.raw.title).toBe('the quiet war');
  });
});

describe('comparing with the wiki', () => {
  const staged = parseImportFiles([
    md('a.md', `---\ntitle: Mira Vale\ntype: character\n---\nCaptain.\n\n## Facts\n- Race: Elf\n- Class: Fighter\n- Ship: The Gull\n\n## History\nSee [[Port Synthetic]] and [[Nowhere Town]] and [[Tomas Reed]].`),
    md('b.md', `---\ntitle: Tomas Reed\ntype: character\ntags: [harbour folk, Unknown Tag]\n---\nA sailor.`),
    md('c.md', `---\ntitle: Old Port\nslug: old-port\n---\nThe old name of the port.`),
    md('d.md', `---\ntitle: The Grey Captain\naliases: [Mira Vale]\n---\nA nickname.`),
  ]);
  const a = analyzeImport(staged, wiki);
  const by = (slug: string) => a.items.find((i) => i.slug === slug)!;

  it('matches existing pages by address, redirect, title or alias, and proposes additions only', () => {
    expect(by('mira-vale')).toMatchObject({ action: 'add_to_existing', default_decision: 'review', match: { slug: 'mira-vale', why: 'A page already has this address.' } });
    expect(by('old-port')).toMatchObject({ action: 'add_to_existing', match: { slug: 'port-synthetic', player_visible: true } });
    expect(by('the-grey-captain').match?.slug).toBe('mira-vale');
    expect(by('tomas-reed')).toMatchObject({ action: 'create', default_decision: 'approve' });
  });

  it('reports conflicting facts and never proposes to replace them', () => {
    expect(by('mira-vale').conflicts).toEqual([{ label: 'Race', existing: 'Human', imported: 'Elf' }]);
    expect(by('mira-vale').same_fields).toEqual(['Class']);
    expect(by('mira-vale').new_fields).toEqual([{ label: 'Ship', value: 'The Gull' }]);
  });

  it('sorts links and categories into existing, in this import, and missing', () => {
    expect(by('mira-vale').links).toEqual({ to_import: ['tomas-reed'], to_wiki: ['port-synthetic'], missing: ['nowhere-town'] });
    expect(by('tomas-reed').categories).toEqual({ existing: ['harbour-folk'], missing: ['Unknown Tag'] });
    expect(a.relations.map((r) => [r.source, r.target, r.basis, r.default_decision])).toEqual([
      ['mira-vale', 'tomas-reed', 'link', 'review'], ['mira-vale', 'port-synthetic', 'link', 'review'],
    ]);
  });

  it('counts what would happen', () => {
    expect(a.totals).toMatchObject({ entries: 4, create: 1, add_to_existing: 3, conflicts: 1, suggested_relations: 2, dm_only: 4 });
  });

  it('builds change sets: approved new pages by default; existing pages only when chosen', () => {
    const def = buildChunks(staged, a, emptyDecisions(), 'b1b1b1b1-0000-4000-8000-000000000000', 'Synthetic', wiki);
    expect(def).toHaveLength(1);
    expect(def[0]!.slugs).toEqual(['tomas-reed']);
    expect(def[0]!.changeSet.changes.map((c) => c.operation)).toEqual(['create_article', 'upsert_section', 'add_category_link']);

    const d = emptyDecisions();
    d.items['mira-vale'] = 'approve';
    d.relations['mira-vale>related_to>tomas-reed'] = 'approve';
    const chunks = buildChunks(staged, a, d, 'b1b1b1b1-0000-4000-8000-000000000000', 'Synthetic', wiki);
    const add = chunks.find((c) => c.slugs.includes('mira-vale'))!;
    expect(add.changeSet.expected_versions).toEqual({ 'mira-vale': 'v2' });
    const ops = add.changeSet.changes;
    // No field is overwritten: only the new label is added; the conflict becomes a private note.
    expect(ops.filter((o) => o.operation === 'upsert_infobox_field').map((o) => (o as { label: string }).label)).toEqual(['Ship']);
    expect(ops.some((o) => o.operation === 'upsert_section' && 'section_id' in o)).toBe(false);
    expect(ops.find((o) => o.operation === 'add_dm_note')).toMatchObject({ title: 'Import conflicts (a.md)' });
    // The connection waits until Tomas exists; then it is saved with Mira's current version.
    expect(chunks.flatMap((c) => c.relationKeys)).toEqual([]);
    const after: WikiIndex = { ...wiki, articles: [...wiki.articles.map((x) => (x.slug === 'mira-vale' ? { ...x, version: 3 } : x)), { id: 'id-tomas', slug: 'tomas-reed', title: 'Tomas Reed', type: 'character', version: 1, visibility: 'dm', status: 'draft' }] };
    const later = buildChunks(staged, analyzeImport(staged, after, new Set(['tomas-reed', 'mira-vale'])), d, 'b1b1b1b1-0000-4000-8000-000000000000', 'Synthetic', after);
    expect(later).toHaveLength(1);
    expect(later[0]!.changeSet).toMatchObject({ expected_versions: { 'mira-vale': 'v3' }, changes: [{ operation: 'add_relation', source_slug: 'mira-vale', target_slug: 'tomas-reed', kind: 'related_to', label: 'Mentioned in imported notes' }] });
    expect(buildChunks(staged, analyzeImport(staged, after, new Set(['tomas-reed', 'mira-vale'])), d, 'b1b1b1b1-0000-4000-8000-000000000000', 'Synthetic', after, new Set(later[0]!.relationKeys))).toEqual([]);
    // Same input, same keys: a retried part is saved once.
    expect(buildChunks(staged, a, d, 'b1b1b1b1-0000-4000-8000-000000000000', 'Synthetic', wiki).map((c) => c.idempotencyKey)).toEqual(chunks.map((c) => c.idempotencyKey));
    for (const c of chunks) expect(c.idempotencyKey.length).toBeGreaterThanOrEqual(8);
  });

  it('never asks for player visibility or publication, and marks rumours and sources', () => {
    const s = parseImportFiles([md('r.md', `---\ntitle: Dragon Sighted\ncanon: rumor\nvisibility: players\nstatus: published\n---\nPeople say a dragon flew over.\n\n## Story\nIt was large.`)]);
    const c = buildChunks(s, analyzeImport(s, wiki), emptyDecisions(), 'b2', 'R', wiki);
    const json = JSON.stringify(c);
    expect(json).not.toMatch(/"visibility"|"status"|published|players/);
    expect(c[0]!.changeSet.changes.find((o) => o.operation === 'upsert_section')).toMatchObject({ heading: 'Rumour (unconfirmed): Story', provenance: { kind: 'transcript_uncertain', reference: 'r.md' } });
  });

  it('skips entries already imported, so a resumed import does not repeat them', () => {
    const resumed = analyzeImport(staged, wiki, new Set(['tomas-reed']));
    expect(resumed.items.find((i) => i.slug === 'tomas-reed')!.action).toBe('imported');
    expect(buildChunks(staged, resumed, emptyDecisions(), 'b3', 'S', wiki)).toEqual([]);
  });

  it('splits large imports into bounded parts', () => {
    const many = parseImportFiles(Array.from({ length: 45 }, (_, i) => md(`p${i}.md`, `# Synthetic Place ${i}\nText ${i}.`)));
    const chunks = buildChunks(many, analyzeImport(many, wiki), emptyDecisions(), 'b4', 'Many', wiki);
    expect(chunks.map((c) => c.slugs.length)).toEqual([20, 20, 5]);
  });

  it('a relation between two new pages is saved with them, in one part', () => {
    const s2 = parseImportFiles([{ name: 'p.json', text: JSON.stringify({ articles: [
      { ref: 'a', slug: 'zz-one', title: 'Zz One', type: 'character', sections: [{ heading: 'N', body: 'x' }] },
      { ref: 'b', slug: 'zz-two', title: 'Zz Two', type: 'location', sections: [{ heading: 'N', body: 'y' }] }],
      relations: [{ source: 'a', target: 'b', kind: 'resides_in' }] }) }]);
    const c = buildChunks(s2, analyzeImport(s2, wiki), emptyDecisions(), 'b5', 'P', wiki);
    expect(c).toHaveLength(1);
    expect(c[0]!.relationKeys).toEqual(['zz-one>resides_in>zz-two']);
    expect(c[0]!.changeSet.changes.at(-1)).toMatchObject({ operation: 'add_relation', source_slug: 'zz-one', target_slug: 'zz-two' });
  });

  it('a rejected page takes its connections with it', () => {
    const s2 = parseImportFiles([{ name: 'p.json', text: JSON.stringify({ articles: [
      { ref: 'a', slug: 'zz-one', title: 'Zz One', type: 'character', sections: [{ heading: 'N', body: 'x' }] },
      { ref: 'b', slug: 'zz-two', title: 'Zz Two', type: 'location', sections: [{ heading: 'N', body: 'y' }] }],
      relations: [{ source: 'a', target: 'b', kind: 'resides_in' }] }) }]);
    const d = emptyDecisions();
    d.items['zz-two'] = 'reject';
    const c = buildChunks(s2, analyzeImport(s2, wiki), d, 'b6', 'P', wiki);
    expect(c.flatMap((x) => x.changeSet.changes).some((o) => o.operation === 'add_relation')).toBe(false);
  });

  it('writes a readable report', () => {
    const r = importReport('Synthetic', staged, a, emptyDecisions(), [{ chunk: 0, key: 'k', slugs: ['tomas-reed'], status: 'applied', at: '2026-01-01' }]);
    expect(r).toContain('Conflict, not applied: Race');
    expect(r).toContain('Nothing was published.');
    expect(r).toContain('Part 1: applied');
  });
});
