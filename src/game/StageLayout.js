import * as THREE from 'three';
import { clamp } from '../utils/helpers.js';
import { BLOCK_SIZE } from './Block.js';

// 壁の組み方とカメラ・発射地点の距離をまとめて決める計算モジュール。
// 「何文字を何列に積むか」「どこから投げるか」「カメラをどこに置くか」は互いに依存するので、
// GameSceneに散らさずここ1箇所に集約している。

// 横は実寸より少し広く取って隣との隙間を作る。横方向の隙間は積み上げに影響しない
export const BLOCK_SPACING_X = BLOCK_SIZE.x * 1.14;
// 縦は実寸ちょうど。ここに隙間を空けると、段ごとの落下が積み重なって壁が自重で自壊する
// （間隔を6%広げただけで20段目の落下速度が5.85m/sに達し、Block.jsの自壊閾値5.1を超えた）。
// 段の区切りはブロック面に焼かれた罫線（Block.jsのFRAME_INSET_RATIO）で見えるので、
// 物理的な隙間は不要
export const BLOCK_SPACING_Y = BLOCK_SIZE.y;

export const CAMERA_FOV_DEG = 50;
// 壁の周囲に確保する余白。1.0だと壁が画面ぴったりになって窮屈なので少し引く
const FRAMING_MARGIN = 1.15;
// 発射距離の下限と上限。短い文章でも近すぎず、長い文章でも遠すぎない範囲に収める
const MIN_LAUNCH_DISTANCE = 13;
const MAX_LAUNCH_DISTANCE = 40;
// カメラを発射地点より何メートル後ろに置くか
const CAMERA_BEHIND_LAUNCH = 5;
// ヨーの可動域。壁の端を狙える角度に、少しだけ余裕を持たせる
const YAW_MARGIN = 1.4;
const MAX_YAW_DEG = 35;

function tanHalfFov() {
  return Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV_DEG / 2));
}

// 幅widthMeters・高さheightMetersの壁が画面に収まるカメラ距離。
// 縦持ちでは横方向、横持ちでは縦方向が先に画面からはみ出すため、両方を見て厳しい方を採る
export function fitDistance(widthMeters, heightMeters, aspect) {
  const tanV = tanHalfFov();
  const tanH = aspect * tanV;
  const byWidth = widthMeters / 2 / tanH;
  const byHeight = heightMeters / 2 / tanV;
  return Math.max(byWidth, byHeight) * FRAMING_MARGIN;
}

export function wallWidth(cols) {
  return (cols - 1) * BLOCK_SPACING_X + BLOCK_SIZE.x;
}

export function wallHeight(rows) {
  return rows * BLOCK_SPACING_Y;
}

// 文字数と画面比から、壁が最も画面に収まりやすい列数を選ぶ。
// 画面が縦長なら縦長の壁（列数が少なく段数が多い）、横長なら横長の壁が選ばれる。
// 総当たりで済む規模（最大120文字）なので素直に全列数を試している
export function chooseColumns(characterCount, aspect) {
  let best = null;
  for (let cols = 1; cols <= characterCount; cols += 1) {
    const rows = Math.ceil(characterCount / cols);
    const distance = fitDistance(wallWidth(cols), wallHeight(rows), aspect);
    if (!best || distance < best.distance) {
      best = { cols, rows, distance };
    }
  }
  return best ?? { cols: 1, rows: 1, distance: MIN_LAUNCH_DISTANCE };
}

// ゲーム開始時に一度だけ呼び、その後は変えない寸法一式を返す。
// 発射距離をここで確定させてしまうのが要点で、以降どれだけ画面が回転しても
// 物理側（狙い方・飛距離）は一切変わらない。動くのはカメラだけになる
export function createStageLayout(characterCount, aspect) {
  const { cols, rows } = chooseColumns(characterCount, aspect);
  const width = wallWidth(cols);
  const height = wallHeight(rows);

  const launchDistance = clamp(
    fitDistance(width, height, aspect),
    MIN_LAUNCH_DISTANCE,
    MAX_LAUNCH_DISTANCE
  );

  // 壁の端を狙える角度。遠いほど壁は小さく見えるので、必要なヨーも小さくなる
  const yawLimitDeg = Math.min(
    MAX_YAW_DEG,
    THREE.MathUtils.radToDeg(Math.atan(width / 2 / launchDistance)) * YAW_MARGIN
  );

  return { cols, rows, width, height, launchDistance, yawLimitDeg };
}

// 画面比が変わるたびに呼ぶ。壁全体が映る距離を取り直すが、
// 発射地点より手前には絶対に来ないようにする（球がカメラの後ろから飛んでくるのを防ぐ）
export function cameraDistanceFor(layout, aspect) {
  return Math.max(
    fitDistance(layout.width, layout.height, aspect),
    layout.launchDistance + CAMERA_BEHIND_LAUNCH
  );
}
