import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getTerrainHeight } from './terrain';
import { colliders } from './environment';
import type { InputManager } from './InputManager';
import turtleWalkUrl from '../assets/turtle_walking.glb';
import turtleRunUrl from '../assets/turtle_running.glb';

const WALK_SPEED = 8;
const RUN_SPEED = 16;
const TURN_SPEED = 5;
const GRAVITY_SNAP = 12; // how fast player snaps to terrain height
const PLAYER_RADIUS = 2.0; // Increased footprint to prevent any clipping through rocks and trees

export class Player {
  readonly group: THREE.Group;
  private mixer: THREE.AnimationMixer | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private runAction: THREE.AnimationAction | null = null;
  private wasRunning = false;

  // Facing angle in world-space (radians, Y axis)
  facingAngle = 0;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.group.position.set(0, getTerrainHeight(0, 0), 0);
    scene.add(this.group);

    this.loadModel();
  }

  private async loadModel() {
    try {
      const loader = new GLTFLoader();
      const [walkGltf, runGltf] = await Promise.all([
        loader.loadAsync(turtleWalkUrl),
        loader.loadAsync(turtleRunUrl),
      ]);
      const model = walkGltf.scene;

      // Enable shadows and fix materials so they react beautifully to the scene lighting
      model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          
          // Force absolute standard lighting by completely overriding any unlit/custom GLTF materials
          mesh.geometry.computeVertexNormals();

          if (mesh.material) {
            const overrideMaterial = (oldMat: any) => {
              const newMat = new THREE.MeshStandardMaterial({
                roughness: 0.7,
                metalness: 0.1,
                side: THREE.DoubleSide, // fixes any inverted normals/backfaces
              });

              // Safely copy over the original colors and textures if they exist
              if (oldMat.map) newMat.map = oldMat.map;
              if (oldMat.color) newMat.color.copy(oldMat.color);
              
              return newMat;
            };

            if (Array.isArray(mesh.material)) {
              mesh.material = mesh.material.map(overrideMaterial);
            } else {
              mesh.material = overrideMaterial(mesh.material);
            }
          }
        }
      });

      // Make the turtle character larger
      model.scale.setScalar(2);

      // Add model directly
      this.group.add(model);

      // Set up animation mixer on the walk model and register both walk + run clips
      this.mixer = new THREE.AnimationMixer(model);

      if (walkGltf.animations.length > 0) {
        this.walkAction = this.mixer.clipAction(walkGltf.animations[0]);
        this.walkAction.play();
      }

      if (runGltf.animations.length > 0) {
        // Use the run clip from the run GLTF but target the walk model's skeleton
        this.runAction = this.mixer.clipAction(runGltf.animations[0]);
        this.runAction.play();
        this.runAction.setEffectiveWeight(0); // start silent
      }

      console.log('Turtle loaded (walk + run)');
    } catch (err) {
      console.error('Failed to load turtle model:', err);
    }
  }

  update(dt: number, input: InputManager, cameraYaw: number) {
    const fwd = input.isDown('KeyW') || input.isDown('ArrowUp');
    const back = input.isDown('KeyS') || input.isDown('ArrowDown');
    const left = input.isDown('KeyA') || input.isDown('ArrowLeft');
    const right = input.isDown('KeyD') || input.isDown('ArrowRight');

    const isRunning = input.isRunning && fwd;
    const speed = isRunning ? RUN_SPEED : WALK_SPEED;

    let moveX = 0;
    let moveZ = 0;

    if (fwd) { moveX -= Math.sin(cameraYaw); moveZ -= Math.cos(cameraYaw); }
    if (back) { moveX += Math.sin(cameraYaw); moveZ += Math.cos(cameraYaw); }
    if (left) { moveX -= Math.cos(cameraYaw); moveZ += Math.sin(cameraYaw); }
    if (right) { moveX += Math.cos(cameraYaw); moveZ -= Math.sin(cameraYaw); }

    const isMoving = moveX !== 0 || moveZ !== 0;

    if (isMoving) {
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      moveX /= len;
      moveZ /= len;

      const nextX = this.group.position.x + moveX * speed * dt;
      const nextZ = this.group.position.z + moveZ * speed * dt;

      // Strict, impenetrable shoreline block: completely prevent walking into the lake (water level -2.0)
      if (getTerrainHeight(nextX, nextZ) > -1.9) {
        this.group.position.x = nextX;
        this.group.position.z = nextZ;
      } else {
        // Retain previous position strictly if moving directly into water
        if (getTerrainHeight(nextX, this.group.position.z) > -1.9) {
          this.group.position.x = nextX;
        } else if (getTerrainHeight(this.group.position.x, nextZ) > -1.9) {
          this.group.position.z = nextZ;
        }
      }

      // Enforce physical object boundaries (Circle-Circle collision resolution)
      for (const c of colliders) {
        const dx = this.group.position.x - c.x;
        const dz = this.group.position.z - c.z;
        const distSq = dx * dx + dz * dz;
        const minDistance = PLAYER_RADIUS + c.radius;

        if (distSq < minDistance * minDistance) {
          const dist = Math.sqrt(distSq);
          if (dist > 0.0001) {
            // Push player smoothly out along the normal vector
            const overlap = minDistance - dist;
            this.group.position.x += (dx / dist) * overlap;
            this.group.position.z += (dz / dist) * overlap;
          }
        }
      }

      // Clamp to terrain bounds
      this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -148, 148);
      this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -148, 148);

      // Smooth facing towards movement direction
      const targetAngle = Math.atan2(moveX, moveZ);
      let diff = targetAngle - this.facingAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facingAngle += diff * TURN_SPEED * dt;
      this.group.rotation.y = this.facingAngle;
    }

    // Snap to terrain height with smooth lerp
    const targetY = getTerrainHeight(this.group.position.x, this.group.position.z);
    this.group.position.y += (targetY - this.group.position.y) * GRAVITY_SNAP * dt;

    // Crossfade between walk and run animations
    if (this.walkAction && this.runAction) {
      if (isRunning && !this.wasRunning) {
        this.runAction.setEffectiveWeight(1);
        this.walkAction.setEffectiveWeight(0);
      } else if (!isRunning && this.wasRunning) {
        this.walkAction.setEffectiveWeight(1);
        this.runAction.setEffectiveWeight(0);
      }
      this.wasRunning = isRunning;
    }

    // Update animation — play when moving, pause when idle
    if (this.mixer) {
      this.mixer.timeScale = isMoving ? 1 : 0;
      this.mixer.update(dt);
    }
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }
}
