export type Point2 = { x: number; y: number };
type PitBase = { id: string; position: Point2; depth: number; slope: number };
export type SquarePit = PitBase & { type: 'square-pit'; bottomSize: number; rotation: number };
export type RectPit = PitBase & { type: 'rect-pit'; bottomLength: number; bottomWidth: number; rotation: number };
export type CircularPit = PitBase & { type: 'circular-pit'; bottomDiameter: number };
export type Pit = SquarePit | RectPit | CircularPit;
export const PIT_LABELS = { 'square-pit': '方形基坑', 'rect-pit': '矩形基坑', 'circular-pit': '圆形基坑' };
export type Trench = { id: string; type: 'trench'; points: Point2[]; bottomWidth: number; depth: number; slope: number };
export type ExcavationElement = Pit | Trench;
export type Project = {
  version: 1; name: string; units: 'm'; elements: ExcavationElement[];
  settings: { gridVisible: boolean; snapEnabled: boolean; snapSpacing: 1; groundSize: number };
};
export type ValidationIssue = { code: string; path: string; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };
export const emptyProject = (): Project => ({ version: 1, name: '未命名工程', units: 'm', elements: [],
  settings: { gridVisible: true, snapEnabled: true, snapSpacing: 1, groundSize: 100 } });
export const normalizeDegrees = (degrees: number): number => ((degrees % 360) + 360) % 360;

/** 基槽整槽共用的截面草稿参数。 */
export type TrenchSection = { bottomWidth: number; depth: number; slope: number };
/** 基坑放置草稿：四种尺寸字段同时保存，切换类型时不必重新输入。 */
export type PitDraftParams = {
  type: Pit['type']; bottomSize: number; bottomLength: number; bottomWidth: number; bottomDiameter: number;
  depth: number; slope: number; rotation: number;
};
export const defaultPitDraft = (type: Pit['type']): PitDraftParams => ({
  type, bottomSize: 4, bottomLength: 6, bottomWidth: 4, bottomDiameter: 4, depth: 2, slope: .5, rotation: 0,
});

/** 由草稿构造候选基坑（未校验）；放置预览与提交共用，避免两处字段不一致。 */
export function pitFromDraft(id: string, position: Point2, draft: PitDraftParams): Pit {
  const base = { id, position: { x: position.x, y: position.y }, depth: draft.depth, slope: draft.slope };
  if (draft.type === 'square-pit') return { ...base, type: 'square-pit', bottomSize: draft.bottomSize, rotation: draft.rotation };
  if (draft.type === 'rect-pit') {
    return { ...base, type: 'rect-pit', bottomLength: draft.bottomLength, bottomWidth: draft.bottomWidth, rotation: draft.rotation };
  }
  return { ...base, type: 'circular-pit', bottomDiameter: draft.bottomDiameter };
}

/** 由草稿构造候选基槽（未校验），节点为副本以免后续编辑草稿影响已提交对象。 */
export function trenchFromDraft(id: string, points: Point2[], section: TrenchSection): Trench {
  return { id, type: 'trench', points: points.map(p => ({ x: p.x, y: p.y })), ...section };
}
