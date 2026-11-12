// Dice expressions for the table screen: "2d6+3", "d20", "4d6kh3", "2d20kl1-1", "1d100".
// Rolls use crypto.getRandomValues, never Math.random.

export interface DieTerm { kind: 'dice'; sign: 1 | -1; count: number; sides: number; keep?: { high: boolean; n: number }; rolls: number[]; kept: number[] }
export interface FlatTerm { kind: 'flat'; sign: 1 | -1; value: number }
export type Term = DieTerm | FlatTerm;
export interface RollResult { expression: string; terms: Term[]; total: number }

const TERM = /^(\d*)d(\d+)(?:(kh|kl)(\d+))?$|^(\d+)$/;

export function randomInt(sides: number, random: () => number = secureRandom): number {
  return Math.floor(random() * sides) + 1;
}

function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 2 ** 32;
}

/** Parses and rolls. Throws an Error with a plain message for anything it cannot read. */
export function roll(expression: string, random: () => number = secureRandom): RollResult {
  const clean = expression.toLowerCase().replace(/\s+/g, '');
  if (!clean) throw new Error('Type something like 2d6+3.');
  if (clean.length > 60) throw new Error('That expression is too long.');
  const parts = clean.match(/[+-]?[^+-]+/g);
  if (!parts) throw new Error(`Could not read “${expression}”.`);
  const terms: Term[] = [];
  let dice = 0;
  for (const raw of parts) {
    const sign: 1 | -1 = raw.startsWith('-') ? -1 : 1;
    const body = raw.replace(/^[+-]/, '');
    const m = TERM.exec(body);
    if (!m) throw new Error(`Could not read “${body}”. Try 2d6, d20, 4d6kh3 or a number.`);
    if (m[5] !== undefined) {
      terms.push({ kind: 'flat', sign, value: Number(m[5]) });
      continue;
    }
    const count = m[1] ? Number(m[1]) : 1;
    const sides = Number(m[2]);
    if (count < 1 || count > 100) throw new Error('Roll between 1 and 100 dice at a time.');
    if (sides < 2 || sides > 1000) throw new Error('Dice need between 2 and 1000 sides.');
    dice += count;
    if (dice > 200) throw new Error('That is a lot of dice. Try fewer than 200.');
    const keep = m[3] ? { high: m[3] === 'kh', n: Number(m[4]) } : undefined;
    if (keep && (keep.n < 1 || keep.n > count)) throw new Error(`Keep between 1 and ${count} dice.`);
    const rolls = Array.from({ length: count }, () => randomInt(sides, random));
    const order = rolls.map((v, i) => ({ v, i })).sort((a, b) => (keep?.high === false ? a.v - b.v : b.v - a.v));
    const keptIdx = new Set((keep ? order.slice(0, keep.n) : order).map((x) => x.i));
    const kept = rolls.filter((_, i) => keptIdx.has(i));
    terms.push({ kind: 'dice', sign, count, sides, keep, rolls, kept });
  }
  const total = terms.reduce((sum, t) => sum + t.sign * (t.kind === 'flat' ? t.value : t.kept.reduce((a, b) => a + b, 0)), 0);
  return { expression: clean, terms, total };
}

/** "2d20kh1+5" for advantage/disadvantage on a d20 check with a modifier. */
export function d20(mode: 'normal' | 'advantage' | 'disadvantage', modifier: number): string {
  const base = mode === 'advantage' ? '2d20kh1' : mode === 'disadvantage' ? '2d20kl1' : 'd20';
  return modifier ? `${base}${modifier > 0 ? '+' : '-'}${Math.abs(modifier)}` : base;
}

/** Human-readable breakdown: "2d20kh1 [17, 4] + 5". */
export function describe(r: RollResult): string {
  return r.terms
    .map((t, i) => {
      const op = i === 0 ? (t.sign < 0 ? '−' : '') : t.sign < 0 ? ' − ' : ' + ';
      if (t.kind === 'flat') return `${op}${t.value}`;
      const name = `${t.count}d${t.sides}${t.keep ? `${t.keep.high ? 'kh' : 'kl'}${t.keep.n}` : ''}`;
      return `${op}${name} [${t.rolls.join(', ')}]`;
    })
    .join('');
}
