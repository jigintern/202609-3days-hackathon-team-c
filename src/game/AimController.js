import * as THREE from 'three';
import { clamp } from '../utils/helpers.js';

const MAX_ELEVATION_DEG = 45; // 引き切ったときの最大仰角
const DRAG_RANGE_RATIO = 0.35; // 画面高さに対する、パワー/仰角が最大になるまでの縦ドラッグ量の割合
// 引き幅がタワー(約11m先・高さ5m前後)の下段から上段までを一通り狙える範囲になるよう調整した値。
// 「もっと山なりに」「もっと直線的に」を変えたいときはここと MAX_ELEVATION_DEG を動かす
const MIN_LAUNCH_POWER = 40;
const MAX_LAUNCH_POWER = 100;
const MIN_PULL_RATIO = 0.03; // ほとんど引かずに離した場合は、誤クリックとみなして球を消費しない

// ドラッグ&フリックで狙いを決める。指の水平位置（床面への視線交点）で左右・奥行きの方向を、
// 縦方向にどれだけ引いたかで仰角とパワーを同時に決め、指を離した瞬間の値で発射する
export class AimController {
  constructor(canvas, camera, launchOrigin, onLaunch) {
    this.canvas = canvas;
    this.camera = camera;
    this.launchOrigin = launchOrigin;
    this.onLaunch = onLaunch;

    this.pointerNDC = new THREE.Vector2(0, 0);
    this.raycaster = new THREE.Raycaster();
    // タワー中段の高さを通る水平面を狙い判定に使う（床面だと狙点が低すぎるため）
    this.floorPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, launchOrigin.y, 0)
    );
    this.aimPoint = new THREE.Vector3(0, 0, 0);

    this.isDragging = false;
    this.startClientY = 0;
    this.pullRatio = 0;
    this.powerPercent = 0;
    this.elevationDeg = 0;
    this.direction = new THREE.Vector3(0, 0, -1);

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);

    canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
  }

  _updatePointerNDC(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  _onPointerDown(event) {
    this.isDragging = true;
    this.startClientY = event.clientY;
    this._updatePointerNDC(event.clientX, event.clientY);
    this._updateAim(event.clientY);
  }

  _onPointerMove(event) {
    if (!this.isDragging) return;
    this._updatePointerNDC(event.clientX, event.clientY);
    this._updateAim(event.clientY);
  }

  _onPointerUp() {
    if (!this.isDragging) return;
    this.isDragging = false;

    const shouldLaunch = this.pullRatio >= MIN_PULL_RATIO;
    const launchPower = this.powerPercent;
    // 次のドラッグまでHUDのパワーゲージを空にしておく
    this.pullRatio = 0;
    this.powerPercent = 0;

    if (shouldLaunch) {
      this.onLaunch(this.direction.clone(), launchPower);
    }
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
    horizontal.normalize();

    const rect = this.canvas.getBoundingClientRect();
    const dragRange = rect.height * DRAG_RANGE_RATIO;
    const pulledUp = clamp(this.startClientY - currentClientY, 0, dragRange);
    this.pullRatio = dragRange > 0 ? pulledUp / dragRange : 0;

    this.powerPercent =
      MIN_LAUNCH_POWER + this.pullRatio * (MAX_LAUNCH_POWER - MIN_LAUNCH_POWER);
    // 少し引いただけのときは低く速い直線的なショット（従来の転がして壊す球）が残るよう、
    // 仰角は二次カーブで上げて、引き切ったときだけ大きく山なりにする
    this.elevationDeg = this.pullRatio * this.pullRatio * MAX_ELEVATION_DEG;

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
  }
}
