import * as THREE from 'three';
import { GRAVITY_Y } from './PhysicsWorld.js';
import { MAX_LAUNCH_SPEED } from './Ball.js';

const SAMPLE_COUNT = 30;
const MAX_TIME_SECONDS = 2.5;

// エイム中（ドラッグ中）に、実際の重力に沿った放物線の予測線を表示する
export class TrajectoryPreview {
  constructor(scene) {
    this.scene = scene;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(SAMPLE_COUNT * 3), 3)
    );
    const material = new THREE.LineDashedMaterial({
      color: 0xffcc33,
      dashSize: 0.25,
      gapSize: 0.15,
    });
    this.line = new THREE.Line(geometry, material);
    this.line.visible = false;
    this.line.frustumCulled = false;
    this.scene.add(this.line);
  }

  show() {
    this.line.visible = true;
  }

  hide() {
    this.line.visible = false;
  }

  // origin: THREE.Vector3, direction: THREE.Vector3（正規化済み）, powerPercent: 0〜100
  update(origin, direction, powerPercent) {
    const speed = (powerPercent / 100) * MAX_LAUNCH_SPEED;
    const positions = this.line.geometry.attributes.position.array;

    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const t = (i / (SAMPLE_COUNT - 1)) * MAX_TIME_SECONDS;
      positions[i * 3] = origin.x + direction.x * speed * t;
      // 地面が無いステージなので、予測線もy=0で止めずにそのまま下へ伸ばす
      positions[i * 3 + 1] =
        origin.y + direction.y * speed * t + 0.5 * GRAVITY_Y * t * t;
      positions[i * 3 + 2] = origin.z + direction.z * speed * t;
    }

    this.line.geometry.attributes.position.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
    this.line.computeLineDistances();
  }

  dispose() {
    this.scene.remove(this.line);
    this.line.geometry.dispose();
    this.line.material.dispose();
  }
}
