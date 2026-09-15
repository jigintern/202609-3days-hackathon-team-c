import { TitleBackground } from '../game/TitleBackground.js';

// 入力欄が発散しないよう、ゲーム側に渡す文章の長さの目安をここで決めておく
// （GameScene側のMAX_MAIL_BLOCKSと同じ値にしてある。入力できたのに壁にならない、
// という嘘をつかないよう、切り詰めではなく入力段階で止める）
const MAX_MAIL_LENGTH = 120;

// メール本文入力画面。「1文字=1ブロック」としてゲーム側が使う文章を受け取るだけの画面。
// ブロックの生成・配置は一切ここでは行わず、入力された文字列をそのまま
// onStartGame(mailText) 経由でGameScene側へ渡す。改行や空白の扱い（詰めて表示する等）は
// ゲーム側（GameScene._setupTower）の責務としている。詳細はREADMEを参照。
export class MailInputScene {
  constructor({ canvas, renderer, overlayRoot, onStartGame, onBack }) {
    this.overlayRoot = overlayRoot;
    this.onStartGame = onStartGame;
    this.onBack = onBack;
    // タイトル画面と同じ背景演出を流用し、画面が切り替わっても世界観がつながって見えるようにする
    this.background = new TitleBackground(canvas, renderer);

    this._handleInput = this._handleInput.bind(this);
    this._handleStartClick = this._handleStartClick.bind(this);

    this.root = document.createElement('div');
    this.root.className = 'screen screen-transparent';
    this.root.innerHTML = `
      <div class="title-panel mail-input-panel">
        <h1 class="mail-input-heading">メール本文を入力</h1>
        <p>
          もらった「お祈りメール」「落選メール」をそのまま貼り付けよう。<br />
          1文字ずつブロックになって積み上がる！
        </p>
        <textarea
          id="mail-input-textarea"
          class="mail-input-textarea"
          placeholder="例）厳正なる選考の結果、今回はご期待に添えず…"
          rows="5"
          maxlength="${MAX_MAIL_LENGTH}"
        ></textarea>
        <p id="mail-input-error" class="mail-input-error" hidden>
          メール本文を入力してください
        </p>
        <div class="mail-input-actions">
          <button class="btn btn-primary" id="btn-start-game" disabled>ゲーム開始</button>
          <button class="btn btn-secondary" id="btn-back-to-title">戻る</button>
        </div>
      </div>
    `;
  }

  mount() {
    this.background.mount();
    this.overlayRoot.appendChild(this.root);
    this.root.classList.add('is-active');

    this.textarea = this.root.querySelector('#mail-input-textarea');
    this.errorText = this.root.querySelector('#mail-input-error');
    this.startButton = this.root.querySelector('#btn-start-game');
    this.backButton = this.root.querySelector('#btn-back-to-title');

    this.textarea.value = '';
    this.errorText.hidden = true;
    this.startButton.disabled = true;

    this.textarea.addEventListener('input', this._handleInput);
    this.startButton.addEventListener('click', this._handleStartClick);
    this.backButton.addEventListener('click', this.onBack);
  }

  update(deltaSeconds) {
    this.background.update(deltaSeconds);
  }

  unmount() {
    this.background.unmount();
    this.textarea.removeEventListener('input', this._handleInput);
    this.startButton.removeEventListener('click', this._handleStartClick);
    this.backButton.removeEventListener('click', this.onBack);
    this.root.remove();
  }

  _handleInput() {
    const hasText = this.textarea.value.trim().length > 0;
    this.startButton.disabled = !hasText;
    if (hasText) {
      this.errorText.hidden = true;
    }
  }

  _handleStartClick() {
    const mailText = this.textarea.value.trim();
    if (mailText.length === 0) {
      this.errorText.hidden = false;
      return;
    }
    this.onStartGame(mailText);
  }
}
