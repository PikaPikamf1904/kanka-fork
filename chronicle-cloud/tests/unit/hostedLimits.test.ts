// The hosted Data API returns at most 1000 rows per request, whatever limit is asked for, and says
// nothing about the rest. A query asking for more works on a small wiki and silently loses rows on
// a big one. Larger reads must page (fetchAll in src/lib/api.ts, getAll in mcp/src/campaignTools.ts).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const MAX_ROWS = 1000;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

export function oversizedLimits(source: string): number[] {
  const found: number[] = [];
  for (const m of source.matchAll(/\.limit\((\d+)\)|[?&]limit=(\d+)/g)) {
    const n = Number(m[1] ?? m[2]);
    if (n > MAX_ROWS) found.push(n);
  }
  return found;
}

describe('queries respect the hosted 1000-row cap', () => {
  it('the checker finds limits above 1000', () => {
    expect(oversizedLimits(".limit(2000) .limit(1000) '?select=x&limit=50000'")).toEqual([2000, 50000]);
  });

  it('no website, Worker or function query asks for more than 1000 rows at once', () => {
    const bad = ['src', 'mcp', 'functions'].flatMap((d) => files(path.join(root, d)))
      .flatMap((f) => oversizedLimits(fs.readFileSync(f, 'utf8')).map((n) => `${path.relative(root, f)}: limit ${n}`));
    expect(bad).toEqual([]);
  });
});
