import { soundManager } from '../audio/SoundManager.js';

// 音のオン/オフを切り替える固定ボタン。特定のシーンには属さず、
// overlay-root直下に常駐させることでmount/unmountのたびに消えないようにする
export class SoundToggle {
  constructor(container) {
    this.root = document.createElement('button');
    this.root.type = 'button';
    this.root.id = 'sound-toggle';
    this.root.className = 'sound-toggle';
    container.appendChild(this.root);

    this.root.addEventListener('click', () => {
      soundManager.setMuted(!soundManager.isMuted);
      this._render();
    });

    this._render();
  }

  _render() {
    const muted = soundManager.isMuted;
    this.root.textContent = muted ? '🔇' : '🔊';
    this.root.classList.toggle('is-muted', muted);
    this.root.setAttribute('aria-pressed', String(muted));
    this.root.setAttribute('aria-label', muted ? 'サウンドをオンにする' : 'サウンドをオフにする');
  }
}
