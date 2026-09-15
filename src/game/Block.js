import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const SIZE = new THREE.Vector3(1.4, 0.9, 1);
const HIT_DURABILITY = 2; // 何回衝突判定を受けたら壊れるか

// 文字を焼き込むテクスチャの解像度。ブロックの手前面(1.4 x 0.9)と同じ縦横比にして、
// 貼り付けたときに文字が横へ潰れないようにしている
const TEXTURE_WIDTH = 448;
const TEXTURE_HEIGHT = 288;
// 面の内側に引く罫線の余白。1文字=1ブロックの区切りを目で追えるようにするためのもの
const FRAME_INSET_RATIO = 0.08;
// 面の高さに対する文字の大きさ。枠と文字が競合しない範囲でできるだけ大きく取る
const CHARACTER_HEIGHT_RATIO = 0.7;

// メールの文面＝紙、という見立ての配色。暗い背景に対してコントラストを最大化する
const PAPER_COLOR = '#f5efe0';
const FRAME_COLOR = '#c9b99a';
const INK_COLOR = '#2a2724';
const SIDE_COLOR = 0xe8dfc8; // 文字を貼らない4面（紙の断面のイメージ）

const FONT_STACK =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

// 1文字をブロック面いっぱいに描いたテクスチャを作る。
// 同じ文字が何度も出てくるため、生成結果はGameScene側でキャッシュして使い回す
export function createCharacterTexture(character) {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext('2d');

  context.fillStyle = PAPER_COLOR;
  context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

  const inset = TEXTURE_HEIGHT * FRAME_INSET_RATIO;
  context.strokeStyle = FRAME_COLOR;
  context.lineWidth = Math.max(2, TEXTURE_HEIGHT * 0.02);
  context.strokeRect(
    inset,
    inset,
    TEXTURE_WIDTH - inset * 2,
    TEXTURE_HEIGHT - inset * 2
  );

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = INK_COLOR;

  // 日本語はほぼ正方形に収まるが、記号や欧文には横に広い字があるので、
  // 実測して枠からはみ出す場合だけ縮める
  let fontSize = TEXTURE_HEIGHT * CHARACTER_HEIGHT_RATIO;
  context.font = `700 ${fontSize}px ${FONT_STACK}`;
  const maxTextWidth = TEXTURE_WIDTH - inset * 4;
  const measuredWidth = context.measureText(character).width;
  if (measuredWidth > maxTextWidth) {
    fontSize *= maxTextWidth / measuredWidth;
    context.font = `700 ${fontSize}px ${FONT_STACK}`;
  }
  context.fillText(character, TEXTURE_WIDTH / 2, TEXTURE_HEIGHT / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// メール本文の1文字を表すブロック。耐久値が尽きるとシーンから消える
export class Block {
  constructor(physicsWorld, material, characterTexture) {
    this.physicsWorld = physicsWorld;
    this.durability = HIT_DURABILITY;
    this.isDestroyed = false;

    const geometry = new THREE.BoxGeometry(SIZE.x, SIZE.y, SIZE.z);
    const faceMaterial = new THREE.MeshStandardMaterial({
      map: characterTexture,
      roughness: 0.85,
    });
    const sideMaterial = new THREE.MeshStandardMaterial({
      color: SIDE_COLOR,
      roughness: 0.9,
    });
    // BoxGeometryのマテリアル配列は [+X, -X, +Y, -Y, +Z, -Z] の順。
    // プレイヤーに向く手前(+Z)と背面(-Z)にだけ文字を貼り、残り4面は断面色にする
    this.mesh = new THREE.Mesh(geometry, [
      sideMaterial,
      sideMaterial,
      sideMaterial,
      sideMaterial,
      faceMaterial,
      faceMaterial,
    ]);
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
  }

  spawnAt(position) {
    this.body.position.set(position.x, position.y, position.z);
    this.physicsWorld.addBody(this.body);
  }

  syncMeshToBody() {
    this.mesh.position.copy(this.body.position);
    this.mesh.quaternion.copy(this.body.quaternion);
  }

  get shouldBreak() {
    return this.durability <= 0;
  }

  dispose() {
    this.physicsWorld.removeBody(this.body);
    this.mesh.geometry.dispose();
    // 側面は同じマテリアルを4面に使い回しているのでSetで重複を除いてから破棄する。
    // 文字テクスチャは他のブロックと共有しているためここでは破棄しない
    // （GameScene.unmount()でまとめて破棄する）
    new Set(this.mesh.material).forEach((material) => material.dispose());
  }
}
