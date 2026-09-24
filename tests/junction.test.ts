import { describe, expect, it } from 'vitest';
import { FrontSide, Mesh, Raycaster, Vector3 } from 'three';
import type { MeshStandardMaterial } from 'three';
import { totalVolume } from '../src/core/calculation/quantities';
import { trenchOutlines } from '../src/core/geometry/trenchOutline';
import type { Point2, Trench } from '../src/core/model/project';
import { GroundManager } from '../src/scene/GroundManager';
import { ExcavationMeshes } from '../src/scene/MeshFactory';

const p = (x: number, y: number): Point2 => ({ x, y });
const section = { bottomWidth: 2, depth: 2, slope: .5 };
/** 40m 方环，顶内边界 y=38、底内边界 y=39。 */
const ring: Trench = { id: 'ring', type: 'trench', points: [p(0, 0), p(40, 0), p(40, 40), p(0, 40), p(0, 0)], ...section };
const island: Trench = { id: 'island', type: 'trench', points: [p(20, 10), p(20, 38)], ...section };
type Hit = { name: string; point: Vector3; side: number; facing: number };

/** 有限线段求交：不能把远处外墙误当作接口畅通的证明，也不让中心线抢先命中。 */
function probe(meshes: ExcavationMeshes, ground: GroundManager, from: Vector3, to: Vector3): Hit[] {
  meshes.root.updateMatrixWorld(true); ground.root.updateMatrixWorld(true);
  const direction = to.clone().sub(from).normalize();
  return new Raycaster(from, direction, 1e-6, from.distanceTo(to) - 1e-6)
    .intersectObjects([meshes.root, ground.root], true)
    .filter(hit => hit.object instanceof Mesh)
    .map(hit => {
      const raw = (hit.object as Mesh).material as MeshStandardMaterial | MeshStandardMaterial[];
      const material = Array.isArray(raw) ? raw[hit.face?.materialIndex ?? 0]! : raw;
      return { name: hit.object.name, point: hit.point, side: material.side,
        facing: (hit.face?.normal ?? new Vector3()).dot(direction) };
    });
}

function withScene(elements: Trench[], check: (meshes: ExcavationMeshes, ground: GroundManager) => void): void {
  const meshes = new ExcavationMeshes(elements);
  let ground: GroundManager | undefined;
  try {
    ground = new GroundManager(meshes.holes, 100, meshes.islands);
    check(meshes, ground);
  } finally { ground?.dispose(); meshes.dispose(); }
}

function expectPassage(meshes: ExcavationMeshes, ground: GroundManager, a: Vector3, b: Vector3): void {
  expect(probe(meshes, ground, a, b), '从支槽往主槽不应遇到接口内部墙').toHaveLength(0);
  expect(probe(meshes, ground, b, a), '反方向也必须畅通，不能靠背面剔除伪装连通').toHaveLength(0);
}

function expectFloor(meshes: ExcavationMeshes, ground: GroundManager, x: number, y: number, z = -2): void {
  const hits = probe(meshes, ground, new Vector3(x, y, 10), new Vector3(x, y, z - 1));
  expect(hits.length, '接口土楔位置必须有真实底面，不能露出背景').toBeGreaterThan(0);
  expect(hits[0]!.point.z).toBeCloseTo(z, 5);
  expect(hits[0]!.side).toBe(FrontSide);
  expect(hits[0]!.facing).toBeLessThan(0);
}

describe('基槽接口真实连通回归', () => {
  it('原始轮廓之间确实存在 1m 底部土楔，派生连接必须补开挖而非仅删除端面', () => {
    const hostBottom = Math.max(...trenchOutlines(ring).bottomHole!.map(point => point.y));
    const branchBottom = Math.max(...trenchOutlines(island).bottomOutline.map(point => point.y));
    expect(hostBottom - branchBottom).toBeCloseTo(1, 9);
    withScene([ring, island], (meshes, ground) => {
      for (const z of [-.1, -1, -1.9]) {
        expectPassage(meshes, ground, new Vector3(20, 37.5, z), new Vector3(20, 40, z));
      }
    });
  });

  it('接口缺口整带有底面，左右侧墙与远端外墙仍保留', () => {
    withScene([ring, island], (meshes, ground) => {
      for (const x of [19.2, 20, 20.8]) for (const y of [38.1, 38.5, 38.9]) expectFloor(meshes, ground, x, y);
      const wall = probe(meshes, ground, new Vector3(20, 40, -1), new Vector3(20, 43, -1));
      expect(wall.length).toBeGreaterThan(0);
      expect(wall[0]!.point.y).toBeCloseTo(41.5, 5);
      for (const x of [17, 23]) {
        const sides = probe(meshes, ground, new Vector3(20, 38.25, -1), new Vector3(x, 38.25, -1));
        expect(sides.length, '连接段不能只补底而漏掉左右侧面').toBeGreaterThan(0);
        expect(Math.abs(sides[0]!.point.x - 20)).toBeCloseTo(1.5, 5);
        expect(sides[0]!.side).toBe(FrontSide);
        expect(sides[0]!.facing).toBeLessThan(0);
      }
    });
  });

  it('工程量包含真实连接土楔：1128 + 积分∫₀²(4-d)·0.5d dd = 1130⅔m³', () => {
    expect(totalVolume([ring, island])).toBeCloseTo(1128 + 8 / 3, 6);
    expect(totalVolume([island, ring])).toBeCloseTo(1128 + 8 / 3, 6);
  });

  it.each([
    { label: '支槽反向', branchReverse: true, ringReverse: false, angle: 0 },
    { label: '环槽顺时针', branchReverse: false, ringReverse: true, angle: 0 },
    { label: '双反向且整体旋转30°平移', branchReverse: true, ringReverse: true, angle: Math.PI / 6 },
  ])('$label 不改变双向连通与工程量', ({ branchReverse, ringReverse, angle }) => {
    const transform = (point: Point2): Point2 => p(
      point.x * Math.cos(angle) - point.y * Math.sin(angle) + 200,
      point.x * Math.sin(angle) + point.y * Math.cos(angle) - 150);
    const point3 = (x: number, y: number, z: number): Vector3 => {
      const point = transform(p(x, y)); return new Vector3(point.x, point.y, z);
    };
    const host = { ...ring, points: (ringReverse ? [...ring.points].reverse() : ring.points).map(transform) };
    const branch = { ...island, points: (branchReverse ? [...island.points].reverse() : island.points).map(transform) };
    withScene([host, branch], (meshes, ground) => {
      expectPassage(meshes, ground, point3(20, 37.5, -1), point3(20, 40, -1));
      const floorPoint = transform(p(20, 38.5)); expectFloor(meshes, ground, floorPoint.x, floorPoint.y);
    });
    expect(totalVolume([host, branch])).toBeCloseTo(1128 + 8 / 3, 5);
  });

  it('零坡比 T 接头也桥接收边的微小间隙，保留一致底面', () => {
    const host: Trench = { id: 'host', type: 'trench', points: [p(0, 0), p(20, 0)], ...section, slope: 0 };
    const branch: Trench = { ...host, id: 'branch', points: [p(10, 1 + 1e-8), p(10, 10)] };
    withScene([host, branch], (meshes, ground) => {
      expectPassage(meshes, ground, new Vector3(10, 2, -1), new Vector3(10, 0, -1));
      expectFloor(meshes, ground, 10, 1);
    });
    expect(totalVolume([host, branch])).toBeCloseTo(116, 6);
  });

  it('同轴端面对接双向畅通、不重复计算土方量', () => {
    const first: Trench = { id: 'first', type: 'trench', points: [p(0, 0), p(20, 0)], ...section };
    const second: Trench = { ...first, id: 'second', points: [p(20, 0), p(40, 0)] };
    withScene([first, second], (meshes, ground) => {
      expectPassage(meshes, ground, new Vector3(19, 0, -1), new Vector3(21, 0, -1));
      expectFloor(meshes, ground, 20, 0);
    });
    expect(totalVolume([first, second])).toBeCloseTo(240, 6);
  });

  it('接触容差内但大于裁剪容差的同轴微缝仍有实际桥接，不残留两堵端墙', () => {
    const first: Trench = { id: 'first', type: 'trench', points: [p(0, 0), p(20, 0)], ...section };
    const second: Trench = { ...first, id: 'second', points: [p(20 + 5e-7, 0), p(40, 0)] };
    withScene([first, second], (meshes, ground) => {
      expectPassage(meshes, ground, new Vector3(19, 0, -1), new Vector3(21, 0, -1));
    });
    expect(totalVolume([first, second])).toBeCloseTo(240, 6);
  });

  it('不同深度的接口上部连通、下部保留真实台阶端面与新增开挖量', () => {
    const host: Trench = { id: 'shallow', type: 'trench', points: [p(0, 0), p(20, 0)], ...section, depth: 1, slope: 0 };
    // 精确贴边也必须可用，不再依赖10nm缝隙规避地面三角化。
    const branch: Trench = { ...host, id: 'deep', depth: 2, points: [p(10, 1), p(10, 8)] };
    withScene([host, branch], (meshes, ground) => {
      expectPassage(meshes, ground, new Vector3(10, 2, -.5), new Vector3(10, 0, -.5));
      const step = probe(meshes, ground, new Vector3(10, 2, -1.5), new Vector3(10, -.5, -1.5));
      expect(step.length, '深浅槽不应通过删除整端面变成漏壳').toBeGreaterThan(0);
      expect(step[0]!.point.y).toBeCloseTo(0, 5);
      expect(step[0]!.side).toBe(FrontSide);
      expect(step[0]!.facing).toBeLessThan(0);
      expectFloor(meshes, ground, 10, .5, -2);
      expectFloor(meshes, ground, 10, -.5, -1);
    });
    expect(totalVolume([host, branch])).toBeCloseTo(70, 6);
  });

  it('两角分别只碰到不同邻槽不能被误判为完整端面对接', () => {
    const left: Trench = { id: 'left', type: 'trench', points: [p(16, 19), p(18, 19)], ...section, slope: 0 };
    const right: Trench = { ...left, id: 'right', points: [p(22, 19), p(24, 19)] };
    const branch: Trench = { id: 'branch', type: 'trench', points: [p(20, 20), p(20, 30)], ...section };
    withScene([left, right, branch], (meshes, ground) => {
      const cap = probe(meshes, ground, new Vector3(20, 21, -1), new Vector3(20, 19, -1));
      expect(cap.length).toBeGreaterThan(0);
      expect(cap[0]!.name).toBe('branch');
      expect(cap[0]!.point.y).toBeCloseTo(20, 5);
    });
    expect(totalVolume([left, right, branch])).toBeCloseTo(76, 6);
  });

  it('同一个环槽的多个接口各自连通且只计算各自新增土楔，数据不被派生几何改写', () => {
    const branches = [10, 30].map(x => ({ ...island, id: `branch-${x}`, points: [p(x, 10), p(x, 38)] }));
    const elements = [ring, ...branches];
    const before = JSON.stringify(elements);
    withScene(elements, (meshes, ground) => {
      for (const x of [10, 30]) {
        expectPassage(meshes, ground, new Vector3(x, 37.5, -1), new Vector3(x, 40, -1));
        expectFloor(meshes, ground, x, 38.5);
      }
    });
    expect(totalVolume(elements)).toBeCloseTo(960 + 336 + 16 / 3, 6);
    expect(JSON.stringify(elements)).toBe(before);
  });
});
