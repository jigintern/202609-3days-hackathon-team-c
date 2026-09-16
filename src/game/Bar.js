import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// 空中に浮く四角い棒。この上にメールブロックの壁を積む。
// 奥行き(Z)はブロックの奥行き1.0に対して1.2しかなく、前後のマージンは片側0.1しかない。
// 球が当たって少しでも押し出されたブロックが背面へこぼれ落ちるよう、
// わざとギリギリの幅にしてある（広げると落ちにくくなってゲームが成立しない）
export const BAR_SIZE = new THREE.Vector3(8, 0.3, 1.2);
// 棒の中心の高さ。ここを動かすと狙うべき仰角が変わるので、
// GameScene のカメラ lookAt と AimController の引き量の当たり所もセットで見直すこと
export const BAR_Y = 6;
// 棒の上面。ブロックの1段目はこの高さから積み始める
export const BAR_TOP_Y = BAR_Y + BAR_SIZE.y / 2;

const BAR_COLOR = 0x8a93a8;

// 完全固定（mass 0）の静的ボディ。球が当たっても棒自体は動かない。
// 棒が落ちる設計にすると、乗っている壁が一撃で全部落ちて8球の球数設計が壊れる
export class Bar {
  constructor(physicsWorld, material) {
    this.physicsWorld = physicsWorld;

    const geometry = new THREE.BoxGeometry(BAR_SIZE.x, BAR_SIZE.y, BAR_SIZE.z);
    const meshMaterial = new THREE.MeshStandardMaterial({
      color: BAR_COLOR,
      metalness: 0.5,
      roughness: 0.45,
    });
    this.mesh = new THREE.Mesh(geometry, meshMaterial);
    this.mesh.position.set(0, BAR_Y, 0);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    this.body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(
        new CANNON.Vec3(BAR_SIZE.x / 2, BAR_SIZE.y / 2, BAR_SIZE.z / 2)
      ),
      material,
    });
    this.body.position.set(0, BAR_Y, 0);
    this.physicsWorld.addBody(this.body);
  }

  dispose() {
    this.physicsWorld.removeBody(this.body);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
