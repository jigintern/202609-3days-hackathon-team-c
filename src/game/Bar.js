import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// 空中に浮く四角い棒。この上にメールブロックの壁を積む。
// 既定の長さ。実際の長さは乗せる壁の幅に合わせてGameSceneから渡す
// （文字数で壁の幅が変わるため、固定値のままだと壁が棒からはみ出す）
//
// 奥行き(Z)はブロックの奥行き1.0に対して2.0。前後のマージンは均等ではなく、
// 手前(+Z)0.3 / 奥(-Z)0.7 に振ってある。
// - 奥を厚くしているのは、押されたブロックが背面へこぼれ落ちるまでの猶予＝難易度そのものだから。
//   重心が後端を越えるまでに必要な横ずれが0.6m→1.0mになり、落ちにくくなる（＝難しくなる）。
//   ここを詰め直すのがゲームバランス調整の主なつまみ
// - 手前を薄くしているのは、棒の前縁が球の通り道に張り出すのを最小限にするため。
//   厚くすると最下段を狙った球が壁に届く前に棒の前縁へ当たるようになる
export const BAR_SIZE = new THREE.Vector3(8, 0.3, 2.0);
// 前後のマージンを非対称にするための、棒の中心のZオフセット。
// 手前マージン0.3のとき前縁は +0.5 + 0.3 = +0.8、中心は 0.8 - 2.0/2 = -0.2
export const BAR_Z = -0.2;
// 棒の中心の高さ。ここを動かすと狙うべき仰角が変わるので、
// GameScene のカメラ lookAt と AimController の引き量の当たり所もセットで見直すこと
export const BAR_Y = 6;
// 棒の上面。ブロックの1段目はこの高さから積み始める
export const BAR_TOP_Y = BAR_Y + BAR_SIZE.y / 2;

const BAR_COLOR = 0x8a93a8;

// 完全固定（mass 0）の静的ボディ。球が当たっても棒自体は動かない。
// 棒が落ちる設計にすると、乗っている壁が一撃で全部落ちて8球の球数設計が壊れる
export class Bar {
  // length: 棒の長さ(X)。省略すると BAR_SIZE.x を使う
  constructor(physicsWorld, material, length = BAR_SIZE.x) {
    this.physicsWorld = physicsWorld;
    this.length = length;

    const geometry = new THREE.BoxGeometry(length, BAR_SIZE.y, BAR_SIZE.z);
    const meshMaterial = new THREE.MeshStandardMaterial({
      color: BAR_COLOR,
      metalness: 0.5,
      roughness: 0.45,
    });
    this.mesh = new THREE.Mesh(geometry, meshMaterial);
    this.mesh.position.set(0, BAR_Y, BAR_Z);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    this.body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(
        new CANNON.Vec3(length / 2, BAR_SIZE.y / 2, BAR_SIZE.z / 2)
      ),
      material,
    });
    this.body.position.set(0, BAR_Y, BAR_Z);
    this.physicsWorld.addBody(this.body);
  }

  dispose() {
    this.physicsWorld.removeBody(this.body);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
