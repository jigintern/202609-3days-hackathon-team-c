import { soundManager } from '../audio/SoundManager.js';

// リザルト画面。リトライ / タイトルへ戻るボタン。
// スコアは持たない（このゲームは点数を競う遊びではないため）。
// 代わりに「メール本文のうち何文字を粉砕したか」を戦果として見せる
export class ResultScene {
  constructor({ overlayRoot, onRetry, onBackToTitle }) {
    this.overlayRoot = overlayRoot;
    this.onRetry = onRetry;
    this.onBackToTitle = onBackToTitle;
    this.mailText = '';
    this.crushedIndices = new Set();
    this.totalCrushableChars = 0;

    this.root = document.createElement('div');
    this.root.className = 'screen';
    this.root.innerHTML = `
      <h1>リザルト</h1>
      <p id="result-summary"></p>
      <button class="btn" id="btn-retry">もう一度</button>
      <button class="btn btn-secondary" id="btn-title">タイトルへ戻る</button>
    `;
  }

  // GameScene.onGameOver から main.js を通じて渡される。mount()より前に
  // 呼ばれる想定（GameScene.setMailTextと同じ作法）
  setResult(mailText, crushedIndices, totalCrushableChars) {
    this.mailText = mailText;
    this.crushedIndices = crushedIndices;
    this.totalCrushableChars = totalCrushableChars;
  }

  mount() {
    this.overlayRoot.appendChild(this.root);
    this.root.classList.add('is-active');

    const destroyedCount = this.crushedIndices.size;
    this.root.querySelector('#result-summary').textContent =
      this.totalCrushableChars === 0
        ? 'ブロックが1つもない状態で終わった'
        : `${destroyedCount}文字を粉砕した（全${this.totalCrushableChars}文字中）`;

    this.root.querySelector('#btn-retry').addEventListener('click', () => {
      soundManager.play('click');
      this.onRetry();
    });
    this.root.querySelector('#btn-title').addEventListener('click', () => {
      soundManager.play('click');
      this.onBackToTitle();
    });
  }

  unmount() {
    this.root.remove();
  }
}
