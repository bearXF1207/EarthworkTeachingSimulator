import { describe, expect, it } from 'vitest';
import { FrontSide, Raycaster, Vector3 } from 'three';
import type { MeshStandardMaterial } from 'three';
import { trenchOutlines } from '../src/core/geometry/trenchOutline';
import type { Point2, Trench } from '../src/core/model/project';
import { GroundManager } from '../src/scene/GroundManager';
import { ExcavationMeshes } from '../src/scene/MeshFactory';

const p = (x: number, y: number): Point2 => ({ x, y });
const section = { bottomWidth: 2, depth: 2, slope: .5 };
/** 环形基槽 40m 见方：顶半宽 2 → 外圈 44²，岛 36²（内边界 y=2/38）。 */
const ring: Trench = { id: 'ring', type: 'trench', points: [p(0, 0), p(40, 0), p(40, 40), p(0, 40), p(0, 0)], ...section };
/** 岛内基槽：终点落在内圈边界 y=38 上（收边后的贯通位置）。 */
const island: Trench = { id: 'island', type: 'trench', points: [p(20, 10), p(20, 38)], ...section };

type Hit = { name: string; z: number; distance: number; side: number; facing: number };

const probe = (meshes: ExcavationMeshes, ground: GroundManager, from: Vector3, to: Vector3): Hit[] => {
  meshes.root.updateMatrixWorld(true); ground.root.updateMatrixWorld(true);
  const direction = to.clone().sub(from).normalize();
  // 只对实体面与地面求交，跳过中心线（细线会抢先命中，干扰诊断）
  const target = (object: { name: string }): boolean => !object.name.endsWith(':centerline');
  return new Raycaster(from, direction).intersectObjects([meshes.root, ground.root], true)
    .filter(hit => target(hit.object))
    .map(hit => {
      const raw = (hit.object as { material?: MeshStandardMaterial | MeshStandardMaterial[] }).material;
      const material = Array.isArray(raw) ? raw[hit.face?.materialIndex ?? 0] : raw;
      const normal = hit.face?.normal.clone() ?? new Vector3();
      return {
        name: hit.object.name || hit.object.type,
        z: +hit.point.z.toFixed(3),
        distance: +hit.distance.toFixed(3),
        side: material?.side ?? -1,
        // <0 表示命中正面（面法线与视线相反），>0 表示命中背面
        facing: +normal.dot(direction).toFixed(3),
      };
    });
};

describe('M5 贯通处几何诊断', () => {
  it('贯通处从槽内看必须命中开挖面，而不是露出背景（A1）', () => {
    const meshes = new ExcavationMeshes([ring, island]);
    const ground = new GroundManager(meshes.holes, 100, meshes.islands);
    try {
      // 岛内基槽内部 z=-1 处，水平朝 +y 看向贯通位置（y=38）
      const hits = probe(meshes, ground, new Vector3(20, 30, -1), new Vector3(20, 60, -1));
      console.log('debug 水平射线命中', JSON.stringify(hits));
      expect(hits.length, '贯通处看不到任何面（露出背景）').toBeGreaterThan(0);
      // 命中的必须是实体面：材质单面、命中正面（背面即会显示为黑面）
      expect(hits.every(hit => hit.side === FrontSide)).toBe(true);
      expect(hits.every(hit => hit.facing < 0)).toBe(true);
      // 不应命中地面补片背面，应命中环形槽的实体墙面
      expect(hits[0]!.name).toBe('ring');
    } finally { meshes.dispose(); ground.dispose(); }
  });

  it('贯通处俯视看：应命中开挖底面，而不是地面背面（A1/A3）', () => {
    const meshes = new ExcavationMeshes([ring, island]);
    const ground = new GroundManager(meshes.holes, 100, meshes.islands);
    try {
      const hits = probe(meshes, ground, new Vector3(20, 38, 40), new Vector3(20, 38, -1));
      console.log('debug 俯视射线命中', JSON.stringify(hits));
      expect(hits.length).toBeGreaterThan(0);
      // 贯通处自上而下应先看到环形槽内壁斜面，再看到开挖底面（z=-2）
      expect(hits.some(hit => Math.abs(hit.z + 2) < 1e-3)).toBe(true);
      // 所有命中都必须是正面（没有背面 → 不会出现黑面/穿模）
      expect(hits.every(hit => hit.facing < 0)).toBe(true);
      expect(hits.every(hit => hit.side === FrontSide)).toBe(true);
    } finally { meshes.dispose(); ground.dispose(); }
  });

  it('土楔宽度：顶轮廓相接处底轮廓相差 m·H（B）', () => {
    const top = trenchOutlines(ring).topHole!;
    const bottom = trenchOutlines(ring).bottomHole!;
    // 岛顶边界 y=2、岛底边界 y=1：两者之间即未开挖土楔，宽度 1m = m·H
    expect(Math.min(...top.map(point => point.y))).toBeCloseTo(2, 9);
    expect(Math.min(...bottom.map(point => point.y))).toBeCloseTo(1, 9);
    // 岛内基槽收边到顶边界 y=38，而环形槽底内边界在 y=39（顶 38 + m·H）
    // 即 z 越低两槽越重叠 → 体积上真连通，只是顶面无覆盖；因此端面必须省略且不能误删侧墙。
    const islandBottom = trenchOutlines(island).bottomOutline;
    expect(Math.max(...islandBottom.map(point => point.y))).toBeCloseTo(38, 9);
    const ringBottomInner = Math.max(...trenchOutlines(ring).bottomHole!.map(point => point.y));
    expect(ringBottomInner).toBeCloseTo(39, 9);
    expect(ringBottomInner - Math.max(...islandBottom.map(point => point.y))).toBeGreaterThan(0);
  });
});
