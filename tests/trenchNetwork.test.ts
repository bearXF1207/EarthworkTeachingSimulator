import { describe, expect, it } from 'vitest';
import { buildTrenchNetwork } from '../src/core/geometry/trenchNetwork';
import { connectionCorrection, totalVolume } from '../src/core/calculation/quantities';
import type { Trench } from '../src/core/model/project';

const host: Trench = { id: 'host', type: 'trench', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], bottomWidth: 2, depth: 2, slope: .5 };
const branch: Trench = { ...host, id: 'branch', points: [{ x: 10, y: 2 }, { x: 10, y: 12 }] };

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
  it('零坡比连接不额外挖土；纳米级收边间隙不留下两面薄墙', () => {
    const verticalHost = { ...host, slope: 0 };
    const verticalBranch = { ...branch, slope: 0, points: [{ x: 10, y: 1 + 1e-8 }, { x: 10, y: 12 }] };
    expect(connectionCorrection([verticalHost, verticalBranch])).toBeLessThan(1e-6);
    expect(buildTrenchNetwork([verticalHost, verticalBranch]).triangles.size).toBe(2);
  });
});
