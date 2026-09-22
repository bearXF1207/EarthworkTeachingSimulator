import { Group, Mesh, MeshStandardMaterial } from 'three';
import type { ExcavationElement, Point2 } from '../core/model/project';
import { buildPit } from '../core/geometry/pit';
import { buildTrench } from '../core/geometry/trench';

/** 把已校验的开挖对象转换为场景 Mesh，并输出与几何同源的地面开口轮廓。 */
export class ExcavationMeshes {
  readonly root = new Group();
  readonly holes: Point2[][] = [];
  private disposed = false;
  constructor(elements: ExcavationElement[], wireframe = false) {
    try {
      for (const element of elements) {
        const built = element.type === 'trench' ? buildTrench(element) : buildPit(element);
        const materials = [new MeshStandardMaterial({ color: 0xb8a77c, roughness: 1, wireframe }),
          new MeshStandardMaterial({ color: 0x936c43, roughness: 1, wireframe })];
        const mesh = new Mesh(built.geometry, materials); mesh.name = element.id;
        this.root.add(mesh); this.holes.push(built.topOutline);
      }
    } catch (error) { this.dispose(); throw error; }
  }
  setWireframe(value: boolean): void {
    for (const child of this.root.children) if (child instanceof Mesh) {
      for (const material of child.material as MeshStandardMaterial[]) material.wireframe = value;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const child of this.root.children) if (child instanceof Mesh) {
      child.geometry.dispose();
      for (const material of child.material as MeshStandardMaterial[]) material.dispose();
    }
    this.root.clear(); this.root.removeFromParent();
  }
}
