// リザルト画面。スコア表示とリトライ / タイトルへ戻るボタン
export class ResultScene {
  constructor({ overlayRoot, onRetry, onBackToTitle }) {
    this.overlayRoot = overlayRoot;
    this.onRetry = onRetry;
    this.onBackToTitle = onBackToTitle;
    this.score = 0;

    this.root = document.createElement('div');
    this.root.className = 'screen';
    this.root.innerHTML = `
      <h1>リザルト</h1>
      <p id="result-score">スコア: 0</p>
      <button class="btn" id="btn-retry">もう一度</button>
      <button class="btn btn-secondary" id="btn-title">タイトルへ戻る</button>
    `;
  }

  setScore(score) {
    this.score = score;
  }

  mount() {
    this.overlayRoot.appendChild(this.root);
    this.root.classList.add('is-active');
    this.root.querySelector('#result-score').textContent = `スコア: ${this.score}`;
    this.root.querySelector('#btn-retry').addEventListener('click', this.onRetry);
    this.root
      .querySelector('#btn-title')
      .addEventListener('click', this.onBackToTitle);
  }

  unmount() {
    this.root.remove();
  }
}
