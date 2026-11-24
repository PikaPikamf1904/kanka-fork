// Turns what the loader read into Markdown: an archive of files (one per page, by kind) and a
// NotebookLM document (everything in one file, split into parts only when it would pass the
// per-source limit). Pure: no queries, no clock other than data.generatedAt, so it is easy to test.
//
// Honesty rules:
// - Labels come only from stored data (provenance kinds, visibility, publish status, Gazette
//   reliability). Anything without a stored label is "Unclassified"; nothing is guessed.
// - Connections come only from saved connection rows. Mentions in text are not connections.
// - "Known to players" uses the same rules as the database: a page that players may see and that
//   is published; a section or fact that players may see (and, for sections, published) on such a page.
import { slugify } from '../slug.ts';
import { relationKindFrom, relationLabel } from '../templates.ts';
import type { ArticleType } from '../types.ts';
import type { ExportData, ExportOptions, ProvenanceKind } from './types.ts';

type Article = ExportData['articles'][number];
type Section = ExportData['sections'][number];
type Field = ExportData['fields'][number];
type Relation = ExportData['relations'][number];

/** NotebookLM accepts up to 500,000 words per source (Google's help, checked 2026-11-24); keep a margin. */
export const WORDS_PER_DOCUMENT = 400_000;
export const ROOT = 'Chronicle-Export';

export const GROUPS: { type: ArticleType; folder: string; heading: string; dmOnly?: boolean }[] = [
  { type: 'session', folder: 'Sessions', heading: 'Campaign history: session journals' },
  { type: 'event', folder: 'Events', heading: 'Campaign history: events' },
  { type: 'character', folder: 'Characters', heading: 'Characters' },
  { type: 'location', folder: 'Locations', heading: 'Locations' },
  { type: 'faction', folder: 'Factions', heading: 'Factions and organisations' },
  { type: 'item', folder: 'Items', heading: 'Items, artifacts and magic' },
  { type: 'quest', folder: 'Quests', heading: 'Quests' },
  { type: 'lore', folder: 'Lore', heading: 'Lore and history' },
  { type: 'news', folder: 'Gazette', heading: 'The Goblin Gazette (in-world news)' },
  { type: 'dossier', folder: 'Dossiers', heading: 'DM dossiers', dmOnly: true },
];
const TYPE_NAME: Record<ArticleType, string> = {
  session: 'Session journal', event: 'Event', character: 'Character', location: 'Location', faction: 'Faction',
  item: 'Item', quest: 'Quest', lore: 'Lore', news: 'Gazette story', dossier: 'DM dossier',
};

export const PROVENANCE_LABEL: Record<ProvenanceKind, string> = {
  official_reference: 'Established lore (official reference)',
  table_confirmed: 'Campaign canon (confirmed at the table)',
  dm_confirmed: 'DM-confirmed',
  planned_unplayed: 'Planned, not yet played',
  transcript_uncertain: 'From session transcripts, not yet confirmed',
};
const PROVENANCE_ORDER: ProvenanceKind[] = ['official_reference', 'table_confirmed', 'dm_confirmed', 'transcript_uncertain', 'planned_unplayed'];
export const UNCLASSIFIED = 'Unclassified';

export interface ExportStats {
  articles: number;
  byType: Partial<Record<ArticleType, number>>;
  sections: number;
  facts: number;
  relations: number;
  relationsOmitted: number;
  timeline: number;
  dmNotes: number;
  mysteries: number;
  clues: number;
  maps: number;
  research: number;
  words: number;
  /** How many sections and facts carry each label (zero counts included, so gaps are visible). */
  labels: Record<string, number>;
  orphanProvenance: number;
}

export interface BuiltExport {
  archive: { path: string; text: string }[];
  notebook: { name: string; text: string }[];
  stats: ExportStats;
}

const words = (s: string) => (s.match(/\S+/g) ?? []).length;
/** Title text that cannot turn into Markdown link syntax or an HTML tag. */
export const esc = (s: string) => s.replace(/[[\]<>]/g, (c) => `\\${c}`);
const date = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
const quote = (s: string) => `“${s}”`;

/** Shift Markdown headings in article text so they nest below the page's own headings. */
export function demoteHeadings(md: string, minLevel: number): string {
  let fenced = false;
  return md.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) return line;
    const m = /^(#{1,6})(\s.*)$/.exec(line);
    if (!m) return line;
    return `${'#'.repeat(Math.min(6, m[1]!.length + minLevel - 1))}${m[2]}`;
  }).join('\n');
}

/** A file name that is safe on every system, keeps accents and apostrophes, and is unique in its folder. */
export function fileName(title: string, slug: string, used: Set<string>): string {
  let base = title.normalize('NFC').replace(/[/\\:*?"<>|\p{Cc}]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (base.length > 80) base = base.slice(0, 80).trim();
  if (!base || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = slug || 'untitled';
  let name = base;
  if (used.has(name.toLowerCase())) name = `${base} (${slug})`;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${slug}) ${n}`;
  used.add(name.toLowerCase());
  return `${name}.md`;
}

export function buildExport(data: ExportData, options: ExportOptions): BuiltExport {
  const site = options.siteUrl.replace(/\/+$/, '');
  const byId = new Map(data.articles.map((a) => [a.id, a]));
  const bySlug = new Map(data.articles.map((a) => [a.slug, a]));
  for (const r of data.redirects) {
    const a = byId.get(r.article_id);
    if (a && !bySlug.has(r.from_slug)) bySlug.set(r.from_slug, a);
  }

  // Provenance by what it describes.
  const sectionIds = new Set(data.sections.map((s) => s.id));
  const fieldIds = new Set(data.fields.map((f) => f.id));
  const provBySection = new Map<string, Set<ProvenanceKind>>();
  const provByField = new Map<string, Set<ProvenanceKind>>();
  const provByArticle = new Map<string, Set<ProvenanceKind>>();
  let orphanProvenance = 0;
  const add = (m: Map<string, Set<ProvenanceKind>>, k: string, v: ProvenanceKind) => m.set(k, (m.get(k) ?? new Set()).add(v));
  for (const p of data.provenance) {
    if (p.section_id) {
      if (sectionIds.has(p.section_id)) add(provBySection, p.section_id, p.kind); else orphanProvenance++;
    } else if (p.field_id) {
      if (fieldIds.has(p.field_id)) add(provByField, p.field_id, p.kind); else orphanProvenance++;
    } else add(provByArticle, p.article_id, p.kind);
  }

  // ---- Scope -----------------------------------------------------------------------------------
  const knownArticle = (a: Article) => a.visibility === 'players' && a.status === 'published';
  const plannedOnly = (kinds: Set<ProvenanceKind> | undefined) => !options.plans && !!kinds?.has('planned_unplayed');
  const included = new Map<string, Article>();
  for (const a of data.articles) {
    if (!options.dmSecrets && !knownArticle(a)) continue;
    if (!options.sessions && a.type === 'session') continue;
    if (plannedOnly(provByArticle.get(a.id))) continue;
    included.set(a.id, a);
  }
  const knownSection = (s: Section) => knownArticle(byId.get(s.article_id)!) && s.visibility === 'players' && s.status === 'published';
  const knownField = (f: Field) => knownArticle(byId.get(f.article_id)!) && f.visibility === 'players';
  const sections = data.sections.filter((s) => included.has(s.article_id) && (options.dmSecrets || knownSection(s)) && !plannedOnly(provBySection.get(s.id)));
  const fields = data.fields.filter((f) => included.has(f.article_id) && (options.dmSecrets || knownField(f)) && !plannedOnly(provByField.get(f.id)));
  const relationKnown = (r: Relation) => r.visibility === 'players' && knownArticle(byId.get(r.source_article_id)!) && knownArticle(byId.get(r.target_article_id)!);
  const relations = options.relationships
    ? data.relations.filter((r) => included.has(r.source_article_id) && included.has(r.target_article_id) && (options.dmSecrets || relationKnown(r)))
    : [];
  const relationsOmitted = options.relationships
    ? data.relations.filter((r) => (options.dmSecrets || relationKnown(r)) && !(included.has(r.source_article_id) && included.has(r.target_article_id))).length
    : 0;
  const timeline = options.sessions
    ? data.timeline.filter((t) => (options.dmSecrets || (t.visibility === 'players' && t.status === 'published' && (!t.article_id || knownArticle(byId.get(t.article_id) ?? ({} as Article)))))
      && (!t.article_id || included.has(t.article_id)))
    : [];
  const dmNotes = options.dmNotes && options.dmSecrets ? data.dmNotes.filter((n) => !n.article_id || included.has(n.article_id)) : [];
  const mysteries = options.dmSecrets ? data.mysteries : [];
  const maps = data.maps.filter((m) => options.dmSecrets || (m.visibility === 'players' && m.status === 'published'));
  const mapIds = new Set(maps.map((m) => m.id));
  const markers = data.markers.filter((mk) => mapIds.has(mk.map_id) && (!mk.article_id || included.has(mk.article_id)) && (options.dmSecrets || mk.visibility === 'players'));
  const research = options.dmNotes && options.dmSecrets ? data.research : { collections: [], notes: [], sources: [] };
  const categories = new Map(data.categories.filter((c) => options.dmSecrets || c.visibility === 'players').map((c) => [c.id, c]));

  // ---- Labels ----------------------------------------------------------------------------------
  const labels: Record<string, number> = Object.fromEntries([...PROVENANCE_ORDER.map((k) => PROVENANCE_LABEL[k]), UNCLASSIFIED].map((l) => [l, 0]));
  const sourceLabel = (kinds: Set<ProvenanceKind> | undefined, count = true) => {
    const list = kinds?.size ? PROVENANCE_ORDER.filter((k) => kinds.has(k)).map((k) => PROVENANCE_LABEL[k]) : [UNCLASSIFIED];
    if (count) for (const l of list) labels[l] = (labels[l] ?? 0) + 1;
    return list.join('; ');
  };
  const visibilityLabel = (known: boolean, draft: boolean) => (known ? 'Known to players' : draft ? 'DM only (draft)' : 'DM only (secret)');
  /** A DM-confirmed fact the players do not know is, exactly, a DM-approved secret. */
  const classification = (kinds: Set<ProvenanceKind> | undefined, known: boolean, draft: boolean) => {
    const source = sourceLabel(kinds);
    const secret = !known && !draft && kinds?.has('dm_confirmed') ? ' (a DM-approved secret)' : '';
    return `Source: ${source}${secret} · Visibility: ${visibilityLabel(known, draft)}`;
  };

  // ---- Links -----------------------------------------------------------------------------------
  type Linker = (target: Article, text: string) => string;
  const titleCount = new Map<string, number>();
  for (const a of included.values()) titleCount.set(a.title, (titleCount.get(a.title) ?? 0) + 1);
  /** A page's name, told apart from other pages with the same title. */
  const nameOf = (a: Article) => ((titleCount.get(a.title) ?? 0) > 1 ? `${a.title} (${a.subtitle.trim() || a.slug})` : a.title);
  const renderText = (md: string, link: Linker) =>
    md
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt.trim() ? `[Picture: ${alt.trim()}]` : '[Picture]'))
      .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, target: string, label?: string) => {
        const a = bySlug.get(slugify(target));
        const shown = a && included.has(a.id);
        // Without a label the wiki shows the address; the export shows the page's name instead.
        const text = (label?.trim() || (shown ? nameOf(a) : target.trim())).replace(/[[\]]/g, '');
        return shown ? link(a, text) : text;
      })
      .replace(/\[([^\]]+)\]\(\/wiki\/([^)\s]+)\)/g, (_m, text: string, slug: string) => {
        const a = bySlug.get(decodeURIComponent(slug));
        return a && included.has(a.id) ? link(a, text) : text;
      });
  const pageUrl = (a: Article) => `${site}/wiki/${encodeURIComponent(a.slug)}`;

  // ---- Indexes for article pages ---------------------------------------------------------------
  const groupOf = (xs: { article_id: string }[]) => {
    const m = new Map<string, typeof xs>();
    for (const x of xs) m.set(x.article_id, [...(m.get(x.article_id) ?? []), x]);
    return m;
  };
  const sectionsBy = groupOf(sections) as Map<string, Section[]>;
  const fieldsBy = groupOf(fields) as Map<string, Field[]>;
  const outBy = new Map<string, Relation[]>();
  const inBy = new Map<string, Relation[]>();
  for (const r of relations) {
    outBy.set(r.source_article_id, [...(outBy.get(r.source_article_id) ?? []), r]);
    inBy.set(r.target_article_id, [...(inBy.get(r.target_article_id) ?? []), r]);
  }
  const redirectsBy = new Map<string, string[]>();
  for (const r of data.redirects) {
    if (!included.has(r.article_id) || (!options.dmSecrets && r.visibility !== 'players')) continue;
    redirectsBy.set(r.article_id, [...(redirectsBy.get(r.article_id) ?? []), r.from_slug]);
  }
  const catsBy = new Map<string, string[]>();
  for (const ac of data.articleCategories) {
    const c = categories.get(ac.category_id);
    if (c && included.has(ac.article_id)) catsBy.set(ac.article_id, [...(catsBy.get(ac.article_id) ?? []), c.name]);
  }
  const newsBy = new Map(data.news.map((n) => [n.article_id, n]));
  const timelineBy = new Map<string, typeof timeline>();
  for (const t of timeline) if (t.article_id) timelineBy.set(t.article_id, [...(timelineBy.get(t.article_id) ?? []), t]);
  const markersBy = new Map<string, typeof markers>();
  for (const mk of markers) if (mk.article_id) markersBy.set(mk.article_id, [...(markersBy.get(mk.article_id) ?? []), mk]);
  const mapsBy = new Map<string, typeof maps>();
  for (const m of maps) if (m.article_id && included.has(m.article_id)) mapsBy.set(m.article_id, [...(mapsBy.get(m.article_id) ?? []), m]);
  const notesBy = new Map<string, typeof dmNotes>();
  for (const n of dmNotes) if (n.article_id) notesBy.set(n.article_id, [...(notesBy.get(n.article_id) ?? []), n]);

  const sortedArticles = (type: ArticleType) => {
    const list = [...included.values()].filter((a) => a.type === type);
    return type === 'session'
      ? list.sort((a, b) => (a.session_date ?? '9999').localeCompare(b.session_date ?? '9999') || a.title.localeCompare(b.title))
      : list.sort((a, b) => a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug));
  };

  /** A connection exactly as stored: source → kind → target. */
  const relationLine = (r: Relation, link: Linker, incoming = false) => {
    const s = byId.get(r.source_article_id)!;
    const t = byId.get(r.target_article_id)!;
    const custom = r.label.trim() ? ` — ${quote(r.label.trim())}` : '';
    const known = relationKnown(r);
    const reading = incoming && relationKindFrom(r.kind, 'in') !== r.kind ? ` (read from this page: ${relationLabel(relationKindFrom(r.kind, 'in'))})` : '';
    return `- ${link(s, nameOf(s))} → *${relationLabel(r.kind)}* → ${link(t, nameOf(t))}${custom}${reading} · ${visibilityLabel(known, false)} · IDs: \`${s.slug}\` → \`${t.slug}\`, kind \`${r.kind}\`, connection \`${r.id}\``;
  };

  /** One page as Markdown, with its headings starting at `level`. */
  const articleMarkdown = (a: Article, level: number, link: Linker): string => {
    const h = (n: number) => '#'.repeat(Math.min(6, level + n));
    const known = knownArticle(a);
    const out: string[] = [`${h(0)} ${esc(a.title)}`];
    if (a.subtitle.trim()) out.push('', `*${a.subtitle.trim()}*`);
    const meta = [
      `- **Chronicle ID:** \`${a.slug}\``,
      `- **Type:** ${TYPE_NAME[a.type]}${a.is_party_member ? ' (party member)' : ''}`,
      `- **Visibility:** ${visibilityLabel(known, a.status === 'draft')}`,
    ];
    const pageKinds = provByArticle.get(a.id);
    if (pageKinds?.size) meta.push(`- **Source:** ${sourceLabel(pageKinds)}`);
    if (a.type === 'session' && a.session_date) meta.push(`- **Played on:** ${a.session_date}`);
    const n = newsBy.get(a.id);
    if (n) {
      meta.push(`- **Gazette:** ${n.reliability} report${n.in_world_date ? `, dated ${n.in_world_date} in the world` : ''}${n.issue_number ? `, issue ${n.issue_number}` : ''}${n.reporter ? `, by ${n.reporter}` : ''}`);
      if (n.reliability === 'rumor' || n.reliability === 'satire') meta.push(`- **Note:** an in-world ${n.reliability === 'rumor' ? 'rumour' : 'satire'}, not established fact.`);
    }
    const cats = catsBy.get(a.id);
    if (cats?.length) meta.push(`- **Categories:** ${[...cats].sort().join(', ')}`);
    const alt = redirectsBy.get(a.id);
    if (alt?.length) meta.push(`- **Former addresses:** ${alt.sort().map((s) => `\`${s}\``).join(', ')}`);
    if (a.source_ref.trim()) meta.push(`- **Imported from:** ${a.source_ref.trim()}`);
    meta.push(`- **Last updated:** ${date(a.updated_at)}`, `- **In Chronicle:** ${pageUrl(a)}`);
    out.push('', ...meta);
    if (a.summary.trim()) out.push('', renderText(a.summary.trim(), link));

    const fs = (fieldsBy.get(a.id) ?? []).sort((x, y) => x.position - y.position);
    if (fs.length) {
      out.push('', `${h(1)} Facts`);
      for (const f of fs) {
        const kinds = provByField.get(f.id);
        out.push(`- **${f.label}:** ${renderText(f.value, link)} — *${classification(kinds, knownField(f), false)}*`);
      }
    }
    for (const s of (sectionsBy.get(a.id) ?? []).sort((x, y) => x.position - y.position)) {
      out.push('', `${h(1)} ${s.heading.trim() || 'Text'}`, `*${classification(provBySection.get(s.id), knownSection(s), s.status === 'draft')}*`);
      if (s.body.trim()) out.push('', demoteHeadings(renderText(s.body.trim(), link), level + 2));
    }
    const outgoing = outBy.get(a.id) ?? [];
    const incoming = inBy.get(a.id) ?? [];
    if (outgoing.length || incoming.length) {
      out.push('', `${h(1)} Connections`);
      if (outgoing.length) out.push('', 'From this page:', ...outgoing.map((r) => relationLine(r, link)));
      if (incoming.length) out.push('', 'To this page:', ...incoming.map((r) => relationLine(r, link, true)));
    }
    const tl = timelineBy.get(a.id);
    if (tl?.length) {
      out.push('', `${h(1)} On the timeline`);
      for (const t of tl) out.push(`- ${t.date_label ? `${t.date_label}: ` : ''}${t.title}`);
    }
    const onMaps = [...(markersBy.get(a.id) ?? []).map((mk) => maps.find((m) => m.id === mk.map_id)?.title ?? ''), ...(mapsBy.get(a.id) ?? []).map((m) => `${m.title} (map of this place)`)].filter(Boolean);
    if (onMaps.length) out.push('', `${h(1)} On maps`, ...[...new Set(onMaps)].map((m) => `- ${m}`));
    const notes = notesBy.get(a.id);
    if (notes?.length) {
      out.push('', `${h(1)} DM notes`, `*Source: ${UNCLASSIFIED} (DM note) · Visibility: DM only*`);
      for (const note of notes) out.push('', `**${note.title.trim() || 'Note'}** (${date(note.updated_at)})`, '', demoteHeadings(renderText(note.body.trim(), link), level + 2));
    }
    return out.join('\n');
  };

  // ---- Shared sections -------------------------------------------------------------------------
  const timelineMarkdown = (level: number, link: Linker) => {
    const sorted = [...timeline].sort((x, y) => Number(x.sort_key ?? Infinity) - Number(y.sort_key ?? Infinity) || x.title.localeCompare(y.title));
    const out = [`${'#'.repeat(level)} Timeline`];
    if (!sorted.length) out.push('', 'No timeline entries in Chronicle.');
    for (const t of sorted) {
      const a = t.article_id ? byId.get(t.article_id) : undefined;
      out.push('', `- **${t.date_label || 'Undated'}: ${t.title}** · ${visibilityLabel(t.visibility === 'players' && t.status === 'published' && (!a || knownArticle(a)), t.status === 'draft')}${a ? ` · about ${link(a, nameOf(a))}` : ''}`);
      if (t.body.trim()) out.push(`  ${renderText(t.body.trim(), link).replace(/\n/g, '\n  ')}`);
    }
    return out.join('\n');
  };
  const relationshipsMarkdown = (level: number, link: Linker) => {
    const out = [`${'#'.repeat(level)} All saved connections`, '',
      'Every connection saved in Chronicle between two pages in this export, exactly as stored: direction (source → target), kind, the custom description in quotes, who may see it, and the IDs. Mentions in text are not listed here.'];
    const sorted = [...relations].sort((x, y) => byId.get(x.source_article_id)!.title.localeCompare(byId.get(y.source_article_id)!.title) || x.kind.localeCompare(y.kind) || byId.get(x.target_article_id)!.title.localeCompare(byId.get(y.target_article_id)!.title) || x.id.localeCompare(y.id));
    if (!sorted.length) out.push('', 'No saved connections in this export.');
    else out.push('', ...sorted.map((r) => relationLine(r, link)));
    if (relationsOmitted) out.push('', `${relationsOmitted} saved connection(s) are not listed because a page at one end is not part of this export.`);
    return out.join('\n');
  };
  const mysteriesMarkdown = (level: number, link: Linker) => {
    const out = [`${'#'.repeat(level)} Mysteries and clues`, '', '*Visibility: the mysteries are DM only; each clue says whether it has been released to the players.*'];
    if (!mysteries.length) out.push('', 'No mysteries in Chronicle.');
    for (const m of [...mysteries].sort((x, y) => x.title.localeCompare(y.title))) {
      out.push('', `${'#'.repeat(level + 1)} ${esc(m.title)}`, '', `- **Status:** ${m.status}`);
      if (m.player_title.trim()) out.push(`- **Title the players see:** ${m.player_title.trim()}`);
      if (m.summary.trim()) out.push('', renderText(m.summary.trim(), link));
      if (options.dmNotes && m.dm_notes.trim()) out.push('', `**DM notes** *(Source: ${UNCLASSIFIED})*`, '', renderText(m.dm_notes.trim(), link));
      for (const c of data.clues.filter((x) => x.mystery_id === m.id).sort((x, y) => x.position - y.position)) {
        const released = c.released_at ? `released ${date(c.released_at)}` : c.release_at ? `to be released ${date(c.release_at)}` : 'not released';
        const found = data.discoveries[c.id] ?? 0;
        const about = c.attach_article_id ? byId.get(c.attach_article_id) : undefined;
        out.push('', `- **Clue: ${c.title}** (${c.kind}) · ${released} · found by ${found} player${found === 1 ? '' : 's'}${about && included.has(about.id) ? ` · on ${link(about, nameOf(about))}` : ''}`);
        if (c.body.trim()) out.push(`  ${renderText(c.body.trim(), link).replace(/\n/g, '\n  ')}`);
        if (c.source_line.trim()) out.push(`  Source: ${c.source_line.trim()}`);
        for (const hint of data.hints.filter((x) => x.clue_id === c.id).sort((x, y) => x.position - y.position)) {
          out.push(`  - Hint (${hint.released_at ? `released ${date(hint.released_at)}` : 'not released'}): ${renderText(hint.body.trim(), link).replace(/\n/g, ' ')}`);
        }
      }
    }
    return out.join('\n');
  };
  const mapsMarkdown = (level: number, link: Linker) => {
    const out = [`${'#'.repeat(level)} Maps`];
    if (!maps.length) out.push('', 'No maps in Chronicle.');
    for (const m of [...maps].sort((x, y) => x.title.localeCompare(y.title))) {
      const a = m.article_id ? byId.get(m.article_id) : undefined;
      out.push('', `${'#'.repeat(level + 1)} ${esc(m.title)}`, '', `- **Visibility:** ${visibilityLabel(m.visibility === 'players' && m.status === 'published', m.status === 'draft')}`);
      if (a && included.has(a.id)) out.push(`- **Map of:** ${link(a, nameOf(a))}`);
      if (m.description.trim()) out.push('', renderText(m.description.trim(), link));
      const pins = markers.filter((mk) => mk.map_id === m.id).sort((x, y) => x.label.localeCompare(y.label));
      if (pins.length) out.push('', ...pins.map((mk) => {
        const at = mk.article_id ? byId.get(mk.article_id) : undefined;
        return `- **${mk.label}**${at ? ` (${link(at, nameOf(at))})` : ''}${mk.description.trim() ? `: ${renderText(mk.description.trim(), link).replace(/\n/g, ' ')}` : ''} · ${mk.visibility === 'players' ? 'Known to players' : 'DM only'}`;
      }));
    }
    return out.join('\n');
  };
  const dmNotesMarkdown = (level: number, link: Linker) => {
    const out = [`${'#'.repeat(level)} DM notes and research`, '', `*Source: ${UNCLASSIFIED}. Chronicle does not record whether a DM note is canon, a plan or an idea, so none is labelled.* · *Visibility: DM only*`];
    const general = dmNotes.filter((n) => !n.article_id);
    const attached = dmNotes.filter((n) => n.article_id);
    out.push('', `${'#'.repeat(level + 1)} General notes`);
    if (!general.length) out.push('', 'None.');
    for (const n of general) out.push('', `**${n.title.trim() || 'Note'}** (${date(n.updated_at)})`, '', demoteHeadings(renderText(n.body.trim(), link), level + 2));
    if (attached.length) {
      out.push('', `${'#'.repeat(level + 1)} Notes kept on pages`, '', 'These appear in full on their pages; listed here so none is missed:');
      for (const n of attached) {
        const a = byId.get(n.article_id!)!;
        out.push(`- ${link(a, nameOf(a))}: ${n.title.trim() || 'Note'}`);
      }
    }
    if (research.collections.length) {
      out.push('', `${'#'.repeat(level + 1)} The DM's Knowledge Studio research`);
      for (const c of research.collections) {
        out.push('', `${'#'.repeat(level + 2)} ${c.title}`);
        if (c.description.trim()) out.push('', renderText(c.description.trim(), link));
        for (const n of research.notes.filter((x) => x.collection_id === c.id)) out.push('', `**${n.title.trim() || 'Note'}**`, '', demoteHeadings(renderText(n.body.trim(), link), level + 3));
        for (const s of research.sources.filter((x) => x.collection_id === c.id).sort((x, y) => x.position - y.position)) {
          const a = s.article_id ? byId.get(s.article_id) : undefined;
          out.push(`- Source${a && included.has(a.id) ? `: ${link(a, nameOf(a))}` : ''}${s.topic ? ` (${s.topic})` : ''}${s.annotation ? ` — ${s.annotation}` : ''}${s.excerpt ? ` — excerpt: ${quote(s.excerpt)}` : ''}`);
        }
      }
    }
    return out.join('\n');
  };
  const planningMarkdown = (level: number, link: Linker) => {
    const out = [`${'#'.repeat(level)} Planned, not yet played`, '', 'Material marked in Chronicle as planned and not yet played. It is listed here by name only; the text is on each page, labelled “Planned, not yet played”. None of it has happened in the campaign.'];
    const rows: string[] = [];
    for (const s of sections) if (provBySection.get(s.id)?.has('planned_unplayed')) { const a = byId.get(s.article_id)!; rows.push(`- ${link(a, nameOf(a))}: section “${s.heading.trim() || 'Text'}”`); }
    for (const f of fields) if (provByField.get(f.id)?.has('planned_unplayed')) { const a = byId.get(f.article_id)!; rows.push(`- ${link(a, nameOf(a))}: fact “${f.label}”`); }
    for (const a of included.values()) if (provByArticle.get(a.id)?.has('planned_unplayed')) rows.push(`- ${link(a, nameOf(a))} (the whole page)`);
    out.push('', ...(rows.length ? rows.sort() : [options.plans ? 'Nothing is marked as planned.' : 'Planned material was left out of this export.']));
    return out.join('\n');
  };
  const overviewMarkdown = (level: number, link: Linker) => {
    const c = data.campaign;
    const out = [`${'#'.repeat(level)} ${c?.title?.trim() || 'Campaign'} — overview`];
    if (c?.tagline?.trim()) out.push('', `*${c.tagline.trim()}*`);
    if (c?.overview?.trim()) out.push('', demoteHeadings(renderText(c.overview.trim(), link), level + 1));
    if (c?.current_status?.trim()) out.push('', `**Where the party is now:** ${renderText(c.current_status.trim(), link)}`);
    return out.join('\n');
  };

  // ---- Archive (one file per page) -------------------------------------------------------------
  const pathOf = new Map<string, string>();
  for (const g of GROUPS) {
    const used = new Set<string>();
    for (const a of sortedArticles(g.type)) pathOf.set(a.id, `${g.folder}/${fileName(a.title, a.slug, used)}`);
  }
  const relLink = (fromDir: number): Linker => (a, text) => `[${esc(text)}](<${'../'.repeat(fromDir)}${pathOf.get(a.id)}>)`;
  const archive: { path: string; text: string }[] = [];
  const put = (path: string, text: string) => archive.push({ path: `${ROOT}/${path}`, text: `${text.trim()}\n` });
  for (const g of GROUPS) for (const a of sortedArticles(g.type)) put(pathOf.get(a.id)!, articleMarkdown(a, 1, relLink(1)));
  put('Campaign-Overview.md', overviewMarkdown(1, relLink(0)));
  if (options.sessions) put('Timeline/Timeline.md', timelineMarkdown(1, relLink(1)));
  if (options.relationships) put('Relationships/Relationships.md', relationshipsMarkdown(1, relLink(1)));
  if (options.dmSecrets) put('Mysteries/Mysteries.md', mysteriesMarkdown(1, relLink(1)));
  if (maps.length) put('Maps/Maps.md', mapsMarkdown(1, relLink(1)));
  if (options.dmNotes && options.dmSecrets) put('DM-Secrets/DM-Notes.md', dmNotesMarkdown(1, relLink(1)));
  if (options.dmSecrets) put('Planning/Planned-Not-Yet-Played.md', planningMarkdown(1, relLink(1)));

  // ---- NotebookLM document -----------------------------------------------------------------------
  const nbLink: Linker = (a, text) => `[${esc(text)}](${pageUrl(a)})`;
  const units: { group: string; text: string }[] = [];
  units.push({ group: '', text: overviewMarkdown(2, nbLink) });
  for (const g of GROUPS) for (const a of sortedArticles(g.type)) units.push({ group: g.heading, text: articleMarkdown(a, 3, nbLink) });
  // These carry their own top-level heading.
  if (options.sessions) units.push({ group: '', text: timelineMarkdown(2, nbLink) });
  if (options.relationships) units.push({ group: '', text: relationshipsMarkdown(2, nbLink) });
  if (options.dmSecrets) units.push({ group: '', text: mysteriesMarkdown(2, nbLink).replace(/^## Mysteries and clues/, '## DM only: mysteries and clues') });
  if (maps.length) units.push({ group: '', text: mapsMarkdown(2, nbLink) });
  if (options.dmNotes && options.dmSecrets) units.push({ group: '', text: dmNotesMarkdown(2, nbLink).replace(/^## DM notes and research/, '## DM only: notes and research') });
  if (options.dmSecrets) units.push({ group: '', text: planningMarkdown(2, nbLink).replace(/^## Planned, not yet played/, '## DM only: planned, not yet played') });

  const stats: ExportStats = {
    articles: included.size,
    byType: Object.fromEntries(GROUPS.map((g) => [g.type, sortedArticles(g.type).length]).filter(([, n]) => n)),
    sections: sections.length, facts: fields.length, relations: relations.length, relationsOmitted, timeline: timeline.length,
    dmNotes: dmNotes.length, mysteries: mysteries.length, clues: mysteries.length ? data.clues.length : 0, maps: maps.length,
    research: research.collections.length, words: 0, labels, orphanProvenance,
  };

  const legend = legendMarkdown(options, stats, data.generatedAt);
  put('README.md', readmeMarkdown(options, stats, data.generatedAt, legend));

  // Pack units into documents under the per-source limit, keeping group headings with their units.
  const docs: string[][] = [[]];
  let count = 0;
  let lastGroup = '';
  for (const u of units) {
    const w = words(u.text);
    if (count > 0 && count + w > WORDS_PER_DOCUMENT) { docs.push([]); count = 0; lastGroup = ''; }
    const doc = docs[docs.length - 1]!;
    if (u.group && u.group !== lastGroup) doc.push(`## ${u.group}`);
    doc.push(u.text);
    lastGroup = u.group;
    count += w;
  }
  const title = data.campaign?.title?.trim() || 'Chronicle';
  const notebook = docs.map((parts, i) => {
    const part = docs.length > 1 ? ` — part ${i + 1} of ${docs.length}` : '';
    const text = [`# ${title}: campaign knowledge from Chronicle${part}`, legend, ...parts].join('\n\n');
    return { name: docs.length > 1 ? `Chronicle-Knowledge-Part-${i + 1}-of-${docs.length}.md` : 'Chronicle-Knowledge.md', text: `${text.trim()}\n` };
  });
  stats.words = notebook.reduce((n, d) => n + words(d.text), 0);
  return { archive, notebook, stats };
}

function legendMarkdown(o: ExportOptions, s: ExportStats, generatedAt: string): string {
  const zero = Object.entries(s.labels).filter(([, n]) => n === 0).map(([l]) => l);
  return [
    `*Exported from Chronicle on ${generatedAt.slice(0, 10)} by the DM. Private: ${o.dmSecrets ? 'contains DM-only secrets; do not share with players.' : 'contains only what players can read.'}*`,
    '',
    '**How to read the labels.** Every section and fact says where it came from and who knows it:',
    `- **${PROVENANCE_LABEL.official_reference}** — official Dragonlance setting material recorded in Chronicle.`,
    `- **${PROVENANCE_LABEL.table_confirmed}** — happened in a played session.`,
    `- **${PROVENANCE_LABEL.dm_confirmed}** — the DM has confirmed it as true. When it is also “DM only”, it is a DM-approved secret the players have not learned.`,
    `- **${PROVENANCE_LABEL.transcript_uncertain}** — taken from session transcripts and not yet checked; treat as uncertain.`,
    `- **${PROVENANCE_LABEL.planned_unplayed}** — a plan for the future. It has not happened.`,
    `- **${UNCLASSIFIED}** — Chronicle has no label for it. Do not assume it is canon, a plan or speculation.`,
    '- **Visibility:** “Known to players” (players can read it in Chronicle), “DM only (secret)” or “DM only (draft)”.',
    '- Gazette stories are in-world newspaper reports; a “rumor” or “satire” report is not established fact.',
    '- Connections are saved links between pages, written source → kind → target, with any custom description in quotes. Mentions in text are not connections.',
    zero.length ? `- Nothing in this export is labelled: ${zero.join('; ')}.` : null,
  ].filter((l) => l !== null).join('\n');
}

function readmeMarkdown(o: ExportOptions, s: ExportStats, generatedAt: string, legend: string): string {
  const on = (b: boolean) => (b ? 'included' : 'left out');
  const types = Object.entries(s.byType).map(([t, n]) => `- ${GROUPS.find((g) => g.type === t)?.folder ?? t}: ${n}`);
  return [
    '# Chronicle knowledge export',
    '',
    legend,
    '',
    '## What this export contains',
    `- Pages: ${s.articles}`,
    ...types,
    `- Sections: ${s.sections}; facts: ${s.facts}; saved connections: ${s.relations}${s.relationsOmitted ? ` (${s.relationsOmitted} left out because a page at one end is not exported)` : ''}`,
    `- Timeline entries: ${s.timeline}; maps: ${s.maps}; mysteries: ${s.mysteries} (clues: ${s.clues}); DM notes: ${s.dmNotes}; DM research collections: ${s.research}`,
    '',
    '## Labels used',
    ...Object.entries(s.labels).map(([l, n]) => `- ${l}: ${n}`),
    s.orphanProvenance ? `- ${s.orphanProvenance} provenance record(s) point at a section or fact that no longer exists and were ignored.` : null,
    '',
    '## Options',
    `- DM-only secrets and drafts: ${on(o.dmSecrets)}`,
    `- Planned, not yet played: ${on(o.plans)}`,
    `- DM notes and research: ${on(o.dmNotes && o.dmSecrets)}`,
    `- Session journals and timeline: ${on(o.sessions)}`,
    `- Saved connections: ${on(o.relationships)}`,
    '',
    '## Never exported',
    '- Players\' private journals and scratchpads, the party\'s investigation board, players\' own Knowledge Studio collections, bookmarks and reading lists.',
    '- Accounts, devices, access codes, invitations, feedback, revisions, import batches and anything to do with sign-in.',
    '- Pictures (each is noted as “[Picture: …]” with its caption).',
    '',
    '## Folders',
    '- `Campaign-Overview.md`, `Timeline/`, `Relationships/`, `Mysteries/`, `Maps/`, `DM-Secrets/`, `Planning/`',
    `- One file per page in ${GROUPS.map((g) => `\`${g.folder}/\``).join(', ')} (folders with no pages are absent).`,
    '',
    '## Using it with NotebookLM',
    'NotebookLM does not open ZIP files. For NotebookLM, download “NotebookLM knowledge document” instead and add that Markdown file as a source. This archive is for keeping and browsing.',
    '',
    `Generated ${generatedAt}.`,
  ].filter((l) => l !== null).join('\n');
}
