import type { ExcavationElement, Point2, Trench } from '../model/project';
import { distanceToSegment, inside, signedArea } from './polygon';
import { polylineJoins, polylineSegments, rawRingSide, ringJoins, ringSegments } from './polylineOffset';
import { isClosedRing } from './trenchOutline';
import { makeCell, signedUnionVolume, unionSurfaces } from './convexExcavation';
import type { Cell } from './convexExcavation';
import { EPSILON } from '../validation/limits';

type Triangle = ReturnType<typeof unionSurfaces>[number];
type Part = { cell: Cell; top: Point2[]; a: Point2; b: Point2 };
export type TrenchNetwork = { triangles: Map<string, Triangle[]>; correction: number; connectionCount: number };
const CONTACT = 1e-6;

/** Each miter-to-miter strip is a convex loft; keep stored centerlines unchanged. */
function parts(trench: Trench): Part[] {
  const closed = isClosedRing(trench.points), nodes = closed ? trench.points.slice(0, -1) : trench.points;
  const segments = closed ? ringSegments(nodes) : polylineSegments(nodes);
  const joins = closed ? ringJoins(nodes, segments) : polylineJoins(nodes, segments);
  const half = trench.bottomWidth / 2;
  const bottomLeft = rawRingSide(nodes, joins, half, 1), bottomRight = rawRingSide(nodes, joins, half, -1);
  const topLeft = rawRingSide(nodes, joins, half + trench.depth * trench.slope, 1);
  const topRight = rawRingSide(nodes, joins, half + trench.depth * trench.slope, -1);
  return segments.map((_, i) => {
    const j = (i + 1) % nodes.length;
    const bottom = [bottomRight[i]!, bottomRight[j]!, bottomLeft[j]!, bottomLeft[i]!];
    const top = [topRight[i]!, topRight[j]!, topLeft[j]!, topLeft[i]!];
    if (signedArea(top) < 0) { top.reverse(); bottom.reverse(); }
    return { cell: makeCell(trench.id, bottom, top, trench.depth), top, a: nodes[i]!, b: nodes[j]! };
  });
}

function build(elements: ExcavationElement[]): TrenchNetwork {
  const trenches = elements.filter((e): e is Trench => e.type === 'trench').sort((a, b) => a.id.localeCompare(b.id));
  if (trenches.length < 2) return { triangles: new Map(), correction: 0, connectionCount: 0 };
  const strips = new Map(trenches.map(t => [t.id, parts(t)]));
  const connected = new Set<string>(), additions: Cell[] = [];
  let connectionCount = 0;
  for (const branch of trenches) {
    if (isClosedRing(branch.points)) continue;
    for (const atStart of [true, false]) {
      const endpoint = branch.points[atStart ? 0 : branch.points.length - 1]!;
      const next = branch.points[atStart ? 1 : branch.points.length - 2]!;
      const length = Math.hypot(endpoint.x - next.x, endpoint.y - next.y);
      const d = { x: (endpoint.x - next.x) / length, y: (endpoint.y - next.y) / length };
      const half = branch.bottomWidth / 2 + branch.depth * branch.slope;
      const cap = [1, -1].map(sign => ({ x: endpoint.x - d.y * half * sign, y: endpoint.y + d.x * half * sign }));
      let found = false;
      for (const host of trenches) {
        if (host.id === branch.id || found) continue;
        for (const part of strips.get(host.id)!) {
          const edge = part.top.findIndex((a, i) => {
            const b = part.top[(i + 1) % part.top.length]!;
            // Both corners on ONE edge, with branch pointing into the host cell.
            return cap.every(p => distanceToSegment(p, a, b) <= CONTACT) &&
              (b.x - a.x) * d.y - (b.y - a.y) * d.x > CONTACT;
          });
          if (edge < 0) continue;
          const hostDx = part.b.x - part.a.x, hostDy = part.b.y - part.a.y;
          const cross = d.x * hostDy - d.y * hostDx;
          let extension = 0;
          if (Math.abs(cross) > 1e-9) {
            extension = ((part.a.x - endpoint.x) * hostDy - (part.a.y - endpoint.y) * hostDx) / cross;
          } else {
            // Collinear end-to-end: bridge only the nanometre trim clearance.
            const a = part.top[edge]!;
            extension = (a.x - endpoint.x) * d.x + (a.y - endpoint.y) * d.y;
            extension = Math.abs(extension) <= EPSILON ? 0 : extension;
          }
          if (extension < -CONTACT || !Number.isFinite(extension)) continue;
          if (extension > 1e-9) {
            const end = { x: endpoint.x + d.x * extension, y: endpoint.y + d.y * extension };
            const connector: Trench = { ...branch, points: [endpoint, end] };
            const derived = parts(connector)[0]!;
            // Connection is local: never add an invisible hole outside the existing host opening.
            if (!derived.top.every(p => inside(p, part.top) || part.top.some((a, i) => distanceToSegment(p, a, part.top[(i + 1) % part.top.length]!) <= CONTACT))) continue;
            additions.push(derived.cell);
          }
          connected.add(branch.id); connected.add(host.id); connectionCount++; found = true; break;
        }
      }
    }
  }
  const triangles = new Map<string, Triangle[]>();
  if (!connected.size) return { triangles, correction: 0, connectionCount: 0 };
  const originals = trenches.filter(t => connected.has(t.id)).flatMap(t => strips.get(t.id)!.map(p => p.cell));
  const surfaces = unionSurfaces([...originals, ...additions]);
  const baseline = originals.reduce((sum, cell) => sum + signedUnionVolume(unionSurfaces([cell])), 0);
  for (const id of connected) triangles.set(id, []);
  for (const triangle of surfaces) triangles.get(triangle.id)!.push(triangle);
  const correction = signedUnionVolume(surfaces) - baseline;
  if (!Number.isFinite(correction) || correction < -1e-5) throw new Error('连接开挖体积异常');
  return { triangles, correction: Math.max(0, correction), connectionCount };
}

// One bounded content-key cache shares exactly the same derived geometry between
// display and quantity calculations; edits/reordering cannot reuse stale results.
let lastKey = '', lastValue: TrenchNetwork | undefined;
export function buildTrenchNetwork(elements: ExcavationElement[]): TrenchNetwork {
  const key = JSON.stringify(elements.filter(e => e.type === 'trench'));
  if (lastValue && key === lastKey) return lastValue;
  const result = build(elements); lastKey = key; lastValue = result; return result;
}
