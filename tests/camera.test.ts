import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CameraManager } from '../src/scene/CameraManager';
import type { ViewMode } from '../src/scene/CameraManager';

describe('M1 相机投影', () => {
  it.each([
    ['top', [0, 0, -1], [0, 1, 0]],
    ['front', [0, 1, 0], [0, 0, 1]],
    ['side', [-1, 0, 0], [0, 0, 1]],
  ] as const)('%s 视图方向、向上方向和屏幕坐标正确', (mode, direction, up) => {
    const manager = new CameraManager();
    manager.setView(mode);
    expect(manager.active.getWorldDirection(new Vector3()).distanceTo(new Vector3(...direction))).toBeLessThan(1e-10);
    expect(manager.active.up.toArray()).toEqual(up);
    const right = mode === 'side' ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    // Explicit world +X is screen-right for top/front, +Y for side.
    right.set(mode === 'side' ? 0 : 1, mode === 'side' ? 1 : 0, 0);
    expect(right.project(manager.active).x).toBeGreaterThan(0);
  });

  it('自由视角使用 Z-up，观察地面中心', () => {
    const manager = new CameraManager();
    expect(manager.active).toBe(manager.perspective);
    expect(manager.active.up.toArray()).toEqual([0, 0, 1]);
    expect(manager.active.getWorldDirection(new Vector3()).dot(manager.active.position.clone().normalize())).toBeCloseTo(-1);
  });

  it('resize保持正交比例和缩放，忽略零尺寸/非有限尺寸', () => {
    const manager = new CameraManager();
    manager.setView('top');
    manager.orthographic.zoom = 3;
    manager.resize(1200, 600);
    const c = manager.orthographic;
    expect((c.right - c.left) / (c.top - c.bottom)).toBe(2);
    expect(c.zoom).toBe(3);
    const matrix = c.projectionMatrix.toArray();
    manager.resize(0, 0); manager.resize(Infinity, 100);
    expect(c.projectionMatrix.toArray()).toEqual(matrix);
    manager.resize(600, 1200);
    expect((c.right - c.left) / (c.top - c.bottom)).toBe(.5);
  });

  it('切视图保留目标和可视范围；各模式重置恢复默认构图', () => {
    const manager = new CameraManager();
    manager.setView('top');
    manager.target.set(12, 4, 0);
    manager.orthographic.zoom = 2;
    manager.setView('side');
    expect(manager.target.toArray()).toEqual([12, 4, 0]);
    expect(manager.orthographic.top - manager.orthographic.bottom).toBeCloseTo(70);
    for (const mode of ['free', 'top', 'front', 'side'] satisfies ViewMode[]) {
      manager.setView(mode); manager.reset();
      const position = manager.active.position.clone();
      manager.target.set(8, 7, 6); manager.active.position.multiplyScalar(2); manager.active.zoom = 4;
      manager.reset();
      expect(manager.target.length()).toBe(0);
      expect(manager.active.position.distanceTo(position)).toBeLessThan(1e-10);
      expect(manager.active.zoom).toBe(1);
    }
  });
});
