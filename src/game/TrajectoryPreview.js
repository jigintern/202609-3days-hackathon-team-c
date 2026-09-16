import * as THREE from 'three';
import { GRAVITY_Y } from './PhysicsWorld.js';
import { MAX_LAUNCH_SPEED } from './Ball.js';

const SAMPLE_COUNT = 72;
const MAX_TIME_SECONDS = 2.5;

// ドット1個の大きさ（ワールド単位の直径）。細かい点線に見せるため、
// 球の直径0.7に対してかなり小さく取っている。
// 数(SAMPLE_COUNT)を増やして密度で軌道を読ませる作り
const DOT_SIZE = 0.28;

// ドットの絵。明るい芯を濃い輪郭で囲う。
// 空(水色)の上でも地面(緑)の上でも沈まないよう、明暗の両方を持たせている。
// 色味を持たせると狙いの補助のほうが壁より目立ってしまうので、無彩色のグレー。
// 明度差だけで読ませている
const DOT_CORE_COLOR = '#dedede';
const DOT_OUTLINE_COLOR = '#55534f';
const TEXTURE_SIZE = 64;
// ドットが小さいぶん輪郭は画面上で1〜2pxしかない。
// 芯との半径差を広めに取らないと縁が消えてしまう
const OUTLINE_RADIUS_RATIO = 0.48;
const CORE_RADIUS_RATIO = 0.3;
// うっすら透かして背景に馴染ませる
const DOT_OPACITY = 0.85;

// 明るい芯を濃い輪郭で囲った丸を描く。1枚作って全ドットで使い回す
function createDotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const context = canvas.getContext('2d');
  const center = TEXTURE_SIZE / 2;

  context.fillStyle = DOT_OUTLINE_COLOR;
  context.beginPath();
  context.arc(center, center, TEXTURE_SIZE * OUTLINE_RADIUS_RATIO, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = DOT_CORE_COLOR;
  context.beginPath();
  context.arc(center, center, TEXTURE_SIZE * CORE_RADIUS_RATIO, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// エイム中（ドラッグ中）に、実際の重力に沿った放物線の予測線を表示する。
//
// 線ではなく点を並べているのは、THREE.Lineの太さが常に1pxで、
// 高解像度の画面では髪の毛のようになって見えないため（linewidthは効かない）。
// 点なら遠近で大きさが変わるので、奥行きも読み取れる。
export class TrajectoryPreview {
  constructor(scene) {
    this.scene = scene;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(SAMPLE_COUNT * 3), 3)
    );

    this.texture = createDotTexture();
    const material = new THREE.PointsMaterial({
      map: this.texture,
      size: DOT_SIZE,
      sizeAttenuation: true,
      transparent: true,
      opacity: DOT_OPACITY,
      // 輪郭の外側は alphaTest で捨てて、丸い形だけを残す。
      // 半透明のまま重ねると描画順で消えたり滲んだりするため
      alphaTest: 0.5,
      // 壁の奥まで伸びた先が空の色に溶けて見えなくなるため、フォグを切る。
      // ブロックと鉄球も同じ理由でフォグを切ってある
      fog: false,
    });

    this.dots = new THREE.Points(geometry, material);
    this.dots.visible = false;
    this.dots.frustumCulled = false;
    this.scene.add(this.dots);
  }

  show() {
    this.dots.visible = true;
  }

  hide() {
    this.dots.visible = false;
  }

  // カメラが引くぶんドットも小さくなってしまうので、引いた距離の比を受け取って
  // 見かけの大きさを保つ。GameScene._applyCameraFraming() から渡される
  setCameraDistanceScale(scale) {
    this.dots.material.size = DOT_SIZE * scale;
  }

  // origin: THREE.Vector3, direction: THREE.Vector3（正規化済み）, powerPercent: 0〜100
  update(origin, direction, powerPercent) {
    const speed = (powerPercent / 100) * MAX_LAUNCH_SPEED;
    const positions = this.dots.geometry.attributes.position.array;

    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const t = (i / (SAMPLE_COUNT - 1)) * MAX_TIME_SECONDS;
      positions[i * 3] = origin.x + direction.x * speed * t;
      // 地面が無いステージなので、予測線もy=0で止めずにそのまま下へ伸ばす
      positions[i * 3 + 1] =
        origin.y + direction.y * speed * t + 0.5 * GRAVITY_Y * t * t;
      positions[i * 3 + 2] = origin.z + direction.z * speed * t;
    }

    this.dots.geometry.attributes.position.needsUpdate = true;
    this.dots.geometry.computeBoundingSphere();
  }

  dispose() {
    this.scene.remove(this.dots);
    this.dots.geometry.dispose();
    this.dots.material.dispose();
    this.texture.dispose();
  }
}
