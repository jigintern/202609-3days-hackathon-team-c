// ゲームプレイ画面のスコア・残弾・パワーゲージ・向き変更ボタンの表示
export class HUD {
  constructor(container) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
        <span id="hud-score">スコア: 0</span>
        <span id="hud-balls">残り球数: 0</span>
      </div>
      <div class="hud-power-gauge">
        <div class="hud-power-gauge-fill" id="hud-power-fill"></div>
      </div>
      <div class="hud-yaw">
        <button type="button" class="hud-yaw-button" id="hud-yaw-left" aria-label="狙いを左へ">&lt;</button>
        <button type="button" class="hud-yaw-button" id="hud-yaw-right" aria-label="狙いを右へ">&gt;</button>
      </div>
    `;
    container.appendChild(this.root);

    this.scoreEl = this.root.querySelector('#hud-score');
    this.ballsEl = this.root.querySelector('#hud-balls');
    this.powerFillEl = this.root.querySelector('#hud-power-fill');
    this.yawLeftEl = this.root.querySelector('#hud-yaw-left');
    this.yawRightEl = this.root.querySelector('#hud-yaw-right');

    this.onYawInput = () => {};
    // ボタンの外で指を離してもヨーが回りっぱなしにならないための保険。
    // windowに付けるぶん、dispose()で必ず外さないとゲームを遊び直すたびに溜まっていく
    this._stopYaw = () => this.onYawInput(0);
    window.addEventListener('pointerup', this._stopYaw);
    this._bindYawButton(this.yawLeftEl, -1);
    this._bindYawButton(this.yawRightEl, 1);
  }

  // 押している間だけ回し続けたいので、クリックではなくpointerdown/upで開始・停止する。
  // 画面外で指を離された場合も止まるよう、解除はwindowでも拾う
  _bindYawButton(button, direction) {
    const start = (event) => {
      // canvasのドラッグ（仰角・威力）が同時に始まらないよう、ここでイベントを止める
      event.preventDefault();
      event.stopPropagation();
      this.onYawInput(direction);
    };
    const stop = this._stopYaw;

    button.addEventListener('pointerdown', start);
    button.addEventListener('pointerup', stop);
    button.addEventListener('pointercancel', stop);
    button.addEventListener('pointerleave', stop);
  }

  // ボタンに付けたリスナーは root ごと remove すれば消えるが、
  // window のものは明示的に外す必要がある
  dispose() {
    window.removeEventListener('pointerup', this._stopYaw);
    this.root.remove();
  }

  show() {
    this.root.classList.add('is-active');
  }

  hide() {
    this.root.classList.remove('is-active');
  }

  setScore(score) {
    this.scoreEl.textContent = `スコア: ${score}`;
  }

  setRemainingBalls(count) {
    this.ballsEl.textContent = `残り球数: ${count}`;
  }

  setPower(percent) {
    this.powerFillEl.style.width = `${percent}%`;
  }
}
