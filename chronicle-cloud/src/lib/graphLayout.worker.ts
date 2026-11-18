// Lays out a large Knowledge Graph off the main thread, so the page stays responsive. Receives ids
// and edges only (no titles), returns positions.
import { forceCenter, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force';

interface In { nodes: { id: string; x?: number; y?: number }[]; edges: { source: string; target: string }[] }
type N = SimulationNodeDatum & { id: string };

self.onmessage = (e: MessageEvent<In>) => {
  const nodes: N[] = e.data.nodes.map((n) => ({ ...n }));
  const sim = forceSimulation<N>(nodes)
    .force('link', forceLink<N, { source: string; target: string }>(e.data.edges.map((x) => ({ ...x }))).id((d) => d.id).distance(80).strength(0.4))
    .force('charge', forceManyBody<N>().strength(-40).theta(1.2).distanceMax(600))
    .force('centre', forceCenter(0, 0))
    .alphaDecay(0.05)
    .stop();
  for (let i = 0; i < 120; i++) sim.tick();
  (self as unknown as Worker).postMessage(nodes.map((n) => [n.id, n.x ?? 0, n.y ?? 0]));
};
