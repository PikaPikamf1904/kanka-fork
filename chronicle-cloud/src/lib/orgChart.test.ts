import { describe, expect, it } from 'vitest';
import { buildOrg, orgSize, type OrgRef } from './orgChart.ts';

const ref = (id: string, type = 'character'): OrgRef => ({ id, slug: id, title: id.toUpperCase(), type });
const guild = ref('guild', 'faction');
const wing = ref('wing', 'faction');

describe('buildOrg', () => {
  it('groups members by rank with leaders first, nests sub-factions and never loops', () => {
    const u = buildOrg(guild, [
      { source: ref('ann'), target: guild, label: 'Guildmaster' },
      { source: ref('bob'), target: guild, label: '' },
      { source: ref('cy'), target: guild, label: 'Archivist' },
      { source: ref('bob'), target: guild, label: '' }, // duplicate connection
      { source: wing, target: guild, label: '' },
      { source: ref('dee'), target: wing, label: 'Captain' },
      { source: guild, target: wing, label: '' }, // a cycle in the data
    ]);
    expect(u.groups.map((g) => [g.rank, g.members.map((m) => m.id)])).toEqual([['Guildmaster', ['ann']], ['Archivist', ['cy']], ['Members', ['bob']]]);
    expect(u.subFactions.map((s) => [s.faction.id, s.groups[0]!.rank])).toEqual([['wing', 'Captain']]);
    expect(u.subFactions[0]!.subFactions).toEqual([]);
    expect(orgSize(u)).toBe(5);
  });
});
