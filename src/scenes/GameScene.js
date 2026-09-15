import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from '../game/PhysicsWorld.js';
import { Ball } from '../game/Ball.js';
import { Block } from '../game/Block.js';
import { AimController } from '../game/AimController.js';
import { TrajectoryPreview } from '../game/TrajectoryPreview.js';
import { HUD } from '../ui/HUD.js';
import { getRandomEmailText } from '../data/emailTexts.js';

const TOTAL_BALLS = 8;
const BLOCK_ROWS = 4;
const BLOCK_COLS = 2;
const SCORE_PER_BLOCK = 100;
const LAUNCH_ORIGIN = new THREE.Vector3(0, 1.5, 11);
const BALL_MAX_LIFETIME_SECONDS = 3; // 稀に物理演算が収束しないケースの保険
const BALL_REST_SPEED = 0.8; // 着地後わずかに転がり続けるだけの状態を「静止」とみなす閾値

// メール本文からブロックタワーを組む際の文字数上限（タワーが発散しないための目安。
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
    this.blocks = [];
    this.activeBall = null;
    this.hasEnded = false;
    // MailInputScene経由で渡された文章。未設定(null)ならランダム文面にフォールバックする
    this.mailText = null;
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

    this.canvas.style.display = 'block';

    this._setupThree();
    this._setupPhysics();
    this._setupTower();

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
    if (this.activeBall) this.activeBall.dispose();

    this.canvas.style.display = 'none';
  }

  _setupThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d2e);
    this.scene.fog = new THREE.Fog(0x1a1d2e, 20, 40);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 9, 14);
    this.camera.lookAt(0, 2, 0);

    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 1.0);
    directional.position.set(6, 12, 8);
    directional.castShadow = true;
    this.scene.add(directional);

    const floorGeometry = new THREE.PlaneGeometry(40, 40);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2e42 });
    this.floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);
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

  _setupTower() {
    const blockWidth = 1.6;
    const blockHeight = 0.95;

    // メール本文が渡されていれば「1文字=1ブロック」で組む。
    // 改行や空白（全角スペース含む）は見た目上のブロックにしても意味がないため、
    // \s+ で丸ごと取り除いてから文字ごとに分割する。長すぎる入力はMAX_MAIL_BLOCKS件までに
    // 切り詰めてタワーが発散しないようにしている（このあたりの挙動はREADME参照）。
    const characters = this.mailText
      ? this.mailText.replace(/\s+/g, '').slice(0, MAX_MAIL_BLOCKS).split('')
      : null;

    if (characters && characters.length > 0) {
      const cols = Math.max(1, Math.ceil(Math.sqrt(characters.length)));
      characters.forEach((character, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        this._spawnBlock(character, row, col, cols, blockWidth, blockHeight);
      });
      return;
    }

    // メール本文が渡されなかった場合（遊び方からのスキップ等）は、
    // これまで通りランダムな文面でブロックタワーを作る
    for (let row = 0; row < BLOCK_ROWS; row += 1) {
      for (let col = 0; col < BLOCK_COLS; col += 1) {
        this._spawnBlock(
          getRandomEmailText(),
          row,
          col,
          BLOCK_COLS,
          blockWidth,
          blockHeight
        );
      }
    }
  }

  _spawnBlock(labelText, row, col, cols, blockWidth, blockHeight) {
    const block = new Block(
      this.physicsWorld,
      this.material,
      labelText,
      this.overlayRoot
    );
    block.mesh.material.color.setHex(row % 2 === 0 ? 0xf2f2f2 : 0xe4e6f5);
    this.scene.add(block.mesh);

    const x = (col - (cols - 1) / 2) * blockWidth;
    const y = blockHeight / 2 + row * blockHeight;
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
    const fellOffStage = ball.body.position.y < -5;
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
    if (this.activeBall) this.activeBall.syncMeshToBody();

    const width = window.innerWidth;
    const height = window.innerHeight;
    this.blocks.forEach((block) =>
      block.updateLabelPosition(this.camera, width, height)
    );

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
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
