import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { Camera } from 'three';
import type { Point2 } from '../core/model/project';

const GROUND = new Plane(new Vector3(0, 0, 1), 0);

/**
 * 画布内归一化设备坐标：使用画布自身的 bounding rect，而不是整个窗口宽高。
 * 落在画布外、尺寸为零或非有限输入返回 null，调用方据此忽略事件。
 */
export function pointerNdc(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): Vector2 | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || !(rect.width > 0) || !(rect.height > 0)) return null;
  const u = (clientX - rect.left) / rect.width, v = (clientY - rect.top) / rect.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return new Vector2(u * 2 - 1, 1 - v * 2);
}

/** 屏幕点投影到地面 z=0；视线与地面平行或落在画布外时返回 null。 */
export function groundPointFromPointer(
  clientX: number, clientY: number, camera: Camera,
  rect: { left: number; top: number; width: number; height: number },
): Point2 | null {
  const ndc = pointerNdc(clientX, clientY, rect);
  if (!ndc) return null;
  const raycaster = new Raycaster();
  raycaster.setFromCamera(ndc, camera);
  // 视线与地面接近平行时交点会漂移到很远，位置不可信，按无交点处理。
  if (Math.abs(GROUND.normal.dot(raycaster.ray.direction)) < 1e-9) return null;
  const hit = raycaster.ray.intersectPlane(GROUND, new Vector3());
  if (!hit || !Number.isFinite(hit.x) || !Number.isFinite(hit.y)) return null;
  return { x: hit.x, y: hit.y };
}
