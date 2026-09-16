// ゲームプレイ画面の残弾・パワーゲージ表示。
// スコアは持たない（このゲームは点数を競う遊びではないため）
export class HUD {
  constructor(container) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
        <span id="hud-balls">残り球数: 0</span>
      </div>
      <div class="hud-power-gauge">
        <div class="hud-power-gauge-fill" id="hud-power-fill"></div>
      </div>
    `;
    container.appendChild(this.root);

    this.ballsEl = this.root.querySelector('#hud-balls');
    this.powerFillEl = this.root.querySelector('#hud-power-fill');
  }

  show() {
    this.root.classList.add('is-active');
  }

  hide() {
    this.root.classList.remove('is-active');
  }

  setRemainingBalls(count) {
    this.ballsEl.textContent = `残り球数: ${count}`;
  }

  setPower(percent) {
    this.powerFillEl.style.width = `${percent}%`;
  }
}
