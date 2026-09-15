import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Ball } from './Ball.js';
import { randomRange } from '../utils/helpers.js';

const ENVELOPE_SIZE = new THREE.Vector3(1.3, 0.8, 0.9);
// レトロブロック崩し風のカラフルな配色
const ENVELOPE_COLORS = [
  0xff5a5a, 0xffb23f, 0xffe14d, 0x4ade80, 0x4ecdc4, 0x4b8bff, 0xc084fc,
];
const SPAWN_INTERVAL_ENVELOPE = 0.8;
const SPAWN_INTERVAL_BALL = 2.2;
const MAX_ENVELOPES = 16;
const MAX_BALLS = 5;
const OUT_OF_BOUNDS_Y = -4;
const BALL_SPAWN_X = 10;
const OUT_OF_BOUNDS_XZ = BALL_SPAWN_X + 3;

const PADDLE_SIZE = new THREE.Vector3(2.6, 0.4, 0.6);
const PADDLE_POSITION_Y = 0.5;
const PADDLE_POSITION_Z = 5.5;
const PADDLE_RANGE = 3.5;
const PADDLE_SPEED = 0.7; // 往復の速さ（ラジアン/秒相当）

// タイトル画面の背景で、鉄球がメール封筒の山へ延々と飛び込み続けるアトラクトモード演出
export class TitleBackground {
  constructor(canvas, renderer) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.envelopes = [];
    this.balls = [];
  }

  mount() {
    this.canvas.style.display = 'block';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c18);
    this.scene.fog = new THREE.Fog(0x0a0c18, 14, 30);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 7, 14);
    this.camera.lookAt(0, 1, 0);

    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.9);
    directional.position.set(5, 10, 6);
    this.scene.add(directional);

    const floorGeometry = new THREE.PlaneGeometry(30, 24);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x14172a });
    this.floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.scene.add(this.floorMesh);

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

    this._envelopeTimer = SPAWN_INTERVAL_ENVELOPE;
    this._ballTimer = SPAWN_INTERVAL_BALL * 0.5;

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  unmount() {
    window.removeEventListener('resize', this._onResize);
    this.envelopes.forEach((item) => this._disposeItem(item));
    this.balls.forEach((item) => this._disposeItem(item));
    this.envelopes = [];
    this.balls = [];
    this.paddleMesh.geometry.dispose();
    this.paddleMesh.material.dispose();
    this.canvas.style.display = 'none';
  }

  update(deltaSeconds) {
    this._paddleTime += deltaSeconds;
    this.paddleMesh.position.x =
      Math.sin(this._paddleTime * PADDLE_SPEED) * PADDLE_RANGE;

    this._envelopeTimer += deltaSeconds;
    this._ballTimer += deltaSeconds;

    if (
      this._envelopeTimer >= SPAWN_INTERVAL_ENVELOPE &&
      this.envelopes.length < MAX_ENVELOPES
    ) {
      this._envelopeTimer = 0;
      this._spawnEnvelope();
    }
    if (
      this._ballTimer >= SPAWN_INTERVAL_BALL &&
      this.balls.length < MAX_BALLS
    ) {
      this._ballTimer = 0;
      this._spawnBall();
    }

    this.physicsWorld.step(deltaSeconds);

    this.envelopes.forEach((item) => this._syncMesh(item));
    this.balls.forEach((item) => this._syncMesh(item));

    this._recycleOutOfBounds();

    this.renderer.render(this.scene, this.camera);
  }

  _spawnEnvelope() {
    const geometry = new THREE.BoxGeometry(
      ENVELOPE_SIZE.x,
      ENVELOPE_SIZE.y,
      ENVELOPE_SIZE.z
    );
    const color =
      ENVELOPE_COLORS[Math.floor(Math.random() * ENVELOPE_COLORS.length)];
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color })
    );

    const body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Box(
        new CANNON.Vec3(
          ENVELOPE_SIZE.x / 2,
          ENVELOPE_SIZE.y / 2,
          ENVELOPE_SIZE.z / 2
        )
      ),
      material: this.material,
    });
    body.position.set(randomRange(-4, 4), randomRange(9, 13), randomRange(-2, 2));
    body.angularVelocity.set(
      randomRange(-3, 3),
      randomRange(-3, 3),
      randomRange(-3, 3)
    );
    this.physicsWorld.addBody(body);
    this.scene.add(mesh);

    this.envelopes.push({ mesh, body });
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

  _recycleOutOfBounds() {
    this.envelopes = this._filterOutOfBounds(this.envelopes);
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
