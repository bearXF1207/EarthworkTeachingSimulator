import { useState } from 'react';
import type { ReactElement } from 'react';
import { polylineReport } from '../../core/geometry/pointMath';
import type { PitDraftParams, TrenchSection } from '../../core/model/project';
import { PIT_LABELS } from '../../core/model/project';
import type { DrawingState, ToolKind } from '../../scene/DrawingManager';
import { NumberFields } from '../PropertyPanel/NumberFields';
import type { NumberField } from '../PropertyPanel/NumberFields';

const TOOL_LABELS: Record<ToolKind, string> = { select: '选择', drawTrench: '绘制基槽', placePit: '放置基坑', measure: '测量（后续阶段）' };
const format = (value: number, digits: number): string => value.toFixed(digits);

/** 长度与角度输入：Enter 或按钮提交一段，结果不做网格吸附。 */
function SegmentForm({ disabled, onAdvance }: { disabled: boolean; onAdvance: (length: number, angle: number) => void }): ReactElement {
  const [length, setLength] = useState('10'), [angle, setAngle] = useState('0'), [error, setError] = useState('');
  const submit = (): void => {
    const parsedLength = Number(length), parsedAngle = Number(angle);
    if (!length.trim() || !angle.trim() || !Number.isFinite(parsedLength) || !Number.isFinite(parsedAngle) || parsedLength <= 0) {
      setError('请输入大于 0 的有限长度与有限角度'); return;
    }
    setError(''); onAdvance(parsedLength, parsedAngle);
  };
  // 普通 Enter 提交本段；Ctrl/Cmd+Enter 留给全局的“完成基槽”。
  const keyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); submit(); }
  };
  return <div className="segment-form">
    <label>本段长度（m）<input aria-label="本段长度（m）" type="text" inputMode="decimal" value={length}
      onChange={e => setLength(e.target.value)} onKeyDown={keyDown} /></label>
    <label>方位角（°）<input aria-label="方位角（°）" type="text" inputMode="decimal" value={angle}
      onChange={e => setAngle(e.target.value)} onKeyDown={keyDown} /></label>
    <button disabled={disabled} onClick={submit}>添加下一点</button>
    {error && <p role="alert" className="input-error">{error}</p>}
  </div>;
}

type Props = {
  state: DrawingState; ready: boolean; message: string; hint: string;
  section: TrenchSection; pit: PitDraftParams; ortho: boolean;
  onTool: (kind: ToolKind) => void; onSection: (section: TrenchSection) => void; onPit: (pit: PitDraftParams) => void;
  onOrtho: (enabled: boolean) => void;
  onAdvance: (length: number, angle: number) => void; onFinish: () => void; onCancel: () => void;
};

/** M5 绘制面板：工具切换、草稿读数与精确输入、基坑放置参数、正交模式与吸附提示。草稿不进入项目数据。 */
export function DrawingPanel({ state, ready, message, hint, section, pit, ortho, onTool, onSection, onPit, onOrtho, onAdvance, onFinish, onCancel }: Props): ReactElement {
  const nodes = state.kind === 'drawTrench' ? state.nodes : [];
  const segments = polylineReport(nodes);
  const cursor = state.kind === 'drawTrench' ? state.cursor : null;
  const last = nodes[nodes.length - 1];
  const rubber = last && cursor ? polylineReport([last, cursor])[0] : undefined;
  // 标签带“新建”前缀，与已创建对象的属性标签区分，避免同名输入框歧义。
  const sectionFields: NumberField[] = [
    { key: 'bottomWidth', label: '新建基槽底宽（m）', value: section.bottomWidth },
    { key: 'depth', label: '新建基槽深度（m）', value: section.depth },
    { key: 'slope', label: '新建基槽坡比 m', value: section.slope },
  ];
  const pitFields: NumberField[] = pit.type === 'circular-pit'
    ? [{ key: 'bottomDiameter', label: '新建基坑底直径（m）', value: pit.bottomDiameter }]
    : pit.type === 'rect-pit'
      ? [{ key: 'bottomLength', label: '新建基坑底长（m）', value: pit.bottomLength }, { key: 'bottomWidth', label: '新建基坑底宽（m）', value: pit.bottomWidth },
        { key: 'rotation', label: '新建基坑旋转角（°）', value: pit.rotation }]
      : [{ key: 'bottomSize', label: '新建基坑底边长（m）', value: pit.bottomSize }, { key: 'rotation', label: '新建基坑旋转角（°）', value: pit.rotation }];
  return <section className="draw-panel" aria-label="绘制工具">
    <div className="create-elements" role="group" aria-label="工具">
      {(Object.keys(TOOL_LABELS) as ToolKind[]).map(kind =>
        <button key={kind} disabled={!ready || kind === 'measure'} aria-pressed={state.kind === kind}
          onClick={() => onTool(kind)}>{TOOL_LABELS[kind]}</button>)}
    </div>
    {message && <p role="alert" className="input-error">{message}</p>}
    {state.kind === 'drawTrench' && <div className="draw-draft">
      <p className="scope-note">已设置 {nodes.length} 个节点：在俯视场地单击添加。确认方式：双击终点、Enter（输入框内用 Ctrl/Cmd+Enter）或“完成基槽”按钮；Esc 取消。绘制期间锁定视角。</p>
      <label><input type="checkbox" checked={ortho} onChange={event => onOrtho(event.target.checked)} />正交模式（仅水平/竖直）</label>
      <p className="scope-note">中心线会吸附到相邻基槽的端点、中心线与槽顶边界，可用端点对接、共边贴合或围合成封闭区域；基槽之间只允许边界接触。正交模式只约束鼠标绘制，长度/角度输入仍按输入值。</p>
      {segments.map((segment, index) =>
        <p key={index}>第 {index + 1} 段：{format(segment.length, 2)}m · 方位角 {format(segment.angle, 1)}°</p>)}
      {last && <p>当前点：({format(last.x, 2)}, {format(last.y, 2)})</p>}
      {rubber && <p>当前段：{format(rubber.length, 2)}m · 方位角 {format(rubber.angle, 1)}°</p>}
      {hint && <p className="scope-note">当前吸附：{hint}</p>}
      <SegmentForm disabled={!ready || !nodes.length} onAdvance={onAdvance} />
      <NumberFields fields={sectionFields} apply={values => {
        onSection({ bottomWidth: values.bottomWidth!, depth: values.depth!, slope: values.slope! });
        return { ok: true, value: null };
      }} />
      <div className="create-elements">
        <button disabled={!ready || !nodes.length} onClick={onFinish}>完成基槽（Enter）</button>
        <button onClick={onCancel}>取消绘制（Esc）</button>
      </div>
    </div>}
    {state.kind === 'placePit' && <div className="draw-draft">
      <label>基坑类型<select aria-label="基坑类型" value={pit.type} onChange={e => onPit({ ...pit, type: e.target.value as PitDraftParams['type'] })}>
        {(Object.keys(PIT_LABELS) as PitDraftParams['type'][]).map(type => <option key={type} value={type}>{PIT_LABELS[type]}</option>)}
      </select></label>
      <NumberFields key={pit.type} fields={pitFields} apply={values => {
        onPit({ ...pit, ...values } as PitDraftParams);
        return { ok: true, value: null };
      }} />
      <NumberFields fields={[
        { key: 'depth', label: '新建基坑深度（m）', value: pit.depth },
        { key: 'slope', label: '新建基坑坡比 m', value: pit.slope },
      ]} apply={values => {
        onPit({ ...pit, depth: values.depth!, slope: values.slope! });
        return { ok: true, value: null };
      }} />
      <p className="scope-note">在俯视场地单击放置；与既有开口重叠、包含或相切会被拒绝并保持当前工具。</p>
      <div className="create-elements"><button onClick={onCancel}>取消放置（Esc）</button></div>
    </div>}
  </section>;
}
