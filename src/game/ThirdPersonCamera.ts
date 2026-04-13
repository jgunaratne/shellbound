import * as THREE from 'three';
import type { InputManager } from './InputManager';

const DISTANCE = 7;
const HEIGHT_OFFSET = 3;
const PITCH_MIN = -0.1;
const PITCH_MAX = 0.9;
const MOUSE_SENSITIVITY = 0.003;
const LERP_SPEED = 8;

export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI; // start behind player
  pitch = 0.35;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 800);
  }

  update(dt: number, target: THREE.Vector3, input: InputManager) {
    const mouse = input.consumeMouseDelta();
    this.yaw   -= mouse.x * MOUSE_SENSITIVITY;
    this.pitch -= mouse.y * MOUSE_SENSITIVITY;
    this.pitch  = THREE.MathUtils.clamp(this.pitch, PITCH_MIN, PITCH_MAX);

    // Desired position behind and above player
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch) * DISTANCE,
      Math.sin(this.pitch) * DISTANCE + HEIGHT_OFFSET,
      Math.cos(this.yaw) * Math.cos(this.pitch) * DISTANCE,
    );

    const desiredPos = target.clone().add(offset);
    this.camera.position.lerp(desiredPos, LERP_SPEED * dt);

    const lookAt = target.clone().add(new THREE.Vector3(0, 1.0, 0));
    this.camera.lookAt(lookAt);
  }

  get cameraYaw(): number {
    return this.yaw;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
