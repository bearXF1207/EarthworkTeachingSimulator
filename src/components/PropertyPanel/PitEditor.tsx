import type { ReactElement } from 'react';
import type { Pit, Project, Result } from '../../core/model/project';
import { PIT_LABELS } from '../../core/model/project';
import { MAX_COORDINATE, MAX_SIZE, MAX_SLOPE, MIN_SIZE, MIN_SLOPE } from '../../core/validation/limits';
import { NumberFields } from './NumberFields';
import type { NumberField } from './NumberFields';

export function PitEditor({ pit, onUpdate }: { pit: Pit; onUpdate: (pit: Pit) => Result<Project> }): ReactElement {
  const size: Pick<NumberField, 'min' | 'max'> = { min: MIN_SIZE, max: MAX_SIZE };
  const fields: NumberField[] = [
    { key: 'x', label: '中心 X（m）', value: pit.position.x, min: -MAX_COORDINATE, max: MAX_COORDINATE },
    { key: 'y', label: '中心 Y（m）', value: pit.position.y, min: -MAX_COORDINATE, max: MAX_COORDINATE },
    { key: 'depth', label: '开挖深度（m）', value: pit.depth, ...size },
    { key: 'slope', label: '放坡系数 m', value: pit.slope, min: MIN_SLOPE, max: MAX_SLOPE },
    ...(pit.type === 'square-pit' ? [{ key: 'bottomSize', label: '底边长（m）', value: pit.bottomSize, ...size }] :
      pit.type === 'rect-pit' ? [{ key: 'bottomLength', label: '底长（m）', value: pit.bottomLength, ...size },
        { key: 'bottomWidth', label: '底宽（m）', value: pit.bottomWidth, ...size }] :
        [{ key: 'bottomDiameter', label: '底直径（m）', value: pit.bottomDiameter, ...size }]),
    ...(pit.type === 'circular-pit' ? [] : [{ key: 'rotation', label: '旋转角（°）', value: pit.rotation }]),
  ];
  return <div className="object-editor">
    <h3>{PIT_LABELS[pit.type]}参数</h3>
    <NumberFields fields={fields} apply={values => onUpdate({ ...pit, ...values, position: { x: values.x!, y: values.y! } } as Pit)} />
    <p className="scope-note">有效输入即时应用。旋转按度保存；边坡水平外扩 = 深度 × 放坡系数。空值和非法参数不改变模型。</p>
  </div>;
}
