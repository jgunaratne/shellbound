import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { InputManager } from './InputManager';
import { Player } from './Player';
import { ThirdPersonCamera } from './ThirdPersonCamera';
import { createTerrain, createWater, waterMaterial, lakeMaterial } from './terrain';
import { populateEnvironment } from './environment';
import { InstancedGrass } from './InstancedGrass';
import { NPCTurtleManager } from './NPCTurtle';
import { Minimap } from './Minimap';
import skyUrl from '../assets/sky.png';
import skyAfternoonUrl from '../assets/sky_afternoon.png';

export class Game {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private input: InputManager;
  private player: Player;
  private grass!: InstancedGrass;
  private npcTurtles!: NPCTurtleManager;
  private minimap!: Minimap;
  private tpCamera: ThirdPersonCamera;
  private skydome: THREE.Object3D | null = null;
  private skyMaterial: THREE.MeshBasicMaterial | null = null;
  private skyCapMaterial: THREE.MeshBasicMaterial | null = null;
  private composer!: EffectComposer;
  private bokehPass!: BokehPass;
  private ssaoPass!: SSAOPass;
  private animId = 0;
  private lastTime = 0;
  private sun!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private fillLight!: THREE.DirectionalLight;
  private currentPreset: '1' | '2' = '1';
  private onKeyHandler: (e: KeyboardEvent) => void;

  constructor(canvas: HTMLCanvasElement) {
    // --- Renderer ---
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;

    // --- Scene ---
    this.scene = new THREE.Scene();
    const fogColor = 0xc9d8f0; // cool sky blue haze as specified
    this.scene.fog = new THREE.FogExp2(fogColor, 0.0025);
    this.scene.background = new THREE.Color(fogColor);

    // --- Skydome ---
    this.createSkydome();

    // --- Lighting System (Realistic multi-source standard) ---
    
    // 1. Sky ambient bounce fill
    this.ambientLight = new THREE.AmbientLight(0xc9d8f0, 1.0);
    this.scene.add(this.ambientLight);

    // 2. Primary mid-afternoon sun (warm)
    const sun = new THREE.DirectionalLight(0xfff5e0, 2.8);
    sun.position.set(100, 150, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const halfWorld = 150;
    sun.shadow.camera.left = -halfWorld;
    sun.shadow.camera.right = halfWorld;
    sun.shadow.camera.top = halfWorld;
    sun.shadow.camera.bottom = -halfWorld;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 500;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    sun.shadow.camera.updateProjectionMatrix();
    this.sun = sun;
    this.scene.add(sun);

    // 3. Secondary subtle cooler back-fill to illuminate shadowed faces naturally
    this.fillLight = new THREE.DirectionalLight(0xc9d8f0, 1.2);
    this.fillLight.position.set(-100, 50, -50);
    this.scene.add(this.fillLight);

    // --- Time-of-day key handler ---
    this.onKeyHandler = (e: KeyboardEvent) => {
      if (e.code === 'Digit1' && this.currentPreset !== '1') {
        this.currentPreset = '1';
        this.applyPreset('1');
      } else if (e.code === 'Digit2' && this.currentPreset !== '2') {
        this.currentPreset = '2';
        this.applyPreset('2');
      }
    };
    window.addEventListener('keydown', this.onKeyHandler);

    // --- Terrain & water ---
    createTerrain(this.scene);
    createWater(this.scene);

    // --- Environment ---
    populateEnvironment(this.scene);

    // --- High-Performance Instanced 3D Grass ---
    this.grass = new InstancedGrass(80000);
    this.scene.add(this.grass.mesh);



    // --- Player ---
    this.player = new Player(this.scene);

    // --- NPC Turtles ---
    this.npcTurtles = new NPCTurtleManager(this.scene);

    // --- Minimap HUD ---
    this.minimap = new Minimap();

    // --- Camera ---
    this.tpCamera = new ThirdPersonCamera();

    // --- Input ---
    this.input = new InputManager(canvas);

    // --- Post-processing (Realistic Depth of Field) ---
    this.composer = new EffectComposer(this.renderer);
    
    const renderPass = new RenderPass(this.scene, this.tpCamera.camera);
    this.composer.addPass(renderPass);

    this.ssaoPass = new SSAOPass(this.scene, this.tpCamera.camera, window.innerWidth, window.innerHeight);
    this.ssaoPass.kernelRadius = 12;
    this.ssaoPass.minDistance = 0.0025;
    this.ssaoPass.maxDistance = 0.1;
    this.composer.addPass(this.ssaoPass);

    this.bokehPass = new BokehPass(this.scene, this.tpCamera.camera, {
      focus: 7.0,       // Focus precisely centered on the player
      aperture: 0.0001, // Tighter aperture for a significantly sharper foreground
      maxblur: 0.004    // Reduced maximum blur to keep the background much clearer
    });
    this.composer.addPass(this.bokehPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    // --- Resize ---
    window.addEventListener('resize', this.onResize);
  }

  private createSkydome() {
    const img = new Image();
    img.onload = () => {
      // Feather horizontal edges so the sky tiles seamlessly (same technique as grass)
      const W = 1024;
      const H = 512;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, W, H);
      const origData = ctx.getImageData(0, 0, W, H);
      const origPx = origData.data;

      // Create horizontally-offset copy (shift by half width)
      const offCanvas = document.createElement('canvas');
      offCanvas.width = W;
      offCanvas.height = H;
      const offCtx = offCanvas.getContext('2d')!;
      const halfW = W / 2;
      offCtx.drawImage(canvas, halfW, 0, halfW, H, 0, 0, halfW, H);
      offCtx.drawImage(canvas, 0, 0, halfW, H, halfW, 0, halfW, H);
      const offData = offCtx.getImageData(0, 0, W, H);
      const offPx = offData.data;

      // Blend: original in center, offset at horizontal edges
      const BLEND = 0.35;
      const result = ctx.createImageData(W, H);
      const out = result.data;

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const nx = x / W;
          const wx = nx < BLEND ? nx / BLEND
                    : nx > (1 - BLEND) ? (1 - nx) / BLEND
                    : 1.0;
          const w = 0.5 - 0.5 * Math.cos(wx * Math.PI);
          const i = (y * W + x) * 4;
          out[i]     = origPx[i]     * w + offPx[i]     * (1 - w);
          out[i + 1] = origPx[i + 1] * w + offPx[i + 1] * (1 - w);
          out[i + 2] = origPx[i + 2] * w + offPx[i + 2] * (1 - w);
          out[i + 3] = 255;
        }
      }

      ctx.putImageData(result, 0, 0);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.repeat.set(3, 1);

      const skyRadius = 350;
      const skyHeight = 800;
      const geo = new THREE.CylinderGeometry(
        skyRadius, skyRadius, skyHeight, 64, 1, true
      );
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      });
      this.skyMaterial = mat;

      // Cinematic sky blur shader
      mat.onBeforeCompile = (shader) => {
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
          `
        );
      };

      const skyGroup = new THREE.Group();
      const cylinder = new THREE.Mesh(geo, mat);
      skyGroup.add(cylinder);

      // Disc cap to close the top
      const capGeo = new THREE.CircleGeometry(skyRadius, 64);
      const capMat = new THREE.MeshBasicMaterial({
        color: 0xc9d8f0,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      });
      this.skyCapMaterial = capMat;
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.rotation.x = Math.PI / 2;
      cap.position.y = skyHeight / 2;
      skyGroup.add(cap);

      skyGroup.position.y = 300;
      skyGroup.renderOrder = -1;
      this.skydome = skyGroup;
      this.scene.add(skyGroup);
    };
    img.src = skyUrl;
  }

  /** Load a sky image, feather its edges, and return a repeating CanvasTexture */
  private loadSkyTexture(url: string, callback: (tex: THREE.CanvasTexture) => void) {
    const img = new Image();
    img.onload = () => {
      const W = 1024, H = 512;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, W, H);
      const origData = ctx.getImageData(0, 0, W, H);
      const origPx = origData.data;

      const offCanvas = document.createElement('canvas');
      offCanvas.width = W; offCanvas.height = H;
      const offCtx = offCanvas.getContext('2d')!;
      const halfW = W / 2;
      offCtx.drawImage(canvas, halfW, 0, halfW, H, 0, 0, halfW, H);
      offCtx.drawImage(canvas, 0, 0, halfW, H, halfW, 0, halfW, H);
      const offPx = offCtx.getImageData(0, 0, W, H).data;

      const BLEND = 0.35;
      const result = ctx.createImageData(W, H);
      const out = result.data;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const nx = x / W;
          const wx = nx < BLEND ? nx / BLEND : nx > (1 - BLEND) ? (1 - nx) / BLEND : 1.0;
          const w = 0.5 - 0.5 * Math.cos(wx * Math.PI);
          const i = (y * W + x) * 4;
          out[i]     = origPx[i]     * w + offPx[i]     * (1 - w);
          out[i + 1] = origPx[i + 1] * w + offPx[i + 1] * (1 - w);
          out[i + 2] = origPx[i + 2] * w + offPx[i + 2] * (1 - w);
          out[i + 3] = 255;
        }
      }
      ctx.putImageData(result, 0, 0);

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.repeat.set(3, 1);
      callback(tex);
    };
    img.src = url;
  }

  /** Apply a time-of-day preset */
  private applyPreset(preset: '1' | '2') {
    if (preset === '1') {
      // ── Midday ──
      this.sun.color.setHex(0xfff5e0);
      this.sun.intensity = 2.8;
      this.sun.position.set(100, 150, 50);

      this.ambientLight.color.setHex(0xc9d8f0);
      this.ambientLight.intensity = 1.0;

      this.fillLight.color.setHex(0xc9d8f0);
      this.fillLight.intensity = 1.2;

      const fogColor = 0xc9d8f0;
      (this.scene.fog as THREE.FogExp2).color.setHex(fogColor);
      (this.scene.background as THREE.Color).setHex(fogColor);

      if (this.skyCapMaterial) this.skyCapMaterial.color.setHex(0xc9d8f0);

      // Reset water to midday colors
      if (waterMaterial && waterMaterial.uniforms) {
        waterMaterial.uniforms.uBaseColor.value.setRGB(0.01, 0.04, 0.12);
        waterMaterial.uniforms.uHighlightColor.value.setRGB(0.05, 0.15, 0.30);
        waterMaterial.uniforms.uFogColor.value.setHex(0xc9d8f0);
      }
      if (lakeMaterial && lakeMaterial.uniforms) {
        lakeMaterial.uniforms.uBaseColor.value.setRGB(0.01, 0.04, 0.12);
        lakeMaterial.uniforms.uHighlightColor.value.setRGB(0.05, 0.15, 0.30);
        lakeMaterial.uniforms.uFogColor.value.setHex(0xc9d8f0);
      }

      this.renderer.toneMappingExposure = 1.4;

      // Swap sky texture
      this.loadSkyTexture(skyUrl, (tex) => {
        if (this.skyMaterial) {
          this.skyMaterial.map?.dispose();
          this.skyMaterial.map = tex;
          this.skyMaterial.needsUpdate = true;
        }
      });
    } else {
      // ── Late Afternoon / Early Evening ──
      this.sun.color.setHex(0xffb347); // warm amber-orange sun
      this.sun.intensity = 2.6;
      this.sun.position.set(80, 40, 80); // low on the horizon

      this.ambientLight.color.setHex(0x9a8ab0); // lighter dusky ambient
      this.ambientLight.intensity = 1.0;

      this.fillLight.color.setHex(0x6a7aaa); // brighter blue backfill
      this.fillLight.intensity = 1.2;

      const fogColor = 0xd4a574; // warm hazy amber fog
      (this.scene.fog as THREE.FogExp2).color.setHex(fogColor);
      (this.scene.background as THREE.Color).setHex(fogColor);

      if (this.skyCapMaterial) this.skyCapMaterial.color.setHex(0xc49060);

      // Update water to late afternoon colors (deep dark blue)
      if (waterMaterial && waterMaterial.uniforms) {
        waterMaterial.uniforms.uBaseColor.value.setRGB(0.01, 0.03, 0.08);
        waterMaterial.uniforms.uHighlightColor.value.setRGB(0.03, 0.06, 0.15);
        waterMaterial.uniforms.uFogColor.value.setHex(0xd4a574);
      }
      if (lakeMaterial && lakeMaterial.uniforms) {
        lakeMaterial.uniforms.uBaseColor.value.setRGB(0.01, 0.03, 0.08);
        lakeMaterial.uniforms.uHighlightColor.value.setRGB(0.03, 0.06, 0.15);
        lakeMaterial.uniforms.uFogColor.value.setHex(0xd4a574);
      }

      this.renderer.toneMappingExposure = 1.35;

      // Swap sky texture
      this.loadSkyTexture(skyAfternoonUrl, (tex) => {
        if (this.skyMaterial) {
          this.skyMaterial.map?.dispose();
          this.skyMaterial.map = tex;
          this.skyMaterial.needsUpdate = true;
        }
      });
    }
  }



  start() {
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  private loop = (time: number) => {
    this.animId = requestAnimationFrame(this.loop);
    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;

    this.player.update(dt, this.input, this.tpCamera.cameraYaw);
    this.npcTurtles.update(dt);
    this.tpCamera.update(dt, this.player.position, this.input);

    // Update minimap HUD
    this.minimap.update(
      this.player.position.x,
      this.player.position.z,
      this.player.facingAngle,
      this.npcTurtles.getPositions(),
    );

    // Keep skydome centered on the camera so it appears infinitely far
    if (this.skydome) {
      const camPos = this.tpCamera.camera.position;
      this.skydome.position.set(camPos.x, 0, camPos.z);
    }

    // Animate the highly realistic water turbulence shader
    const waterTime = time / 1000.0;
    if (waterMaterial && waterMaterial.uniforms) {
      waterMaterial.uniforms.uTime.value = waterTime;
    }
    if (lakeMaterial && lakeMaterial.uniforms) {
      lakeMaterial.uniforms.uTime.value = waterTime;
    }

    // Animate the highly performant 3D Instanced Grass swaying in the wind
    if (this.grass) {
      this.grass.update(time / 1000.0);
    }

    this.composer.render();
  };

  private onResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.tpCamera.onResize();
  };

  dispose() {
    cancelAnimationFrame(this.animId);
    this.input.dispose();
    this.minimap.dispose();
    window.removeEventListener('keydown', this.onKeyHandler);
    window.removeEventListener('resize', this.onResize);
    this.bokehPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
