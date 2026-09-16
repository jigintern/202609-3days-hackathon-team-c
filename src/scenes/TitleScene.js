import { TitleBackground } from '../game/TitleBackground.js';
import { soundManager } from '../audio/SoundManager.js';

// タイトル画面。スタート / 遊び方の2ボタンと、鉄球が封筒を吹き飛ばし続ける背景演出
export class TitleScene {
  constructor({ canvas, renderer, overlayRoot, onStart, onShowHowTo }) {
    this.overlayRoot = overlayRoot;
    this.onStart = onStart;
    this.onShowHowTo = onShowHowTo;
    this.background = new TitleBackground(canvas, renderer);

    this._handleStartClick = this._handleStartClick.bind(this);
    this._handleHowToClick = this._handleHowToClick.bind(this);

    this.root = document.createElement('div');
    this.root.className = 'screen screen-transparent';
    this.root.innerHTML = `
      <div class="title-panel">
        <div class="title-lockup">
          <span class="title-burst">ドカン！</span>
          <h1>お祈りメールクラッシャー</h1>
        </div>
        <p>就活の「お祈りメール」や抽選の「落選メール」を鉄球でぶっ壊せ！</p>
        <button class="btn btn-primary" id="btn-start">スタート</button>
        <button class="btn btn-secondary" id="btn-howto">遊び方</button>
      </div>
    `;
  }

  mount() {
    this.background.mount();

    this.overlayRoot.appendChild(this.root);
    this.root.classList.add('is-active');
    this.startButton = this.root.querySelector('#btn-start');
    this.howToButton = this.root.querySelector('#btn-howto');
    this.startButton.addEventListener('click', this._handleStartClick);
    this.howToButton.addEventListener('click', this._handleHowToClick);
  }

  update(deltaSeconds) {
    this.background.update(deltaSeconds);
  }

  unmount() {
    this.background.unmount();
    this.startButton.removeEventListener('click', this._handleStartClick);
    this.howToButton.removeEventListener('click', this._handleHowToClick);
    this.root.remove();
  }

  _handleStartClick() {
    soundManager.play('click');
    this.onStart();
  }

  _handleHowToClick() {
    soundManager.play('click');
    this.onShowHowTo();
  }
}
