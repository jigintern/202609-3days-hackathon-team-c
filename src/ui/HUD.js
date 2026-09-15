// ゲームプレイ画面のスコア・残弾・パワーゲージ表示と、タイトルへ戻るボタン
export class HUD {
  constructor(container, { onBackToTitle } = {}) {
    this.onBackToTitle = onBackToTitle;

    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
        <span id="hud-score">スコア: 0</span>
        <span id="hud-balls">残り球数: 0</span>
        <button type="button" class="hud-exit" id="hud-exit">タイトルへ</button>
      </div>
      <div class="hud-power-gauge">
        <div class="hud-power-gauge-fill" id="hud-power-fill"></div>
      </div>
    `;
    container.appendChild(this.root);

    this.scoreEl = this.root.querySelector('#hud-score');
    this.ballsEl = this.root.querySelector('#hud-balls');
    this.powerFillEl = this.root.querySelector('#hud-power-fill');
    this.exitButton = this.root.querySelector('#hud-exit');

    this._handleExitClick = this._handleExitClick.bind(this);
    this.exitButton.addEventListener('click', this._handleExitClick);
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

  dispose() {
    this.exitButton.removeEventListener('click', this._handleExitClick);
    this.root.remove();
  }

  _handleExitClick() {
    this.onBackToTitle?.();
  }
}
