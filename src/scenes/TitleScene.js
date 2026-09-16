import { TitleBackground } from '../game/TitleBackground.js';
import { soundManager } from '../audio/SoundManager.js';

// タイトル画面。スタート / 遊び方の2ボタンと、鉄球が封筒を吹き飛ばし続ける背景演出
export class TitleScene {
  constructor({ canvas, renderer, overlayRoot, onStart, onShowHowTo }) {
    this.overlayRoot = overlayRoot;
    this.onStart = onStart;
    this.onShowHowTo = onShowHowTo;
    this.background = new TitleBackground(canvas, renderer);

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
    this.root.querySelector('#btn-start').addEventListener('click', () => {
      soundManager.play('click');
      this.onStart();
    });
    this.root.querySelector('#btn-howto').addEventListener('click', () => {
      soundManager.play('click');
      this.onShowHowTo();
    });
  }

  update(deltaSeconds) {
    this.background.update(deltaSeconds);
  }

  unmount() {
    this.background.unmount();
    this.root.remove();
  }
}
