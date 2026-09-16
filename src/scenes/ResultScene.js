import { soundManager } from '../audio/SoundManager.js';

// 1文字ごとの「まだ靄が残っている」演出をずらすときの、ずらし幅の周期。
// これより長く残った文字が連続しても、遅延が延々と伸び続けないようここで折り返す
const HAZE_DELAY_CYCLE = 24;
const HAZE_DELAY_STEP_SECONDS = 0.03;

// リザルト画面。リトライ / タイトルへ戻るボタン。
// スコアは持たない（このゲームは点数を競う遊びではないため）。
// 代わりに、メール本文そのものを1文字ずつ描画し、棒から落とせた（粉砕した）
// 文字と、まだ棒の上に残って読める文字を見比べさせることで戦果を見せる
export class ResultScene {
  constructor({ overlayRoot, onRetry, onBackToTitle }) {
    this.overlayRoot = overlayRoot;
    this.onRetry = onRetry;
    this.onBackToTitle = onBackToTitle;
    this.mailText = '';
    this.crushedIndices = new Set();
    this.totalCrushableChars = 0;

    this.root = document.createElement('div');
    this.root.className = 'screen result-screen';
    this.root.innerHTML = `
      <div class="result-panel">
        <h1 id="result-heading">粉砕結果</h1>
        <p class="result-summary" id="result-summary"></p>
        <div class="result-mail" id="result-mail"></div>
        <div class="result-actions">
          <button class="btn" id="btn-retry">もう一度</button>
          <button class="btn btn-secondary" id="btn-title">タイトルへ戻る</button>
        </div>
      </div>
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
    this._render();

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

  _render() {
    const destroyedCount = this.crushedIndices.size;
    const total = this.totalCrushableChars;
    const complete = total > 0 && destroyedCount === total;

    this.root.classList.toggle('is-complete', complete);
    this.root.querySelector('#result-heading').textContent = complete
      ? '完全粉砕！'
      : '粉砕結果';
    this.root.querySelector('#result-summary').textContent =
      total === 0
        ? 'ブロックが1つもない状態で終わった'
        : `${destroyedCount}文字を粉砕した（全${total}文字中）`;

    this._renderMail();
  }

  // メール本文を1文字ずつspanに分けて描画する。改行はGameScene._splitIntoRows()と
  // 同じ規則（\r\n はまとめて1つ、\r 単体・\n 単体もそれぞれ1つ）でbrに変換し、
  // 見た目の改行を本文どおりに保つ。
  // 空白はそもそも棒のブロックにならない（粉砕も残留もしない）ので素通しする
  _renderMail() {
    const mailEl = this.root.querySelector('#result-mail');
    mailEl.innerHTML = '';

    const chars = Array.from(this.mailText);
    let hazeDelayIndex = 0;

    for (let i = 0; i < chars.length; i += 1) {
      const character = chars[i];

      if (character === '\r' || character === '\n') {
        mailEl.appendChild(document.createElement('br'));
        if (character === '\r' && chars[i + 1] === '\n') i += 1;
        continue;
      }

      const span = document.createElement('span');
      span.className = 'result-char';
      span.textContent = character;

      if (/\s/.test(character)) {
        span.classList.add('is-space');
      } else if (this.crushedIndices.has(i)) {
        span.classList.add('is-crushed');
      } else {
        span.classList.add('is-intact');
        const delay =
          (hazeDelayIndex % HAZE_DELAY_CYCLE) * HAZE_DELAY_STEP_SECONDS;
        span.style.setProperty('--haze-delay', `${delay}s`);
        hazeDelayIndex += 1;
      }

      mailEl.appendChild(span);
    }
  }
}
