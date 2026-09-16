import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from '../game/PhysicsWorld.js';
import { Ball } from '../game/Ball.js';
import { Block, createCharacterTexture } from '../game/Block.js';
import { Bar, BAR_TOP_Y, BAR_Y } from '../game/Bar.js';
import { AimController } from '../game/AimController.js';
import { TrajectoryPreview } from '../game/TrajectoryPreview.js';
import { HUD } from '../ui/HUD.js';
import { getRandomEmailText } from '../data/emailTexts.js';

const TOTAL_BALLS = 8;
const SCORE_PER_BLOCK = 100;
// 発射地点。z がブロックの壁(z=0)までの距離そのもの。
// 空中(y=6)の棒に積んだ壁は幅7.8m・高さ4.7mあり、これを縦画面に収めるにはカメラを
// 21m以上引く必要がある。カメラを引くぶん球も届かなくなるので、発射地点と
// Ball の MAX_LAUNCH_SPEED（届く距離は速度の2乗に比例）はセットで見直すこと
const LAUNCH_ORIGIN = new THREE.Vector3(0, 1.5, 25);
const BALL_MAX_LIFETIME_SECONDS = 3; // 稀に物理演算が収束しないケースの保険
const BALL_REST_SPEED = 0.8; // 棒の上でわずかに転がり続けるだけの状態を「静止」とみなす閾値
// 外したボールを消す高さ。画面下端(z=0面で約-6.6m)より下で消して、
// 消える瞬間がプレイヤーに見えないようにする
const BALL_DESPAWN_Y = -8;

// 回収用の床の高さ。プレイヤーには見えない位置（画面下端よりはるか下・フォグの中）に置き、
// 落ちたブロックがここへ着いた時点で破棄する。無限に落ち続けるボディを作らないための受け皿
const FLOOR_Y = -20;
// 床に着いたとみなす高さ。床との衝突イベントが主で、これは取りこぼし用の保険
// （落ちたブロックの上に別のブロックが重なって着地した場合など）
const FLOOR_LANDED_Y = FLOOR_Y + 2;
// この高さより下に落ちたら「棒から落ちた」とみなして加点する。
// 棒の上で横滑りしただけのブロックを誤って数えないよう、棒より1m下に置いてある
const SCORE_FALL_Y = BAR_Y - 1;

// メール本文からブロックの壁を組む際の文字数上限（壁が発散しないための目安。
// 見た目やカメラ位置に合わせて調整可）
const MAX_MAIL_BLOCKS = 24;


// メインのゲームプレイ画面。three.jsの描画とcannon-esの物理更新、
// 狙い/発射/スコア判定をひとつにまとめる
export class GameScene {
  constructor({ canvas, renderer, overlayRoot, onGameOver }) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.overlayRoot = overlayRoot;
    this.onGameOver = onGameOver;

    this.score = 0;
    this.remainingBalls = TOTAL_BALLS;
    // まだ棒の上に残っていて加点していないブロック
    this.blocks = [];
    // 棒から落ちて加点済みだが、まだ床に着いていない落下中のブロック
    this.fallingBlocks = [];
    this.activeBall = null;
    this.hasEnded = false;
    // MailInputScene経由で渡された文章。未設定(null)ならランダム文面にフォールバックする
    this.mailText = null;
    // 同じ文字のブロックでテクスチャを使い回すためのキャッシュ（文字 -> CanvasTexture）。
    // ブロック単位で破棄すると他のブロックの文字まで消えるため、unmount()でまとめて破棄する
    this.characterTextures = new Map();
  }

  // MailInputScene.onStartGame(mailText) から main.js を通じて渡される入力文字列を受け取る。
  // mount()より前に呼ばれる想定（ResultScene.setScoreと同じ使い方）
  setMailText(mailText) {
    this.mailText = mailText;
  }

  mount() {
    this.hasEnded = false;
    this.score = 0;
    this.remainingBalls = TOTAL_BALLS;
    this.blocks = [];
    this.fallingBlocks = [];
    this.activeBall = null;
    this.characterTextures = new Map();
    // 回収用の床に着いたボディの置き場。床のcollideイベントから積まれ、
    // 毎フレームの _resolveLandedBlocks() で消化する
    this.landedBodies = new Set();

    this.canvas.style.display = 'block';

    this._setupThree();
    this._setupPhysics();
    this._setupBar();
    this._setupWall();

    this.hud = new HUD(this.overlayRoot);
    this.hud.show();
    this.hud.setScore(this.score);
    this.hud.setRemainingBalls(this.remainingBalls);

    this.aimController = new AimController(
      this.canvas,
      this.camera,
      LAUNCH_ORIGIN,
      (direction, power) => this._launchBall(direction, power)
    );
    this.trajectoryPreview = new TrajectoryPreview(this.scene);

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  unmount() {
    window.removeEventListener('resize', this._onResize);
    this.aimController.dispose();
    this.trajectoryPreview.dispose();
    this.hud.hide();
    this.hud.root.remove();

    this.blocks.forEach((block) => block.dispose());
    this.fallingBlocks.forEach((block) => block.dispose());
    this.bar.dispose();
    if (this.activeBall) this.activeBall.dispose();

    // ブロック間で共有している文字テクスチャはここでまとめて破棄する
    this.characterTextures.forEach((texture) => texture.dispose());
    this.characterTextures.clear();

    this.canvas.style.display = 'none';
  }

  _setupThree() {
    this.scene = new THREE.Scene();
    // タイトル画面(TitleBackground)と同じ水色。同じ紙色ブロックの見た目が
    // この背景で視認性を確保できることは既にタイトル画面で確認済み
    this.scene.background = new THREE.Color(0x8ecbf0);
    // 回収用の床(y=-20)がフォグに沈む距離から掛ける。カメラからそこまでは約40mある
    this.scene.fog = new THREE.Fog(0x8ecbf0, 35, 50);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    // 棒(y=6)に積んだ壁は幅7.8m。縦画面(aspect≒0.46)でこれが収まるのは
    // カメラ距離21m以上なので28mまで引いてある。
    // lookAtは壁の中心(y≒8.5)より少し下を見て、壁を画面の上寄り・
    // その下にブロックが落ちていく空間が入るように振っている
    this.camera.position.set(0, 9, 28);
    this.camera.lookAt(0, 7, 0);

    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xfff3d6, 1.1);
    directional.position.set(6, 18, 8);
    directional.castShadow = true;
    // 影を落とす対象が原点付近から空中の壁(y=6〜11)へ移ったので、
    // ライトの注視点とシャドウカメラの範囲も一緒に持ち上げる。
    // これを忘れると壁がシャドウカメラの外に出て影が消える
    directional.target.position.set(0, BAR_Y + 2, 0);
    this.scene.add(directional.target);
    directional.shadow.camera.left = -8;
    directional.shadow.camera.right = 8;
    directional.shadow.camera.top = 8;
    directional.shadow.camera.bottom = -8;
    directional.shadow.camera.updateProjectionMatrix();
    this.scene.add(directional);

    // 床のメッシュは置かない。地面が無いぶん、落ちたブロックはそのまま
    // 背景の奥（フォグの中）へ消えていく（回収用の床は物理だけで、画面には映らない位置にある）
  }

  _setupPhysics() {
    this.physicsWorld = new PhysicsWorld();
    this.material = this.physicsWorld.defaultMaterial;

    // ステージには地面が無く、棒から落ちたブロックはどこまでも落ちていく。
    // 物理ボディを無限に走らせ続けないよう、画面に映らない高さに回収用の床を敷き、
    // ここへ着いたブロックを破棄する
    const floorBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: this.material,
    });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    floorBody.position.set(0, FLOOR_Y, 0);
    floorBody.addEventListener('collide', (event) => {
      this.landedBodies.add(event.body);
    });
    this.physicsWorld.addBody(floorBody);
  }

  _setupBar() {
    this.bar = new Bar(this.physicsWorld, this.material);
    this.scene.add(this.bar.mesh);
  }

  // 空中に浮いた棒の上にメールブロックの壁を積む。
  // 壁そのものの組み方（列数・間隔）は床に積んでいた頃と同じで、
  // 積み始める高さが棒の上面になった点だけが違う
  _setupWall() {
    const blockWidth = 1.6;
    const blockHeight = 0.95;

    const characters = this._buildCharacters();
    const cols = Math.max(1, Math.ceil(Math.sqrt(characters.length)));

    characters.forEach((character, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      this._spawnBlock(character, row, col, cols, blockWidth, blockHeight);
    });
  }

  // タワーに積む文字の配列を作る。「1文字=1ブロック」の組み方をここ1箇所に集約し、
  // メール本文が渡されなかった場合（遊び方からゲームへ直行した場合など）も
  // ランダムな文面を同じ手順で1文字ずつに分解する。
  // 改行や空白（全角スペース含む）はブロックにしても意味がないため \s+ で取り除き、
  // サロゲートペア（絵文字など）を割らないよう Array.from で分割する。
  // 長すぎる入力は MAX_MAIL_BLOCKS 件までに切り詰めてタワーが発散しないようにしている。
  _buildCharacters() {
    const normalized = (this.mailText ?? '').replace(/\s+/g, '');
    // 空白だけの入力でブロックが0個になると開始直後にゲームが終わってしまうため、
    // 正規化した結果が空ならランダム文面に退避する
    const source =
      normalized.length > 0
        ? normalized
        : getRandomEmailText().replace(/\s+/g, '');
    return Array.from(source).slice(0, MAX_MAIL_BLOCKS);
  }

  // 同じ文字は同じテクスチャを使い回す。24ブロック分を毎回描き直す必要はなく、
  // 「の」「ご」のように頻出する文字ほど効く
  _getCharacterTexture(character) {
    let texture = this.characterTextures.get(character);
    if (!texture) {
      texture = createCharacterTexture(character);
      this.characterTextures.set(character, texture);
    }
    return texture;
  }

  _spawnBlock(character, row, col, cols, blockWidth, blockHeight) {
    const block = new Block(
      this.physicsWorld,
      this.material,
      this._getCharacterTexture(character)
    );
    this.scene.add(block.mesh);

    const x = (col - (cols - 1) / 2) * blockWidth;
    const y = BAR_TOP_Y + blockHeight / 2 + row * blockHeight;
    const z = 0;
    block.spawnAt(new THREE.Vector3(x, y, z));

    this.blocks.push(block);
  }

  _launchBall(direction, power) {
    if (this.hasEnded) return;
    if (this.activeBall || this.remainingBalls <= 0) return;

    this.remainingBalls -= 1;
    this.hud.setRemainingBalls(this.remainingBalls);

    const ball = new Ball(this.physicsWorld, this.material);
    ball.spawnAt(LAUNCH_ORIGIN);
    ball.launch(direction, power);
    this.scene.add(ball.mesh);
    this.activeBall = ball;
    this.activeBallAge = 0;
  }

  _isBallAtRest(ball, age) {
    const speed = ball.body.velocity.length();
    const fellOffStage = ball.body.position.y < BALL_DESPAWN_Y;
    const tookTooLong = age >= BALL_MAX_LIFETIME_SECONDS;
    return fellOffStage || speed < BALL_REST_SPEED || tookTooLong;
  }

  update(deltaSeconds) {
    if (this.hasEnded) return;

    this.hud.setPower(this.aimController.powerPercent);

    const canLaunch = !this.activeBall && this.remainingBalls > 0;
    if (this.aimController.isDragging && canLaunch) {
      this.trajectoryPreview.show();
      this.trajectoryPreview.update(
        LAUNCH_ORIGIN,
        this.aimController.direction,
        this.aimController.powerPercent
      );
    } else {
      this.trajectoryPreview.hide();
    }

    this.physicsWorld.step(deltaSeconds);

    this.blocks.forEach((block) => block.syncMeshToBody());
    this.fallingBlocks.forEach((block) => block.syncMeshToBody());
    if (this.activeBall) this.activeBall.syncMeshToBody();

    this._resolveFallenBlocks();
    this._resolveLandedBlocks();
    this._resolveActiveBall(deltaSeconds);
    this._checkGameOver();

    this.renderer.render(this.scene, this.camera);
  }

  // 棒より下へ落ちたブロックを見つけて加点する。ブロックは壊れないので、
  // 得点手段はこの「落とす」だけ。加点したブロックは fallingBlocks へ移し、
  // 二重に数えないようにする
  _resolveFallenBlocks() {
    const remaining = [];
    this.blocks.forEach((block) => {
      if (block.body.position.y < SCORE_FALL_Y) {
        this.score += SCORE_PER_BLOCK;
        this.hud.setScore(this.score);
        this.fallingBlocks.push(block);
      } else {
        remaining.push(block);
      }
    });

    // 落ち着いた壁はcannon-esのスリープに入っていて、下のブロックが落ちても
    // 目を覚まさず宙に浮いたままになる。落ちたぶんだけ残りを起こして自然に崩落させる
    if (remaining.length !== this.blocks.length) {
      remaining.forEach((block) => block.body.wakeUp());
    }

    this.blocks = remaining;
  }

  // 回収用の床まで落ちたブロックを破棄する。床のcollideイベントが主で、
  // 先に落ちたブロックの上に着地してしまった場合に備えて高さでも拾う
  _resolveLandedBlocks() {
    if (this.fallingBlocks.length === 0) return;

    this.fallingBlocks = this.fallingBlocks.filter((block) => {
      const landed =
        this.landedBodies.has(block.body) ||
        block.body.position.y < FLOOR_LANDED_Y;
      if (!landed) return true;

      this.landedBodies.delete(block.body);
      this.scene.remove(block.mesh);
      block.dispose();
      return false;
    });
  }

  _resolveActiveBall(deltaSeconds) {
    if (!this.activeBall) return;
    this.activeBallAge += deltaSeconds;
    if (this._isBallAtRest(this.activeBall, this.activeBallAge)) {
      this.scene.remove(this.activeBall.mesh);
      this.activeBall.dispose();
      this.activeBall = null;
    }
  }

  _checkGameOver() {
    // 落下中のブロックが残っているうちに結果画面へ飛ぶと、最後の一撃が
    // 落ちきる前に画面が切り替わってしまう。球と落下中のブロックが
    // 片付いてから終了する
    const settled = !this.activeBall && this.fallingBlocks.length === 0;
    const cleared = this.blocks.length === 0 && settled;
    const outOfAmmo = this.remainingBalls <= 0 && settled;
    if (cleared || outOfAmmo) {
      this.hasEnded = true;
      this.onGameOver(this.score);
    }
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
