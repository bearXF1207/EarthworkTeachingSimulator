import { Group, Mesh, MeshStandardMaterial } from 'three';
import type { Pit, Point2 } from '../core/model/project';
import { buildPit } from '../core/geometry/pit';

export class PitMeshes {
  readonly root = new Group();
  readonly holes: Point2[][] = [];
  private disposed = false;
  constructor(pits: Pit[], wireframe = false) {
    try {
      for (const pit of pits) {
        const built = buildPit(pit);
        const materials = [new MeshStandardMaterial({ color: 0xb8a77c, roughness: 1, wireframe }),
          new MeshStandardMaterial({ color: 0x936c43, roughness: 1, wireframe })];
        const mesh = new Mesh(built.geometry, materials); mesh.name = pit.id;
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
