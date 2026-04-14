import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { getTerrainHeight } from './terrain';
import { colliders } from './environment';
import turtleWalkUrl from '../assets/turtle_walking.glb';

/* ── Constants ──────────────────────────────────────────────────────── */

const NPC_WALK_SPEED = 3.5;
const NPC_TURN_SPEED = 3;
const NPC_COUNT = 7;
const TERRAIN_HALF = 130; // stay well inside the 150-unit terrain bounds
const WATER_LEVEL = -1.9;
const IDLE_TIME_MIN = 2;
const IDLE_TIME_MAX = 5;
const WANDER_RADIUS = 30; // how far a wander target can be from current pos
const NPC_RADIUS = 1.5;

/* ── Seeded RNG (deterministic placement) ───────────────────────────── */

function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/* ── State machine ──────────────────────────────────────────────────── */

type NPCState = 'idle' | 'wander';

/* ── Single NPC ─────────────────────────────────────────────────────── */

class SingleNPC {
  readonly group: THREE.Group;
  private mixer: THREE.AnimationMixer | null = null;
  private facingAngle: number;
  private state: NPCState = 'idle';
  private stateTimer = 0;
  private targetX = 0;
  private targetZ = 0;
  private rand: () => number;
  private collider: { x: number; z: number; radius: number };

  constructor(
    model: THREE.Group,
    clip: THREE.AnimationClip,
    x: number,
    z: number,
    seed: number,
  ) {
    this.rand = seededRng(seed);
    this.facingAngle = this.rand() * Math.PI * 2;

    this.group = new THREE.Group();
    const clone = SkeletonUtils.clone(model) as THREE.Group;
    clone.scale.setScalar(2);

    // Enable shadows on the clone
    clone.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    this.group.add(clone);
    this.group.position.set(x, getTerrainHeight(x, z), z);
    this.group.rotation.y = this.facingAngle;

    // Register a dynamic collider so the player can't walk through this NPC
    this.collider = { x, z, radius: NPC_RADIUS };
    colliders.push(this.collider);

    // Set up animation mixer on the cloned model
    this.mixer = new THREE.AnimationMixer(clone);
    const action = this.mixer.clipAction(clip);
    action.play();

    // Start idle for a random duration
    this.stateTimer = IDLE_TIME_MIN + this.rand() * (IDLE_TIME_MAX - IDLE_TIME_MIN);
  }

  update(dt: number) {
    this.stateTimer -= dt;

    if (this.state === 'idle') {
      // Pause animation while idle
      if (this.mixer) this.mixer.timeScale = 0;

      if (this.stateTimer <= 0) {
        // Pick a new wander target
        this.pickWanderTarget();
        this.state = 'wander';
      }
    } else {
      // Wander toward target
      if (this.mixer) this.mixer.timeScale = 1;

      const dx = this.targetX - this.group.position.x;
      const dz = this.targetZ - this.group.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 1.5 || this.stateTimer <= 0) {
        // Arrived or timed out → go idle
        this.state = 'idle';
        this.stateTimer = IDLE_TIME_MIN + this.rand() * (IDLE_TIME_MAX - IDLE_TIME_MIN);
      } else {
        // Turn toward target
        const targetAngle = Math.atan2(dx, dz);
        let diff = targetAngle - this.facingAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.facingAngle += diff * NPC_TURN_SPEED * dt;
        this.group.rotation.y = this.facingAngle;

        // Move forward
        const moveX = Math.sin(this.facingAngle) * NPC_WALK_SPEED * dt;
        const moveZ = Math.cos(this.facingAngle) * NPC_WALK_SPEED * dt;
        const nextX = this.group.position.x + moveX;
        const nextZ = this.group.position.z + moveZ;

        // Only move if destination is on dry land
        if (getTerrainHeight(nextX, nextZ) > WATER_LEVEL) {
          this.group.position.x = nextX;
          this.group.position.z = nextZ;
        } else {
          // Hit water — stop and pick a new target next frame
          this.state = 'idle';
          this.stateTimer = 0.5;
        }

        // Avoid colliders (rocks, trees) — skip our own collider
        for (const c of colliders) {
          if (c === this.collider) continue;
          const cdx = this.group.position.x - c.x;
          const cdz = this.group.position.z - c.z;
          const distSq = cdx * cdx + cdz * cdz;
          const minDist = NPC_RADIUS + c.radius;
          if (distSq < minDist * minDist) {
            const d = Math.sqrt(distSq);
            if (d > 0.0001) {
              const overlap = minDist - d;
              this.group.position.x += (cdx / d) * overlap;
              this.group.position.z += (cdz / d) * overlap;
            }
          }
        }

        // Clamp to terrain bounds
        this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -TERRAIN_HALF, TERRAIN_HALF);
        this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -TERRAIN_HALF, TERRAIN_HALF);
      }
    }

    // Snap to terrain height
    const terrainY = getTerrainHeight(this.group.position.x, this.group.position.z);
    this.group.position.y += (terrainY - this.group.position.y) * 12 * dt;

    // Sync dynamic collider position so the player bounces off us
    this.collider.x = this.group.position.x;
    this.collider.z = this.group.position.z;

    // Advance animation
    if (this.mixer) this.mixer.update(dt);
  }

  private pickWanderTarget() {
    // Try up to 10 random points; accept the first one on dry land
    for (let attempt = 0; attempt < 10; attempt++) {
      const angle = this.rand() * Math.PI * 2;
      const radius = 5 + this.rand() * WANDER_RADIUS;
      const tx = this.group.position.x + Math.cos(angle) * radius;
      const tz = this.group.position.z + Math.sin(angle) * radius;

      // Must be on dry terrain and within bounds
      if (
        Math.abs(tx) < TERRAIN_HALF &&
        Math.abs(tz) < TERRAIN_HALF &&
        getTerrainHeight(tx, tz) > WATER_LEVEL
      ) {
        this.targetX = tx;
        this.targetZ = tz;
        this.stateTimer = 8 + this.rand() * 6; // max wander time before forcing idle
        return;
      }
    }

    // Fallback: wander toward center
    this.targetX = (this.rand() - 0.5) * 60;
    this.targetZ = (this.rand() - 0.5) * 60;
    this.stateTimer = 10;
  }
}

/* ── NPC Manager ────────────────────────────────────────────────────── */

export class NPCTurtleManager {
  private npcs: SingleNPC[] = [];
  private loaded = false;

  constructor(private scene: THREE.Scene) {
    this.load();
  }

  private async load() {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(turtleWalkUrl);
      const baseModel = gltf.scene;

      // Fix materials to match the player's look
      baseModel.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.computeVertexNormals();
          if (mesh.material) {
            const override = (oldMat: any) => {
              const newMat = new THREE.MeshStandardMaterial({
                roughness: 0.7,
                metalness: 0.1,
                side: THREE.DoubleSide,
              });
              if (oldMat.map) newMat.map = oldMat.map;
              if (oldMat.color) newMat.color.copy(oldMat.color);
              return newMat;
            };
            if (Array.isArray(mesh.material)) {
              mesh.material = mesh.material.map(override);
            } else {
              mesh.material = override(mesh.material);
            }
          }
        }
      });

      const clip = gltf.animations[0];
      if (!clip) {
        console.warn('NPC turtle: no walk animation clip found');
        return;
      }

      // Deterministic spawn positions using a seeded RNG
      const rand = seededRng(999);
      for (let i = 0; i < NPC_COUNT; i++) {
        // Find a valid spawn point on dry land, away from the player spawn and lake
        let x: number, z: number;
        let attempts = 0;
        do {
          x = (rand() - 0.5) * TERRAIN_HALF * 2;
          z = (rand() - 0.5) * TERRAIN_HALF * 2;
          attempts++;
        } while (
          attempts < 50 &&
          (
            getTerrainHeight(x, z) < WATER_LEVEL + 1 || // well above water
            Math.sqrt(x * x + z * z) < 30              // away from player spawn
          )
        );

        const npc = new SingleNPC(baseModel, clip, x, z, 7000 + i * 131);
        this.npcs.push(npc);
        this.scene.add(npc.group);
      }

      this.loaded = true;
      console.log(`${NPC_COUNT} NPC turtles spawned and roaming`);
    } catch (err) {
      console.error('Failed to load NPC turtle:', err);
    }
  }

  update(dt: number) {
    if (!this.loaded) return;
    for (const npc of this.npcs) {
      npc.update(dt);
    }
  }
}
