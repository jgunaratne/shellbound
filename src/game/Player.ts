import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getTerrainHeight } from './Terrain';
import { colliders } from './Environment';
import type { InputManager } from './InputManager';
import turtleWalkUrl from '../assets/turtle_walking.glb';
import turtleRunUrl from '../assets/turtle_running.glb';
import turtleJumpUrl from '../assets/turtle_jump_run.glb';

const WALK_SPEED = 8;
const RUN_SPEED = 16;
const TURN_SPEED = 5;
const GRAVITY = 28;
const JUMP_VELOCITY = 12;
const PLAYER_RADIUS = 2.0;
const WATER_LEVEL = -1.9;
const WORLD_BOUNDS = 148;
const GROUND_SNAP_SPEED = 12;
const MODEL_SCALE = 2;

type MovementIntent = {
  moveX: number;
  moveZ: number;
  isMoving: boolean;
  isRunning: boolean;
  speed: number;
};

export class Player {
  readonly group: THREE.Group;
  facingAngle = 0;

  private mixer: THREE.AnimationMixer | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private runAction: THREE.AnimationAction | null = null;
  private jumpAction: THREE.AnimationAction | null = null;
  private isJumping = false;
  private verticalVelocity = 0;
  private groundY = 0;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.group.position.set(0, getTerrainHeight(0, 0), 0);
    scene.add(this.group);

    this.loadModel();
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  update(dt: number, input: InputManager, cameraYaw: number) {
    const movement = this.getMovementIntent(input, cameraYaw);

    this.startJumpIfNeeded(input);

    if (movement.isMoving) {
      this.moveHorizontally(movement, dt);
      this.updateFacing(movement, dt);
    }

    this.updateVerticalPosition(dt);
    this.updateAnimationState(dt, movement.isMoving, movement.isRunning);
  }

  private async loadModel() {
    try {
      const loader = new GLTFLoader();
      const [walkGltf, runGltf, jumpGltf] = await Promise.all([
        loader.loadAsync(turtleWalkUrl),
        loader.loadAsync(turtleRunUrl),
        loader.loadAsync(turtleJumpUrl),
      ]);

      const model = walkGltf.scene;
      this.prepareModel(model);
      model.scale.setScalar(MODEL_SCALE);
      this.group.add(model);

      this.mixer = new THREE.AnimationMixer(model);
      this.walkAction = this.createAction(walkGltf.animations[0]);
      this.runAction = this.createAction(runGltf.animations[0], { initialWeight: 0 });
      this.jumpAction = this.createAction(jumpGltf.animations[0], {
        initialWeight: 0,
        loopOnce: true,
      });

      console.log('Turtle loaded (walk + run + jump)');
    } catch (error) {
      console.error('Failed to load turtle model:', error);
    }
  }

  private prepareModel(model: THREE.Object3D) {
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.geometry.computeVertexNormals();

      if (mesh.material) {
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((material) => this.createLitMaterial(material))
          : this.createLitMaterial(mesh.material);
      }
    });
  }

  private createLitMaterial(material: THREE.Material): THREE.MeshStandardMaterial {
    const source = material as THREE.MeshStandardMaterial & {
      map?: THREE.Texture | null;
      color?: THREE.Color;
    };
    const litMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.7,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    if (source.map) {
      litMaterial.map = source.map;
    }

    if (source.color) {
      litMaterial.color.copy(source.color);
    }

    return litMaterial;
  }

  private createAction(
    clip: THREE.AnimationClip | undefined,
    options?: { initialWeight?: number; loopOnce?: boolean },
  ): THREE.AnimationAction | null {
    if (!clip || !this.mixer) {
      return null;
    }

    const action = this.mixer.clipAction(clip);
    if (options?.loopOnce) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }

    action.play();
    action.setEffectiveWeight(options?.initialWeight ?? 1);
    return action;
  }

  private getMovementIntent(input: InputManager, cameraYaw: number): MovementIntent {
    const forward = input.isDown('KeyW') || input.isDown('ArrowUp');
    const backward = input.isDown('KeyS') || input.isDown('ArrowDown');
    const left = input.isDown('KeyA') || input.isDown('ArrowLeft');
    const right = input.isDown('KeyD') || input.isDown('ArrowRight');

    let moveX = 0;
    let moveZ = 0;

    if (forward) {
      moveX -= Math.sin(cameraYaw);
      moveZ -= Math.cos(cameraYaw);
    }
    if (backward) {
      moveX += Math.sin(cameraYaw);
      moveZ += Math.cos(cameraYaw);
    }
    if (left) {
      moveX -= Math.cos(cameraYaw);
      moveZ += Math.sin(cameraYaw);
    }
    if (right) {
      moveX += Math.cos(cameraYaw);
      moveZ -= Math.sin(cameraYaw);
    }

    const isMoving = moveX !== 0 || moveZ !== 0;
    const isRunning = input.isRunning && forward;
    const speed = isRunning ? RUN_SPEED : WALK_SPEED;

    if (!isMoving) {
      return { moveX, moveZ, isMoving, isRunning, speed };
    }

    const length = Math.hypot(moveX, moveZ);
    return {
      moveX: moveX / length,
      moveZ: moveZ / length,
      isMoving,
      isRunning,
      speed,
    };
  }

  private startJumpIfNeeded(input: InputManager) {
    if (input.isDown('Space') && !this.isJumping) {
      this.isJumping = true;
      this.verticalVelocity = JUMP_VELOCITY;
    }
  }

  private moveHorizontally(movement: MovementIntent, dt: number) {
    const targetX = this.group.position.x + movement.moveX * movement.speed * dt;
    const targetZ = this.group.position.z + movement.moveZ * movement.speed * dt;

    this.applyTerrainConstrainedMovement(targetX, targetZ);
    this.resolveColliderOverlaps();
    this.clampToWorld();
  }

  private applyTerrainConstrainedMovement(nextX: number, nextZ: number) {
    if (this.isWalkable(nextX, nextZ)) {
      this.group.position.x = nextX;
      this.group.position.z = nextZ;
      return;
    }

    if (this.isWalkable(nextX, this.group.position.z)) {
      this.group.position.x = nextX;
    } else if (this.isWalkable(this.group.position.x, nextZ)) {
      this.group.position.z = nextZ;
    }
  }

  private isWalkable(x: number, z: number): boolean {
    return getTerrainHeight(x, z) > WATER_LEVEL;
  }

  private resolveColliderOverlaps() {
    for (const collider of colliders) {
      const dx = this.group.position.x - collider.x;
      const dz = this.group.position.z - collider.z;
      const distance = Math.hypot(dx, dz);
      const minDistance = PLAYER_RADIUS + collider.radius;

      if (distance >= minDistance || distance <= 0.0001) {
        continue;
      }

      const overlap = minDistance - distance;
      this.group.position.x += (dx / distance) * overlap;
      this.group.position.z += (dz / distance) * overlap;
    }
  }

  private clampToWorld() {
    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -WORLD_BOUNDS, WORLD_BOUNDS);
    this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -WORLD_BOUNDS, WORLD_BOUNDS);
  }

  private updateFacing(movement: MovementIntent, dt: number) {
    const targetAngle = Math.atan2(movement.moveX, movement.moveZ);
    this.facingAngle += this.getShortestAngleDelta(targetAngle, this.facingAngle) * TURN_SPEED * dt;
    this.group.rotation.y = this.facingAngle;
  }

  private getShortestAngleDelta(targetAngle: number, currentAngle: number): number {
    let delta = targetAngle - currentAngle;
    while (delta > Math.PI) {
      delta -= Math.PI * 2;
    }
    while (delta < -Math.PI) {
      delta += Math.PI * 2;
    }
    return delta;
  }

  private updateVerticalPosition(dt: number) {
    this.groundY = getTerrainHeight(this.group.position.x, this.group.position.z);

    if (this.isJumping) {
      this.verticalVelocity -= GRAVITY * dt;
      this.group.position.y += this.verticalVelocity * dt;

      if (this.group.position.y <= this.groundY) {
        this.group.position.y = this.groundY;
        this.isJumping = false;
        this.verticalVelocity = 0;
      }
      return;
    }

    this.group.position.y += (this.groundY - this.group.position.y) * GROUND_SNAP_SPEED * dt;
  }

  private updateAnimationState(dt: number, isMoving: boolean, isRunning: boolean) {
    if (this.walkAction && this.runAction && this.jumpAction) {
      if (this.isJumping) {
        this.jumpAction.setEffectiveWeight(1);
        this.walkAction.setEffectiveWeight(0);
        this.runAction.setEffectiveWeight(0);

        if (this.jumpAction.time === 0 || !this.jumpAction.isRunning()) {
          this.jumpAction.reset();
          this.jumpAction.play();
        }
      } else if (isRunning) {
        this.jumpAction.setEffectiveWeight(0);
        this.walkAction.setEffectiveWeight(0);
        this.runAction.setEffectiveWeight(1);
      } else {
        this.jumpAction.setEffectiveWeight(0);
        this.walkAction.setEffectiveWeight(1);
        this.runAction.setEffectiveWeight(0);
      }
    }

    if (this.mixer) {
      this.mixer.timeScale = isMoving || this.isJumping ? 1 : 0;
      this.mixer.update(dt);
    }
  }
}
