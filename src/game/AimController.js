import * as THREE from 'three';
import { clamp } from '../utils/helpers.js';

const MAX_ELEVATION_DEG = 45; // 引き切ったときの最大仰角
// 画面の何割ドラッグしたら仰角/威力が振り切るか。縦横それぞれ別に持つ
const ELEVATION_DRAG_RANGE_RATIO = 0.35;
const POWER_DRAG_RANGE_RATIO = 0.25;
// 押してから離すまでの移動量(縦+横)がこの割合未満なら、狙ったドラッグではないとみなして
// 球を消費しない。2軸になったので縦横の移動量を合計して判定する
const MIN_DRAG_RATIO = 0.04;
// `<` `>` を押しっぱなしにしたときに毎秒何度回るか
const YAW_SPEED_DEG_PER_SECOND = 15;

// 狙いを決めるコントローラ。3つの入力を別々の軸として受け取る。
// - 左右の向き(ヨー): 画面の `<` `>` ボタン。長押しで連続回転する
// - 仰角: 画面を手前（下方向）に引くほど放物線が高くなる
// - 威力: 右に引くほど強い。中央が中間で、左に引けば弱くなる
// 以前は指の位置から床面へのレイキャストで左右を決めていたが、
// ヨーをボタンに分離したことで画面のどこを触っても同じように狙えるようになっている
export class AimController {
  constructor(canvas, onLaunch, yawLimitDeg) {
    this.canvas = canvas;
    this.onLaunch = onLaunch;
    this.yawLimitDeg = yawLimitDeg;

    this.isDragging = false;
    this.startClientX = 0;
    this.startClientY = 0;
    this.yawDeg = 0;
    // -1(左回り) / 0(停止) / +1(右回り)。ボタンを押している間だけ0以外になる
    this.yawInput = 0;
    this.elevationRatio = 0;
    // 威力は中央(0.5)を初期値にして、そこから左右に振る
    this.powerRatio = 0.5;
    this.elevationDeg = 0;
    this.direction = new THREE.Vector3(0, 0, -1);

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);

    canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);

    this._updateDirection();
  }

  // HUDの `<` `>` ボタンから呼ばれる。押している間 direction を指定して、離したら0に戻す
  setYawInput(direction) {
    this.yawInput = direction;
  }

  // ヨーの連続回転を進める。GameSceneのupdateから毎フレーム呼ぶ
  update(deltaSeconds) {
    if (this.yawInput === 0) return;
    this.yawDeg = clamp(
      this.yawDeg + this.yawInput * YAW_SPEED_DEG_PER_SECOND * deltaSeconds,
      -this.yawLimitDeg,
      this.yawLimitDeg
    );
    this._updateDirection();
  }

  get powerPercent() {
    return this.powerRatio * 100;
  }

  _onPointerDown(event) {
    this.isDragging = true;
    this.startClientX = event.clientX;
    this.startClientY = event.clientY;
    this._updateAim(event.clientX, event.clientY);
  }

  _onPointerMove(event) {
    if (!this.isDragging) return;
    this._updateAim(event.clientX, event.clientY);
  }

  _onPointerUp() {
    if (!this.isDragging) return;
    this.isDragging = false;

    const draggedEnough =
      Math.abs(this.elevationRatio) + Math.abs(this.powerRatio - 0.5) >=
      MIN_DRAG_RATIO;
    if (draggedEnough) {
      this.onLaunch(this.direction.clone(), this.powerRatio);
    }
    // 離した後も軌道プレビューは出し続けるので、仰角と威力はそのまま保持する。
    // `<` `>` でヨーを振ったときに、直前と同じ弾道がどこへ飛ぶかが見えるようにするため
  }

  // 押した位置を原点に、縦方向のドラッグ量を仰角へ、横方向のドラッグ量を威力へ割り当てる
  _updateAim(currentClientX, currentClientY) {
    const rect = this.canvas.getBoundingClientRect();

    // 手前（画面下方向）に引くほど放物線が高くなる。弓を引く動きと向きを揃えている
    const elevationRange = rect.height * ELEVATION_DRAG_RANGE_RATIO;
    const pulledDown = currentClientY - this.startClientY;
    this.elevationRatio =
      elevationRange > 0 ? clamp(pulledDown / elevationRange, 0, 1) : 0;

    // 右に引くほど強い。触れた位置が中間の威力で、左右どちらにも振れる
    const powerRange = rect.width * POWER_DRAG_RANGE_RATIO;
    const draggedRight = currentClientX - this.startClientX;
    const powerOffset =
      powerRange > 0 ? clamp(draggedRight / powerRange, -1, 1) : 0;
    this.powerRatio = clamp(0.5 + powerOffset * 0.5, 0, 1);

    // 引き量と着弾する段がほぼ比例するよう線形にしている。
    // 以前は二次カーブで低い角度に寄せていたが、威力が横方向に分離されたことで
    // 「低く速い球」は仰角を上げずに威力を上げれば作れるようになり、役目を終えた
    this.elevationDeg = this.elevationRatio * MAX_ELEVATION_DEG;
    this._updateDirection();
  }

  // ヨーと仰角から1本の3D方向ベクトルを組み立てる。ヨー0度で -Z（壁の方向）を向く
  _updateDirection() {
    const yawRad = THREE.MathUtils.degToRad(this.yawDeg);
    const elevationRad = THREE.MathUtils.degToRad(this.elevationDeg);
    const horizontalScale = Math.cos(elevationRad);
    this.direction
      .set(
        Math.sin(yawRad) * horizontalScale,
        Math.sin(elevationRad),
        -Math.cos(yawRad) * horizontalScale
      )
      .normalize();
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
  }
}
