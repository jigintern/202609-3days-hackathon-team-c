import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GRAVITY_Y } from './PhysicsWorld.js';
import { clamp, lerp } from '../utils/helpers.js';

// ブロックと同じく世界のスケールに合わせて1.6倍にしてある（元は0.35）。
// ここだけ据え置くと壁に対して豆粒になり、当たり判定も相対的に狭くなる
const RADIUS = 0.56;

// 発射距離から「使える速度の範囲」を求める。
// 距離が変われば届く速度も変わるので、固定値ではなく毎回ここで計算する。
// - 下限: 仰角45度の山なりで壁の根元にぎりぎり届く速度（これ未満はどう撃っても絶対に届かない）
// - 上限: ほぼ水平に撃って壁の根元に届く速度（これ以上速くしても直線的になるだけ）
// 低い仰角と低い威力を同時に選ぶと届かない組み合わせが残るが、それは物理的に避けられない。
// 指を離す前に軌道プレビューの点線で分かるようにしてある
export function launchSpeedRange(distance, launchHeight) {
  const gravity = Math.abs(GRAVITY_Y);
  const reachWithLob = Math.sqrt(
    (gravity * distance * distance) / (launchHeight + distance)
  );
  const reachWithFlatShot = Math.sqrt(
    (gravity * distance * distance) / (2 * launchHeight)
  );
  return { min: reachWithLob * 1.2, max: reachWithFlatShot * 1.1 };
}

// powerRatio(0〜1)を実際の速度に変換する
export function speedFromPowerRatio(speedRange, powerRatio) {
  return lerp(speedRange.min, speedRange.max, clamp(powerRatio, 0, 1));
}

// 鉄球。生成した瞬間は静止しており、launch()で狙った方向へ指定の速度を与える
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
      // 球体は減衰が小さすぎるといつまでも転がり続けて静止判定が来ないため、
      // 現実の転がり摩擦相当の減衰をかけて数秒以内に収束させる
      linearDamping: 0.3,
      angularDamping: 0.4,
    });
    // ブロック側で衝突相手がボールかどうかを見分けるための目印
    this.body.isBall = true;
  }

  spawnAt(position) {
    this.body.position.set(position.x, position.y, position.z);
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.physicsWorld.addBody(this.body);
  }

  // direction: THREE.Vector3（正規化済み想定）, speed: m/s
  launch(direction, speed) {
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
