import { describe, expect, it } from 'vitest';
import type { Point2 } from '../src/core/model/project';
import { makeCell, signedUnionVolume, unionSurfaces } from '../src/core/geometry/convexExcavation';
import type { UnionTriangle } from '../src/core/geometry/convexExcavation';

const rectangle = (x0: number, y0: number, x1: number, y1: number): Point2[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const box = (id: string, x0: number, y0: number, x1: number, y1: number, depth = 2) => {
  const outline = rectangle(x0, y0, x1, y1);
  return makeCell(id, outline, outline, depth);
};
const area = ({ a, b, c }: UnionTriangle): number => Math.hypot(
  (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
  (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
) / 2;
const areaSum = (triangles: UnionTriangle[]) => triangles.reduce((sum, triangle) => sum + area(triangle), 0);

describe('凸开挖体的真实并集边界', () => {
  it('保留独立空腔的内向底面与侧面，不创建地面盖板', () => {
    const triangles = unionSurfaces([box('a', 0, 0, 4, 3), box('b', 10, 0, 12, 2)]);
    expect(signedUnionVolume(triangles)).toBeCloseTo(32, 10);
    expect(areaSum(triangles)).toBeCloseTo(60, 10);
    expect(triangles.every(t => area(t) > 0 && [t.a, t.b, t.c].every(p => Object.values(p).every(Number.isFinite)))).toBe(true);
    expect(triangles.some(t => [t.a, t.b, t.c].every(p => p.z === 0))).toBe(false);
  });

  it('重叠长方体只保留并集外壳，重叠底面按先来者拥有', () => {
    const triangles = unionSurfaces([box('a', 0, 0, 4, 3), box('b', 2, 0, 6, 3)]);
    expect(signedUnionVolume(triangles)).toBeCloseTo(36, 10);
    expect(areaSum(triangles.filter(t => t.material === 0))).toBeCloseTo(18, 10);
    expect(areaSum(triangles)).toBeCloseTo(54, 10);
    expect(triangles.some(t => [t.a, t.b, t.c].every(p => p.x === 2 || p.x === 4) && t.material === 1)).toBe(false);
  });

  it('精确贴合的相反端面两侧都删除，而不是留下单向可见的墙', () => {
    const triangles = unionSurfaces([box('a', 0, 0, 4, 3), box('b', 4, 0, 8, 3)]);
    expect(triangles.some(t => [t.a, t.b, t.c].every(p => p.x === 4))).toBe(false);
    expect(signedUnionVolume(triangles)).toBeCloseTo(48, 10);
    expect(areaSum(triangles)).toBeCloseTo(68, 10);
  });

  it('纳米收边间隙视为同一接口，不残留两个相反方向可见的薄墙', () => {
    const triangles = unionSurfaces([box('a', 0, 0, 4, 3), box('b', 4 + 1e-8, 0, 8, 3)]);
    expect(triangles.some(t => [t.a, t.b, t.c].every(p => Math.abs(p.x - 4) <= 1e-7))).toBe(false);
    expect(signedUnionVolume(triangles)).toBeCloseTo(48, 6);
  });

  it('完整重复体与包含体不重复计量，也不挖掉共面底部', () => {
    const a = box('a', 0, 0, 4, 3), b = box('b', 0, 0, 4, 3), c = box('c', 1, 1, 2, 2);
    const triangles = unionSurfaces([a, b, c]);
    expect(new Set(triangles.map(t => t.id))).toEqual(new Set(['a']));
    expect(signedUnionVolume(triangles)).toBeCloseTo(24, 10);
    expect(areaSum(triangles)).toBeCloseTo(40, 10);
  });

  it('不同深度保留必要的台阶立面，删除上部共享壁', () => {
    const triangles = unionSurfaces([box('a', 0, 0, 4, 3, 2), box('b', 2, 0, 6, 3, 3)]);
    expect(signedUnionVolume(triangles)).toBeCloseTo(48, 10);
    expect(areaSum(triangles.filter(t => t.material === 0))).toBeCloseTo(18, 10);
    const step = triangles.filter(t => [t.a, t.b, t.c].every(p => Math.abs(p.x - 2) < 1e-8));
    expect(areaSum(step)).toBeCloseTo(3, 10);
    expect(step.every(t => [t.a, t.b, t.c].every(p => p.z <= -2 + 1e-8))).toBe(true);
  });

  it('放坡槽体与端部补挖体形成完整并集，并修正附加土方量', () => {
    // A 4x2 bottom expanding to 6x4 top: Simpson exact volume = 92/3.
    const sloped = makeCell('slope', rectangle(-2, -1, 2, 1), rectangle(-3, -2, 3, 2), 2);
    const connector = box('connector', 2, -1, 4, 1, 2);
    const triangles = unionSurfaces([sloped, connector]);
    // Connector is 8 m³, 2 m³ are already within the sloped cavity.
    expect(signedUnionVolume(triangles)).toBeCloseTo(92 / 3 + 6, 10);
    expect(triangles.every(t => area(t) > 0)).toBe(true);
    expect(signedUnionVolume(unionSurfaces([connector, sloped]))).toBeCloseTo(92 / 3 + 6, 10);
  });

  it('旋转与远离原点后的重叠计算仍保持面积、体积及顺序不变量', () => {
    const transform = (ring: Point2[]) => ring.map(p => ({
      x: 9000 + p.x * Math.cos(0.371) - p.y * Math.sin(0.371),
      y: -8000 + p.x * Math.sin(0.371) + p.y * Math.cos(0.371),
    }));
    const a = transform(rectangle(0, 0, 4, 3)), b = transform(rectangle(2, 0, 6, 3));
    const cells = [makeCell('a', a, a, 2), makeCell('b', b, b, 3)];
    expect(signedUnionVolume(unionSurfaces(cells))).toBeCloseTo(48, 7);
    expect(signedUnionVolume(unionSurfaces([...cells].reverse()))).toBeCloseTo(48, 7);
    expect(areaSum(unionSurfaces(cells))).toBeCloseTo(areaSum(unionSurfaces([...cells].reverse())), 7);
  });

  it('拒绝反向、凹形、自交、非有限、退化或侧面扭曲的输入', () => {
    const ring = rectangle(0, 0, 4, 3);
    expect(() => makeCell('a', [...ring].reverse(), ring, 2)).toThrow();
    expect(() => makeCell('a', [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 3 }], ring, 2)).toThrow();
    expect(() => makeCell('a', [ring[0]!, ring[2]!, ring[1]!, ring[3]!], ring, 2)).toThrow();
    expect(() => makeCell('a', [{ x: NaN, y: 0 }, ...ring.slice(1)], ring, 2)).toThrow();
    expect(() => makeCell('a', [ring[0]!, ring[0]!, ...ring.slice(2)], ring, 2)).toThrow();
    expect(() => makeCell('a', ring, [ring[0]!, ring[1]!, { x: 5, y: 4 }, ring[3]!], 2)).toThrow();
    expect(() => makeCell('a', ring, ring, Infinity)).toThrow();
    expect(signedUnionVolume([])).toBe(0);
  });
});
