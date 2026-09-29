import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import type { Result } from '../../core/model/project';

/** min/max 只作界面提示与浏览器辅助；数值是否接受始终由 core/validation 决定，不在 UI 另设一套校验。 */
export type NumberField = { key: string; label: string; value: number; min?: number; max?: number };

const rangeTitle = (field: NumberField): string | undefined =>
  field.min === undefined || field.max === undefined ? undefined : `取值范围 ${field.min}～${field.max}`;

type FormState = { modelKey: string; draft: Record<string, string>; error: string; invalid: string[] };
const valuesKey = (fields: NumberField[], values?: Record<string, number>): string =>
  JSON.stringify(fields.map(field => [field.key, values ? values[field.key] : field.value]));
const formFromModel = (fields: NumberField[], modelKey: string): FormState => ({
  modelKey, draft: Object.fromEntries(fields.map(field => [field.key, String(field.value)])), error: '', invalid: [],
});

/**
 * 数值文本草稿与已接受数据分离：只有全部字段都是有限数值时才提交候选，
 * 因此键入过程中出现的空串、'-' 等临时文本不会写入项目、草稿参数或模型。
 * 提交目标既可以是工程（属性编辑），也可以是绘制草稿参数。
 * 错误用文字 + aria-invalid 同时表达，不只依赖颜色。
 */
export function NumberFields({ fields, apply }: {
  fields: NumberField[]; apply: (values: Record<string, number>) => Result<unknown>;
}): ReactElement {
  const modelKey = valuesKey(fields);
  const [form, setForm] = useState(() => formFromModel(fields, modelKey));
  const errorId = useId();
  // 按模型内容同步，不能按每次渲染都会重建的 fields 数组引用同步。
  // 在提交当前渲染前重置外部更新对应的草稿，避免旧参数继续显示或参与下一次编辑。
  let current = form;
  if (form.modelKey !== modelKey) {
    current = formFromModel(fields, modelKey);
    setForm(current);
  }
  const { draft, error, invalid } = current;
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
    const next = { ...draft, [key]: text };
    if (Object.values(next).some(v => !v.trim() || !Number.isFinite(Number(v)))) {
      setForm({ modelKey, draft: next, error: '请填写所有有限数值；已保留上次有效参数。', invalid: [key] });
      return;
    }
    const values = Object.fromEntries(Object.entries(next).map(([k, v]) => [k, Number(v)]));
    const result = apply(values);
    // apply 同步接受后，父组件回传相同数值时保留 '3.' 等输入文本和原输入节点。
    // 撤销、拖动或数值归一化回传不同内容时，则由上面的模型同步替换整组草稿。
    setForm({
      modelKey: result.ok ? valuesKey(fields, values) : modelKey,
      draft: next,
      error: result.ok ? '' : result.issues.map(i => `${i.path}：${i.message}`).join('；'),
      invalid: result.ok ? [] : locate(result.issues.map(i => i.path)),
    });
  }
  return <>
    {fields.map(f => <label key={f.key}>{f.label}<input aria-label={f.label} type="text" inputMode="decimal" value={draft[f.key] ?? ''}
      min={f.min} max={f.max} title={rangeTitle(f)} aria-invalid={invalid.includes(f.key) || undefined}
      aria-describedby={error ? errorId : undefined}
      onChange={e => change(f.key, e.target.value)} /></label>)}
    {error && <p role="alert" className="input-error" id={errorId}>{error}</p>}
  </>;
}
