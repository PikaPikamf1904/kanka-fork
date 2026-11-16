// Faction organisation charts from stored "Member of" connections: who belongs to a faction, grouped
// by the connection's label as their rank or role (for example "Captain"), plus sub-factions that are
// themselves "Member of" it. Nothing is inferred; only connections the reader received are used.

export interface OrgRef { id: string; slug: string; title: string; type: string }
export interface OrgRel { source: OrgRef; target: OrgRef; label: string }
export interface OrgGroup { rank: string; members: OrgRef[] }
export interface OrgUnit { faction: OrgRef; groups: OrgGroup[]; subFactions: OrgUnit[] }

const LEADER = /\b(leader|head|chief|captain|commander|master|grandmaster|queen|king|lord|lady|founder|boss|guildmaster|high)\b/i;

export function buildOrg(root: OrgRef, rels: OrgRel[], depth = 2, seen = new Set<string>()): OrgUnit {
  seen.add(root.id);
  const members = rels.filter((r) => r.target.id === root.id && r.source.id !== root.id);
  const subs = members.filter((r) => r.source.type === 'faction' && !seen.has(r.source.id));
  const people = members.filter((r) => !(r.source.type === 'faction'));
  const byRank = new Map<string, OrgRef[]>();
  for (const r of people) {
    const rank = r.label.trim() && r.label.trim().toLowerCase() !== 'member of' ? r.label.trim() : 'Members';
    const list = byRank.get(rank) ?? [];
    if (!list.some((m) => m.id === r.source.id)) list.push(r.source);
    byRank.set(rank, list);
  }
  const groups = [...byRank.entries()]
    .map(([rank, ms]) => ({ rank, members: ms.sort((a, b) => a.title.localeCompare(b.title)) }))
    // Leadership first, the plain "Members" last, others alphabetically in between.
    .sort((a, b) => (Number(LEADER.test(b.rank)) - Number(LEADER.test(a.rank))) || (Number(a.rank === 'Members') - Number(b.rank === 'Members')) || a.rank.localeCompare(b.rank));
  return {
    faction: root,
    groups,
    subFactions: depth > 0
      ? subs.sort((a, b) => a.source.title.localeCompare(b.source.title)).map((r) => buildOrg(r.source, rels, depth - 1, seen))
      : [],
  };
}

export const orgSize = (u: OrgUnit): number => u.groups.reduce((n, g) => n + g.members.length, 0) + u.subFactions.reduce((n, s) => n + 1 + orgSize(s), 0);
