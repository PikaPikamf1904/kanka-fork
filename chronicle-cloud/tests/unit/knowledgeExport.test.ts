import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport, demoteHeadings, fileName, PROVENANCE_LABEL, ROOT, UNCLASSIFIED, WORDS_PER_DOCUMENT, type BuiltExport } from '../../src/lib/knowledgeExport/build.ts';
import { sampleData, SENTINELS } from '../../src/lib/knowledgeExport/sample.fixture.ts';
import { DEFAULT_OPTIONS, type ExportData, type ExportOptions } from '../../src/lib/knowledgeExport/types.ts';

const SITE = 'https://chronicle.example';
const build = (over: Partial<ExportOptions> = {}, data: ExportData = sampleData()) => buildExport(data, { ...DEFAULT_OPTIONS, siteUrl: SITE, ...over });
const everything = (b: BuiltExport) => [...b.archive.map((f) => `${f.path}\n${f.text}`), ...b.notebook.map((d) => `${d.name}\n${d.text}`)].join('\n');
const file = (b: BuiltExport, p: string) => b.archive.find((f) => f.path === `${ROOT}/${p}`)?.text ?? '';
const nb = (b: BuiltExport) => b.notebook.map((d) => d.text).join('\n');

describe('the complete DM export', () => {
  const b = build();

  it('has one file per page, in folders by kind, and every page exactly once in the NotebookLM document', () => {
    const pages = b.archive.filter((f) => /\/(Characters|Locations|Factions|Items|Quests|Sessions|Events|Lore|Gazette|Dossiers)\//.test(f.path));
    expect(pages).toHaveLength(sampleData().articles.length);
    for (const a of sampleData().articles) {
      expect(nb(b).split(`- **Chronicle ID:** \`${a.slug}\``).length - 1, a.slug).toBe(1);
    }
    expect(b.notebook).toHaveLength(1);
    expect(b.stats.articles).toBe(15);
  });

  it('keeps titles, accents and apostrophes, and gives duplicate or unsafe titles unique safe file names', () => {
    const paths = b.archive.map((f) => f.path);
    expect(paths).toContain(`${ROOT}/Characters/Lady Mirelle d’Aubrac.md`);
    expect(paths).toContain(`${ROOT}/Characters/Captain Rhys O'Dell.md`);
    expect(paths).toContain(`${ROOT}/Characters/Captain Rhys O'Dell (captain-rhys-odell-the-younger).md`);
    expect(paths).toContain(`${ROOT}/Locations/Tower West East Ruins.md`);
    expect(new Set(paths).size).toBe(paths.length);
    expect(file(b, 'Characters/Lady Mirelle d’Aubrac.md')).toContain('# Lady Mirelle d’Aubrac');
    expect(nb(b)).toContain('The gods’ anger fell upon Istar.');
  });

  it('exports every saved connection exactly as stored: direction, kind, custom words and IDs', () => {
    const rel = file(b, 'Relationships/Relationships.md');
    for (const r of sampleData().relations) expect(rel, r.id).toContain(`connection \`${r.id}\``);
    expect(rel).toContain('→ *Member of* →');
    expect(rel).toContain('“Sworn sister”');
    expect(rel).toContain('“Brass egg selection”');
    expect(rel).toContain('“Protecting the eggs”'); // two connections between the same pages, both kept
    expect(rel).toContain("IDs: `lady-mirelle` → `order-of-the-silver-rose`, kind `member_of`");
    // The target's page lists it under "To this page", still in the stored direction, read from its side.
    const younger = file(b, "Characters/Captain Rhys O'Dell (captain-rhys-odell-the-younger).md");
    expect(younger).toContain('To this page:');
    expect(younger).toContain("→ *Parent of* → [Captain Rhys O'Dell (The younger)]");
    expect(younger).toContain('(read from this page: Child of)');
    expect(file(b, 'Characters/Lady Mirelle d’Aubrac.md')).toContain('From this page:');
    expect(b.stats.relations).toBe(7);
  });

  it('labels each section and fact only from what Chronicle stores', () => {
    const text = nb(b);
    expect(text).toContain(`Source: ${PROVENANCE_LABEL.dm_confirmed} · Visibility: Known to players`);
    expect(text).toContain(`Source: ${PROVENANCE_LABEL.dm_confirmed} (a DM-approved secret) · Visibility: DM only (secret)`);
    expect(text).toContain(`Source: ${PROVENANCE_LABEL.transcript_uncertain} · Reference: Session 1 transcript · Visibility: Known to players`);
    expect(text).toContain(`Source: ${PROVENANCE_LABEL.table_confirmed}`);
    expect(text).toContain(`Source: ${PROVENANCE_LABEL.official_reference}`);
    expect(text).toContain(`Source: ${PROVENANCE_LABEL.planned_unplayed} · Visibility: DM only (secret)`);
    expect(text).toContain(`Source: ${UNCLASSIFIED} · Visibility: Known to players`); // the watchtower has no label
    expect(text).toContain(`Source: ${UNCLASSIFIED} · Visibility: DM only (draft)`); // the draft quest
    expect(text).toContain('an in-world rumour, not established fact');
    expect(b.stats.orphanProvenance).toBe(1);
    expect(file(b, 'README.md')).toContain('1 provenance record(s) point at a section or fact that no longer exists');
  });

  it('escapes titles that look like Markdown or HTML, and names pages in unlabelled links', () => {
    expect(file(b, 'Locations/Tower West East Ruins.md')).toContain('# Tower: West/East? \\<Ruins\\>');
    expect(file(b, 'Campaign-Overview.md')).toContain('[Kharolis Watchtower](<Locations/Kharolis Watchtower.md>)'); // [[kharolis-watchtower]]
  });

  it('turns wiki links into working links, pictures into captions, and nests headings inside the page', () => {
    const mirelle = file(b, 'Characters/Lady Mirelle d’Aubrac.md');
    expect(mirelle).toContain("[Rhys](<../Characters/Captain Rhys O'Dell.md>)");
    expect(mirelle).toContain('[a masked stranger](<../Characters/The Veiled Envoy.md>)');
    expect(mirelle).toContain('[Picture: A portrait of Mirelle]');
    expect(mirelle).not.toContain('media:');
    expect(mirelle).toContain('### Early life'); // was "# Early life" inside the section
    expect(nb(b)).toContain(`[Rhys](${SITE}/wiki/captain-rhys-odell)`);
    // Every relative link in the archive points at a file that exists.
    const paths = new Set(b.archive.map((f) => f.path));
    for (const f of b.archive) {
      for (const m of f.text.matchAll(/\]\(<([^>]+)>\)/g)) {
        expect(paths.has(path.posix.normalize(path.posix.join(path.posix.dirname(f.path), m[1]!))), `${f.path} -> ${m[1]}`).toBe(true);
      }
    }
  });

  it('separates history from planning and lists planned material by name only', () => {
    const plan = file(b, 'Planning/Planned-Not-Yet-Played.md');
    expect(plan).toContain('[Order of the Silver Rose]');
    expect(plan).toContain('section “Next season”');
    expect(plan).not.toContain('PLAN-SENTINEL'); // the text stays on its page, not duplicated
    const sessions = nb(b).indexOf('Ashes at the Ford') < nb(b).indexOf('The Bridge of Crows');
    expect(sessions).toBe(true); // in played order
  });

  it('includes DM notes, mysteries, clues and the DM’s research, labelled unclassified', () => {
    const text = everything(b);
    for (const s of ['BRAINSTORM-SENTINEL', 'NOTE-SENTINEL', 'MYSTERY-NOTE-SENTINEL', 'RESEARCH-SENTINEL', 'DOSSIER-SENTINEL']) expect(text).toContain(s);
    expect(file(b, 'Mysteries/Mysteries.md')).toContain('found by 2 players');
    expect(file(b, 'Mysteries/Mysteries.md')).toContain('not released');
  });

  it('says honestly which labels no record carries', () => {
    const data = sampleData();
    data.provenance = data.provenance.filter((p) => p.kind !== 'official_reference');
    const readme = file(build({}, data), 'README.md');
    expect(readme).toContain(`Nothing in this export is labelled: ${PROVENANCE_LABEL.official_reference}`);
    expect(readme).toContain(`- ${PROVENANCE_LABEL.official_reference}: 0`);
  });
});

describe('content choices', () => {
  it('without DM secrets: only what players can read, and no DM-only string anywhere', () => {
    const b = build({ dmSecrets: false });
    const text = everything(b);
    for (const s of SENTINELS) expect(text, s).not.toContain(s);
    expect(text).toContain('a masked stranger'); // the link text players see, without the hidden page
    expect(text).not.toContain('Escort the Envoy'); // a players page that is still a draft
    expect(text).toContain('Brass egg selection');
    expect(b.stats.relationsOmitted).toBe(0); // Mirelle knows the envoy: hidden from players, so not theirs to miss
    expect(text).not.toContain('connection `r4`');
    expect(b.archive.some((f) => f.path.includes('DM-Secrets') || f.path.includes('Mysteries') || f.path.includes('Dossiers'))).toBe(false);
    expect(text).toContain('DM-only pages, sections, facts and connections are left out, but the source labels, references and dates are still DM information');
  });

  it('without plans, notes, sessions or connections', () => {
    expect(everything(build({ plans: false }))).not.toContain('PLAN-SENTINEL');
    const noNotes = everything(build({ dmNotes: false }));
    for (const s of ['BRAINSTORM-SENTINEL', 'NOTE-SENTINEL', 'MYSTERY-NOTE-SENTINEL', 'RESEARCH-SENTINEL']) expect(noNotes).not.toContain(s);
    const noSessions = build({ sessions: false });
    expect(everything(noSessions)).not.toContain('Ashes at the Ford');
    expect(noSessions.archive.some((f) => f.path.includes('Timeline'))).toBe(false);
    const withSessionLink = sampleData();
    withSessionLink.relations.push({ id: 'r8', source_article_id: 'a1', target_article_id: 'a7', kind: 'appeared_in', label: '', visibility: 'players', source_ref: '' });
    const omitted = build({ sessions: false }, withSessionLink);
    expect(omitted.stats.relationsOmitted).toBe(1); // a connection to a session that was left out is counted, not hidden
    expect(file(omitted, 'Relationships/Relationships.md')).toContain('1 saved connection(s) are not listed because a page at one end is not part of this export.');
    const noRelations = build({ relationships: false });
    expect(noRelations.stats.relations).toBe(0);
    expect(everything(noRelations)).not.toContain('Brass egg selection');
  });
});

describe('edge cases', () => {
  it('an empty campaign still produces a readable export', () => {
    const empty: ExportData = { ...sampleData(), campaign: null, articles: [], sections: [], fields: [], relations: [], categories: [], articleCategories: [], redirects: [], timeline: [], provenance: [], dmNotes: [], news: [], maps: [], markers: [], mysteries: [], clues: [], hints: [], discoveries: {}, research: { collections: [], notes: [], sources: [] } };
    const b = build({}, empty);
    expect(b.stats.articles).toBe(0);
    expect(file(b, 'README.md')).toContain('- Pages: 0');
    expect(nb(b)).toContain('No saved connections in this export.');
  });

  it('a large campaign is split into NotebookLM-sized documents without cutting a page in two', () => {
    const data = sampleData();
    const long = Array.from({ length: 30_000 }, (_, i) => `word${i}`).join(' ');
    for (let i = 0; i < 40; i++) {
      data.articles.push({ ...data.articles[3]!, id: `big${i}`, slug: `big-${i}`, title: `Big Place ${i}` });
      data.sections.push({ id: `bs${i}`, article_id: `big${i}`, position: 1, heading: 'Long', body: `START-${i} ${long} END-${i}`, visibility: 'players', status: 'published' });
    }
    const started = Date.now();
    const b = build({}, data);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(b.notebook.length).toBeGreaterThan(2);
    for (const d of b.notebook) expect((d.text.match(/\S+/g) ?? []).length).toBeLessThanOrEqual(WORDS_PER_DOCUMENT + 40_000);
    for (let i = 0; i < 40; i++) {
      const holders = b.notebook.filter((d) => d.text.includes(`START-${i} `));
      expect(holders).toHaveLength(1);
      expect(holders[0]!.text).toContain(`END-${i}`);
    }
    expect(b.notebook[0]!.name).toBe(`Chronicle-Knowledge-Part-1-of-${b.notebook.length}.md`);
  });

  it('many pages build quickly', () => {
    const data = sampleData();
    for (let i = 0; i < 3000; i++) {
      data.articles.push({ ...data.articles[1]!, id: `p${i}`, slug: `person-${i}`, title: `Person ${i}` });
      for (let j = 0; j < 4; j++) data.sections.push({ id: `p${i}s${j}`, article_id: `p${i}`, position: j, heading: `Part ${j}`, body: `Knows [[person-${(i + 1) % 3000}]].`, visibility: 'players', status: 'published' });
      data.relations.push({ id: `pr${i}`, source_article_id: `p${i}`, target_article_id: `p${(i + 7) % 3000}`, kind: 'knows', label: '', visibility: 'players', source_ref: '' });
    }
    const started = Date.now();
    const b = build({}, data);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(b.stats.articles).toBe(3015);
    expect(b.stats.relations).toBe(3007);
  });

  it('file names: reserved, empty and overlong titles', () => {
    const used = new Set<string>();
    expect(fileName('CON', 'con-slug', used)).toBe('con-slug.md');
    expect(fileName('???', 'only-marks', used)).toBe('only-marks.md');
    expect(fileName('a'.repeat(200), 'long', used)).toBe(`${'a'.repeat(80)}.md`);
    expect(fileName('Tail dots...', 'dots', used)).toBe('Tail dots.md');
    expect(fileName('tail dots', 'dots-2', used)).toBe('tail dots (dots-2).md'); // case-insensitive collision
  });

  it('keeps stored source references on connections, and survives a malformed hand-written link', () => {
    const data = sampleData();
    data.relations[0]!.source_ref = 'Kanka import, entity 42';
    data.sections[3]!.body += ' See [the bridge](/wiki/bad%zz).';
    const b = build({}, data);
    expect(file(b, 'Relationships/Relationships.md')).toContain('· Source: Kanka import, entity 42 ·');
    expect(nb(b)).toContain('See the bridge.');
  });

  it('demotes headings outside code blocks only', () => {
    expect(demoteHeadings('# A\n```\n# not a heading\n```\n## B', 3)).toBe('### A\n```\n# not a heading\n```\n#### B');
  });
});

// The committed sample under docs/ is this fixture's export. Regenerate with UPDATE_SAMPLE=1.
describe('committed sample export', () => {
  const dir = path.resolve(import.meta.dirname, '../../../docs/chronicle/notebooklm-export-sample');
  const b = build();
  const expected = [...b.archive.map((f) => ({ path: f.path, text: f.text })), ...b.notebook.map((d) => ({ path: d.name, text: d.text }))];
  if (process.env.UPDATE_SAMPLE === '1') {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const f of expected) {
      fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
      fs.writeFileSync(path.join(dir, f.path), f.text);
    }
  }
  it('matches the builder', () => {
    for (const f of expected) expect(fs.readFileSync(path.join(dir, f.path), 'utf8'), f.path).toBe(f.text);
  });
});
