// ゲームプレイ画面の残りブロック数・パワーゲージ表示と、タイトルへ戻るボタン。
// スコアや残弾のような「失敗して終わる」ための表示は持たない
export class HUD {
  constructor(container, { onBackToTitle } = {}) {
    this.onBackToTitle = onBackToTitle;

    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
        <span id="hud-remaining">残り 0 個</span>
        <button type="button" class="hud-exit" id="hud-exit">タイトルへ</button>
      </div>
      <p class="hud-clear" id="hud-clear" hidden>全部壊した！</p>
      <div class="hud-power-gauge">
        <div class="hud-power-gauge-fill" id="hud-power-fill"></div>
      </div>
    `;
    container.appendChild(this.root);

    this.remainingEl = this.root.querySelector('#hud-remaining');
    this.clearEl = this.root.querySelector('#hud-clear');
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

  setRemainingBlocks(count) {
    this.remainingEl.textContent = `残り ${count} 個`;
  }

  // 全部壊したときの祝福表示。ゲームは終わらせないので、
  // 数秒かけてフェードアウトするだけで操作は一切止めない（CSSアニメーション側で消える）
  showClearMessage() {
    this.clearEl.hidden = false;
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
