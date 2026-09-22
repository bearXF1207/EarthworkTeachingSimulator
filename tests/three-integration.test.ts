import { BufferGeometry, Float32BufferAttribute } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { describe, expect, it } from 'vitest';
import { threeRevision } from '../src/scene/runtimeInfo';

describe('Three.js 依赖与类型集成', () => {
  it('可解析核心包和 addons，并构造及释放 CPU 几何资源', () => {
    expect(threeRevision).toMatch(/^\d+$/);
    expect(OrbitControls).toBeTypeOf('function');
    const geometry = new BufferGeometry();
    try {
      geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      geometry.computeBoundingBox();
      expect(geometry.getAttribute('position').count).toBe(3);
      expect(geometry.boundingBox?.max.toArray()).toEqual([1, 1, 0]);
    } finally {
      geometry.dispose();
    }
  });
});
