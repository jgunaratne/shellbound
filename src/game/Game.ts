import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { InputManager } from './InputManager';
import { Player } from './Player';
import { ThirdPersonCamera } from './ThirdPersonCamera';
import { createTerrain, createWater, getTerrainHeight, waterMaterial, lakeMaterial } from './Terrain';
import { populateEnvironment } from './Environment';
import { InstancedGrass } from './InstancedGrass';
import { NPCTurtleManager } from './NpcTurtle';
import { Minimap } from './Minimap';
import { CAVE_BOUNDS, CAVE_SPAWN, createCaveScene } from './Cave';
import skyUrl from '../assets/sky.png';
import skyAfternoonUrl from '../assets/sky_afternoon.png';
import skyNightUrl from '../assets/sky_night.png';

type PresetId = '1' | '2' | '3';
type WorldMode = 'outdoor' | 'cave';

type PresetDefinition = {
  sun: { color: number; intensity: number; position: [number, number, number] };
  ambient: { color: number; intensity: number };
  fill: { color: number; intensity: number };
  fogColor: number;
  skyCapColor: number;
  exposure: number;
  skyUrl: string;
  water: {
    baseColor: [number, number, number];
    highlightColor: [number, number, number];
  };
};

type QualityTier = 0 | 1 | 2;

const FOG_COLOR = 0xc9d8f0;
const SHADOW_WORLD_HALF = 150;
const SKY_TEXTURE_SIZE = { width: 1024, height: 512 };
const SKY_EDGE_BLEND = 0.35;
const SKY_TEXTURE_REPEAT_X = 3;
const SKY_RADIUS = 350;
const SKY_HEIGHT = 800;
const GRASS_INSTANCE_COUNT = 50000;
const MAX_RENDER_PIXEL_RATIO = 1.75;
const TARGET_FRAME_TIME_MS = 1000 / 60;
const LOW_FPS_FRAME_TIME_MS = 1000 / 50;
const RECOVERY_FRAME_TIME_MS = 1000 / 57;
const DEGRADE_HOLD_MS = 4000;
const RECOVERY_HOLD_MS = 8000;
const OUTDOOR_WORLD_BOUNDS = 148;

const QUALITY_PROFILES: Record<
  QualityTier,
  { composerScale: number; ssaoEnabled: boolean; ssaoKernelRadius: number; ssaoMaxDistance: number }
> = {
  0: { composerScale: 1, ssaoEnabled: true, ssaoKernelRadius: 12, ssaoMaxDistance: 0.1 },
  1: { composerScale: 0.92, ssaoEnabled: true, ssaoKernelRadius: 10, ssaoMaxDistance: 0.085 },
  2: { composerScale: 0.85, ssaoEnabled: true, ssaoKernelRadius: 8, ssaoMaxDistance: 0.07 },
};

const PRESETS: Record<PresetId, PresetDefinition> = {
  '1': {
    sun: { color: 0xfff5e0, intensity: 2.8, position: [100, 150, 50] },
    ambient: { color: 0xc9d8f0, intensity: 1.0 },
    fill: { color: 0xc9d8f0, intensity: 1.2 },
    fogColor: 0xc9d8f0,
    skyCapColor: 0xc9d8f0,
    exposure: 1.4,
    skyUrl,
    water: {
      baseColor: [0.01, 0.04, 0.12],
      highlightColor: [0.05, 0.15, 0.3],
    },
  },
  '2': {
    sun: { color: 0xffb347, intensity: 2.6, position: [80, 40, 80] },
    ambient: { color: 0x9a8ab0, intensity: 1.0 },
    fill: { color: 0x6a7aaa, intensity: 1.2 },
    fogColor: 0xd4a574,
    skyCapColor: 0xc49060,
    exposure: 1.35,
    skyUrl: skyAfternoonUrl,
    water: {
      baseColor: [0.01, 0.03, 0.08],
      highlightColor: [0.03, 0.06, 0.15],
    },
  },
  '3': {
    sun: { color: 0xb0d5f8, intensity: 1.5, position: [-50, 150, -50] },
    ambient: { color: 0x2d3d55, intensity: 0.85 },
    fill: { color: 0x354a65, intensity: 0.6 },
    fogColor: 0x1b283c,
    skyCapColor: 0x10192b,
    exposure: 1.32,
    skyUrl: skyNightUrl,
    water: {
      baseColor: [0.008, 0.015, 0.04],
      highlightColor: [0.02, 0.05, 0.12],
    },
  },
};

export class Game {
  private readonly outdoorScene: THREE.Scene;
  private readonly caveScene: THREE.Scene;
  private activeScene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly input: InputManager;
  private readonly player: Player;
  private readonly grass: InstancedGrass;
  private readonly npcTurtles: NPCTurtleManager;
  private readonly minimap: Minimap;
  private readonly tpCamera: ThirdPersonCamera;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private ssaoPass: SSAOPass;
  private bokehPass: BokehPass;
  private readonly outdoorWorld: THREE.Group;
  private readonly caveWorld: THREE.Group;
  private readonly outdoorSun: THREE.DirectionalLight;
  private readonly outdoorAmbientLight: THREE.AmbientLight;
  private readonly outdoorFillLight: THREE.DirectionalLight;
  private currentPreset: PresetId = '1';
  private targetPreset: PresetId = '1';
  private worldMode: WorldMode = 'outdoor';
  private qualityTier: QualityTier = 0;
  private basePixelRatio = 1;
  private smoothedFrameTimeMs = TARGET_FRAME_TIME_MS;
  private lowPerfElapsedMs = 0;
  private recoveryElapsedMs = 0;
  private skydome: THREE.Group | null = null;
  private skyMaterialA: THREE.MeshBasicMaterial | null = null;
  private skyMaterialB: THREE.MeshBasicMaterial | null = null;
  private activeSkyLayer: 0 | 1 = 0;
  private skyCapMaterial: THREE.MeshBasicMaterial | null = null;
  private animId = 0;
  private lastTime = 0;

  public onMangoCollected?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = this.createRenderer(canvas);
    this.outdoorScene = this.createScene(FOG_COLOR);
    this.caveScene = this.createScene(0x3a3027, 0.01);
    this.activeScene = this.outdoorScene;
    this.outdoorWorld = new THREE.Group();
    this.outdoorWorld.name = 'outdoor_world';
    this.outdoorScene.add(this.outdoorWorld);
    this.caveWorld = createCaveScene(CAVE_SPAWN.y);
    this.caveScene.add(this.caveWorld);
    this.createSkydome(PRESETS[this.currentPreset].skyUrl);

    const outdoorLighting = this.createOutdoorLighting();
    this.outdoorSun = outdoorLighting.sun;
    this.outdoorAmbientLight = outdoorLighting.ambientLight;
    this.outdoorFillLight = outdoorLighting.fillLight;

    this.createCaveLighting();

    this.initializeOutdoorWorld();
    this.grass = new InstancedGrass(GRASS_INSTANCE_COUNT);
    this.outdoorScene.add(this.grass.mesh);

    this.player = new Player(this.outdoorScene);
    this.player.onMangoCollected = () => {
      if (this.onMangoCollected) {
        this.onMangoCollected();
      }
    };
    this.player.setMovementBounds({
      minX: -148,
      maxX: 148,
      minZ: -148,
      maxZ: 148,
    });
    this.npcTurtles = new NPCTurtleManager(this.outdoorScene);
    this.minimap = new Minimap();
    this.tpCamera = new ThirdPersonCamera();
    this.player.setGroundingResolvers(
      this.getOutdoorGroundHeight,
      this.isOutdoorWalkable,
    );
    this.tpCamera.setGroundHeightResolver(this.getOutdoorGroundHeight);
    this.input = new InputManager(canvas);

    // Apply initial preset instantly
    this.applyPreset(this.currentPreset, true);

    const postProcessing = this.createPostProcessing();
    this.composer = postProcessing.composer;
    this.renderPass = postProcessing.renderPass;
    this.ssaoPass = postProcessing.ssaoPass;
    this.bokehPass = postProcessing.bokehPass;
    this.applyQualityProfile();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
  }

  private isDisposed = false;

  start() {
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  dispose() {
    this.isDisposed = true;
    cancelAnimationFrame(this.animId);
    this.input.dispose();
    this.minimap.dispose();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    this.bokehPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  private createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.basePixelRatio = Math.min(window.devicePixelRatio, MAX_RENDER_PIXEL_RATIO);
    renderer.setPixelRatio(this.basePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = PRESETS[this.currentPreset].exposure;
    return renderer;
  }

  private createScene(backgroundColor: number, fogDensity = 0.0025): THREE.Scene {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(backgroundColor, fogDensity);
    scene.background = new THREE.Color(backgroundColor);
    return scene;
  }

  private createOutdoorLighting() {
    const ambientLight = new THREE.AmbientLight(FOG_COLOR, 1.0);
    this.outdoorScene.add(ambientLight);

    const sun = new THREE.DirectionalLight(0xfff5e0, 2.8);
    sun.position.set(100, 150, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -SHADOW_WORLD_HALF;
    sun.shadow.camera.right = SHADOW_WORLD_HALF;
    sun.shadow.camera.top = SHADOW_WORLD_HALF;
    sun.shadow.camera.bottom = -SHADOW_WORLD_HALF;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 500;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    sun.shadow.camera.updateProjectionMatrix();
    this.outdoorScene.add(sun);

    const fillLight = new THREE.DirectionalLight(FOG_COLOR, 1.2);
    fillLight.position.set(-100, 50, -50);
    this.outdoorScene.add(fillLight);

    return { sun, ambientLight, fillLight };
  }

  private createCaveLighting() {
    const ambientLight = new THREE.AmbientLight(0x9a8b74, 1.9);
    this.caveScene.add(ambientLight);

    const caveLight = new THREE.PointLight(0xffb066, 8.5, 40, 2);
    caveLight.position.set(-3, CAVE_SPAWN.y + 3.8, -3);
    caveLight.castShadow = true;
    caveLight.shadow.mapSize.set(1024, 1024);
    this.caveScene.add(caveLight);

    const caveFillLight = new THREE.PointLight(0x7ea6ff, 3.4, 36, 2);
    caveFillLight.position.set(6, CAVE_SPAWN.y + 4.5, 6);
    this.caveScene.add(caveFillLight);

    return { ambientLight, caveLight, caveFillLight };
  }

  private initializeOutdoorWorld() {
    createTerrain(this.outdoorWorld);
    createWater(this.outdoorWorld);
    populateEnvironment(this.outdoorWorld);
  }

  private createPostProcessing() {
    const composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.activeScene, this.tpCamera.camera);
    composer.addPass(renderPass);

    const ssaoPass = new SSAOPass(
      this.activeScene,
      this.tpCamera.camera,
      window.innerWidth,
      window.innerHeight,
    );
    ssaoPass.kernelRadius = 12;
    ssaoPass.minDistance = 0.0025;
    ssaoPass.maxDistance = 0.1;
    composer.addPass(ssaoPass);

    const bokehPass = new BokehPass(this.activeScene, this.tpCamera.camera, {
      focus: 7.0,
      aperture: 0.0001,
      maxblur: 0.004,
    });
    composer.addPass(bokehPass);
    composer.addPass(new OutputPass());

    return { composer, renderPass, bokehPass, ssaoPass };
  }

  private applyQualityProfile() {
    const profile = QUALITY_PROFILES[this.qualityTier];
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.composer.setPixelRatio(this.basePixelRatio * profile.composerScale);
    this.ssaoPass.enabled = profile.ssaoEnabled;
    this.ssaoPass.kernelRadius = profile.ssaoKernelRadius;
    this.ssaoPass.maxDistance = profile.ssaoMaxDistance;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  private updateAdaptiveQuality(dt: number) {
    const frameTimeMs = dt * 1000;
    this.smoothedFrameTimeMs = THREE.MathUtils.lerp(this.smoothedFrameTimeMs, frameTimeMs, 0.08);

    if (this.smoothedFrameTimeMs > LOW_FPS_FRAME_TIME_MS) {
      this.lowPerfElapsedMs += frameTimeMs;
      this.recoveryElapsedMs = 0;
    } else if (this.smoothedFrameTimeMs < RECOVERY_FRAME_TIME_MS) {
      this.recoveryElapsedMs += frameTimeMs;
      this.lowPerfElapsedMs = 0;
    } else {
      this.lowPerfElapsedMs = 0;
      this.recoveryElapsedMs = 0;
    }

    if (this.lowPerfElapsedMs >= DEGRADE_HOLD_MS && this.qualityTier < 2) {
      this.qualityTier = (this.qualityTier + 1) as QualityTier;
      this.lowPerfElapsedMs = 0;
      this.recoveryElapsedMs = 0;
      this.applyQualityProfile();
      return;
    }

    if (this.recoveryElapsedMs >= RECOVERY_HOLD_MS && this.qualityTier > 0) {
      this.qualityTier = (this.qualityTier - 1) as QualityTier;
      this.lowPerfElapsedMs = 0;
      this.recoveryElapsedMs = 0;
      this.applyQualityProfile();
    }
  }

  private createSkydome(url: string) {
    this.loadSkyTexture(url, (texture) => {
      const skyGroup = new THREE.Group();

      const skyMaterialA = this.createSkyMaterial(texture);
      skyMaterialA.transparent = true;
      skyMaterialA.opacity = 1.0;

      const skyMaterialB = this.createSkyMaterial(texture);
      skyMaterialB.transparent = true;
      skyMaterialB.opacity = 0.0;

      const geo = new THREE.CylinderGeometry(SKY_RADIUS, SKY_RADIUS, SKY_HEIGHT, 64, 1, true);
      const skyCylinderA = new THREE.Mesh(geo, skyMaterialA);
      const skyCylinderB = new THREE.Mesh(geo, skyMaterialB);
      skyCylinderB.scale.setScalar(0.998); // offset slightly to stop Z-fighting

      skyGroup.add(skyCylinderA);
      skyGroup.add(skyCylinderB);

      const skyCapMaterial = new THREE.MeshBasicMaterial({
        color: FOG_COLOR,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      });
      const skyCap = new THREE.Mesh(new THREE.CircleGeometry(SKY_RADIUS, 64), skyCapMaterial);
      skyCap.rotation.x = Math.PI / 2;
      skyCap.position.y = SKY_HEIGHT / 2;
      skyGroup.add(skyCap);

      skyGroup.position.y = 300;
      skyGroup.renderOrder = -1;

      this.skyMaterialA = skyMaterialA;
      this.skyMaterialB = skyMaterialB;
      this.skyCapMaterial = skyCapMaterial;
      this.skydome = skyGroup;
      this.outdoorScene.add(skyGroup);
    });
  }

  private createSkyMaterial(texture: THREE.CanvasTexture): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });

    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
        `
        float blurAmt = 0.008;
        vec4 sampledDiffuseColor = (
          texture2D(map, vMapUv) +
          texture2D(map, vMapUv + vec2(blurAmt, 0.0)) +
          texture2D(map, vMapUv - vec2(blurAmt, 0.0)) +
          texture2D(map, vMapUv + vec2(0.0, blurAmt)) +
          texture2D(map, vMapUv - vec2(0.0, blurAmt)) +
          texture2D(map, vMapUv + vec2(blurAmt, blurAmt)) +
          texture2D(map, vMapUv - vec2(blurAmt, blurAmt))
        ) / 7.0;
        `,
      );
    };

    return material;
  }

  private loadSkyTexture(url: string, callback: (texture: THREE.CanvasTexture) => void) {
    const img = new Image();
    img.onload = () => callback(this.buildFeatheredSkyTexture(img));
    img.src = url;
  }

  private buildFeatheredSkyTexture(img: HTMLImageElement): THREE.CanvasTexture {
    const { width, height } = SKY_TEXTURE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create sky texture canvas context');
    }

    ctx.drawImage(img, 0, 0, width, height);
    const originalPixels = ctx.getImageData(0, 0, width, height).data;
    const offsetPixels = this.createOffsetSkyPixels(canvas, width, height);
    const result = ctx.createImageData(width, height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const blend = this.getHorizontalBlendWeight(x / width);
        const index = (y * width + x) * 4;
        result.data[index] = originalPixels[index] * blend + offsetPixels[index] * (1 - blend);
        result.data[index + 1] =
          originalPixels[index + 1] * blend + offsetPixels[index + 1] * (1 - blend);
        result.data[index + 2] =
          originalPixels[index + 2] * blend + offsetPixels[index + 2] * (1 - blend);
        result.data[index + 3] = 255;
      }
    }

    ctx.putImageData(result, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(SKY_TEXTURE_REPEAT_X, 1);
    return texture;
  }

  private createOffsetSkyPixels(
    sourceCanvas: HTMLCanvasElement,
    width: number,
    height: number,
  ): Uint8ClampedArray {
    const offsetCanvas = document.createElement('canvas');
    offsetCanvas.width = width;
    offsetCanvas.height = height;
    const offsetCtx = offsetCanvas.getContext('2d');
    if (!offsetCtx) {
      throw new Error('Failed to create offset sky texture canvas context');
    }

    const halfWidth = width / 2;
    offsetCtx.drawImage(sourceCanvas, halfWidth, 0, halfWidth, height, 0, 0, halfWidth, height);
    offsetCtx.drawImage(sourceCanvas, 0, 0, halfWidth, height, halfWidth, 0, halfWidth, height);

    return offsetCtx.getImageData(0, 0, width, height).data;
  }

  private getHorizontalBlendWeight(normalizedX: number): number {
    const edgeWeight =
      normalizedX < SKY_EDGE_BLEND
        ? normalizedX / SKY_EDGE_BLEND
        : normalizedX > 1 - SKY_EDGE_BLEND
          ? (1 - normalizedX) / SKY_EDGE_BLEND
          : 1;

    return 0.5 - 0.5 * Math.cos(edgeWeight * Math.PI);
  }

  private applyPreset(presetId: PresetId, instant = false) {
    this.targetPreset = presetId;
    const preset = PRESETS[presetId];

    this.loadSkyTexture(preset.skyUrl, (texture) => {
      if (!this.skyMaterialA || !this.skyMaterialB) return;

      if (instant) {
        this.skyMaterialA.map = texture;
        this.skyMaterialA.opacity = 1.0;
        this.skyMaterialA.needsUpdate = true;
        this.skyMaterialB.opacity = 0.0;
        this.activeSkyLayer = 0;
      } else {
        // Fade to alternate layer
        const nextLayer = this.activeSkyLayer === 0 ? this.skyMaterialB : this.skyMaterialA;
        nextLayer.map = texture;
        nextLayer.needsUpdate = true;
        this.activeSkyLayer = this.activeSkyLayer === 0 ? 1 : 0;
      }
    });

    if (instant) {
      this.outdoorSun.color.setHex(preset.sun.color);
      this.outdoorSun.intensity = preset.sun.intensity;
      this.outdoorSun.position.set(...preset.sun.position);

      this.outdoorAmbientLight.color.setHex(preset.ambient.color);
      this.outdoorAmbientLight.intensity = preset.ambient.intensity;

      this.outdoorFillLight.color.setHex(preset.fill.color);
      this.outdoorFillLight.intensity = preset.fill.intensity;

      this.setFogColor(this.outdoorScene, preset.fogColor);
      if (this.skyCapMaterial) {
        this.skyCapMaterial.color.setHex(preset.skyCapColor);
      }

      this.renderer.toneMappingExposure = preset.exposure;
      this.updateWaterColors(
        preset.water.baseColor,
        preset.water.highlightColor,
        preset.fogColor,
      );
    }
  }

  private updatePresetLerp(dt: number) {
    const preset = PRESETS[this.targetPreset];
    const speed = dt * 2.0;

    const tempColor = new THREE.Color();
    const tempPos = new THREE.Vector3();

    this.outdoorSun.color.lerp(tempColor.setHex(preset.sun.color), speed);
    this.outdoorSun.intensity += (preset.sun.intensity - this.outdoorSun.intensity) * speed;
    tempPos.set(...preset.sun.position);
    this.outdoorSun.position.lerp(tempPos, speed);

    this.outdoorAmbientLight.color.lerp(tempColor.setHex(preset.ambient.color), speed);
    this.outdoorAmbientLight.intensity += (preset.ambient.intensity - this.outdoorAmbientLight.intensity) * speed;

    this.outdoorFillLight.color.lerp(tempColor.setHex(preset.fill.color), speed);
    this.outdoorFillLight.intensity += (preset.fill.intensity - this.outdoorFillLight.intensity) * speed;

    const fogTarget = tempColor.setHex(preset.fogColor);
    (this.outdoorScene.fog as THREE.FogExp2).color.lerp(fogTarget, speed);
    (this.outdoorScene.background as THREE.Color).lerp(fogTarget, speed);

    if (this.skyCapMaterial) {
      this.skyCapMaterial.color.lerp(tempColor.setHex(preset.skyCapColor), speed);
    }

    // Cross-fade sky materials
    if (this.skyMaterialA && this.skyMaterialB) {
      if (this.activeSkyLayer === 0) {
        this.skyMaterialA.opacity += (1.0 - this.skyMaterialA.opacity) * speed;
        this.skyMaterialB.opacity += (0.0 - this.skyMaterialB.opacity) * speed;
      } else {
        this.skyMaterialB.opacity += (1.0 - this.skyMaterialB.opacity) * speed;
        this.skyMaterialA.opacity += (0.0 - this.skyMaterialA.opacity) * speed;
      }
    }

    this.renderer.toneMappingExposure += (preset.exposure - this.renderer.toneMappingExposure) * speed;

    for (const material of [waterMaterial, lakeMaterial]) {
      if (!material?.uniforms) continue;
      material.uniforms.uBaseColor.value.lerp(tempColor.setRGB(...preset.water.baseColor), speed);
      material.uniforms.uHighlightColor.value.lerp(tempColor.setRGB(...preset.water.highlightColor), speed);
      material.uniforms.uFogColor.value.lerp(tempColor.setHex(preset.fogColor), speed);
    }
  }

  private activateOutdoorWorld(presetId: PresetId) {
    this.worldMode = 'outdoor';
    this.activeScene = this.outdoorScene;
    this.currentPreset = presetId;
    this.outdoorScene.add(this.player.group);
    this.npcTurtles.setVisible(true);
    this.minimap.setVisible(true);
    this.updatePostProcessingScene();
    this.player.setMovementBounds({
      minX: -OUTDOOR_WORLD_BOUNDS,
      maxX: OUTDOOR_WORLD_BOUNDS,
      minZ: -OUTDOOR_WORLD_BOUNDS,
      maxZ: OUTDOOR_WORLD_BOUNDS,
    });
    this.player.setGroundingResolvers(
      this.getOutdoorGroundHeight,
      this.isOutdoorWalkable,
    );
    this.tpCamera.setGroundHeightResolver(this.getOutdoorGroundHeight);
    this.applyPreset(presetId);
  }

  private activateCaveWorld() {
    this.worldMode = 'cave';
    this.activeScene = this.caveScene;
    this.caveScene.add(this.player.group);
    this.npcTurtles.setVisible(false);
    this.minimap.setVisible(false);
    this.updatePostProcessingScene();
    this.renderer.toneMappingExposure = 1.85;
    this.player.setMovementBounds(CAVE_BOUNDS);
    this.player.setGroundingResolvers(
      this.getCaveGroundHeight,
      this.isCaveWalkable,
    );
    this.tpCamera.setGroundHeightResolver(this.getCaveGroundHeight);
    this.player.setPosition(CAVE_SPAWN.x, CAVE_SPAWN.y, CAVE_SPAWN.z);
  }

  private readonly getOutdoorGroundHeight = (x: number, z: number) => {
    return getTerrainHeight(x, z);
  };

  private readonly isOutdoorWalkable = (x: number, z: number) => {
    return getTerrainHeight(x, z) > -1.9;
  };

  private readonly getCaveGroundHeight = () => {
    return CAVE_SPAWN.y;
  };

  private readonly isCaveWalkable = (x: number, z: number) => {
    return (
      x >= CAVE_BOUNDS.minX &&
      x <= CAVE_BOUNDS.maxX &&
      z >= CAVE_BOUNDS.minZ &&
      z <= CAVE_BOUNDS.maxZ
    );
  };

  private updatePostProcessingScene() {
    this.renderPass.scene = this.activeScene;
    this.ssaoPass.scene = this.activeScene;
    this.bokehPass.scene = this.activeScene;
  }

  private setFogColor(scene: THREE.Scene, color: number) {
    (scene.fog as THREE.FogExp2).color.setHex(color);
    (scene.background as THREE.Color).setHex(color);
  }

  private updateWaterColors(
    baseColor: [number, number, number],
    highlightColor: [number, number, number],
    fogColor: number,
  ) {
    for (const material of [waterMaterial, lakeMaterial]) {
      if (!material?.uniforms) {
        continue;
      }

      material.uniforms.uBaseColor.value.setRGB(...baseColor);
      material.uniforms.uHighlightColor.value.setRGB(...highlightColor);
      material.uniforms.uFogColor.value.setHex(fogColor);
    }
  }

  private updateWaterTime(timeSeconds: number) {
    for (const material of [waterMaterial, lakeMaterial]) {
      if (material?.uniforms) {
        material.uniforms.uTime.value = timeSeconds;
      }
    }
  }

  private updateSkydomePosition() {
    if (!this.skydome) {
      return;
    }

    const cameraPosition = this.tpCamera.camera.position;
    this.skydome.position.set(cameraPosition.x, 0, cameraPosition.z);
  }

  private readonly loop = (time: number) => {
    if (this.isDisposed) return;
    this.animId = requestAnimationFrame(this.loop);
    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    const timeSeconds = time / 1000;
    this.lastTime = time;

    this.player.update(dt, this.input, this.tpCamera.cameraYaw);
    this.npcTurtles.update(dt);
    this.tpCamera.update(dt, this.player.position, this.input);

    this.minimap.update(
      this.player.position.x,
      this.player.position.z,
      this.player.facingAngle,
      this.npcTurtles.getPositions(),
    );

    this.updateSkydomePosition();
    if (this.worldMode === 'outdoor') {
      this.updateWaterTime(timeSeconds);
      this.grass.update(timeSeconds);
      this.updatePresetLerp(dt);
    }
    this.updateAdaptiveQuality(dt);
    this.composer.render();
  };

  private readonly onResize = () => {
    this.basePixelRatio = Math.min(window.devicePixelRatio, MAX_RENDER_PIXEL_RATIO);
    this.applyQualityProfile();
    this.tpCamera.onResize();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Digit1') {
      this.activateOutdoorWorld('1');
    } else if (event.code === 'Digit2') {
      this.activateOutdoorWorld('2');
    } else if (event.code === 'Digit3') {
      this.activateOutdoorWorld('3');
    } else if (event.code === 'Digit9' && this.worldMode !== 'cave') {
      this.activateCaveWorld();
    }
  };
}
