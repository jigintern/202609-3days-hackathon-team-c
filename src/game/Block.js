import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ブロックの実寸。タイトル画面の背景（TitleBackground）も同じ値を使うので、
// ここを変えるとゲーム画面と背景の両方のブロックの大きさが変わる
export const BLOCK_SIZE = new THREE.Vector3(1.4, 0.9, 1);

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

// ブロック6面ぶんのマテリアルを作る。BoxGeometryのマテリアル配列は
// [+X, -X, +Y, -Y, +Z, -Z] の順で、プレイヤーに向く手前(+Z)と背面(-Z)にだけ
// 文字を貼り、残り4面は紙の断面色にする。
// タイトル画面の背景のブロックも同じ見た目にするため、ここを共用している
export function createBlockMaterials(characterTexture) {
  const faceMaterial = new THREE.MeshStandardMaterial({
    map: characterTexture,
    roughness: 0.85,
  });
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: SIDE_COLOR,
    roughness: 0.9,
  });
  // 遠くへ飛ばされてもフォグで水色に色が混ざらないよう、紙の色を保持する。
  // 遠近感による見た目の縮小はパースペクティブカメラの効果だけで十分つく
  faceMaterial.fog = false;
  sideMaterial.fog = false;
  return [
    sideMaterial,
    sideMaterial,
    sideMaterial,
    sideMaterial,
    faceMaterial,
    faceMaterial,
  ];
}

// メール本文の1文字を表すブロック。ブロックは壊れない。
// 得点条件は「棒の上から落ちたかどうか」だけなので、耐久値も破壊判定も持たない
export class Block {
  constructor(physicsWorld, material, characterTexture) {
    this.physicsWorld = physicsWorld;

    const geometry = new THREE.BoxGeometry(
      BLOCK_SIZE.x,
      BLOCK_SIZE.y,
      BLOCK_SIZE.z
    );
    this.mesh = new THREE.Mesh(geometry, createBlockMaterials(characterTexture));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    this.body = new CANNON.Body({
      mass: 1.5,
      shape: new CANNON.Box(
        new CANNON.Vec3(BLOCK_SIZE.x / 2, BLOCK_SIZE.y / 2, BLOCK_SIZE.z / 2)
      ),
      material,
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

  dispose() {
    this.physicsWorld.removeBody(this.body);
    this.mesh.geometry.dispose();
    // 側面は同じマテリアルを4面に使い回しているのでSetで重複を除いてから破棄する。
    // 文字テクスチャは他のブロックと共有しているためここでは破棄しない
    // （GameScene.unmount()でまとめて破棄する）
    new Set(this.mesh.material).forEach((material) => material.dispose());
  }
}
