import * as THREE from 'three';

const POWER_CYCLE_SECONDS = 1.2; // パワーゲージが0→100→0を1往復する時間

// マウス/タッチ位置から狙いを決め、長押しでパワーゲージを往復させて発射を管理する
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

    this.isCharging = false;
    this.powerPercent = 0;
    this.chargeElapsed = 0;

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);

    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointerup', this._onPointerUp);
  }

  _onPointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _onPointerDown() {
    this.isCharging = true;
    this.chargeElapsed = 0;
    this.powerPercent = 0;
  }

  _onPointerUp() {
    if (!this.isCharging) return;
    this.isCharging = false;
    this.onLaunch(this.getAimDirection(), this.powerPercent);
  }

  // 床平面との交点を計算し、そこへ向かう発射方向を返す
  getAimDirection() {
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    const hit = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.floorPlane, hit);
    if (hit) {
      this.aimPoint.copy(hit);
    }
    const direction = this.aimPoint
      .clone()
      .sub(this.launchOrigin)
      .normalize();
    return direction;
  }

  update(deltaSeconds) {
    if (!this.isCharging) return;
    this.chargeElapsed += deltaSeconds;
    const phase =
      (this.chargeElapsed % POWER_CYCLE_SECONDS) / POWER_CYCLE_SECONDS;
    // 三角波で0〜100を往復させる
    this.powerPercent = 100 * (1 - Math.abs(phase * 2 - 1));
  }

  dispose() {
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointerup', this._onPointerUp);
  }
}
