// Deterministic force-directed layout for the connections web (no randomness, so the same
// connections always draw the same picture). Small graphs only: O(n²) per step.

export interface LayoutNode { id: string; x: number; y: number }
export interface LayoutEdge { source: string; target: string }

export function layout(ids: string[], edges: LayoutEdge[], opts: { width?: number; height?: number; steps?: number } = {}): Map<string, { x: number; y: number }> {
  const width = opts.width ?? 1000;
  const height = opts.height ?? 700;
  const steps = opts.steps ?? 320;
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  // Start on a golden-angle spiral: spread out and deterministic.
  for (let i = 0; i < n; i++) {
    const r = 30 * Math.sqrt(i + 1);
    const a = i * 2.399963229728653;
    x[i] = width / 2 + r * Math.cos(a);
    y[i] = height / 2 + r * Math.sin(a);
  }
  const links = edges.map((e) => [index.get(e.source), index.get(e.target)]).filter((p): p is [number, number] => p[0] !== undefined && p[1] !== undefined && p[0] !== p[1]);
  const ideal = Math.max(60, Math.min(160, Math.sqrt((width * height) / Math.max(n, 1)) * 0.75));
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let step = 0; step < steps; step++) {
    const cool = 1 - step / steps;
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = x[i]! - x[j]!;
        let ey = y[i]! - y[j]!;
        let d2 = ex * ex + ey * ey;
        if (d2 < 0.01) { ex = 0.1 * (i - j); ey = 0.1; d2 = ex * ex + ey * ey; }
        const f = (ideal * ideal) / d2;
        dx[i]! += ex * f * 0.05; dy[i]! += ey * f * 0.05;
        dx[j]! -= ex * f * 0.05; dy[j]! -= ey * f * 0.05;
      }
    }
    for (const [a, b] of links) {
      const ex = x[b]! - x[a]!;
      const ey = y[b]! - y[a]!;
      const d = Math.sqrt(ex * ex + ey * ey) || 1;
      const f = ((d - ideal) / d) * 0.1;
      dx[a]! += ex * f; dy[a]! += ey * f;
      dx[b]! -= ex * f; dy[b]! -= ey * f;
    }
    for (let i = 0; i < n; i++) {
      dx[i]! += (width / 2 - x[i]!) * 0.01;
      dy[i]! += (height / 2 - y[i]!) * 0.01;
      const len = Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!);
      const max = 40 * cool + 1;
      const s = len > max ? max / len : 1;
      x[i]! += dx[i]! * s;
      y[i]! += dy[i]! * s;
    }
  }
  // Fit into the box with a margin.
  const pad = 60;
  const minX = Math.min(...x), maxX = Math.max(...x), minY = Math.min(...y), maxY = Math.max(...y);
  const sx = (width - 2 * pad) / Math.max(maxX - minX, 1);
  const sy = (height - 2 * pad) / Math.max(maxY - minY, 1);
  const s = Math.min(sx, sy, 1.5);
  const out = new Map<string, { x: number; y: number }>();
  ids.forEach((id, i) => {
    out.set(id, {
      x: n === 1 ? width / 2 : pad + (x[i]! - minX) * s + (width - 2 * pad - (maxX - minX) * s) / 2,
      y: n === 1 ? height / 2 : pad + (y[i]! - minY) * s + (height - 2 * pad - (maxY - minY) * s) / 2,
    });
  });
  return out;
}
