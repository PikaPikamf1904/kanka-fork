// Kanka export -> Chronicle plan. Pure functions: no network, no database, no writes.
//
// Safety rules:
//  * Anything whose player visibility cannot be proven from the export is DM-only.
//  * Kanka's per-role permissions are NOT in the export, so even non-private entities stay
//    DM-only unless the operator passes trustPublicEntities after checking their Kanka roles.
//  * Entry HTML is reduced to Markdown text; no HTML, scripts, styles or images pass through.

export type Visibility = 'players' | 'dm';

export interface KankaEntity {
  id: number;
  name: string;
  type?: string | null;
  entry?: string | null;
  is_private?: boolean | number | null;
  is_attributes_private?: boolean | number | null;
  image_path?: string | null;
  header_image?: string | null;
  posts?: KankaPost[];
  entityAttributes?: KankaAttribute[];
  attributes?: KankaAttribute[];
  relationships?: KankaRelation[];
  entityTags?: { tag_id?: number; id?: number }[];
  [key: string]: unknown;
}

export interface KankaPost {
  id: number;
  name?: string | null;
  entry?: string | null;
  visibility_id?: number | null;
  is_private?: boolean | number | null;
  position?: number | null;
}

export interface KankaAttribute {
  id: number;
  name: string;
  value?: string | null;
  type_id?: number | null;
  is_private?: boolean | number | null;
  is_hidden?: boolean | number | null;
  default_order?: number | null;
}

export interface KankaRelation {
  id: number;
  owner_id: number;
  target_id: number;
  relation?: string | null;
  visibility_id?: number | null;
}

/** One exported file: a module folder plus the child model, which nests the entity. */
export interface KankaRecord {
  module: string;
  file: string;
  model: Record<string, unknown> & { id?: number; name?: string; entity?: KankaEntity };
}

export type ArticleType = 'lore' | 'character' | 'location' | 'faction' | 'item' | 'quest' | 'session' | 'event' | 'dossier';

export const MODULE_TYPES: Record<string, ArticleType> = {
  characters: 'character',
  locations: 'location',
  organisations: 'faction',
  families: 'faction',
  items: 'item',
  quests: 'quest',
  journals: 'session',
  events: 'event',
  notes: 'lore',
  races: 'lore',
  creatures: 'lore',
  abilities: 'lore',
  timelines: 'lore',
  calendars: 'lore',
};

/** Child-model fields worth showing in the infobox, per module. */
const INFOBOX_FIELDS: Record<string, [string, string][]> = {
  characters: [['title', 'Title'], ['age', 'Age'], ['sex', 'Sex'], ['pronouns', 'Pronouns'], ['is_dead', 'Status']],
  locations: [['type', 'Type']],
  organisations: [['type', 'Type']],
  families: [['type', 'Type']],
  items: [['type', 'Item type'], ['price', 'Price'], ['size', 'Size']],
  quests: [['type', 'Type'], ['is_completed', 'Status']],
  journals: [['type', 'Type'], ['date', 'Date']],
  events: [['type', 'Type'], ['date', 'Date']],
  notes: [['type', 'Type']],
};

const truthy = (v: unknown) => v === true || v === 1 || v === '1';
/** Only these mean "not private". Anything unrecognised ('yes', 2, an object) is treated as private. */
const explicitlyFalse = (v: unknown) => v === false || v === 0 || v === '0';
/** A privacy flag that is absent is not set; one that is present must be explicitly false to count as public. */
const flagSet = (v: unknown) => v !== undefined && v !== null && !explicitlyFalse(v);

export interface Decision {
  visibility: Visibility;
  reason: string;
}

export interface Options {
  trustPublicEntities: boolean;
}

export function entityVisibility(entity: KankaEntity, opts: Options): Decision {
  if (entity.is_private === undefined || entity.is_private === null) return { visibility: 'dm', reason: 'privacy unknown' };
  if (truthy(entity.is_private)) return { visibility: 'dm', reason: 'private (admin only) in Kanka' };
  if (!explicitlyFalse(entity.is_private)) return { visibility: 'dm', reason: 'privacy value not recognised' };
  if (!opts.trustPublicEntities) return { visibility: 'dm', reason: 'Kanka role permissions are not in the export' };
  return { visibility: 'players', reason: 'not private in Kanka (trusted by --trust-public-entities)' };
}

const KANKA_VISIBILITY: Record<number, string> = { 1: 'All', 2: 'Admin', 3: 'Admin and self', 4: 'Self', 5: 'Members' };

export function postVisibility(post: KankaPost, parent: Decision): Decision {
  if (flagSet(post.is_private)) return { visibility: 'dm', reason: 'post is private' };
  if (post.visibility_id !== 1) {
    const name = post.visibility_id ? KANKA_VISIBILITY[post.visibility_id] ?? `unknown (${post.visibility_id})` : 'unknown';
    return { visibility: 'dm', reason: `post visibility: ${name}` };
  }
  return parent.visibility === 'players' ? { visibility: 'players', reason: 'post visible to all' } : { visibility: 'dm', reason: `parent is DM-only (${parent.reason})` };
}

export function attributeVisibility(attr: KankaAttribute, entity: KankaEntity, parent: Decision): Decision {
  if (flagSet(entity.is_attributes_private)) return { visibility: 'dm', reason: 'entity attributes are private' };
  if (flagSet(attr.is_private)) return { visibility: 'dm', reason: 'attribute is private' };
  if (flagSet(attr.is_hidden)) return { visibility: 'dm', reason: 'attribute is hidden' };
  return parent.visibility === 'players' ? { visibility: 'players', reason: 'attribute visible' } : { visibility: 'dm', reason: 'parent is DM-only' };
}

export function relationVisibility(rel: KankaRelation, ends: [Decision, Decision]): Decision {
  if (rel.visibility_id !== 1) return { visibility: 'dm', reason: 'relation not visible to all' };
  if (ends.some((e) => e.visibility !== 'players')) return { visibility: 'dm', reason: 'an end is DM-only' };
  return { visibility: 'players', reason: 'relation visible to all' };
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+[0-9]*);/gi, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return ENTITIES[lower] ?? match;
  });
}

/**
 * Reduce Kanka entry HTML to Markdown. Structure that Markdown can express is kept; everything
 * else is reduced to its text. Images and embeds are dropped (and counted) because media is
 * imported separately with its own visibility.
 */
export function htmlToMarkdown(html: string, stats: { droppedImages: number } = { droppedImages: 0 }): string {
  let s = html ?? '';
  s = s.replace(/<(script|style|iframe|object|embed|svg)[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<img\b[^>]*>/gi, () => {
    stats.droppedImages++;
    return '';
  });
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) =>
    `\n\n${'#'.repeat(Math.min(Number(level) + 1, 4))} ${inner.trim()}\n\n`);
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => (inner.trim() ? `**${inner.trim()}**` : ''));
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => (inner.trim() ? `*${inner.trim()}*` : ''));
  s = s.replace(/<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) =>
    /^https?:\/\//i.test(href) ? `[${inner.replace(/<[^>]+>/g, '').trim()}](${href})` : inner);
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) =>
    `\n\n${inner.replace(/<[^>]+>/g, '').trim().split('\n').map((l) => `> ${l}`).join('\n')}\n\n`);
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => {
    let n = 0;
    return `\n\n${inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_x, li: string) => `${++n}. ${li.replace(/<[^>]+>/g, '').trim()}\n`)}\n`;
  });
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `- ${inner.replace(/<[^>]+>/g, '').trim()}\n`);
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
  s = s.replace(/<\/(p|div|section|article|table|tr)>/gi, '\n\n');
  s = s.replace(/<\/t[dh]>/gi, ' | ');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** Turn Kanka mentions ([type:id] or [type:id|text|...]) into [[slug|text]] links. */
export function convertMentions(
  text: string,
  lookup: (entityId: number) => { slug: string; title: string; hidden?: boolean } | undefined,
  unknown: number[] = [],
  redacted: { count: number } = { count: 0 },
): string {
  return text.replace(/\[([a-z_-]+):(\d+)(?:\|([^\]]*))?\]/gi, (_m, _type: string, id: string, rest?: string) => {
    const target = lookup(Number(id));
    const label = rest?.split('|')[0]?.trim();
    if (!target) {
      unknown.push(Number(id));
      return label || '(unknown reference)';
    }
    // In player-visible text, a DM-only page's title and slug must not appear.
    if (target.hidden) {
      redacted.count++;
      return label || '(unrevealed)';
    }
    return label && label !== target.title ? `[[${target.slug}|${label}]]` : `[[${target.slug}|${target.title}]]`;
  });
}

export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------

export interface PlannedArticle {
  sourceRef: string;
  kankaEntityId: number;
  module: string;
  type: ArticleType;
  slug: string;
  title: string;
  summary: string;
  visibility: Visibility;
  reason: string;
  sections: { heading: string; body: string; visibility: Visibility; reason: string }[];
  infobox: { label: string; value: string; visibility: Visibility }[];
  tagIds: number[];
  images: string[];
}

export interface PlannedCategory {
  sourceRef: string;
  slug: string;
  name: string;
  visibility: Visibility;
}

export interface PlannedRelation {
  sourceRef: string;
  source: string;
  target: string;
  label: string;
  visibility: Visibility;
}

export interface Plan {
  articles: PlannedArticle[];
  categories: PlannedCategory[];
  relations: PlannedRelation[];
  report: {
    byType: Record<string, number>;
    byVisibility: Record<Visibility, number>;
    wouldBePlayersWithTrust: number;
    skippedModules: Record<string, number>;
    duplicateNames: { name: string; ids: number[] }[];
    unknownMentions: number[];
    droppedInlineImages: number;
    mentionsRedacted: number;
    imagesReferenced: number;
    sectionsDmOnly: number;
    infoboxDmOnly: number;
    relationsDmOnly: number;
    relationsMissingEnd: number;
    reasons: Record<string, number>;
    /** Files skipped because their content is not a usable Kanka record. */
    malformedFiles: string[];
    /** Files skipped because an earlier file already supplied the same entity id. */
    duplicateEntityFiles: string[];
    /** Posts, attributes or relations dropped because they were not usable. */
    droppedParts: number;
  };
}

// ---------------------------------------------------------------------------------------------
// Input hardening. A real export can contain truncated or hand-edited files; one bad file must
// never abort the run or, worse, half-apply it. Anything unusable is skipped and reported.
// ---------------------------------------------------------------------------------------------
export interface Sanitized {
  records: KankaRecord[];
  malformedFiles: string[];
  duplicateEntityFiles: string[];
  droppedParts: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asText = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const asId = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : null;
};

export function sanitizeRecords(input: KankaRecord[]): Sanitized {
  const out: Sanitized = { records: [], malformedFiles: [], duplicateEntityFiles: [], droppedParts: 0 };
  const seen = new Set<number>();
  const objects = (value: unknown): Record<string, unknown>[] => {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) {
      out.droppedParts++;
      return [];
    }
    const kept = value.filter(isObject);
    out.droppedParts += value.length - kept.length;
    return kept;
  };

  for (const r of input) {
    const where = `${r.module}/${r.file}`;
    if (!isObject(r.model)) {
      out.malformedFiles.push(where);
      continue;
    }
    const raw = r.model.entity as unknown;
    if (raw === undefined || raw === null) {
      // Tags and some modules carry no nested entity; pass them through untouched.
      out.records.push(r);
      continue;
    }
    const id = isObject(raw) ? asId(raw.id) : null;
    if (!isObject(raw) || id === null) {
      out.malformedFiles.push(where);
      continue;
    }
    if (r.module !== 'tags') {
      if (seen.has(id)) {
        out.duplicateEntityFiles.push(where);
        continue;
      }
      seen.add(id);
    }
    const attributes = (list: unknown) =>
      objects(list).map((a) => ({ ...a, id: asId(a.id) ?? 0, name: asText(a.name) ?? '', value: asText(a.value) })) as KankaAttribute[];
    const relationships = objects(raw.relationships).flatMap((x) => {
      const relId = asId(x.id);
      const owner = asId(x.owner_id);
      const target = asId(x.target_id);
      if (relId === null || owner === null || target === null) {
        out.droppedParts++;
        return [];
      }
      return [{ ...x, id: relId, owner_id: owner, target_id: target, relation: asText(x.relation) } as KankaRelation];
    });
    const entity: KankaEntity = {
      ...raw,
      id,
      name: asText(raw.name) ?? '',
      entry: asText(raw.entry),
      image_path: typeof raw.image_path === 'string' ? raw.image_path : null,
      header_image: typeof raw.header_image === 'string' ? raw.header_image : null,
      posts: objects(raw.posts).map((x) => ({ ...x, id: asId(x.id) ?? 0, name: asText(x.name), entry: asText(x.entry) })) as KankaPost[],
      relationships,
      entityTags: objects(raw.entityTags) as KankaEntity['entityTags'],
    };
    if (raw.entityAttributes !== undefined && raw.entityAttributes !== null) entity.entityAttributes = attributes(raw.entityAttributes);
    else delete entity.entityAttributes;
    if (raw.attributes !== undefined && raw.attributes !== null) entity.attributes = attributes(raw.attributes);
    else delete entity.attributes;
    out.records.push({ ...r, model: { ...r.model, entity } });
  }
  return out;
}

export function buildPlan(input: KankaRecord[], opts: Options): Plan {
  const sanitized = sanitizeRecords(input);
  const records = sanitized.records;
  const tagRecords = records.filter((r) => r.module === 'tags');
  const entityRecords = records.filter((r) => r.module !== 'tags' && r.model.entity);
  const skippedModules: Record<string, number> = {};
  for (const r of records) {
    if (r.module !== 'tags' && !MODULE_TYPES[r.module] && r.model.entity) skippedModules[r.module] = (skippedModules[r.module] ?? 0) + 1;
  }

  // Deterministic slugs: sort by Kanka entity id, then suffix collisions.
  const usable = entityRecords
    .filter((r) => MODULE_TYPES[r.module])
    .sort((a, b) => (a.model.entity!.id ?? 0) - (b.model.entity!.id ?? 0));
  const taken = new Set<string>();
  const byEntity = new Map<number, { slug: string; title: string; decision: Decision }>();
  const nameCount = new Map<string, number[]>();
  for (const r of usable) {
    const e = r.model.entity!;
    const title = (e.name || String(r.model.name ?? '')).trim() || `Untitled ${e.id}`;
    let slug = slugify(title) || `entry-${e.id}`;
    if (taken.has(slug)) slug = `${slug}-${e.id}`;
    taken.add(slug);
    byEntity.set(e.id, { slug, title, decision: entityVisibility(e, opts) });
    const key = `${r.module}:${title.toLowerCase()}`;
    nameCount.set(key, [...(nameCount.get(key) ?? []), e.id]);
  }

  const reasons: Record<string, number> = {};
  const count = (reason: string) => (reasons[reason] = (reasons[reason] ?? 0) + 1);
  const unknownMentions: number[] = [];
  const stats = { droppedImages: 0 };
  const redacted = { count: 0 };
  // Text that players will see may only name pages players can see.
  const text = (html: string | null | undefined, audience: Visibility) =>
    convertMentions(htmlToMarkdown(html ?? '', stats), (id) => {
      const t = byEntity.get(id);
      return t && { ...t, hidden: audience === 'players' && t.decision.visibility !== 'players' };
    }, unknownMentions, redacted);

  const articles: PlannedArticle[] = [];
  const relations: PlannedRelation[] = [];
  let sectionsDmOnly = 0;
  let infoboxDmOnly = 0;
  let relationsDmOnly = 0;
  let relationsMissingEnd = 0;
  let trusted = 0;

  for (const r of usable) {
    const e = r.model.entity!;
    const meta = byEntity.get(e.id)!;
    const decision = meta.decision;
    count(decision.reason);
    if (explicitlyFalse(e.is_private)) trusted++;

    const sections: PlannedArticle['sections'] = [];
    const entry = text(e.entry, decision.visibility);
    if (entry) sections.push({ heading: 'Overview', body: entry, visibility: decision.visibility, reason: decision.reason });
    const posts = [...(e.posts ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    for (const p of posts) {
      const d = postVisibility(p, decision);
      if (d.visibility === 'dm') sectionsDmOnly++;
      sections.push({ heading: (p.name ?? '').trim() || 'Notes', body: text(p.entry, d.visibility), visibility: d.visibility, reason: d.reason });
    }

    const infobox: PlannedArticle['infobox'] = [];
    for (const [field, label] of INFOBOX_FIELDS[r.module] ?? []) {
      const value = r.model[field];
      if (value === null || value === undefined || value === '' || value === false || value === 0) continue;
      const shown = field === 'is_dead' ? 'Dead' : field === 'is_completed' ? 'Completed' : String(value);
      infobox.push({ label, value: shown, visibility: decision.visibility });
    }
    for (const a of [...(e.entityAttributes ?? e.attributes ?? [])].sort((x, y) => (x.default_order ?? 0) - (y.default_order ?? 0))) {
      if (!a.name?.trim()) continue;
      const d = attributeVisibility(a, e, decision);
      if (d.visibility === 'dm') infoboxDmOnly++;
      infobox.push({ label: a.name.trim().slice(0, 80), value: text(a.value ?? '', d.visibility), visibility: d.visibility });
    }

    for (const rel of e.relationships ?? []) {
      const source = byEntity.get(rel.owner_id);
      const target = byEntity.get(rel.target_id);
      if (!source || !target) {
        relationsMissingEnd++;
        continue;
      }
      const d = relationVisibility(rel, [source.decision, target.decision]);
      if (d.visibility === 'dm') relationsDmOnly++;
      relations.push({ sourceRef: `kanka:relation:${rel.id}`, source: source.slug, target: target.slug, label: (rel.relation ?? '').slice(0, 120), visibility: d.visibility });
    }

    const summarySource = sections.find((s) => s.visibility === decision.visibility)?.body ?? '';
    articles.push({
      sourceRef: `kanka:entity:${e.id}`,
      kankaEntityId: e.id,
      module: r.module,
      type: MODULE_TYPES[r.module]!,
      slug: meta.slug,
      title: meta.title,
      // The summary is shown wherever the article is; only take it from same-visibility text.
      summary: summarySource.replace(/[#*>[\]]/g, '').split('\n').find((l) => l.trim())?.slice(0, 280) ?? '',
      visibility: decision.visibility,
      reason: decision.reason,
      sections,
      infobox,
      tagIds: (e.entityTags ?? []).map((t) => Number(t.tag_id ?? t.id)).filter((n) => Number.isFinite(n)),
      images: [e.image_path, e.header_image].filter((p): p is string => typeof p === 'string' && p.length > 0 && !p.includes('?')),
    });
  }

  const categories: PlannedCategory[] = [];
  const tagSlugs = new Set<string>();
  for (const t of tagRecords) {
    const e = t.model.entity;
    const id = Number(t.model.id ?? e?.id);
    const name = String(t.model.name ?? e?.name ?? '').trim();
    if (!name) continue;
    let slug = slugify(name) || `tag-${id}`;
    if (tagSlugs.has(slug)) slug = `${slug}-${id}`;
    tagSlugs.add(slug);
    const d = e ? entityVisibility(e, opts) : { visibility: 'dm' as const, reason: 'privacy unknown' };
    categories.push({ sourceRef: `kanka:tag:${id}`, slug, name, visibility: d.visibility });
  }

  const byType: Record<string, number> = {};
  const byVisibility: Record<Visibility, number> = { players: 0, dm: 0 };
  for (const a of articles) {
    byType[a.type] = (byType[a.type] ?? 0) + 1;
    byVisibility[a.visibility]++;
  }

  return {
    articles,
    categories,
    relations,
    report: {
      byType,
      byVisibility,
      wouldBePlayersWithTrust: trusted,
      skippedModules,
      duplicateNames: [...nameCount.entries()].filter(([, ids]) => ids.length > 1).map(([k, ids]) => ({ name: k, ids })),
      unknownMentions: [...new Set(unknownMentions)].sort((a, b) => a - b),
      droppedInlineImages: stats.droppedImages,
      mentionsRedacted: redacted.count,
      imagesReferenced: articles.reduce((n, a) => n + a.images.length, 0),
      sectionsDmOnly,
      infoboxDmOnly,
      relationsDmOnly,
      relationsMissingEnd,
      reasons,
      malformedFiles: sanitized.malformedFiles,
      duplicateEntityFiles: sanitized.duplicateEntityFiles,
      droppedParts: sanitized.droppedParts,
    },
  };
}
