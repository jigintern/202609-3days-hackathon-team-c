import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Ball } from './Ball.js';
import { randomRange } from '../utils/helpers.js';

const BRICK_SIZE = new THREE.Vector3(1.3, 0.8, 0.9);
// レンガ調（赤〜茶系）で統一。「1文字=1ブロック」のコンセプトを伝えるダミー配色
const BRICK_COLORS = [0xb5482a, 0x9c4221, 0x8a3a24, 0xc65a3a];
// タイトル画面ではダミー文字でよいので、タイトル文言から適当な文字を拝借する
const DUMMY_CHARS = Array.from(
  'ドカンおいのりめーるくらっしゃーごえんがなかったこと'
);
const SPAWN_INTERVAL_BRICK = 0.8;
const SPAWN_INTERVAL_BALL = 2.2;
const MAX_BRICKS = 14;
const MAX_BALLS = 5;
const OUT_OF_BOUNDS_Y = -4;
const BALL_SPAWN_X = 10;
const OUT_OF_BOUNDS_XZ = BALL_SPAWN_X + 3;

// 台（ペデスタル）: ブロックを置くための低い横長の土台
const PEDESTAL_SIZE = new THREE.Vector3(9, 0.6, 4);
const PEDESTAL_TOP_Y = PEDESTAL_SIZE.y;
const BRICK_SPAWN_X_RANGE = [-3.5, 3.5];
const BRICK_SPAWN_Z_RANGE = [-1.5, 1.5];

const PADDLE_SIZE = new THREE.Vector3(2.6, 0.4, 0.6);
const PADDLE_POSITION_Y = 0.5;
const PADDLE_POSITION_Z = 5.5;
const PADDLE_RANGE = 3.5;
const PADDLE_SPEED = 0.7; // 往復の速さ（ラジアン/秒相当）

// タイトル/メール入力画面の背景で、鉄球がレンガの山へ延々と飛び込み続けるアトラクトモード演出。
// 青空と芝生でゲーム本編と統一感のある明るい屋外の雰囲気にする。
export class TitleBackground {
  constructor(canvas, renderer, overlayRoot) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.overlayRoot = overlayRoot;
    this.bricks = [];
    this.balls = [];
  }

  mount() {
    this.canvas.style.display = 'block';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8ecbf0);
    this.scene.fog = new THREE.Fog(0x8ecbf0, 20, 42);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 7, 15);
    this.camera.lookAt(0, 1, 0);

    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xfff3d6, 1.1);
    directional.position.set(6, 14, 8);
    this.scene.add(directional);

    // 芝生（地面）
    const grassGeometry = new THREE.PlaneGeometry(30, 24);
    const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x5fae4a });
    this.grassMesh = new THREE.Mesh(grassGeometry, grassMaterial);
    this.grassMesh.rotation.x = -Math.PI / 2;
    this.scene.add(this.grassMesh);

    // ブロックを置くための低い台
    const pedestalGeometry = new THREE.BoxGeometry(
      PEDESTAL_SIZE.x,
      PEDESTAL_SIZE.y,
      PEDESTAL_SIZE.z
    );
    const pedestalMaterial = new THREE.MeshStandardMaterial({
      color: 0xcac2ae,
    });
    this.pedestalMesh = new THREE.Mesh(pedestalGeometry, pedestalMaterial);
    this.pedestalMesh.position.set(0, PEDESTAL_SIZE.y / 2, 0);
    this.scene.add(this.pedestalMesh);

    // 左右に少しだけ揺れ動くパドル（見た目だけのブロック崩し風演出）
    const paddleGeometry = new THREE.BoxGeometry(
      PADDLE_SIZE.x,
      PADDLE_SIZE.y,
      PADDLE_SIZE.z
    );
    const paddleMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f6ff });
    this.paddleMesh = new THREE.Mesh(paddleGeometry, paddleMaterial);
    this.paddleMesh.position.set(0, PADDLE_POSITION_Y, PADDLE_POSITION_Z);
    this.scene.add(this.paddleMesh);
    this._paddleTime = 0;

    this.physicsWorld = new PhysicsWorld();
    this.material = this.physicsWorld.defaultMaterial;

    const floorBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: this.material,
    });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.physicsWorld.addBody(floorBody);

    const pedestalBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(
        new CANNON.Vec3(
          PEDESTAL_SIZE.x / 2,
          PEDESTAL_SIZE.y / 2,
          PEDESTAL_SIZE.z / 2
        )
      ),
      material: this.material,
    });
    pedestalBody.position.set(0, PEDESTAL_SIZE.y / 2, 0);
    this.physicsWorld.addBody(pedestalBody);

    this._brickTimer = SPAWN_INTERVAL_BRICK;
    this._ballTimer = SPAWN_INTERVAL_BALL * 0.5;

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  unmount() {
    window.removeEventListener('resize', this._onResize);
    this.bricks.forEach((item) => this._disposeItem(item));
    this.balls.forEach((item) => this._disposeItem(item));
    this.bricks = [];
    this.balls = [];
    this.paddleMesh.geometry.dispose();
    this.paddleMesh.material.dispose();
    this.pedestalMesh.geometry.dispose();
    this.pedestalMesh.material.dispose();
    this.grassMesh.geometry.dispose();
    this.grassMesh.material.dispose();
    this.canvas.style.display = 'none';
  }

  update(deltaSeconds) {
    this._paddleTime += deltaSeconds;
    this.paddleMesh.position.x =
      Math.sin(this._paddleTime * PADDLE_SPEED) * PADDLE_RANGE;

    this._brickTimer += deltaSeconds;
    this._ballTimer += deltaSeconds;

    if (
      this._brickTimer >= SPAWN_INTERVAL_BRICK &&
      this.bricks.length < MAX_BRICKS
    ) {
      this._brickTimer = 0;
      this._spawnBrick();
    }
    if (
      this._ballTimer >= SPAWN_INTERVAL_BALL &&
      this.balls.length < MAX_BALLS
    ) {
      this._ballTimer = 0;
      this._spawnBall();
    }

    this.physicsWorld.step(deltaSeconds);

    this.bricks.forEach((item) => this._syncMesh(item));
    this.balls.forEach((item) => this._syncMesh(item));

    const width = window.innerWidth;
    const height = window.innerHeight;
    this.bricks.forEach((item) => this._updateLabel(item, width, height));

    this._recycleOutOfBounds();

    this.renderer.render(this.scene, this.camera);
  }

  _spawnBrick() {
    const geometry = new THREE.BoxGeometry(
      BRICK_SIZE.x,
      BRICK_SIZE.y,
      BRICK_SIZE.z
    );
    const color =
      BRICK_COLORS[Math.floor(Math.random() * BRICK_COLORS.length)];
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color })
    );

    const body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Box(
        new CANNON.Vec3(BRICK_SIZE.x / 2, BRICK_SIZE.y / 2, BRICK_SIZE.z / 2)
      ),
      material: this.material,
    });
    body.position.set(
      randomRange(BRICK_SPAWN_X_RANGE[0], BRICK_SPAWN_X_RANGE[1]),
      randomRange(9, 13),
      randomRange(BRICK_SPAWN_Z_RANGE[0], BRICK_SPAWN_Z_RANGE[1])
    );
    body.angularVelocity.set(
      randomRange(-3, 3),
      randomRange(-3, 3),
      randomRange(-3, 3)
    );
    this.physicsWorld.addBody(body);
    this.scene.add(mesh);

    const label = document.createElement('div');
    label.className = 'brick-label';
    label.textContent =
      DUMMY_CHARS[Math.floor(Math.random() * DUMMY_CHARS.length)];
    this.overlayRoot.appendChild(label);

    this.bricks.push({ mesh, body, label });
  }

  _spawnBall() {
    const fromLeft = Math.random() < 0.5;
    const ball = new Ball(this.physicsWorld, this.material);
    const originX = fromLeft ? -BALL_SPAWN_X : BALL_SPAWN_X;
    ball.spawnAt(new THREE.Vector3(originX, randomRange(2, 5), randomRange(-2, 2)));

    const direction = new THREE.Vector3(
      fromLeft ? 1 : -1,
      randomRange(0.05, 0.2),
      randomRange(-0.15, 0.15)
    ).normalize();
    ball.launch(direction, randomRange(45, 70));

    this.scene.add(ball.mesh);
    this.balls.push(ball);
  }

  _syncMesh(item) {
    if (typeof item.syncMeshToBody === 'function') {
      item.syncMeshToBody();
    } else {
      item.mesh.position.copy(item.body.position);
      item.mesh.quaternion.copy(item.body.quaternion);
    }
  }

  // ブロック中央のダミー文字ラベルを、3D座標をスクリーン座標に投影して追従させる
  _updateLabel(item, width, height) {
    if (!item.label) return;
    const projected = item.mesh.position.clone().project(this.camera);
    const behindCamera = projected.z > 1;
    if (behindCamera) {
      item.label.style.display = 'none';
      return;
    }
    item.label.style.display = 'block';
    const x = (projected.x * 0.5 + 0.5) * width;
    const y = (-projected.y * 0.5 + 0.5) * height;
    item.label.style.left = `${x}px`;
    item.label.style.top = `${y}px`;
  }

  _recycleOutOfBounds() {
    this.bricks = this._filterOutOfBounds(this.bricks);
    this.balls = this._filterOutOfBounds(this.balls);
  }

  _filterOutOfBounds(items) {
    const survivors = [];
    items.forEach((item) => {
      const { x, y, z } = item.body.position;
      const outOfBounds =
        y < OUT_OF_BOUNDS_Y ||
        Math.abs(x) > OUT_OF_BOUNDS_XZ ||
        Math.abs(z) > OUT_OF_BOUNDS_XZ;
      if (outOfBounds) {
        this._disposeItem(item);
      } else {
        survivors.push(item);
      }
    });
    return survivors;
  }

  _disposeItem(item) {
    this.scene.remove(item.mesh);
    if (item.label) {
      item.label.remove();
    }
    if (typeof item.dispose === 'function') {
      item.dispose();
    } else {
      this.physicsWorld.removeBody(item.body);
      item.mesh.geometry.dispose();
      item.mesh.material.dispose();
    }
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
