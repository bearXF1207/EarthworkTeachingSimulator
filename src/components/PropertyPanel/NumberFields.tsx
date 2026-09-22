import { useState } from 'react';
import type { ReactElement } from 'react';
import type { Result } from '../../core/model/project';

export type NumberField = { key: string; label: string; value: number };

/**
 * 数值文本草稿与已接受数据分离：只有全部字段都是有限数值时才提交候选，
 * 因此键入过程中出现的空串、'-' 等临时文本不会写入项目、草稿参数或模型。
 * 提交目标既可以是工程（属性编辑），也可以是绘制草稿参数。
 */
export function NumberFields({ fields, apply }: {
  fields: NumberField[]; apply: (values: Record<string, number>) => Result<unknown>;
}): ReactElement {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.key, String(f.value)])));
  const [error, setError] = useState('');
  function change(key: string, text: string): void {
    const next = { ...draft, [key]: text }; setDraft(next);
    if (Object.values(next).some(v => !v.trim() || !Number.isFinite(Number(v)))) { setError('请填写所有有限数值；已保留上次有效参数。'); return; }
    const values = Object.fromEntries(Object.entries(next).map(([k, v]) => [k, Number(v)]));
    const result = apply(values);
    setError(result.ok ? '' : result.issues.map(i => `${i.path}：${i.message}`).join('；'));
  }
  return <>
    {fields.map(f => <label key={f.key}>{f.label}<input aria-label={f.label} type="text" inputMode="decimal" value={draft[f.key] ?? ''}
      onChange={e => change(f.key, e.target.value)} /></label>)}
    {error && <p role="alert" className="input-error">{error}</p>}
  </>;
}
