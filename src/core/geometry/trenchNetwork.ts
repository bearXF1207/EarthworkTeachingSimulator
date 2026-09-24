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
/** 与 `trenchTrim` 一致的收边缝隙（米）。 */
const TRIM_CLEARANCE = 1e-8;
/** 数值余量（米）：0.1mm，远小于任何工程尺寸，只吸收浮点与投影换算误差。 */
const CAP_SLACK = 1e-4;
/**
 * 端面明显斜交时的外偏上限（米）：超过它说明支槽是斜着穿过边界而不是贴端对接，不做连接。
 */
const MAX_CAP_OFFSET = 0.25;

/**
 * 端面贴合带（米）——上下界都是收边几何的直接签名：
 * 端面垂直于支槽中心线（butt cap），与斜交的相邻边界不可能共面，收边因此把端面推到边界之外，
 * 近端角点恰好贴住边界（`trenchTrim` 只让出纳米的法向净距），远端角点最多外移
 * `2×顶半宽×|u·ĥ|`（`u` 为支槽向外方向、`ĥ` 为被贴合边界方向）。
 * 连接判定要求端面正好落进这条带：近端角点必须贴到边界，远端角点不超过倾角隐含的外偏。
 */
function capBand(direction: Point2, edge: Point2, halfWidth: number): { near: number; far: number } {
  const size = Math.hypot(edge.x, edge.y);
  const oblique = size > 0 ? Math.abs((direction.x * edge.x + direction.y * edge.y) / size) : 0;
  const slack = TRIM_CLEARANCE + CONTACT + CAP_SLACK;
  return { near: slack, far: Math.min(2 * halfWidth * oblique, MAX_CAP_OFFSET) + slack };
}

/** 每个 miter 到 miter 的条带是一个凸棱柱单元；存储的中心线始终不被改写。 */
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
          if (found) break;
          for (let i = 0; i < part.top.length; i++) {
            const a = part.top[i]!, b = part.top[(i + 1) % part.top.length]!;
            const size = Math.hypot(b.x - a.x, b.y - a.y);
            if (!(size > CONTACT)) continue;
            // 逆时针顶口的向外法向：离开槽体的一侧。
            const outward = { x: (b.y - a.y) / size, y: -(b.x - a.x) / size };
            const band = capBand(d, { x: b.x - a.x, y: b.y - a.y }, half);
            // 两个角点的外偏与沿边位置必须同时落在同一条边界的贴合带内：近端贴住边界、远端不超过倾角上界。
            const offsets = cap.map(p => (p.x - a.x) * outward.x + (p.y - a.y) * outward.y);
            const fits = cap.every((p, index) => {
              const offset = offsets[index]!;
              const along = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / size;
              return offset >= -CONTACT && offset <= band.far && along >= -band.far && along <= size + band.far;
            }) && Math.min(...offsets) <= band.near;
            if (!fits) continue;
            if (d.x * outward.x + d.y * outward.y >= -CONTACT) continue;
            const hostDx = part.b.x - part.a.x, hostDy = part.b.y - part.a.y;
            const cross = d.x * hostDy - d.y * hostDx;
            let extension = 0;
            if (Math.abs(cross) > 1e-9) {
              extension = ((part.a.x - endpoint.x) * hostDy - (part.a.y - endpoint.y) * hostDx) / cross;
            } else {
              // 共线端面对接：只桥接纳米的收边缝隙。
              extension = (a.x - endpoint.x) * d.x + (a.y - endpoint.y) * d.y;
              extension = Math.abs(extension) <= EPSILON ? 0 : extension;
            }
            if (extension < -CONTACT || !Number.isFinite(extension)) continue;
            if (extension > 1e-9) {
              const end = { x: endpoint.x + d.x * extension, y: endpoint.y + d.y * extension };
              const connector: Trench = { ...branch, points: [endpoint, end] };
              const derived = parts(connector)[0]!;
              // 连接只发生在贴合带内：端面可以带入收边留下的外偏，更远处一律放弃，
              // 避免在既有开口之外制造不可见开挖。
              if (!derived.top.every(p => inside(p, part.top) || distanceToSegment(p, a, b) <= band.far)) continue;
              additions.push(derived.cell);
            }
            connected.add(branch.id); connected.add(host.id); connectionCount++; found = true; break;
          }
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

// 以内容为键的有界缓存（只保留一条）：显示与计量共用同一份派生几何；
// 编辑或数组重排都会改变键，因此不会复用陈旧结果。
let lastKey = '', lastValue: TrenchNetwork | undefined;
export function buildTrenchNetwork(elements: ExcavationElement[]): TrenchNetwork {
  const key = JSON.stringify(elements.filter(e => e.type === 'trench'));
  if (lastValue && key === lastKey) return lastValue;
  const result = build(elements); lastKey = key; lastValue = result; return result;
}
