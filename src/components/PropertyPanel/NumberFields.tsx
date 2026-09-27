import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import type { Result } from '../../core/model/project';

/** min/max 只作界面提示与浏览器辅助；数值是否接受始终由 core/validation 决定，不在 UI 另设一套校验。 */
export type NumberField = { key: string; label: string; value: number; min?: number; max?: number };

const rangeTitle = (field: NumberField): string | undefined =>
  field.min === undefined || field.max === undefined ? undefined : `取值范围 ${field.min}～${field.max}`;

/**
 * 数值文本草稿与已接受数据分离：只有全部字段都是有限数值时才提交候选，
 * 因此键入过程中出现的空串、'-' 等临时文本不会写入项目、草稿参数或模型。
 * 提交目标既可以是工程（属性编辑），也可以是绘制草稿参数。
 * 错误用文字 + aria-invalid 同时表达，不只依赖颜色。
 */
export function NumberFields({ fields, apply }: {
  fields: NumberField[]; apply: (values: Record<string, number>) => Result<unknown>;
}): ReactElement {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.key, String(f.value)])));
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState<string[]>([]);
  const errorId = useId();
  // 校验失败时按 issue.path 的末段匹配字段名；无法定位（如基槽 points）则整组标为无效。
  const locate = (paths: string[]): string[] => {
    const keys = fields.map(f => f.key);
    const hit = paths.flatMap(path => {
      const bare = (path.split('.').pop() ?? '').replace(/\[\d+\]$/, '');
      return keys.filter(key => key === bare || key.replace(/[xy]\d+$/, 'points') === bare);
    });
    return hit.length ? [...new Set(hit)] : keys;
  };
  function change(key: string, text: string): void {
    const next = { ...draft, [key]: text }; setDraft(next);
    if (Object.values(next).some(v => !v.trim() || !Number.isFinite(Number(v)))) {
      setError('请填写所有有限数值；已保留上次有效参数。'); setInvalid([key]); return;
    }
    const values = Object.fromEntries(Object.entries(next).map(([k, v]) => [k, Number(v)]));
    const result = apply(values);
    setError(result.ok ? '' : result.issues.map(i => `${i.path}：${i.message}`).join('；'));
    setInvalid(result.ok ? [] : locate(result.issues.map(i => i.path)));
  }
  return <>
    {fields.map(f => <label key={f.key}>{f.label}<input aria-label={f.label} type="text" inputMode="decimal" value={draft[f.key] ?? ''}
      min={f.min} max={f.max} title={rangeTitle(f)} aria-invalid={invalid.includes(f.key) || undefined}
      aria-describedby={error ? errorId : undefined}
      onChange={e => change(f.key, e.target.value)} /></label>)}
    {error && <p role="alert" className="input-error" id={errorId}>{error}</p>}
  </>;
}