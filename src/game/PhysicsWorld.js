import * as CANNON from 'cannon-es';

// cannon-esのワールド生成と毎フレームのstepをまとめるラッパー
export class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;

    this.defaultMaterial = new CANNON.Material('default');
    const contactMaterial = new CANNON.ContactMaterial(
      this.defaultMaterial,
      this.defaultMaterial,
      { friction: 0.4, restitution: 0.3 }
    );
    this.world.addContactMaterial(contactMaterial);
    this.world.defaultContactMaterial = contactMaterial;
  }

  addBody(body) {
    this.world.addBody(body);
  }

  removeBody(body) {
    this.world.removeBody(body);
  }

  step(deltaSeconds) {
    // 固定タイムステップで安定させる（最大タイムステップを制限してスパイラル・オブ・デスを防ぐ）
    this.world.step(1 / 60, deltaSeconds, 3);
  }
}
