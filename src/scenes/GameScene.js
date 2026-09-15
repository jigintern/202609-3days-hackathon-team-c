import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from '../game/PhysicsWorld.js';
import { Ball, launchSpeedRange, speedFromPowerRatio } from '../game/Ball.js';
import { Block, createCharacterTexture } from '../game/Block.js';
import { AimController } from '../game/AimController.js';
import { TrajectoryPreview } from '../game/TrajectoryPreview.js';
import {
  BLOCK_SPACING_X,
  BLOCK_SPACING_Y,
  CAMERA_FOV_DEG,
  cameraDistanceFor,
  createStageLayout,
} from '../game/StageLayout.js';
import { HUD } from '../ui/HUD.js';
import { getRandomEmailText } from '../data/emailTexts.js';

const TOTAL_BALLS = 8;
const SCORE_PER_BLOCK = 100;
const LAUNCH_HEIGHT = 2.4; // 発射地点の高さ。ブロックと同じく世界のスケールに合わせてある
const BALL_MAX_LIFETIME_SECONDS = 3; // 稀に物理演算が収束しないケースの保険
const BALL_REST_SPEED = 1.0; // 着地後わずかに転がり続けるだけの状態を「静止」とみなす閾値

// メール本文からブロックの壁を組む際の文字数上限。
// MailInputScene側のMAX_MAIL_LENGTH（textareaのmaxlength）と揃えてあり、
// 「入力できたのに壁にならない」状態が起きないようにしている
const MAX_MAIL_BLOCKS = 100;

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
    this.blocks = [];
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
    this.activeBall = null;
    this.characterTextures = new Map();

    this.canvas.style.display = 'block';

    // 壁の形と発射距離をここで確定させ、以降は画面が回転しても変えない。
    // 途中で発射距離が変わると、プレイヤーが掴んだ狙いの感覚が無効になってしまうため
    const mailText = this._resolveMailText();
    this.layout = createStageLayout(mailText, this._aspect(), MAX_MAIL_BLOCKS);
    this.launchOrigin = new THREE.Vector3(0, LAUNCH_HEIGHT, this.layout.launchDistance);
    this.speedRange = launchSpeedRange(this.layout.launchDistance, LAUNCH_HEIGHT);

    this._setupThree();
    this._setupPhysics();
    this._setupWall();

    this.hud = new HUD(this.overlayRoot);
    this.hud.show();
    this.hud.setScore(this.score);
    this.hud.setRemainingBalls(this.remainingBalls);

    this.aimController = new AimController(
      this.canvas,
      (direction, powerRatio) => this._launchBall(direction, powerRatio),
      this.layout.yawLimitDeg
    );
    this.hud.onYawInput = (direction) =>
      this.aimController.setYawInput(direction);
    this.trajectoryPreview = new TrajectoryPreview(this.scene);

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  unmount() {
    window.removeEventListener('resize', this._onResize);
    this.aimController.dispose();
    this.trajectoryPreview.dispose();
    this.hud.hide();
    this.hud.dispose();

    this.blocks.forEach((block) => block.dispose());
    if (this.activeBall) this.activeBall.dispose();

    // ブロック間で共有している文字テクスチャはここでまとめて破棄する
    this.characterTextures.forEach((texture) => texture.dispose());
    this.characterTextures.clear();

    this.canvas.style.display = 'none';
  }

  _aspect() {
    return window.innerWidth / window.innerHeight;
  }

  _setupThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d2e);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV_DEG,
      this._aspect(),
      0.1,
      1000
    );
    this._updateCamera();

    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    // 壁の高さに合わせて光源も引き上げないと、高い壁の上段だけ影に沈む
    const directional = new THREE.DirectionalLight(0xffffff, 1.0);
    directional.position.set(
      this.layout.width,
      this.layout.height + 20,
      this.layout.launchDistance * 0.5
    );
    directional.castShadow = true;
    this.scene.add(directional);

    // 床は発射地点の先まで届く必要がある。足りないと何もない空中から投げることになる
    const floorSize = (this.layout.launchDistance + 30) * 2;
    const floorGeometry = new THREE.PlaneGeometry(floorSize, floorSize);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2e42 });
    this.floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);
  }

  // カメラだけが画面比に追従する。壁が画面に収まる距離を取り直すが、
  // 発射地点より手前には来ないのでボールがカメラの後ろから飛んでくることはない
  _updateCamera() {
    const distance = cameraDistanceFor(this.layout, this._aspect());
    // 壁の中心を正面に捉える。壁は最大30m近くまで伸びるので、原点を見ると上半分が切れる
    const centerY = this.layout.height / 2;
    this.camera.position.set(0, centerY, distance);
    this.camera.lookAt(0, centerY, 0);
    this.camera.far = distance * 3;
    this.camera.updateProjectionMatrix();

    // フォグはカメラ〜壁の距離より必ず奥から掛ける。手前から掛けると壁自体が霞む
    this.scene.fog = new THREE.Fog(0x1a1d2e, distance * 1.25, distance * 2.2);
  }

  _setupPhysics() {
    this.physicsWorld = new PhysicsWorld();
    this.material = this.physicsWorld.defaultMaterial;

    const floorBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: this.material,
    });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.physicsWorld.addBody(floorBody);
  }

  // 1文字=1ブロックで壁を組む。行・列は StageLayout が文章と画面比から決めた
  // 値を使うので、縦持ちなら縦長の壁、横持ちなら横長の壁になり、どちらでも
  // 文面が画面に収まる。各行は同じ幅（cols）に揃えて空白ブロックで埋めてあるので、
  // 行をまたいでも同じ列には必ず支えがある（自重で崩れない）
  _setupWall() {
    const { rows } = this.layout;
    // 文面は上の段から読み始められるように積む。単純に下から詰めると
    // 最下段が文頭になり、壁を下から上へ読むことになってメールが読めない
    const topRow = rows.length - 1;
    rows.forEach((rowChars, indexFromTop) => {
      const row = topRow - indexFromTop;
      rowChars.forEach((character, col) => {
        this._spawnBlock(character, row, col);
      });
    });

    // 組み上げた直後に眠らせておく。20段積むと開始直後の自重の沈み込みだけで
    // 下段が潰れて勝手にスコアが入ってしまうため、何かがぶつかるまでは完全に固定する。
    // 衝突すればcannon-es側が自動で起こすし、ブロックが壊れたときは
    // _resolveBrokenBlocks が残りを明示的に起こして崩落させる
    this.blocks.forEach((block) => block.body.sleep());
  }

  // 壁に積む文章を決める。メール本文が渡されなかった場合（遊び方からゲームへ
  // 直行した場合など）や空白だけの入力では、開始直後にブロックが0個で
  // ゲームが終わってしまうため、ランダムな文面に退避する。
  // 実際の行分割（改行の保持・自動折り返し・空白パディング）は
  // StageLayout.createStageLayout に集約してある
  _resolveMailText() {
    const hasContent =
      Array.from((this.mailText ?? '').replace(/\s+/g, '')).length > 0;
    return hasContent ? this.mailText : getRandomEmailText();
  }

  // 同じ文字は同じテクスチャを使い回す。ブロック数ぶん毎回描き直す必要はなく、
  // 「の」「ご」のように頻出する文字ほど効く
  _getCharacterTexture(character) {
    let texture = this.characterTextures.get(character);
    if (!texture) {
      texture = createCharacterTexture(character);
      this.characterTextures.set(character, texture);
    }
    return texture;
  }

  _spawnBlock(character, row, col) {
    const block = new Block(
      this.physicsWorld,
      this.material,
      this._getCharacterTexture(character)
    );
    this.scene.add(block.mesh);

    const x = (col - (this.layout.cols - 1) / 2) * BLOCK_SPACING_X;
    const y = BLOCK_SPACING_Y / 2 + row * BLOCK_SPACING_Y;
    const z = 0;
    block.spawnAt(new THREE.Vector3(x, y, z));

    this.blocks.push(block);
  }

  _launchBall(direction, powerRatio) {
    if (this.hasEnded) return;
    if (this.activeBall || this.remainingBalls <= 0) return;

    this.remainingBalls -= 1;
    this.hud.setRemainingBalls(this.remainingBalls);

    const ball = new Ball(this.physicsWorld, this.material);
    ball.spawnAt(this.launchOrigin);
    ball.launch(direction, speedFromPowerRatio(this.speedRange, powerRatio));
    this.scene.add(ball.mesh);
    this.activeBall = ball;
    this.activeBallAge = 0;
  }

  _isBallAtRest(ball, age) {
    const speed = ball.body.velocity.length();
    const fellOffStage = ball.body.position.y < -5;
    const tookTooLong = age >= BALL_MAX_LIFETIME_SECONDS;
    return fellOffStage || speed < BALL_REST_SPEED || tookTooLong;
  }

  update(deltaSeconds) {
    if (this.hasEnded) return;

    this.aimController.update(deltaSeconds);
    this.hud.setPower(this.aimController.powerPercent);

    // 軌道プレビューは球が撃てる間ずっと出しておく。
    // `<` `>` でヨーを振ったときに点線が左右に振れてくれないと、
    // ボタンを押しても何が変わったのか分からないため
    const canLaunch = !this.activeBall && this.remainingBalls > 0;
    if (canLaunch) {
      this.trajectoryPreview.show();
      this.trajectoryPreview.update(
        this.launchOrigin,
        this.aimController.direction,
        speedFromPowerRatio(this.speedRange, this.aimController.powerRatio)
      );
    } else {
      this.trajectoryPreview.hide();
    }

    this.physicsWorld.step(deltaSeconds);

    this.blocks.forEach((block) => block.syncMeshToBody());
    if (this.activeBall) this.activeBall.syncMeshToBody();

    this._resolveBrokenBlocks();
    this._resolveActiveBall(deltaSeconds);
    this._checkGameOver();

    this.renderer.render(this.scene, this.camera);
  }

  _resolveBrokenBlocks() {
    const survivors = [];
    this.blocks.forEach((block) => {
      if (block.shouldBreak) {
        this.scene.remove(block.mesh);
        block.dispose();
        this.score += SCORE_PER_BLOCK;
        this.hud.setScore(this.score);
      } else {
        survivors.push(block);
      }
    });

    // 落ち着いた壁はcannon-esのスリープに入っていて、下のブロックが消えても
    // 目を覚まさず宙に浮いたままになる。壊れたぶんだけ残りを起こして自然に崩落させる
    if (survivors.length !== this.blocks.length) {
      survivors.forEach((block) => block.body.wakeUp());
    }

    this.blocks = survivors;
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
    const cleared = this.blocks.length === 0;
    const outOfAmmo = this.remainingBalls <= 0 && !this.activeBall;
    if (cleared || outOfAmmo) {
      this.hasEnded = true;
      this.onGameOver(this.score);
    }
  }

  _onResize() {
    this.camera.aspect = this._aspect();
    // 壁の形と発射距離は mount() で確定済みなので触らない。動くのはカメラだけ
    this._updateCamera();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
