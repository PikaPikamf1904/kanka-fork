// Initiative tracker state for the table screen. Pure functions; the screen stores the state on
// this device only.

export interface Combatant { id: string; name: string; init: number; hp: number | null; maxHp: number | null; note: string; player: boolean }
export interface Encounter { combatants: Combatant[]; active: number; round: number }

export const EMPTY: Encounter = { combatants: [], active: 0, round: 1 };

/** Highest initiative first; ties keep the order they were added in. */
export function ordered(list: Combatant[]): Combatant[] {
  return list.map((c, i) => ({ c, i })).sort((a, b) => b.c.init - a.c.init || a.i - b.i).map((x) => x.c);
}

/** The combatant whose turn it is, once combat has started (before the first "next", the top of the order). */
function started(e: Encounter): string | undefined {
  return e.round > 1 || e.active > 0 ? ordered(e.combatants)[e.active]?.id : undefined;
}

export function add(e: Encounter, c: Combatant): Encounter {
  const current = started(e);
  const combatants = [...e.combatants, c];
  const active = current ? ordered(combatants).findIndex((x) => x.id === current) : 0;
  return { ...e, combatants, active };
}

export function remove(e: Encounter, id: string): Encounter {
  const list = ordered(e.combatants);
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return e;
  const combatants = e.combatants.filter((c) => c.id !== id);
  let active = e.active;
  if (idx < active) active -= 1;
  if (active >= combatants.length) active = 0;
  return { ...e, combatants, active };
}

export function next(e: Encounter): Encounter {
  if (e.combatants.length === 0) return e;
  const wrap = e.active + 1 >= e.combatants.length;
  return { ...e, active: wrap ? 0 : e.active + 1, round: wrap ? e.round + 1 : e.round };
}

export function previous(e: Encounter): Encounter {
  if (e.combatants.length === 0) return e;
  if (e.active === 0) return e.round > 1 ? { ...e, active: e.combatants.length - 1, round: e.round - 1 } : e;
  return { ...e, active: e.active - 1 };
}

export function changeHp(e: Encounter, id: string, delta: number): Encounter {
  return {
    ...e,
    combatants: e.combatants.map((c) => {
      if (c.id !== id || c.hp === null) return c;
      const hp = c.hp + delta;
      return { ...c, hp: Math.max(0, c.maxHp !== null ? Math.min(hp, c.maxHp) : hp) };
    }),
  };
}

export function update(e: Encounter, id: string, patch: Partial<Omit<Combatant, 'id'>>): Encounter {
  const current = started(e);
  const combatants = e.combatants.map((c) => (c.id === id ? { ...c, ...patch } : c));
  const active = current ? Math.max(0, ordered(combatants).findIndex((x) => x.id === current)) : 0;
  return { ...e, combatants, active };
}

/** Accepts only well-formed saved state; anything else starts fresh. */
export function parseSaved(raw: unknown): Encounter {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const r = raw as Partial<Encounter>;
  if (!Array.isArray(r.combatants)) return EMPTY;
  const combatants = r.combatants
    .filter((c): c is Combatant => !!c && typeof c === 'object' && typeof (c as Combatant).id === 'string' && typeof (c as Combatant).name === 'string')
    .slice(0, 60)
    .map((c) => ({
      id: c.id, name: String(c.name).slice(0, 80), init: Number(c.init) || 0,
      hp: typeof c.hp === 'number' ? c.hp : null, maxHp: typeof c.maxHp === 'number' ? c.maxHp : null,
      note: String(c.note ?? '').slice(0, 200), player: !!c.player,
    }));
  const active = Number.isInteger(r.active) && r.active! >= 0 && r.active! < combatants.length ? r.active! : 0;
  return { combatants, active, round: Number.isInteger(r.round) && r.round! > 0 ? r.round! : 1 };
}
