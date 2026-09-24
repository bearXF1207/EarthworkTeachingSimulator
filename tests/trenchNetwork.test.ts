import { describe, expect, it } from 'vitest';
import { buildTrenchNetwork } from '../src/core/geometry/trenchNetwork';
import { trimEndsToNeighbours } from '../src/core/geometry/trenchTrim';
import { trenchOutlines } from '../src/core/geometry/trenchOutline';
import { connectionCorrection, totalVolume, volumeSummary } from '../src/core/calculation/quantities';
import { trenchVolume } from '../src/core/calculation/trenchVolume';
import type { Point2, Trench } from '../src/core/model/project';

const host: Trench = { id: 'host', type: 'trench', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], bottomWidth: 2, depth: 2, slope: .5 };
const branch: Trench = { ...host, id: 'branch', points: [{ x: 10, y: 2 }, { x: 10, y: 12 }] };
/** 与命令层一致：按相邻槽顶边界收边后再参与连接与计量。 */
const trimmed = (points: Point2[], neighbour: Trench = host): Point2[] => {
  const result = trimEndsToNeighbours(points, neighbour.bottomWidth / 2 + neighbour.depth * neighbour.slope,
    [{ ring: trenchOutlines(neighbour).topOutline }]);
  if (!result) throw new Error('应收边成功');
  return result;
};

describe('派生连接数据与工程量', () => {
  it('正交接口增加8/3m³，来自补挖土楔而不是整个延伸段体积', () => {
    const before = JSON.stringify([host, branch]);
    expect(connectionCorrection([host, branch])).toBeCloseTo(8 / 3, 8);
    expect(totalVolume([host, branch])).toBeCloseTo(180 + 8 / 3, 8);
    expect(JSON.stringify([host, branch])).toBe(before);
  });
  it('删除或移离邻槽撤销派生连接，编辑不会复用旧缓存', () => {
    expect(connectionCorrection([host, branch])).toBeGreaterThan(0);
    const away = { ...branch, points: branch.points.map(p => ({ ...p, y: p.y + 1 })) };
    expect(connectionCorrection([host, away])).toBe(0);
    expect(connectionCorrection([branch])).toBe(0);
    expect(connectionCorrection([host, branch])).toBeCloseTo(8 / 3, 8);
  });
  it('稳定ID决定归属，数组重排不改变几何和计量', () => {
    const first = buildTrenchNetwork([host, branch]);
    const second = buildTrenchNetwork([branch, host]);
    expect(second).toEqual(first);
  });
  it('宽度与深度变化后补挖量重新计算', () => {
    const shallow = { ...branch, depth: 1 };
    // At depth d the host gap is .5d and branch width is 3-d.
    expect(connectionCorrection([host, shallow])).toBeCloseTo(7 / 12, 8);
  });
  it('真实绘制的微小倾角：收边后的端面仍在贴合带内，接口照常贯通', () => {
    // 鼠标点击必然带亚像素偏移：起点 (10,12)、终点吸附到主槽中心线 (10.3,0)，方位角约 269.6°。
    const drawn: Point2[] = [{ x: 10, y: 12 }, { x: 10.3, y: 0 }];
    const end = trimmed(drawn).at(-1)!;
    const tilt = Math.abs((10 - 10.3) / Math.hypot(10 - 10.3, 12));
    // 收边端面垂直支槽中心线，落在边界外侧；外偏上界 = 顶半宽×|u·ĥ|（远端角点两倍）
    expect(end.y - 2).toBeGreaterThan(0);
    expect(end.y - 2).toBeLessThanOrEqual(2 * (1 + 2 * .5) * tilt + 1e-6);
    const tilted: Trench = { ...branch, points: [...drawn.slice(0, 1), end] };
    const network = buildTrenchNetwork([host, tilted]);
    expect(network.connectionCount).toBe(1);
    // 补挖量 = 8/3 的土楔 + 端面外偏留下的那道土墙（外偏 × 断面面积 6m²），与显示几何同源
    const wall = (end.y - 2) * 6;
    const correction = connectionCorrection([host, tilted]);
    expect(correction).toBeGreaterThan(8 / 3);
    expect(correction).toBeCloseTo(8 / 3 + wall, 1);
    // 两侧倾斜都应贯通，且不因符号不同而时通时不通
    const other = trimmed([{ x: 10, y: 12 }, { x: 9.7, y: 0 }]);
    expect(buildTrenchNetwork([host, { ...branch, points: other }]).connectionCount).toBe(1);
  });

  it('非整数坐标的贴合接口同样贯通，结果与整数网格一致', () => {
    const offsetHost: Trench = { ...host, points: [{ x: 0.35, y: -0.2 }, { x: 20.7, y: -0.2 }] };
    const end = trimmed([{ x: 10.42, y: 11.8 }, { x: 10.42, y: -0.2 }], offsetHost).at(-1)!;
    const offsetBranch: Trench = { ...branch, points: [{ x: 10.42, y: 11.8 }, end] };
    const network = buildTrenchNetwork([offsetHost, offsetBranch]);
    expect(network.connectionCount).toBe(1);
    // 端面精确贴到主槽顶边（y=1.8）外侧 10nm 级净距，补挖量与整数网格一致
    expect(end.y - 1.8).toBeGreaterThan(0);
    expect(end.y - 1.8).toBeLessThan(1e-6);
    expect(connectionCorrection([offsetHost, offsetBranch])).toBeCloseTo(8 / 3, 4);
  });

  it('贴合带之外不误判：垂直端面外偏 2cm、斜交端面外偏 1m 都不连接', () => {
    // 垂直入射时容差退化为净距常量，端面只是“停在 2cm 外”不算贴合
    const short: Trench = { ...branch, points: [{ x: 10, y: 12 }, { x: 10, y: 2.02 }] };
    expect(buildTrenchNetwork([host, short]).connectionCount).toBe(0);
    // 斜交但远离边界：外偏超过上限，不能凭空在开口外开挖
    const far: Trench = { ...branch, points: [{ x: 14.5, y: 12 }, { x: 10, y: 3 }] };
    expect(buildTrenchNetwork([host, far]).connectionCount).toBe(0);
    expect(connectionCorrection([host, far])).toBe(0);
  });

  it('合计读数带保护：连接几何抛错时退回单槽估算而不是让界面崩掉', () => {
    const normal = volumeSummary([host, branch]);
    expect(normal.degraded).toBe(false);
    expect(normal.total).toBeCloseTo(totalVolume([host, branch]), 10);
    // 退化截面（底宽与坡比都为 0）会让凸单元构造抛错：合计必须退回单槽估算并标记降级
    const degenerate = { ...branch, id: 'bad', bottomWidth: 0, slope: 0 };
    const degraded = volumeSummary([host, degenerate]);
    expect(degraded.degraded).toBe(true);
    expect(degraded.correction).toBe(0);
    expect(degraded.total).toBeCloseTo(trenchVolume(host)!, 10);
    expect(() => connectionCorrection([host, degenerate])).toThrow();
  });

  it('零坡比连接不额外挖土；纳米级收边间隙不留下两面薄墙', () => {
    const verticalHost = { ...host, slope: 0 };
    const verticalBranch = { ...branch, slope: 0, points: [{ x: 10, y: 1 + 1e-8 }, { x: 10, y: 12 }] };
    expect(connectionCorrection([verticalHost, verticalBranch])).toBeLessThan(1e-6);
    expect(buildTrenchNetwork([verticalHost, verticalBranch]).triangles.size).toBe(2);
  });
});
