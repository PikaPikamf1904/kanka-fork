// A small synthetic campaign for the export's tests and the committed sample export. Invented
// names only; no real campaign content. Strings ending in -SENTINEL are DM-only material that must
// never appear in a players-only export.
import type { ExportData } from './types.ts';

const T = '2026-01-01T00:00:00.000Z';
const art = (id: string, slug: string, type: ExportData['articles'][number]['type'], title: string, visibility: 'players' | 'dm', status: 'published' | 'draft', extra: Partial<ExportData['articles'][number]> = {}): ExportData['articles'][number] => ({
  id, slug, type, title, subtitle: '', summary: '', visibility, status, is_party_member: false, importance: 0,
  session_date: null, source_ref: '', created_at: T, updated_at: T, published_at: status === 'published' ? T : null, ...extra,
});
const sec = (id: string, article_id: string, position: number, heading: string, body: string, visibility: 'players' | 'dm' = 'players', status: 'published' | 'draft' = 'published') =>
  ({ id, article_id, position, heading, body, visibility, status });

export function sampleData(): ExportData {
  return {
    generatedAt: '2026-11-24T12:00:00.000Z',
    campaign: {
      title: 'The Synthetic Chronicle',
      tagline: 'A made-up campaign for tests',
      overview: '## Premise\nThe party guards the road to [[kharolis-watchtower]].',
      current_status: 'Resting at [[kharolis-watchtower|the watchtower]].',
    },
    articles: [
      art('a1', 'lady-mirelle', 'character', 'Lady Mirelle d’Aubrac', 'players', 'published', { is_party_member: true, subtitle: 'Knight-errant', summary: 'A knight who remembers the Cataclysm’s stories.' }),
      art('a2', 'captain-rhys-odell', 'character', "Captain Rhys O'Dell", 'players', 'published'),
      art('a3', 'the-veiled-envoy', 'character', 'The Veiled Envoy', 'dm', 'published', { summary: 'ENVOY-SUMMARY-SENTINEL' }),
      art('a4', 'kharolis-watchtower', 'location', 'Kharolis Watchtower', 'players', 'published'),
      art('a5', 'order-of-the-silver-rose', 'faction', 'Order of the Silver Rose', 'players', 'published'),
      art('a6', 'shard-of-the-lost-moon', 'item', 'Shard of the Lost Moon', 'players', 'published'),
      art('a7', 'ashes-at-the-ford', 'session', 'Ashes at the Ford', 'players', 'published', { session_date: '2026-01-10' }),
      art('a8', 'the-bridge-of-crows', 'session', 'The Bridge of Crows', 'players', 'published', { session_date: '2026-01-24' }),
      art('a9', 'night-of-falling-stars', 'event', 'The Night of Falling Stars', 'players', 'published'),
      art('a10', 'the-cataclysm', 'lore', 'The Cataclysm', 'players', 'published', { source_ref: 'Setting notes' }),
      art('a11', 'escort-the-envoy', 'quest', 'Escort the Envoy', 'players', 'draft'),
      art('a12', 'envoys-allegiance', 'dossier', 'The Envoy’s true allegiance', 'dm', 'draft'),
      art('a13', 'ford-burned-says-crier', 'news', 'Ford burned, says crier', 'players', 'published'),
      art('a14', 'captain-rhys-odell-the-younger', 'character', "Captain Rhys O'Dell", 'players', 'published', { subtitle: 'The younger' }),
      art('a15', 'tower-ruins', 'location', 'Tower: West/East? <Ruins>', 'players', 'published'),
    ],
    sections: [
      sec('s1', 'a1', 1, 'Background', '# Early life\nRaised beside [[captain-rhys-odell|Rhys]]. She once met [[the-veiled-envoy|a masked stranger]].\n\n![A portrait of Mirelle](media:portrait.webp)'),
      sec('s2', 'a1', 2, 'What she hides', 'SECRET-SENTINEL: she carries a letter from the envoy.', 'dm'),
      sec('s3', 'a7', 1, 'Summary', 'The party crossed the ford at dusk; the inn burned.'),
      sec('s4', 'a8', 1, 'What happened', 'The party held the Bridge of Crows. Rhys was wounded.'),
      sec('s5', 'a10', 1, 'Overview', 'The gods’ anger fell upon Istar.'),
      sec('s6', 'a5', 1, 'Next season', 'PLAN-SENTINEL: the Order splits over the shard.', 'dm'),
      sec('s7', 'a4', 1, 'Description', 'An old stone tower above the pass.'),
      sec('s8', 'a11', 1, 'Brief', 'DRAFT-SENTINEL: escort the envoy north.', 'players', 'draft'),
      sec('s9', 'a3', 1, 'Who they are', 'ENVOY-SENTINEL: an agent of the dark queen.', 'dm'),
      sec('s10', 'a13', 1, 'Report', 'The crier swears the ford was set alight by goblins.'),
      sec('s11', 'a12', 1, 'Allegiance', 'DOSSIER-SENTINEL: serves two masters.', 'dm', 'draft'),
    ],
    fields: [
      { id: 'f1', article_id: 'a1', position: 1, label: 'Species', value: 'Half-elf', visibility: 'players' },
      { id: 'f2', article_id: 'a1', position: 2, label: 'True name', value: 'TRUE-NAME-SENTINEL', visibility: 'dm' },
      { id: 'f3', article_id: 'a2', position: 1, label: 'Class', value: 'Fighter', visibility: 'players' },
    ],
    relations: [
      { id: 'r1', source_article_id: 'a1', target_article_id: 'a5', kind: 'member_of', label: 'Sworn sister', visibility: 'players', source_ref: '' },
      { id: 'r2', source_article_id: 'a2', target_article_id: 'a1', kind: 'ally_of', label: '', visibility: 'players', source_ref: '' },
      { id: 'r3', source_article_id: 'a3', target_article_id: 'a5', kind: 'controls', label: 'HIDDEN-RELATION-SENTINEL', visibility: 'dm', source_ref: '' },
      { id: 'r4', source_article_id: 'a1', target_article_id: 'a3', kind: 'knows', label: '', visibility: 'players', source_ref: '' },
      { id: 'r5', source_article_id: 'a1', target_article_id: 'a6', kind: 'related_to', label: 'Brass egg selection', visibility: 'players', source_ref: '' },
      { id: 'r6', source_article_id: 'a1', target_article_id: 'a6', kind: 'related_to', label: 'Protecting the eggs', visibility: 'players', source_ref: '' },
      { id: 'r7', source_article_id: 'a2', target_article_id: 'a14', kind: 'parent_of', label: '', visibility: 'players', source_ref: '' },
    ],
    categories: [
      { id: 'c1', slug: 'heroes', name: 'Heroes', kind: '', description: '', visibility: 'players' },
      { id: 'c2', slug: 'secret-cabals', name: 'CABAL-CATEGORY-SENTINEL', kind: '', description: '', visibility: 'dm' },
    ],
    articleCategories: [
      { article_id: 'a1', category_id: 'c1' },
      { article_id: 'a2', category_id: 'c1' },
      { article_id: 'a3', category_id: 'c2' },
    ],
    redirects: [
      { from_slug: 'mirelle', article_id: 'a1', visibility: 'players' },
      { from_slug: 'envoy-old-name-sentinel', article_id: 'a3', visibility: 'dm' },
    ],
    timeline: [
      { id: 't1', title: 'The ford burns', date_label: 'Spring 352 AC', sort_key: 1, body: 'Seen at [[ashes-at-the-ford]].', article_id: 'a7', visibility: 'players', status: 'published' },
      { id: 't2', title: 'TIMELINE-SENTINEL arrives', date_label: 'Summer 352 AC', sort_key: 2, body: '', article_id: null, visibility: 'dm', status: 'published' },
    ],
    provenance: [
      { id: 'p1', article_id: 'a1', section_id: 's1', field_id: null, kind: 'dm_confirmed', reference: '' },
      { id: 'p2', article_id: 'a1', section_id: 's2', field_id: null, kind: 'dm_confirmed', reference: '' },
      { id: 'p3', article_id: 'a7', section_id: 's3', field_id: null, kind: 'transcript_uncertain', reference: 'Session 1 transcript' },
      { id: 'p4', article_id: 'a8', section_id: 's4', field_id: null, kind: 'table_confirmed', reference: '' },
      { id: 'p5', article_id: 'a10', section_id: 's5', field_id: null, kind: 'official_reference', reference: '' },
      { id: 'p6', article_id: 'a5', section_id: 's6', field_id: null, kind: 'planned_unplayed', reference: '' },
      { id: 'p7', article_id: 'a1', section_id: null, field_id: 'f1', kind: 'dm_confirmed', reference: '' },
      { id: 'p8', article_id: 'a1', section_id: null, field_id: 'f-deleted', kind: 'dm_confirmed', reference: '' },
    ],
    dmNotes: [
      { id: 'n1', article_id: null, title: 'Ideas for the next arc', body: 'BRAINSTORM-SENTINEL: what if the shard is a key?', created_at: T, updated_at: T },
      { id: 'n2', article_id: 'a1', title: 'Mirelle’s arc', body: 'NOTE-SENTINEL: reveal the letter in session 5.', created_at: T, updated_at: T },
    ],
    news: [{ article_id: 'a13', section: 'front', reliability: 'rumor', reporter: 'A crier', dateline: 'The ford', in_world_date: 'Spring 352 AC', issue_number: 1, review_state: 'approved', corrects_article_id: null }],
    maps: [{ id: 'm1', slug: 'kharolis', title: 'Kharolis', description: 'The pass and its tower.', article_id: 'a4', parent_map_id: null, visibility: 'players', status: 'published' }],
    markers: [
      { id: 'mk1', map_id: 'm1', label: 'Watchtower', description: 'The party’s camp.', article_id: 'a4', visibility: 'players' },
      { id: 'mk2', map_id: 'm1', label: 'MARKER-SENTINEL camp', description: '', article_id: 'a3', visibility: 'dm' },
    ],
    mysteries: [{ id: 'y1', title: 'Who burned the ford?', player_title: 'The burned ford', summary: 'Someone set the inn alight.', dm_notes: 'MYSTERY-NOTE-SENTINEL: it was the envoy.', status: 'active' }],
    clues: [
      { id: 'q1', mystery_id: 'y1', kind: 'symbol', title: 'Scorched sigil', body: 'A rose burned into the door.', source_line: '', attach_article_id: 'a4', requires_clue_id: null, release_at: null, released_at: T, position: 1 },
      { id: 'q2', mystery_id: 'y1', kind: 'note', title: 'Envoy’s glove', body: 'Found in the ashes.', source_line: '', attach_article_id: null, requires_clue_id: 'q1', release_at: null, released_at: null, position: 2 },
    ],
    hints: [{ id: 'h1', clue_id: 'q2', position: 1, body: 'Ask the stablehand.', release_at: null, released_at: null }],
    discoveries: { q1: 2 },
    research: {
      collections: [{ id: 'rc1', title: 'Arc ideas', description: 'Loose threads.', shared: false }],
      notes: [{ id: 'rn1', collection_id: 'rc1', title: 'The shard', body: 'RESEARCH-SENTINEL: ties to the moons.' }],
      sources: [{ id: 'rs1', collection_id: 'rc1', article_id: 'a6', topic: 'moons', annotation: 'Check the legend.', excerpt: 'A shard of light', position: 1 }],
    },
    tablesRead: [],
  };
}

/** Every DM-only string in the sample. */
export const SENTINELS = [
  'ENVOY-SUMMARY-SENTINEL', 'SECRET-SENTINEL', 'PLAN-SENTINEL', 'DRAFT-SENTINEL', 'ENVOY-SENTINEL', 'DOSSIER-SENTINEL', 'TRUE-NAME-SENTINEL',
  'HIDDEN-RELATION-SENTINEL', 'CABAL-CATEGORY-SENTINEL', 'envoy-old-name-sentinel', 'TIMELINE-SENTINEL', 'BRAINSTORM-SENTINEL', 'NOTE-SENTINEL',
  'MARKER-SENTINEL', 'MYSTERY-NOTE-SENTINEL', 'RESEARCH-SENTINEL', 'The Veiled Envoy', 'the-veiled-envoy',
];
