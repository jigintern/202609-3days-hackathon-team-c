import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ブロックの実寸。タイトル画面の背景（TitleBackground）も同じ値を使うので、
// ここを変えるとゲーム画面と背景の両方のブロックの大きさが変わる
export const BLOCK_SIZE = new THREE.Vector3(1.4, 0.9, 1);

// ゲーム画面のブロックだけ、この倍率で拡大して使う。
// 壁が大きいほど遠くから投げることになり、重力に対して世界が大きくなるぶん滞空時間が伸びて、
// 放物線と崩落がよく見えるようになる（距離も比例して伸びるので画面上の見かけは変わらない）。
// タイトル背景は自前のカメラ位置で構図が調整されているため、拡大の対象にしていない。
// ここを変えるなら StageLayout の配置間隔と Block.js の衝突閾値も連動する
export const GAME_BLOCK_SCALE = 1.6;
export const GAME_BLOCK_SIZE = BLOCK_SIZE.clone().multiplyScalar(
  GAME_BLOCK_SCALE
);
const HIT_DURABILITY = 2; // 何回衝突判定を受けたら壊れるか
// 衝突とみなす速度。世界を1.6倍にすると同じ見た目の動きでも速度が√1.6≒1.27倍になるため、
// 元の値(1.5 / 4)をその比率で補正している
const BALL_IMPACT_SPEED = 1.9; // ボールが当たったとみなす衝突速度
// 崩れ落ちてきたブロックに潰されたとみなす衝突速度。タワーが自重で落ち着くときの
// 接触で自壊しないよう、ボールより高い値を要求する
const BLOCK_IMPACT_SPEED = 5.1;
// ボールの衝突だけは速度に比例してダメージが増える。この速度ごとに耐久を1削るので、
// 19以上で耐久2のブロックを一撃、38以上なら貫通しながら次のブロックも削れる。
// ブロック同士の衝突は連鎖が過剰にならないよう一律1のままにしている
const BALL_DAMAGE_PER_SPEED = 19;

// 文字を焼き込むテクスチャの解像度。ブロックの手前面(1.4 x 0.9)と同じ縦横比にして、
// 貼り付けたときに文字が横へ潰れないようにしている。
// GAME_BLOCK_SCALE は縦横を同じ倍率で拡大するので、この比率には影響しない
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
  return [
    sideMaterial,
    sideMaterial,
    sideMaterial,
    sideMaterial,
    faceMaterial,
    faceMaterial,
  ];
}

// メール本文の1文字を表すブロック。耐久値が尽きるとシーンから消える
export class Block {
  constructor(physicsWorld, material, characterTexture) {
    this.physicsWorld = physicsWorld;
    this.durability = HIT_DURABILITY;
    this.isDestroyed = false;

    // ゲーム画面側は拡大した寸法を使う（タイトル背景は素の BLOCK_SIZE のまま）
    const geometry = new THREE.BoxGeometry(
      GAME_BLOCK_SIZE.x,
      GAME_BLOCK_SIZE.y,
      GAME_BLOCK_SIZE.z
    );
    this.mesh = new THREE.Mesh(geometry, createBlockMaterials(characterTexture));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    this.body = new CANNON.Body({
      mass: 1.5,
      shape: new CANNON.Box(
        new CANNON.Vec3(
          GAME_BLOCK_SIZE.x / 2,
          GAME_BLOCK_SIZE.y / 2,
          GAME_BLOCK_SIZE.z / 2
        )
      ),
      material,
    });

    // 耐久値はボール、または支えを失って落ちてきた他のブロックとの強い衝突で減らす。
    // 床のような静的（mass 0）なものとの接触では減らさない
    this.body.addEventListener('collide', (event) => {
      if (event.body.mass <= 0) return;
      const impactSpeed = Math.abs(event.contact.getImpactVelocityAlongNormal());
      const isBall = Boolean(event.body.isBall);
      const threshold = isBall ? BALL_IMPACT_SPEED : BLOCK_IMPACT_SPEED;
      if (impactSpeed <= threshold) return;
      // 速い球ほど大きく削る。プレイヤーが選んだ威力が破壊力に直結するようにするための処理で、
      // 崩落の連鎖（ブロック同士）は調整が難しくなるので一律1に据え置いている
      const damage = isBall
        ? Math.max(1, Math.ceil(impactSpeed / BALL_DAMAGE_PER_SPEED))
        : 1;
      this.durability -= damage;
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
