// Family trees from stored connections only. Three connection kinds describe family:
//   parent_of  (source is a parent of target), spouse_of and sibling_of (either direction).
// Nothing is inferred beyond what the connections say, except that two people with a shared
// parent are drawn as siblings. Layout is a pure function so it can be unit-tested.

export const FAMILY_KINDS = ['parent_of', 'spouse_of', 'sibling_of'] as const;
export type FamilyKind = (typeof FAMILY_KINDS)[number];
export const isFamilyKind = (k: string): k is FamilyKind => (FAMILY_KINDS as readonly string[]).includes(k);

export interface FamilyPerson { id: string; slug: string; title: string; heroMediaId: string | null }
export interface FamilyEdge { kind: FamilyKind; source: string; target: string }

export interface PlacedPerson extends FamilyPerson {
  generation: number;
  /** Column within its generation row (0-based, may be fractional after centring). */
  x: number;
  /** How this person relates to the root, in words. */
  relation: string;
  /** True when this person has family beyond the drawn generations. */
  more: boolean;
}

export interface FamilyLayout {
  people: PlacedPerson[];
  /** Parent → child lines and spouse / sibling links between people that are drawn. */
  lines: { kind: FamilyKind; from: string; to: string }[];
  minGeneration: number;
  maxGeneration: number;
  /** Width of the widest row, in columns. */
  columns: number;
}

export const MAX_GENERATIONS = 4;
export const MAX_PEOPLE = 150;

const UP = ['parent', 'grandparent', 'great-grandparent'];
const DOWN = ['child', 'grandchild', 'great-grandchild'];

function relationWord(gen: number, direct: string | null): string {
  if (direct) return direct;
  if (gen < 0) return UP[-gen - 1] ?? `ancestor, ${-gen} generations up`;
  if (gen > 0) return DOWN[gen - 1] ?? `descendant, ${gen} generations down`;
  return 'relative';
}

export function layoutFamily(rootId: string, people: FamilyPerson[], edges: FamilyEdge[]): FamilyLayout | null {
  const byId = new Map(people.map((p) => [p.id, p]));
  if (!byId.has(rootId)) return null;
  const known = edges.filter((e) => e.source !== e.target && byId.has(e.source) && byId.has(e.target));
  const parents = new Map<string, Set<string>>();
  const children = new Map<string, Set<string>>();
  const peers = new Map<string, Map<string, 'spouse' | 'sibling'>>();
  const put = <K, V>(m: Map<K, Set<V>>, k: K, v: V) => m.set(k, (m.get(k) ?? new Set()).add(v));
  const peer = (a: string, b: string, kind: 'spouse' | 'sibling') => {
    const m = peers.get(a) ?? new Map<string, 'spouse' | 'sibling'>();
    if (!m.has(b)) m.set(b, kind);
    peers.set(a, m);
  };
  for (const e of known) {
    if (e.kind === 'parent_of') {
      put(children, e.source, e.target);
      put(parents, e.target, e.source);
    } else {
      const k = e.kind === 'spouse_of' ? 'spouse' : 'sibling';
      peer(e.source, e.target, k);
      peer(e.target, e.source, k);
    }
  }

  // Breadth-first from the root. The first generation a person is reached at wins, so a cycle in
  // the data (someone recorded as their own grandparent) cannot loop or move people around.
  const gen = new Map<string, number>([[rootId, 0]]);
  const direct = new Map<string, string>();
  const queue = [rootId];
  const more = new Set<string>();
  const visit = (from: string, to: string, g: number, word: string | null) => {
    if (gen.has(to)) return;
    if (Math.abs(g) > MAX_GENERATIONS || gen.size >= MAX_PEOPLE) {
      more.add(from);
      return;
    }
    gen.set(to, g);
    if (from === rootId && word) direct.set(to, word);
    queue.push(to);
  };
  while (queue.length) {
    const id = queue.shift()!;
    const g = gen.get(id)!;
    for (const p of parents.get(id) ?? []) visit(id, p, g - 1, 'parent');
    for (const c of children.get(id) ?? []) visit(id, c, g + 1, 'child');
    for (const [o, k] of peers.get(id) ?? []) visit(id, o, g, k);
    // Siblings through a shared parent are reached through that parent.
  }
  // Siblings of the root through a shared parent read as "sibling", not "relative".
  for (const p of parents.get(rootId) ?? []) for (const c of children.get(p) ?? []) if (c !== rootId && !direct.has(c)) direct.set(c, 'sibling');

  const placed = [...gen.keys()];
  const rows = new Map<number, string[]>();
  for (const id of placed) rows.set(gen.get(id)!, [...(rows.get(gen.get(id)!) ?? []), id]);
  const gens = [...rows.keys()].sort((a, b) => a - b);

  // Order each row: start from title order, then pull people under their parents (barycentre),
  // keeping spouses side by side. Two passes downward and one upward settle small families well.
  const x = new Map<string, number>();
  for (const g of gens) {
    const row = rows.get(g)!.sort((a, b) => byId.get(a)!.title.localeCompare(byId.get(b)!.title));
    row.forEach((id, i) => x.set(id, i));
  }
  const mean = (ids: string[]) => ids.reduce((s, i) => s + x.get(i)!, 0) / ids.length;
  const reorder = (g: number, neighbours: (id: string) => string[]) => {
    const row = rows.get(g)!;
    const key = new Map(row.map((id) => {
      const n = neighbours(id).filter((o) => x.has(o));
      return [id, n.length ? mean(n) : x.get(id)!];
    }));
    row.sort((a, b) => key.get(a)! - key.get(b)! || x.get(a)! - x.get(b)!);
    // Spouses next to each other.
    for (let i = 0; i < row.length; i++) {
      for (const [o, k] of peers.get(row[i]!) ?? []) {
        if (k !== 'spouse') continue;
        const j = row.indexOf(o);
        if (j > i + 1) {
          row.splice(j, 1);
          row.splice(i + 1, 0, o);
        }
      }
    }
    row.forEach((id, i) => x.set(id, i));
  };
  const inGen = (ids: Iterable<string>, g: number) => [...ids].filter((i) => gen.get(i) === g);
  for (let pass = 0; pass < 2; pass++) {
    for (const g of gens.slice(1)) reorder(g, (id) => inGen(parents.get(id) ?? [], g - 1));
    for (const g of gens.slice(0, -1).reverse()) reorder(g, (id) => inGen(children.get(id) ?? [], g + 1));
  }
  const columns = Math.max(...gens.map((g) => rows.get(g)!.length));
  // Centre each row under the widest one.
  for (const g of gens) {
    const row = rows.get(g)!;
    const offset = (columns - row.length) / 2;
    row.forEach((id, i) => x.set(id, i + offset));
  }

  const drawn = new Set(placed);
  const lines: FamilyLayout['lines'] = [];
  const seenLine = new Set<string>();
  for (const e of known) {
    if (!drawn.has(e.source) || !drawn.has(e.target)) continue;
    const [a, b] = e.kind === 'parent_of' ? [e.source, e.target] : [e.source, e.target].sort();
    const key = `${e.kind}|${a}|${b}`;
    if (seenLine.has(key)) continue;
    seenLine.add(key);
    // A parent line only makes sense one generation apart; anything else came from a cycle.
    if (e.kind === 'parent_of' && gen.get(b!)! - gen.get(a!)! !== 1) continue;
    if (e.kind !== 'parent_of' && gen.get(a!) !== gen.get(b!)) continue;
    lines.push({ kind: e.kind, from: a!, to: b! });
  }

  // Someone with family that was not drawn (beyond the generation cap) gets a "more" mark.
  for (const id of placed) {
    const all = [...(parents.get(id) ?? []), ...(children.get(id) ?? []), ...(peers.get(id)?.keys() ?? [])];
    if (all.some((o) => !drawn.has(o))) more.add(id);
  }

  return {
    people: placed.map((id) => ({
      ...byId.get(id)!,
      generation: gen.get(id)!,
      x: x.get(id)!,
      relation: id === rootId ? 'this character' : relationWord(gen.get(id)!, direct.get(id) ?? null),
      more: more.has(id),
    })),
    lines,
    minGeneration: gens[0]!,
    maxGeneration: gens[gens.length - 1]!,
    columns,
  };
}
