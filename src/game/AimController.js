import * as THREE from 'three';
import { clamp } from '../utils/helpers.js';

// 仰角は「引かない(0)」から「引き切り(1)」まで線形に上げる。
// 空中の棒(y=6)の上に積んだ壁(高さ約6.15〜11.85)と、その上を横切る鳥(y=13.8)の
// 両方を1本の引き量に載せるため、物理シミュレーションで実測して14〜34度にした
// （壁の高さ・カメラ・鳥の高さのどれかを変えたら実測し直すこと。角度の理論値と
//   実測値はダンピングの影響でずれる）:
// - 引き量0(14度)は壁の面を4.2mで通過＝壁の下を素通り
// - 引き量0.20〜0.74で壁(6行)のどこかに当たる
// - 引き量0.91(32.3度)で鳥のほぼ中心を撃ち抜く。鳥に当たるのは0.71〜1.00で、
//   上限28度だった頃の「0.97以上＝ほぼ引き切り必須」から広げてある
// - 引き量1.0(34度)は壁の面を14.85mで通過＝壁も鳥も越える
const MIN_ELEVATION_DEG = 14;
const MAX_ELEVATION_DEG = 34;
const DRAG_RANGE_RATIO = 0.35; // 画面高さに対する、パワー/仰角が最大になるまでの縦ドラッグ量の割合
// パワーの変化幅はわずかにとどめている。仰角と一緒にパワーまで大きく振ると、
// 着弾高さが引き量に対して敏感になりすぎて、指1本の精度では壁のどこにも当てられなくなる
// （速度と角度を同時に上げるほど到達高さが跳ね上がるため）
const MIN_LAUNCH_POWER = 85;
const MAX_LAUNCH_POWER = 100;
const MIN_PULL_RATIO = 0.03; // ほとんど引かずに離した場合は、誤クリックとみなして球を消費しない

// maxYawDeg を渡さなかった場合の左右角度の上限。
// GameScene の MIN_AIM_YAW_DEG（壁が細いときに確保する下限）と同じ値にしてある
const DEFAULT_MAX_YAW_DEG = 20;

// ドラッグ&フリックで狙いを決める。指の水平位置（床面への視線交点）で左右・奥行きの方向を、
// 縦方向にどれだけ引いたかで仰角とパワーを同時に決め、指を離した瞬間の値で発射する
export class AimController {
  // maxYawDeg: 正面(-Z)からの左右角度の上限（度）。壁の幅から GameScene が算出して渡す
  constructor(canvas, camera, launchOrigin, onLaunch, maxYawDeg = DEFAULT_MAX_YAW_DEG) {
    this.canvas = canvas;
    this.camera = camera;
    this.launchOrigin = launchOrigin;
    this.onLaunch = onLaunch;
    this.maxYawDeg = maxYawDeg;

    this.pointerNDC = new THREE.Vector2(0, 0);
    this.raycaster = new THREE.Raycaster();
    // タワー中段の高さを通る水平面を狙い判定に使う（床面だと狙点が低すぎるため）
    this.floorPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, launchOrigin.y, 0)
    );
    this.aimPoint = new THREE.Vector3(0, 0, 0);

    this.isDragging = false;
    // ドラッグ中の指のID。2本目以降の指のイベントを無視して、狙いを乗っ取られ
    // ないようにする（スマホは端末を持つ指が画面に触れることがあるため）
    this.activePointerId = null;
    this.startClientY = 0;
    this.pullRatio = 0;
    this.powerPercent = 0;
    this.elevationDeg = 0;
    this.direction = new THREE.Vector3(0, 0, -1);

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);

    canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerCancel);
  }

  _updatePointerNDC(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  _onPointerDown(event) {
    // すでにドラッグ中なら2本目の指。ここで受けてしまうと狙いの基準位置
    // (startClientY)が上書きされ、引き量が0に戻って発射できなくなる
    if (this.isDragging) return;

    this.isDragging = true;
    this.activePointerId = event.pointerId;
    this.startClientY = event.clientY;
    this._updatePointerNDC(event.clientX, event.clientY);
    this._updateAim(event.clientY);
  }

  _onPointerMove(event) {
    if (!this._isActivePointer(event)) return;
    this._updatePointerNDC(event.clientX, event.clientY);
    this._updateAim(event.clientY);
  }

  _onPointerUp(event) {
    if (!this._isActivePointer(event)) return;

    const shouldLaunch = this.pullRatio >= MIN_PULL_RATIO;
    const launchPower = this.powerPercent;
    this._endDrag();

    if (shouldLaunch) {
      this.onLaunch(this.direction.clone(), launchPower);
    }
  }

  // ブラウザやOSにタッチを横取りされた場合（着信、システムのジェスチャーなど）。
  // pointerup は二度と来ないので、ここで拾わないと isDragging が立ちっぱなしに
  // なり、以降の狙いが壊れる。意図しない角度で球を1個失わせないよう、
  // ここでは発射せず状態を戻すだけにしている
  _onPointerCancel(event) {
    if (!this._isActivePointer(event)) return;
    this._endDrag();
  }

  _isActivePointer(event) {
    return this.isDragging && event.pointerId === this.activePointerId;
  }

  _endDrag() {
    this.isDragging = false;
    this.activePointerId = null;
    // 次のドラッグまでHUDのパワーゲージを空にしておく
    this.pullRatio = 0;
    this.powerPercent = 0;
  }

  // 水平方向は指の位置と床面の交点から、垂直方向は押した位置からの縦ドラッグ量から求め、
  // 1本の3D方向ベクトルにまとめる
  _updateAim(currentClientY) {
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    // 上に引くと視線が水平面より上を向いて交点が無くなる。その場合は直前の狙点を保つ
    const hit = this.raycaster.ray.intersectPlane(
      this.floorPlane,
      new THREE.Vector3()
    );
    if (hit) {
      this.aimPoint.copy(hit);
    }
    const horizontal = this.aimPoint.clone().sub(this.launchOrigin);
    horizontal.y = 0;
    if (horizontal.lengthSq() < 1e-6) {
      horizontal.set(0, 0, -1);
    }
    // 左右の向きは「正面(-Z)から何度ずれているか」に直してから上限で丸める。
    // 視線と水平面の交点をそのまま使うと、横長画面では画面端の視線が真横に近づき、
    // 交点が発射地点のすぐ手前（11m先）に来るため、左右角度が際限なく開いてしまう
    // （実測：スマホ390x844で最大±16度に対し、PC1920x950では±51度、
    //   2560x700では±66度。球がほぼ真横＝プレイヤーの脇へ飛んでいく向きになる）。
    // 壁を狙うのに必要なのは5列で±9度、17列でも±29度なので、それ以上は丸めて構わない
    const yawDeg = THREE.MathUtils.radToDeg(
      Math.atan2(horizontal.x, -horizontal.z)
    );
    const clampedYawRad = THREE.MathUtils.degToRad(
      clamp(yawDeg, -this.maxYawDeg, this.maxYawDeg)
    );
    horizontal.set(Math.sin(clampedYawRad), 0, -Math.cos(clampedYawRad));

    const rect = this.canvas.getBoundingClientRect();
    const dragRange = rect.height * DRAG_RANGE_RATIO;
    const pulledDown = clamp(currentClientY - this.startClientY, 0, dragRange);
    this.pullRatio = dragRange > 0 ? pulledDown / dragRange : 0;

    this.powerPercent =
      MIN_LAUNCH_POWER + this.pullRatio * (MAX_LAUNCH_POWER - MIN_LAUNCH_POWER);
    // 仰角は引き量に比例させる（線形）。壁を狙うゲームでは、二次カーブで
    // 低い引き量の仰角を潰すと球が壁の下を素通りする区間が広くなりすぎるため、
    // 引き量と着弾位置の対応が直感的な線形にしてある
    this.elevationDeg =
      MIN_ELEVATION_DEG + this.pullRatio * (MAX_ELEVATION_DEG - MIN_ELEVATION_DEG);

    const elevationRad = THREE.MathUtils.degToRad(this.elevationDeg);
    const horizontalScale = Math.cos(elevationRad);
    this.direction
      .set(
        horizontal.x * horizontalScale,
        Math.sin(elevationRad),
        horizontal.z * horizontalScale
      )
      .normalize();
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerCancel);
  }
}
