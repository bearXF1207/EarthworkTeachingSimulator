import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { GroundManager } from '../src/scene/GroundManager';

describe('M1 地面资源', () => {
  it('100m场地位于XY平面，网格旋转到地面且间距1m', () => {
    const ground = new GroundManager();
    try {
      ground.ground.geometry.computeBoundingBox();
      expect(ground.ground.geometry.boundingBox?.min.toArray()).toEqual([-50, -50, 0]);
      expect(ground.ground.geometry.boundingBox?.max.toArray()).toEqual([50, 50, 0]);
      ground.root.updateMatrixWorld(true);
      const points = ground.grid.geometry.getAttribute('position');
      expect(points.count).toBe(404);
      for (let i = 0; i < points.count; i++) {
        expect(new Vector3().fromBufferAttribute(points, i).applyMatrix4(ground.grid.matrixWorld).z).toBeCloseTo(.015);
      }
      ground.setGridVisible(false); expect(ground.grid.visible).toBe(false);
      expect(ground.ground.visible).toBe(true);
    } finally { ground.dispose(); }
  });
  it('dispose幂等，几何与材质仅释放一次', () => {
    const ground = new GroundManager();
    const geometry = vi.spyOn(ground.ground.geometry, 'dispose');
    const material = vi.spyOn(ground.ground.material, 'dispose');
    const grid = vi.spyOn(ground.grid.geometry, 'dispose');
    ground.dispose(); ground.dispose();
    expect(geometry).toHaveBeenCalledTimes(1); expect(material).toHaveBeenCalledTimes(1);
    expect(grid).toHaveBeenCalledTimes(1); expect(ground.root.children).toHaveLength(0);
  });
});
