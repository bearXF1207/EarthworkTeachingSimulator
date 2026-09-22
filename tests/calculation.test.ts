import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { buildPit } from '../src/core/geometry/pit';
import { buildTrench } from '../src/core/geometry/trench';
import { distance, polylineLength } from '../src/core/calculation/measurement';
import { circularPitVolume, pitVolume, rectPitVolume } from '../src/core/calculation/pitVolume';
import { trenchSectionArea, trenchTopWidth, trenchVolume } from '../src/core/calculation/trenchVolume';
import { quantityOf, totalVolume } from '../src/core/calculation/quantities';
import type { Pit, Point2, Trench } from '../src/core/model/project';

const p = (x: number, y: number): Point2 => ({ x, y });
const trench = (points: Point2[], over: Partial<Trench> = {}): Trench =>
  ({ id: 't1', type: 'trench', points, bottomWidth: 2, depth: 2, slope: .5, ...over });
const square = (over: Partial<Pit> = {}): Pit =>
  ({ id: 'p1', type: 'square-pit', position: p(0, 0), bottomSize: 4, depth: 2, slope: .5, rotation: 0, ...over } as Pit);
const rect = (): Pit =>
  ({ id: 'p2', type: 'rect-pit', position: p(0, 0), bottomLength: 6, bottomWidth: 4, depth: 2, slope: .5, rotation: 0 });
const circle = (): Pit => ({ id: 'p3', type: 'circular-pit', position: p(0, 0), bottomDiameter: 4, depth: 2, slope: .5 });

/**
 * 独立几何交叉验证：对开挖实体的三角面做有向四面体积分。
 * 顶部开口位于 z=0 平面，补盖的贡献恰好为 0，因此直接对“底面+侧面”求和即得体积。
 */
const meshVolume = (geometry: BufferGeometry): number => {
  const position = geometry.getAttribute('position');
  let sum = 0;
  for (let i = 0; i < position.count; i += 3) {
    const a = new Vector3(position.getX(i), position.getY(i), position.getZ(i));
    const b = new Vector3(position.getX(i + 1), position.getY(i + 1), position.getZ(i + 1));
    const c = new Vector3(position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2));
    sum += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(sum);
};
const relative = (actual: number, expected: number): number => Math.abs(actual - expected) / expected;

describe('M7 平面测量', () => {
  it('两点距离：(0,0) 到 (3,4) 为 5m，同点为 0m', () => {
    expect(distance(p(0, 0), p(3, 4))).toBe(5);
    expect(distance(p(7, -2), p(7, -2))).toBe(0);
  });
  it('平移与旋转不改变同一批点集的长度', () => {
    const before = [p(0, 0), p(10, 0), p(10, 10)];
    const shifted = before.map(point => p(point.x + 5, point.y - 3));
    expect(polylineLength(shifted)).toBeCloseTo(polylineLength(before)!, 12);
    const radians = 30 * Math.PI / 180;
    const rotated = before.map(point => p(point.x * Math.cos(radians) - point.y * Math.sin(radians), point.x * Math.sin(radians) + point.y * Math.cos(radians)));
    expect(polylineLength(rotated)).toBeCloseTo(polylineLength(before)!, 9);
  });
  it('非有限输入与点数不足返回 null，不返回 NaN', () => {
    expect(distance(p(Number.NaN, 0), p(1, 1))).toBeNull();
    expect(polylineLength([p(0, 0)])).toBeNull();
    expect(polylineLength([p(0, 0), p(Number.POSITIVE_INFINITY, 0)])).toBeNull();
  });
  it('折线总长累加各段；闭合中心线的闭合段也计入', () => {
    expect(polylineLength([p(0, 0), p(10, 0), p(10, 10)])).toBeCloseTo(20, 12);
    expect(polylineLength([p(0, 0), p(10, 0), p(15, 5), p(25, 5)])).toBeCloseTo(20 + Math.sqrt(50), 12);
    // 环形：末点回到首点，四条边都被计入
    expect(polylineLength([p(0, 0), p(20, 0), p(20, 20), p(0, 20), p(0, 0)])).toBeCloseTo(80, 12);
  });
});

describe('M7 基槽工程量', () => {
  it('直槽 L=20/B=2/H=2/m=.5：T=4，A=6，V=120m³', () => {
    const element = trench([p(0, 0), p(20, 0)]);
    expect(trenchTopWidth(element)).toBe(4);
    expect(trenchSectionArea(element)).toBe(6);
    expect(trenchVolume(element)).toBeCloseTo(120, 10);
  });
  it('L 型 (0,0),(10,0),(10,10)：总长 20，V=120m³', () => {
    expect(trenchVolume(trench([p(0, 0), p(10, 0), p(10, 10)]))).toBeCloseTo(120, 10);
  });
  it('多段 (0,0),(10,0),(15,5),(25,5)：V=6×(20+√50)', () => {
    expect(trenchVolume(trench([p(0, 0), p(10, 0), p(15, 5), p(25, 5)]))).toBeCloseTo(6 * (20 + Math.sqrt(50)), 10);
  });
  it('原需求展示例 L=25.6/B=2/H=1.5/m=.5：顶宽 3.5，V=105.6m³', () => {
    const element = trench([p(0, 0), p(25.6, 0)], { depth: 1.5 });
    expect(trenchTopWidth(element)).toBeCloseTo(3.5, 12);
    expect(trenchVolume(element)).toBeCloseTo(105.6, 10);
  });
  it('环形基槽：断面面积 × 闭合中心线长', () => {
    const ring = trench([p(0, 0), p(20, 0), p(20, 20), p(0, 20), p(0, 0)]);
    expect(trenchVolume(ring)).toBeCloseTo(6 * 80, 10);
  });
  it('m=0 退化为棱柱；非法参数与不足两点返回 null', () => {
    expect(trenchVolume(trench([p(0, 0), p(10, 0)], { slope: 0 }))).toBeCloseTo(2 * 2 * 10, 10);
    expect(trenchVolume(trench([p(0, 0)], {}))).toBeNull();
    expect(trenchVolume(trench([p(0, 0), p(10, 0)], { depth: Number.NaN }))).toBeNull();
  });
  it('与网格几何交叉验证：直槽体积等于解析值', () => {
    const element = trench([p(0, 0), p(20, 0)]);
    expect(relative(meshVolume(buildTrench(element).geometry), trenchVolume(element)!)).toBeLessThan(1e-6);
  });
});

describe('M7 基坑工程量', () => {
  it('方形 4×4/H=2/m=.5：V=152/3≈50.6667m³', () => {
    expect(pitVolume(square())).toBeCloseTo(152 / 3, 10);
  });
  it('矩形 6×4/H=2/m=.5：V=212/3≈70.6667m³（防止错误棱台公式回归）', () => {
    expect(pitVolume(rect())).toBeCloseTo(212 / 3, 10);
    // 相似截面公式在此不适用，与本设计公式明显不同
    const wrong = 2 / 3 * (24 + 56 + Math.sqrt(24 * 56));
    expect(Math.abs(wrong - 212 / 3)).toBeGreaterThan(0.01);
  });
  it('圆坑 直径4/H=2/m=.5：r=2、R=3，V=38π/3≈39.7935m³', () => {
    expect(circularPitVolume(4, 2, .5)).toBeCloseTo(38 * Math.PI / 3, 10);
    expect(pitVolume(circle())).toBeCloseTo(38 * Math.PI / 3, 10);
  });
  it('m=0 退化为棱柱/圆柱；各方向放大 2 倍体积变为 8 倍', () => {
    expect(rectPitVolume(6, 4, 2, 0)).toBeCloseTo(48, 12);
    expect(circularPitVolume(4, 2, 0)).toBeCloseTo(Math.PI * 4 * 2, 12);
    expect(rectPitVolume(12, 8, 4, .5)! / rectPitVolume(6, 4, 2, .5)!).toBeCloseTo(8, 10);
    expect(circularPitVolume(8, 4, .5)! / circularPitVolume(4, 2, .5)!).toBeCloseTo(8, 10);
  });
  it('非法参数返回 null，不返回非有限值', () => {
    expect(pitVolume(square({ depth: Number.NaN }))).toBeNull();
    expect(circularPitVolume(-1, 2, .5)).toBeNull();
  });
  it('与网格几何交叉验证：方/矩形精确相符，96 段圆坑相对差 <0.1%', () => {
    for (const pit of [square(), rect()]) expect(relative(meshVolume(buildPit(pit).geometry), pitVolume(pit)!)).toBeLessThan(1e-6);
    expect(relative(meshVolume(buildPit(circle()).geometry), pitVolume(circle())!)).toBeLessThan(1e-3);
  });
});

describe('M7 工程量汇总', () => {
  it('读数带单位，体积不可算时为 null', () => {
    const { rows, volume } = quantityOf(trench([p(0, 0), p(20, 0)]));
    expect(volume).toBeCloseTo(120, 10);
    expect(rows.find(row => row.label === '中心线长度')).toMatchObject({ value: 20, unit: 'm' });
    expect(rows.find(row => row.label === '顶宽 T')).toMatchObject({ value: 4, unit: 'm' });
    expect(rows.find(row => row.label === '断面面积 A')).toMatchObject({ value: 6, unit: 'm²' });
    expect(quantityOf(trench([p(0, 0)])).volume).toBeNull();
  });
  it('基坑读数区分圆形的直径与矩形的长宽', () => {
    expect(quantityOf(circle()).rows.map(row => row.label)).toEqual(['底部直径', '顶部直径', '底面积']);
    expect(quantityOf(square()).rows.map(row => row.label)).toEqual(['底部尺寸', '底部宽度', '顶部尺寸', '顶部宽度', '底面积']);
  });
  it('合计只对可计算的对象求和，跳过无法计算的对象', () => {
    const elements = [trench([p(0, 0), p(20, 0)]), square(), trench([p(0, 0)])];
    expect(totalVolume(elements)).toBeCloseTo(120 + 152 / 3, 10);
    expect(totalVolume([])).toBe(0);
  });
});
