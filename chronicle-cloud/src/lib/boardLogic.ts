// Pure logic for the Investigation Board: view maths, grouping, text for the activity list, and the
// picture export. Nothing here touches the network or the page.

export const CARD_W = 200;
export const CARD_H = 96;
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2;
export const NUDGE = 20;
export const WORLD_LIMIT = 20000;

export const BOARD_COLOURS = ['parchment', 'crimson', 'azure', 'emerald', 'amber', 'violet', 'slate'] as const;
export type BoardColour = (typeof BOARD_COLOURS)[number];
export const MARKS = [
  { value: 'suspicious', label: 'Suspicious' },
  { value: 'important', label: 'Important' },
  { value: 'investigated', label: 'Investigated' },
  { value: 'unconfirmed', label: 'Unconfirmed' },
] as const;
export const THEORY_STATUS = [
  { value: 'unresolved', label: 'Unresolved' },
  { value: 'solved', label: 'Solved' },
  { value: 'disproven', label: 'Disproven' },
] as const;
export const statusLabel = (s: string | null) => THEORY_STATUS.find((t) => t.value === s)?.label ?? '';
export const colourLabel = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);

/** Light fills used by the saved picture (the page itself uses theme.css). */
export const COLOUR_HEX: Record<string, { fill: string; line: string }> = {
  parchment: { fill: '#f4e9cf', line: '#a78a4a' },
  crimson: { fill: '#f3d3d3', line: '#a33a3a' },
  azure: { fill: '#d6e6f5', line: '#3b6ea5' },
  emerald: { fill: '#d4ecd9', line: '#3b8a55' },
  amber: { fill: '#f8e3b5', line: '#b7831f' },
  violet: { fill: '#e3d8f1', line: '#7a55a8' },
  slate: { fill: '#dde1e6', line: '#5b6573' },
};

export interface View { x: number; y: number; k: number }
export const HOME_VIEW: View = { x: 40, y: 40, k: 1 };

export const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
export const clampWorld = (n: number) => Math.min(WORLD_LIMIT, Math.max(-WORLD_LIMIT, Math.round(n)));

export const screenToWorld = (v: View, sx: number, sy: number) => ({ x: (sx - v.x) / v.k, y: (sy - v.y) / v.k });

/** Zoom by a factor while keeping the point under (cx, cy) where it is. */
export function zoomAt(v: View, factor: number, cx: number, cy: number): View {
  const k = clampZoom(v.k * factor);
  const real = k / v.k;
  return { k, x: cx - (cx - v.x) * real, y: cy - (cy - v.y) * real };
}

export interface Rect { x: number; y: number; w: number; h: number }

/** A view that shows every rectangle, centred, with some padding. Empty boards get the home view. */
export function fitView(rects: Rect[], width: number, height: number, pad = 40): View {
  if (rects.length === 0 || width <= 0 || height <= 0) return { ...HOME_VIEW };
  const b = bounds(rects);
  const k = clampZoom(Math.min((width - pad * 2) / b.w, (height - pad * 2) / b.h, 1));
  return { k, x: (width - b.w * k) / 2 - b.x * k, y: (height - b.h * k) / 2 - b.y * k };
}

export function bounds(rects: Rect[]): Rect {
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Move a card by a number of pixels (keyboard), staying inside the board. */
export const nudge = (p: { x: number; y: number }, dx: number, dy: number) => ({ x: clampWorld(p.x + dx), y: clampWorld(p.y + dy) });

/** Where the line from a card's centre toward a point leaves the card's edge. */
export function edgePoint(card: Rect, toward: { x: number; y: number }) {
  const cx = card.x + card.w / 2;
  const cy = card.y + card.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const s = Math.min(dx === 0 ? Infinity : card.w / 2 / Math.abs(dx), dy === 0 ? Infinity : card.h / 2 / Math.abs(dy));
  return { x: cx + dx * s, y: cy + dy * s };
}

export function linkLine(a: Rect, b: Rect) {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const from = edgePoint(a, cb);
  const to = edgePoint(b, ca);
  return { from, to, mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } };
}

/** A place for a new card: a grid of slots starting near the middle of the view, so new cards never sit on top of each other. */
export function spawnPosition(v: View, width: number, height: number, count: number) {
  const c = screenToWorld(v, width / 2, height / 2);
  const col = count % 3;
  const row = Math.floor(count / 3) % 4;
  return {
    x: clampWorld(c.x - CARD_W * 1.5 - 20 + col * (CARD_W + 20)),
    y: clampWorld(c.y - CARD_H * 2 + row * (CARD_H + 24)),
  };
}

export interface Sectioned<T> { id: string | null; title: string; colour: string; cards: T[] }

/** Cards by section, in the order of the sections, with cards that belong to none last. */
export function groupCards<T extends { group_id: string | null; created_at: string }>(
  cards: T[], groups: { id: string; title: string; colour: string; position: number }[],
): Sectioned<T>[] {
  const byTime = (a: T, b: T) => a.created_at.localeCompare(b.created_at);
  const out: Sectioned<T>[] = [...groups].sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
    .map((g) => ({ id: g.id, title: g.title, colour: g.colour, cards: cards.filter((c) => c.group_id === g.id).sort(byTime) }));
  const loose = cards.filter((c) => !c.group_id || !groups.some((g) => g.id === c.group_id)).sort(byTime);
  if (loose.length > 0 || out.length === 0) out.push({ id: null, title: 'No section', colour: 'parchment', cards: loose });
  return out;
}

export interface ActivityRow { action: string; actor_name: string; item_kind: string; detail: string }
const kindWord = (k: string) => (k === 'pin' ? 'a pinned page' : k === 'note' ? 'a note' : k === 'theory' ? 'a theory' : 'a card');

/** "Sybil added a theory: …". A pin never has a title here, only what a member wrote. */
export function activityText(a: ActivityRow): string {
  const who = a.actor_name || 'Someone';
  const tail = a.detail && a.item_kind !== 'pin' ? `: ${a.detail}` : '';
  switch (a.action) {
    case 'added': return `${who} added ${kindWord(a.item_kind)}${tail}`;
    case 'edited': return `${who} changed ${kindWord(a.item_kind)}${tail}`;
    case 'removed': return `${who} removed ${kindWord(a.item_kind)}${tail}`;
    case 'status': return `${who} changed the status of a theory${a.detail ? ` (${a.detail})` : ''}`;
    case 'linked': return `${who} connected two cards${a.detail ? `: ${a.detail}` : ''}`;
    case 'unlinked': return `${who} removed a connection${a.detail ? `: ${a.detail}` : ''}`;
    default: return `${who} changed the board`;
  }
}

// ---------- picture export ----------

export interface ExportCard extends Rect { id: string; title: string; subtitle: string; colour: string }
export interface ExportLink { from: string; to: string; label: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Break text into at most `lines` lines of about `max` characters. */
export function wrapText(text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = word.length > max ? `${word.slice(0, max - 1)}…` : word;
    if (line && `${line} ${w}`.length > max) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  if (out.length > lines) {
    const cut = out.slice(0, lines);
    cut[lines - 1] = `${cut[lines - 1]!.slice(0, Math.max(0, max - 1))}…`;
    return cut;
  }
  return out;
}

/** The board as a standalone SVG, built only from what is already on screen. Cards and lines, no scripts. */
export function buildBoardSvg(cards: ExportCard[], links: ExportLink[], title = 'Investigation board'): string {
  const pad = 40;
  const header = 36;
  const b = cards.length ? bounds(cards) : { x: 0, y: 0, w: 320, h: 120 };
  const w = Math.ceil(b.w + pad * 2);
  const h = Math.ceil(b.h + pad * 2 + header);
  const ox = pad - b.x;
  const oy = pad + header - b.y;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Georgia, serif">`,
    `<rect width="${w}" height="${h}" fill="#fbf6e9"/>`,
    `<text x="${pad}" y="${pad - 8}" font-size="20" font-weight="700" fill="#3a2f1b">${esc(title)}</text>`,
  ];
  for (const l of links) {
    const a = byId.get(l.from);
    const c = byId.get(l.to);
    if (!a || !c) continue;
    const g = linkLine(a, c);
    parts.push(`<line x1="${g.from.x + ox}" y1="${g.from.y + oy}" x2="${g.to.x + ox}" y2="${g.to.y + oy}" stroke="#8a2a2a" stroke-width="2"/>`);
    if (l.label) parts.push(`<text x="${g.mid.x + ox}" y="${g.mid.y + oy - 4}" font-size="12" text-anchor="middle" fill="#5a1d1d">${esc(l.label)}</text>`);
  }
  for (const c of cards) {
    const hex = COLOUR_HEX[c.colour] ?? COLOUR_HEX.parchment!;
    parts.push(`<rect x="${c.x + ox}" y="${c.y + oy}" width="${c.w}" height="${c.h}" rx="6" fill="${hex.fill}" stroke="${hex.line}" stroke-width="2"/>`);
    wrapText(c.title, 24, 3).forEach((line, i) => parts.push(`<text x="${c.x + ox + 10}" y="${c.y + oy + 24 + i * 16}" font-size="14" font-weight="700" fill="#2b2415">${esc(line)}</text>`));
    if (c.subtitle) parts.push(`<text x="${c.x + ox + 10}" y="${c.y + oy + c.h - 10}" font-size="11" fill="#5b5136">${esc(wrapText(c.subtitle, 30, 1)[0] ?? '')}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
