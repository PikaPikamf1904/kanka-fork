import { describe, expect, it } from 'vitest';
import {
  activityText, buildBoardSvg, CARD_H, CARD_W, clampZoom, edgePoint, fitView, groupCards, linkLine, nudge, screenToWorld, spawnPosition, wrapText, zoomAt,
} from './boardLogic.ts';

describe('view maths', () => {
  it('clamps zoom', () => {
    expect(clampZoom(10)).toBe(2);
    expect(clampZoom(0.01)).toBe(0.1);
  });
  it('keeps the point under the cursor fixed when zooming', () => {
    const v = { x: 30, y: -10, k: 1 };
    const before = screenToWorld(v, 200, 150);
    const z = zoomAt(v, 1.5, 200, 150);
    const after = screenToWorld(z, 200, 150);
    expect(z.k).toBe(1.5);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAt({ x: 0, y: 0, k: 2 }, 3, 0, 0).k).toBe(2);
  });
  it('fits cards into the viewport, never zooming in past 1', () => {
    const v = fitView([{ x: 0, y: 0, w: 100, h: 100 }], 1000, 800);
    expect(v.k).toBe(1);
    const big = fitView([{ x: 0, y: 0, w: 4000, h: 100 }, { x: 0, y: 0, w: 10, h: 10 }], 800, 600);
    expect(big.k).toBeLessThan(0.25 + 0.06);
    // Everything fits: the fitted view keeps every rectangle inside the viewport.
    for (const r of [{ x: 0, y: 0, w: 4000, h: 100 }, { x: 0, y: 0, w: 10, h: 10 }]) {
      expect(big.x + r.x * big.k).toBeGreaterThanOrEqual(0);
      expect(big.x + (r.x + r.w) * big.k).toBeLessThanOrEqual(800);
    }
    expect(fitView([], 800, 600)).toEqual({ x: 40, y: 40, k: 1 });
  });
  it('nudges inside the board', () => {
    expect(nudge({ x: 10, y: 10 }, 20, -20)).toEqual({ x: 30, y: -10 });
    expect(nudge({ x: 19990, y: 0 }, 20, 0).x).toBe(20000);
  });
  it('spawns on a grid near the middle of the view, never on top of another card', () => {
    const spots = Array.from({ length: 12 }, (_, n) => spawnPosition({ x: 0, y: 0, k: 1 }, 1000, 600, n));
    const overlap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < CARD_W && Math.abs(a.y - b.y) < CARD_H;
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) expect(overlap(spots[i]!, spots[j]!)).toBe(false);
    expect(Math.abs(spots[0]!.x + CARD_W - 500)).toBeLessThan(CARD_W * 2);
  });
});

describe('connections', () => {
  const a = { x: 0, y: 0, w: 200, h: 100 };
  const b = { x: 400, y: 0, w: 200, h: 100 };
  it('leaves each card at its edge', () => {
    expect(edgePoint(a, { x: 500, y: 50 })).toEqual({ x: 200, y: 50 });
    const l = linkLine(a, b);
    expect(l.from).toEqual({ x: 200, y: 50 });
    expect(l.to).toEqual({ x: 400, y: 50 });
    expect(l.mid).toEqual({ x: 300, y: 50 });
  });
});

describe('groupCards', () => {
  const card = (id: string, group_id: string | null, t: string) => ({ id, group_id, created_at: t });
  it('orders sections, puts loose cards last, and treats an unknown section as none', () => {
    const out = groupCards(
      [card('a', 'g2', '2'), card('b', 'g1', '1'), card('c', null, '3'), card('d', 'gone', '0')],
      [{ id: 'g2', title: 'Second', colour: 'azure', position: 2 }, { id: 'g1', title: 'First', colour: 'amber', position: 1 }],
    );
    expect(out.map((s) => [s.title, s.cards.map((c) => c.id)])).toEqual([['First', ['b']], ['Second', ['a']], ['No section', ['d', 'c']]]);
  });
  it('has a single "No section" for an empty board', () => {
    expect(groupCards([], []).map((s) => s.title)).toEqual(['No section']);
  });
});

describe('activityText', () => {
  it('never prints a title for a pin', () => {
    expect(activityText({ action: 'added', actor_name: 'Sybil', item_kind: 'pin', detail: '' })).toBe('Sybil added a pinned page');
    expect(activityText({ action: 'added', actor_name: 'Sybil', item_kind: 'pin', detail: 'Secret title' })).toBe('Sybil added a pinned page');
  });
  it('says what was written', () => {
    expect(activityText({ action: 'added', actor_name: 'Sybil', item_kind: 'theory', detail: 'The mayor did it' })).toBe('Sybil added a theory: The mayor did it');
    expect(activityText({ action: 'status', actor_name: 'Jo', item_kind: 'theory', detail: 'The mayor did it: solved' })).toContain('(The mayor did it: solved)');
    expect(activityText({ action: 'linked', actor_name: '', item_kind: 'link', detail: 'met at' })).toBe('Someone connected two cards: met at');
  });
});

describe('export', () => {
  it('wraps text', () => {
    expect(wrapText('one two three four', 8, 2)).toEqual(['one two', 'three…']);
    expect(wrapText('one two', 20, 2)).toEqual(['one two']);
    expect(wrapText('a '.repeat(50), 10, 2)).toHaveLength(2);
    expect(wrapText('x'.repeat(40), 10, 2)[0]).toBe(`${'x'.repeat(9)}…`);
  });
  it('builds an SVG with the cards and the labelled line, escaped', () => {
    const svg = buildBoardSvg(
      [
        { id: '1', x: 0, y: 0, w: 200, h: 96, title: 'Theory <script>alert(1)</script>', subtitle: 'Theory', colour: 'azure' },
        { id: '2', x: 400, y: 0, w: 200, h: 96, title: 'The Harbour', subtitle: 'Pinned page', colour: 'parchment' },
      ],
      [{ from: '1', to: '2', label: 'saw & heard' }, { from: '1', to: 'missing', label: 'ghost' }],
    );
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('<script');
    expect(svg).toContain('saw &amp; heard');
    expect(svg).not.toContain('ghost');
    expect((svg.match(/<line /g) ?? []).length).toBe(1);
    expect(svg).toContain('The Harbour');
  });
  it('handles an empty board', () => {
    expect(buildBoardSvg([], [])).toContain('</svg>');
  });
});
