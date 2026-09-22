import { useState } from 'react';
import type { ReactElement } from 'react';
import type { Pit, Result, Project } from '../../core/model/project';
import { PIT_LABELS } from '../../core/model/project';

export function PitEditor({ pit, onUpdate }: { pit: Pit; onUpdate: (pit: Pit) => Result<Project> }): ReactElement {
  const fields = [
    { key: 'x', label: '中心 X（m）', value: pit.position.x }, { key: 'y', label: '中心 Y（m）', value: pit.position.y },
    { key: 'depth', label: '开挖深度（m）', value: pit.depth }, { key: 'slope', label: '放坡系数 m', value: pit.slope },
    ...(pit.type === 'square-pit' ? [{ key: 'bottomSize', label: '底边长（m）', value: pit.bottomSize }] :
      pit.type === 'rect-pit' ? [{ key: 'bottomLength', label: '底长（m）', value: pit.bottomLength }, { key: 'bottomWidth', label: '底宽（m）', value: pit.bottomWidth }] :
        [{ key: 'bottomDiameter', label: '底直径（m）', value: pit.bottomDiameter }]),
    ...(pit.type === 'circular-pit' ? [] : [{ key: 'rotation', label: '旋转角（°）', value: pit.rotation }]),
  ];
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.key, String(f.value)])));
  const [error, setError] = useState('');
  function change(key: string, text: string): void {
    const next = { ...draft, [key]: text }; setDraft(next);
    if (Object.values(next).some(v => !v.trim() || !Number.isFinite(Number(v)))) { setError('请填写所有有限数值；已保留上次有效参数。'); return; }
    const values = Object.fromEntries(Object.entries(next).map(([k, v]) => [k, Number(v)]));
    const candidate = { ...pit, ...values, position: { x: values.x!, y: values.y! } } as Pit;
    const result = onUpdate(candidate);
    setError(result.ok ? '' : result.issues.map(i => `${i.path}：${i.message}`).join('；'));
  }
  return <div className="pit-editor">
    <h3>{PIT_LABELS[pit.type]}参数</h3>
    {fields.map(f => <label key={f.key}>{f.label}<input aria-label={f.label} type="text" inputMode="decimal" value={draft[f.key] ?? ''}
      onChange={e => change(f.key, e.target.value)} /></label>)}
    {error && <p role="alert" className="input-error">{error}</p>}
    <p className="scope-note">有效输入即时应用。旋转按度保存；边坡水平外扩 = 深度 × 放坡系数。空值和非法参数不改变模型。</p>
  </div>;
}
