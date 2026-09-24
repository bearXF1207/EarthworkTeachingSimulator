import { describe, expect, it, vi } from 'vitest';
import { Mesh, Raycaster, ShapeUtils, Vector3 } from 'three';
import { GroundManager } from '../src/scene/GroundManager';
import { ExcavationMeshes } from '../src/scene/MeshFactory';
import type { Trench } from '../src/core/model/project';

const host: Trench = { id: 'host', type: 'trench', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], bottomWidth: 2, depth: 1, slope: 0 };
const branch: Trench = { ...host, id: 'branch', depth: 2, points: [{ x: 10, y: 1 }, { x: 10, y: 8 }] };
function area(ground: GroundManager): number {
  let sum = 0;
  for (const object of ground.root.children) if (object instanceof Mesh) {
    const p = object.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) {
      sum += Math.abs((p.getX(i + 1) - p.getX(i)) * (p.getY(i + 2) - p.getY(i)) -
        (p.getY(i + 1) - p.getY(i)) * (p.getX(i + 2) - p.getX(i))) / 2;
    }
  }
  return sum;
}
function hits(ground: GroundManager, x: number, y: number): number {
  ground.root.updateMatrixWorld(true);
  return new Raycaster(new Vector3(x, y, 5), new Vector3(0, 0, -1))
    .intersectObjects(ground.root.children.filter(o => o instanceof Mesh)).length;
}

describe('接头顶部精确共边的地面三角化', () => {
  it('精确T接头无需抖动坐标或人为留缝，地面面积与孔洞均正确', () => {
    const meshes = new ExcavationMeshes([host, branch]);
    const ground = new GroundManager(meshes.holes, 100, meshes.islands);
    try {
      expect(area(ground)).toBeCloseTo(9946, 4);
      expect(hits(ground, 10, .5)).toBe(0); expect(hits(ground, 10, 1.5)).toBe(0);
      expect(hits(ground, 11.1, 1.5)).toBeGreaterThan(0);
      expect(branch.points[0]!.y).toBe(1);
    } finally { ground.dispose(); meshes.dispose(); }
  });
  it('岛内接头共边，岛面同样通过面积守卫并在支槽位置开孔', () => {
    const ring: Trench = { ...host, id: 'ring', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 0, y: 0 }] };
    const inside: Trench = { ...branch, points: [{ x: 10, y: 5 }, { x: 10, y: 19 }] };
    const meshes = new ExcavationMeshes([ring, inside]);
    const ground = new GroundManager(meshes.holes, 100, meshes.islands);
    try {
      expect(area(ground)).toBeCloseTo(9812, 4);
      expect(hits(ground, 10, 18.5)).toBe(0);
      expect(hits(ground, 12, 18.5)).toBeGreaterThan(0);
    } finally { ground.dispose(); meshes.dispose(); }
  });
  it('底层三角化返回空结果仍抛错，不用补片掩盖故障', () => {
    const triangulate = vi.spyOn(ShapeUtils, 'triangulateShape').mockReturnValue([]);
    try { expect(() => new GroundManager()).toThrow('Incomplete'); }
    finally { triangulate.mockRestore(); }
  });
});
