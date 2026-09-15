import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from '../game/PhysicsWorld.js';
import { Ball } from '../game/Ball.js';
import { Block } from '../game/Block.js';
import { AimController } from '../game/AimController.js';
import { HUD } from '../ui/HUD.js';
import { getRandomEmailText } from '../data/emailTexts.js';

const TOTAL_BALLS = 8;
const BLOCK_ROWS = 4;
const BLOCK_COLS = 2;
const SCORE_PER_BLOCK = 100;
const LAUNCH_ORIGIN = new THREE.Vector3(0, 1.5, 11);

// メインのゲームプレイ画面。three.jsの描画とcannon-esの物理更新、
// 狙い/発射/スコア判定をひとつにまとめる
export class GameScene {
  constructor({ canvas, overlayRoot, onGameOver }) {
    this.canvas = canvas;
    this.overlayRoot = overlayRoot;
    this.onGameOver = onGameOver;

    this.score = 0;
    this.remainingBalls = TOTAL_BALLS;
    this.blocks = [];
    this.activeBall = null;
    this.hasEnded = false;
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

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  unmount() {
    window.removeEventListener('resize', this._onResize);
    this.aimController.dispose();
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

    // リトライのたびにWebGLコンテキストを作り直さないよう、rendererは使い回す
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
    }
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

    for (let row = 0; row < BLOCK_ROWS; row += 1) {
      for (let col = 0; col < BLOCK_COLS; col += 1) {
        const labelText = getRandomEmailText();
        const block = new Block(
          this.physicsWorld,
          this.material,
          labelText,
          this.overlayRoot
        );
        block.mesh.material.color.setHex(row % 2 === 0 ? 0xf2f2f2 : 0xe4e6f5);
        this.scene.add(block.mesh);

        const x = (col - (BLOCK_COLS - 1) / 2) * blockWidth;
        const y = blockHeight / 2 + row * blockHeight;
        const z = 0;
        block.spawnAt(new THREE.Vector3(x, y, z));

        this.blocks.push(block);
      }
    }
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
  }

  _isBallAtRest(ball) {
    const speed = ball.body.velocity.length();
    const fellOffStage = ball.body.position.y < -5;
    return fellOffStage || speed < 0.05;
  }

  update(deltaSeconds) {
    if (this.hasEnded) return;

    this.aimController.update(deltaSeconds);
    this.hud.setPower(this.aimController.powerPercent);

    this.physicsWorld.step(deltaSeconds);

    this.blocks.forEach((block) => block.syncMeshToBody());
    if (this.activeBall) this.activeBall.syncMeshToBody();

    const width = window.innerWidth;
    const height = window.innerHeight;
    this.blocks.forEach((block) =>
      block.updateLabelPosition(this.camera, width, height)
    );

    this._resolveBrokenBlocks();
    this._resolveActiveBall();
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

  _resolveActiveBall() {
    if (!this.activeBall) return;
    if (this._isBallAtRest(this.activeBall)) {
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
