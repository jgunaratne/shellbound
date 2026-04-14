import * as THREE from 'three';
import type { InputManager } from './InputManager';
import { getTerrainHeight } from './Terrain';

const DISTANCE = 7;
const HEIGHT_OFFSET = 2.0;
const PITCH_MIN = -0.4;
const PITCH_MAX = 0.9;
const MOUSE_SENSITIVITY = 0.003;
const LERP_SPEED = 8;

export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI; // start behind player
  pitch = 0.1;
  private readonly offset = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly lookAtTarget = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 800);
  }

  update(dt: number, target: THREE.Vector3, input: InputManager) {
    const mouse = input.consumeMouseDelta();
    this.yaw   -= mouse.x * MOUSE_SENSITIVITY;
    this.pitch -= mouse.y * MOUSE_SENSITIVITY;
    this.pitch  = THREE.MathUtils.clamp(this.pitch, PITCH_MIN, PITCH_MAX);

    // Desired position behind and above player
    this.offset.set(
      Math.sin(this.yaw) * Math.cos(this.pitch) * DISTANCE,
      Math.sin(this.pitch) * DISTANCE + HEIGHT_OFFSET,
      Math.cos(this.yaw) * Math.cos(this.pitch) * DISTANCE,
    );

    this.desiredPos.copy(target).add(this.offset);
    
    // Keep desired position above terrain
    const terrainYAtDesired = getTerrainHeight(this.desiredPos.x, this.desiredPos.z);
    if (this.desiredPos.y < terrainYAtDesired + 0.5) {
      this.desiredPos.y = terrainYAtDesired + 0.5;
    }

    this.camera.position.lerp(this.desiredPos, LERP_SPEED * dt);

    // Enforce immediate clamp on final lerped position
    const actualTerrainY = getTerrainHeight(this.camera.position.x, this.camera.position.z);
    if (this.camera.position.y < actualTerrainY + 0.5) {
      this.camera.position.y = actualTerrainY + 0.5;
    }

    this.lookAtTarget.copy(target);
    this.lookAtTarget.y += 1.0;
    this.camera.lookAt(this.lookAtTarget);
  }

  get cameraYaw(): number {
    return this.yaw;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
