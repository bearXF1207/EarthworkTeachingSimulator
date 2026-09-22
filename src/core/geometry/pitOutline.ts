import type { Pit, Point2 } from '../model/project';

export const CIRCLE_SEGMENTS = 96;
export function outline(pit: Pit, top: boolean): Point2[] {
  const expansion = top ? pit.depth * pit.slope : 0;
  if (pit.type === 'circular-pit') {
    const r = pit.bottomDiameter / 2 + expansion;
    return Array.from({ length: CIRCLE_SEGMENTS }, (_, i) => {
      const a = i * Math.PI * 2 / CIRCLE_SEGMENTS;
      return { x: pit.position.x + r * Math.cos(a), y: pit.position.y + r * Math.sin(a) };
    });
  }
  const x = (pit.type === 'square-pit' ? pit.bottomSize : pit.bottomLength) / 2 + expansion;
  const y = (pit.type === 'square-pit' ? pit.bottomSize : pit.bottomWidth) / 2 + expansion;
  const angle = pit.rotation * Math.PI / 180;
  return [[-x, -y], [x, -y], [x, y], [-x, y]].map(([px = 0, py = 0]) => ({
    x: pit.position.x + px * Math.cos(angle) - py * Math.sin(angle),
    y: pit.position.y + px * Math.sin(angle) + py * Math.cos(angle),
  }));
}
