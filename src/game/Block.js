import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const SIZE = new THREE.Vector3(1.4, 0.9, 1);
const HIT_DURABILITY = 2; // 何回衝突判定を受けたら壊れるか

// お祈り/落選メール1通を表すブロック。耐久値が尽きるとシーンから消える
export class Block {
  constructor(physicsWorld, material, labelText, labelContainer) {
    this.physicsWorld = physicsWorld;
    this.durability = HIT_DURABILITY;
    this.isDestroyed = false;

    const geometry = new THREE.BoxGeometry(SIZE.x, SIZE.y, SIZE.z);
    const meshMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f2f2 });
    this.mesh = new THREE.Mesh(geometry, meshMaterial);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    this.body = new CANNON.Body({
      mass: 1.5,
      shape: new CANNON.Box(
        new CANNON.Vec3(SIZE.x / 2, SIZE.y / 2, SIZE.z / 2)
      ),
      material,
    });

    // 耐久値はボールとの衝突でのみ減らす（ブロック同士や床との接触では減らさない）。
    // 速度の大きい衝突のみカウントして誤爆を防ぐ
    this.body.addEventListener('collide', (event) => {
      if (!event.body.isBall) return;
      const impactSpeed = event.contact.getImpactVelocityAlongNormal();
      if (Math.abs(impactSpeed) > 1.5) {
        this.durability -= 1;
      }
    });

    this.labelContainer = labelContainer;
    this.labelElement = document.createElement('div');
    this.labelElement.className = 'block-label';
    this.labelElement.textContent = labelText;
    labelContainer.appendChild(this.labelElement);
  }

  spawnAt(position) {
    this.body.position.set(position.x, position.y, position.z);
    this.physicsWorld.addBody(this.body);
  }

  syncMeshToBody() {
    this.mesh.position.copy(this.body.position);
    this.mesh.quaternion.copy(this.body.quaternion);
  }

  // カメラの投影行列を使ってブロックの3D座標をスクリーン座標に変換し、ラベルを追従させる
  updateLabelPosition(camera, width, height) {
    const projected = this.mesh.position.clone().project(camera);
    const behindCamera = projected.z > 1;
    if (behindCamera) {
      this.labelElement.style.display = 'none';
      return;
    }
    this.labelElement.style.display = 'block';
    const x = (projected.x * 0.5 + 0.5) * width;
    const y = (-projected.y * 0.5 + 0.5) * height;
    this.labelElement.style.left = `${x}px`;
    this.labelElement.style.top = `${y}px`;
  }

  get shouldBreak() {
    return this.durability <= 0;
  }

  dispose() {
    this.physicsWorld.removeBody(this.body);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.labelElement.remove();
  }
}
