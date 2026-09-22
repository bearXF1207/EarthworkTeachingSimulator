// 统一工程保护边界。数值调整必须同时更新设计文档、验证器提示和边界测试，禁止各模块另定义。
export const EPSILON = 1e-7;
/** 接触判定容差：明显大于 EPSILON，用于区分“边界接触”与“内部交叠”。 */
export const TOUCH_TOLERANCE = 1e-6;
/** 相邻基槽吸附半径（米）。 */
export const SNAP_RADIUS = 1.5;
export const MAX_COORDINATE = 10000;
export const MIN_SIZE = 0.02;
export const MAX_SIZE = 1000;
export const MIN_SLOPE = 0;
export const MAX_SLOPE = 5;
export const MAX_ELEMENTS = 500;
export const MIN_NODES = 2;
export const MAX_NODES = 200;
export const MIN_SEGMENT_LENGTH = 0.01;
