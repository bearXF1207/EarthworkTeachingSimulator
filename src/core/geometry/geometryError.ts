/**
 * 几何生成的可读错误：携带出错节点或线段序号，供校验层转成结构化 issue。
 * node/segment 为 null 表示错误与单个节点无关（例如整条轮廓或中心线整体失效）。
 * 序号统一为 0 基下标，展示给用户时由调用方加一。
 */
export class GeometryError extends Error {
  readonly node: number | null;
  readonly segment: number | null;
  constructor(message: string, node: number | null = null, segment: number | null = null) {
    super(message);
    this.name = 'GeometryError';
    this.node = node;
    this.segment = segment;
  }
}
