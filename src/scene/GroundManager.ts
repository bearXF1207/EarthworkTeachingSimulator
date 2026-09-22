import { AxesHelper, DoubleSide, GridHelper, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';

export class GroundManager {
  readonly root = new Group();
  readonly ground = new Mesh(new PlaneGeometry(100, 100), new MeshStandardMaterial({
    color: 0x7d8060, roughness: 1, side: DoubleSide,
  }));
  readonly grid = new GridHelper(100, 100, 0x414d3f, 0x667157);
  readonly axes = new AxesHelper(12);
  private disposed = false;
  constructor() {
    this.root.name = 'ground';
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.z = 0.015;
    this.axes.position.z = 0.03;
    this.root.add(this.ground, this.grid, this.axes);
  }
  setGridVisible(visible: boolean): void { this.grid.visible = visible; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const object of [this.ground, this.grid, this.axes]) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    }
    this.root.clear();
    this.root.removeFromParent();
  }
}
