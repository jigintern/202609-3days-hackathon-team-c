import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { clamp } from '../utils/helpers.js';

const RADIUS = 0.35;
const MAX_LAUNCH_SPEED = 26;

// 鉄球。生成した瞬間は静止しており、launch()で狙った方向へパワーに応じた速度を与える
export class Ball {
  constructor(physicsWorld, material) {
    this.physicsWorld = physicsWorld;

    const geometry = new THREE.SphereGeometry(RADIUS, 24, 24);
    const meshMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
      metalness: 0.9,
      roughness: 0.2,
    });
    this.mesh = new THREE.Mesh(geometry, meshMaterial);
    this.mesh.castShadow = true;

    this.body = new CANNON.Body({
      mass: 4,
      shape: new CANNON.Sphere(RADIUS),
      material,
      linearDamping: 0.05,
    });
  }

  spawnAt(position) {
    this.body.position.set(position.x, position.y, position.z);
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.physicsWorld.addBody(this.body);
  }

  // direction: THREE.Vector3（正規化済み想定）, powerPercent: 0〜100
  launch(direction, powerPercent) {
    const speed = (clamp(powerPercent, 0, 100) / 100) * MAX_LAUNCH_SPEED;
    this.body.velocity.set(
      direction.x * speed,
      direction.y * speed,
      direction.z * speed
    );
  }

  syncMeshToBody() {
    this.mesh.position.copy(this.body.position);
    this.mesh.quaternion.copy(this.body.quaternion);
  }

  dispose() {
    this.physicsWorld.removeBody(this.body);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
