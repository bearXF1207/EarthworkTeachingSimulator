import type { ReactElement } from 'react';
import type { Project, Result, Trench } from '../../core/model/project';
import { NumberFields } from './NumberFields';
import type { NumberField } from './NumberFields';

export function TrenchEditor({ trench, onUpdate }: { trench: Trench; onUpdate: (trench: Trench) => Result<Project> }): ReactElement {
  // 当前阶段的校验保证基槽恰好有两个节点；这里的兜底只用于类型收窄。
  const [first, second] = trench.points;
  const fields: NumberField[] = [
    { key: 'x1', label: '起点 X（m）', value: first?.x ?? 0 }, { key: 'y1', label: '起点 Y（m）', value: first?.y ?? 0 },
    { key: 'x2', label: '终点 X（m）', value: second?.x ?? 0 }, { key: 'y2', label: '终点 Y（m）', value: second?.y ?? 0 },
    { key: 'bottomWidth', label: '底宽（m）', value: trench.bottomWidth },
    { key: 'depth', label: '开挖深度（m）', value: trench.depth }, { key: 'slope', label: '放坡系数 m', value: trench.slope },
  ];
  return <div className="object-editor">
    <h3>直线基槽参数</h3>
    <NumberFields fields={fields} apply={values => onUpdate({ ...trench,
      bottomWidth: values.bottomWidth!, depth: values.depth!, slope: values.slope!,
      points: [{ x: values.x1!, y: values.y1! }, { x: values.x2!, y: values.y2! }] })} />
    <p className="scope-note">端面垂直，不在中心线方向额外放坡；边坡水平外扩 = 深度 × 放坡系数。当前阶段仅支持两个节点，折线基槽在后续阶段实现。</p>
  </div>;
}
