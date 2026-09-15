import { TitleBackground } from '../game/TitleBackground.js';

// 入力欄が発散しないよう、ゲーム側に渡す文章の長さの目安をここで決めておく
// （GameScene側のMAX_MAIL_BLOCKSと合わせて、両方で二重に上限をかけている）
const MAX_MAIL_LENGTH = 100;

// タイトル画面。タイトル表示・メール本文の入力・ゲーム開始を1枚に収めている。
// 「1文字=1ブロック」としてゲーム側が使う文章を受け取るだけで、ブロックの生成・配置は
// 一切ここでは行わない。入力された文字列は onStart(mailText) 経由でGameScene側へ渡す。
// 改行や空白の扱い（詰めて表示する等）はゲーム側（GameScene._buildCharacters）の責務。
// 詳細はREADMEを参照。
export class TitleScene {
  constructor({ canvas, renderer, overlayRoot, onStart }) {
    this.overlayRoot = overlayRoot;
    this.onStart = onStart;
    this.background = new TitleBackground(canvas, renderer);
    // 直前に遊んだ本文。貼り直さずにもう一度遊べるよう、mount前にAppから書き戻される
    this.mailText = '';

    this._handleStartClick = this._handleStartClick.bind(this);

    this.root = document.createElement('div');
    this.root.className = 'screen screen-transparent';
    this.root.innerHTML = `
      <div class="title-panel">
        <div class="title-lockup">
          <span class="title-burst">ドカン！</span>
          <h1>お祈りメールクラッシャー</h1>
        </div>
        <p>もらった「お祈りメール」を貼り付けて、鉄球でぶっ壊せ！</p>
        <textarea
          id="mail-input"
          class="title-mail-input"
          placeholder="例）厳正なる選考の結果、今回はご期待に添えず…"
          rows="4"
          maxlength="${MAX_MAIL_LENGTH}"
        ></textarea>
        <p class="title-note">未入力ならランダムな文面で遊べます</p>
        <button class="btn btn-primary" id="btn-start">スタート</button>
        <details class="title-howto">
          <summary>遊び方</summary>
          <p>
            画面をドラッグして狙いを定めよう。<br />
            そのまま上に引っ張ると、放物線が高く・強くなる。<br />
            指を離すと、その角度と強さで鉄球が発射される。
          </p>
        </details>
      </div>
    `;
  }

  // Appが保持している直前のメール本文を受け取る
  // （mount前に呼ばれる想定。GameScene.setMailTextと同じ使い方）
  setMailText(mailText) {
    this.mailText = mailText ?? '';
  }

  mount() {
    this.background.mount();

    this.overlayRoot.appendChild(this.root);
    this.root.classList.add('is-active');

    this.textarea = this.root.querySelector('#mail-input');
    this.startButton = this.root.querySelector('#btn-start');

    this.textarea.value = this.mailText;
    this.startButton.addEventListener('click', this._handleStartClick);
  }

  update(deltaSeconds) {
    this.background.update(deltaSeconds);
  }

  unmount() {
    this.background.unmount();
    this.startButton.removeEventListener('click', this._handleStartClick);
    this.root.remove();
  }

  // 未入力でもそのまま開始できる。空文字を渡すとGameScene側が
  // ランダムなお祈りメール文面にフォールバックする
  _handleStartClick() {
    this.onStart(this.textarea.value.trim());
  }
}
