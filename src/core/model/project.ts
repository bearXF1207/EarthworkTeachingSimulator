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
