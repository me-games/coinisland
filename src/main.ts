// ── Genex boot: crash reporting + session replay, then signed-in identity ──
// These are the FIRST things to run, before any other game code.
import { initGameSentry, sentryCanvasSnapshot } from "@genex-ai/embed-sdk/sentry";
import { initEmbed } from "@genex-ai/embed-sdk";
import { GENEX } from "./genex.config";

initGameSentry({ slug: GENEX.slug });
initEmbed({
  slug: GENEX.slug,
  apiUrl: GENEX.apiUrl,
  dashboardOrigins: GENEX.dashboardOrigins,
});

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import "./style.css";

// Small helper: fetch a required DOM element or fail loudly.
const $ = <T extends Element>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error("missing " + sel);
  return el;
};

const app = $<HTMLDivElement>("#app");
const hintEl = $<HTMLDivElement>("#hint");
const winEl = $<HTMLDivElement>("#win");

// ── Renderer ──────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

// ── Scene & camera ──────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd0ff); // fallback sky until skybox lands

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(0, 7, 12);

// ── The sky (real generated tropical skybox) wraps + lights the scene ───────
new THREE.TextureLoader()
  .loadAsync("./assets/skybox/sunny-tropical-sky-with-a-few-clouds-over-the-ocea.jpg")
  .then((sky) => {
    sky.mapping = THREE.EquirectangularReflectionMapping;
    sky.colorSpace = THREE.SRGBColorSpace;
    scene.background = sky;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(sky).texture;
  })
  .catch(() => {/* keep the plain blue fallback sky */});

// Audio listener rides the camera (for the win chime).
const listener = new THREE.AudioListener();
camera.add(listener);

// ── Lights ──────────────────────────────────────────────────────────────────
scene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a5a, 1.0));
const sun = new THREE.DirectionalLight(0xfff2d6, 2.0);
sun.position.set(12, 18, 8);
scene.add(sun);

// ── The island ground (real generated grass-and-sand texture) ───────────────
const ISLAND_RADIUS = 16;
const groundMat = new THREE.MeshStandardMaterial({ color: 0x6ba24a, roughness: 0.95, metalness: 0 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(ISLAND_RADIUS, 64), groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// A little thickness under the island so the edge reads as land, not paper.
const base = new THREE.Mesh(
  new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS * 0.82, 3, 64),
  new THREE.MeshStandardMaterial({ color: 0x8a6b45, roughness: 1 }),
);
base.position.y = -1.5;
scene.add(base);

new THREE.TextureLoader()
  .loadAsync("./assets/textures/tropical-island-ground-patches-of-green-grass-blen/basecolor.png")
  .then((map) => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(6, 6);
    map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    groundMat.map = map;
    groundMat.color.set(0xffffff);
    groundMat.needsUpdate = true;
  })
  .catch(() => {/* keep the plain green ground */});

// ── The player (a simple capsule) ───────────────────────────────────────────
const PLAYER_RADIUS = 0.5;
const PLAYER_HEIGHT = 1.0; // cylinder part height
const player = new THREE.Mesh(
  new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT, 8, 16),
  new THREE.MeshStandardMaterial({ color: 0xff5a3c, roughness: 0.4, metalness: 0.1 }),
);
const PLAYER_Y = PLAYER_RADIUS + PLAYER_HEIGHT / 2; // rest on the ground
player.position.set(0, PLAYER_Y, 10);
scene.add(player);

// ── The treasure chest (placeholder box until the generated model lands) ────
const chest = new THREE.Group();
chest.position.set(0, 0, 0);
scene.add(chest);

const placeholderChest = new THREE.Mesh(
  new THREE.BoxGeometry(1.6, 1.1, 1.1),
  new THREE.MeshStandardMaterial({ color: 0x9c6b3f, roughness: 0.7 }),
);
placeholderChest.position.y = 0.55;
chest.add(placeholderChest);

new GLTFLoader()
  .loadAsync("./assets/models/wooden-treasure-chest-with-gold-trim-closed-lid-ga.glb")
  .then((gltf) => {
    // Swap the placeholder for the real chest, scaled to sit nicely on the ground.
    chest.remove(placeholderChest);
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetHeight = 1.4;
    const scale = targetHeight / (size.y || 1);
    model.scale.setScalar(scale);
    const box2 = new THREE.Box3().setFromObject(model);
    model.position.y -= box2.min.y; // drop it so its base rests at y = 0
    chest.add(model);
  })
  .catch(() => {/* keep the placeholder box */});

// A soft glow ring under the chest so you always know where to go.
const marker = new THREE.Mesh(
  new THREE.RingGeometry(1.6, 2.1, 48),
  new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
);
marker.rotation.x = -Math.PI / 2;
marker.position.y = 0.02;
scene.add(marker);

// ── The win chime (generated sound) ─────────────────────────────────────────
const winSound = new THREE.Audio(listener);
let winSoundReady = false;
new THREE.AudioLoader()
  .loadAsync("./assets/sfx/coins-clinking-together-cheerful-win-chime-treasur.mp3")
  .then((buffer) => {
    winSound.setBuffer(buffer);
    winSound.setVolume(0.9);
    winSoundReady = true;
  })
  .catch(() => {/* silent if the sound isn't there yet */});

// ── Input (WASD) ─────────────────────────────────────────────────────────────
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  keys.add(e.key.toLowerCase());
  // Browsers require a user gesture before audio can play.
  if (listener.context.state === "suspended") void listener.context.resume();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// ── Win state ────────────────────────────────────────────────────────────────
let won = false;
const WIN_RADIUS = 2.2;

function triggerWin(): void {
  if (won) return;
  won = true;
  hintEl.style.opacity = "0";
  winEl.classList.add("show");
  chest.visible = false; // chest opens/disappears
  marker.visible = false;
  if (winSoundReady) {
    if (winSound.isPlaying) winSound.stop();
    winSound.play();
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
const MOVE_SPEED = 6; // units per second

function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  // Movement in world space: W away from camera, S toward, A/D strafe.
  if (!won) {
    let mx = 0;
    let mz = 0;
    if (keys.has("w") || keys.has("arrowup")) mz -= 1;
    if (keys.has("s") || keys.has("arrowdown")) mz += 1;
    if (keys.has("a") || keys.has("arrowleft")) mx -= 1;
    if (keys.has("d") || keys.has("arrowright")) mx += 1;
    if (mx !== 0 || mz !== 0) {
      const len = Math.hypot(mx, mz);
      player.position.x += (mx / len) * MOVE_SPEED * dt;
      player.position.z += (mz / len) * MOVE_SPEED * dt;
      // Keep the player on the island.
      const distFromCenter = Math.hypot(player.position.x, player.position.z);
      const maxDist = ISLAND_RADIUS - 1;
      if (distFromCenter > maxDist) {
        player.position.x *= maxDist / distFromCenter;
        player.position.z *= maxDist / distFromCenter;
      }
    }

    // Reached the chest?
    if (Math.hypot(player.position.x, player.position.z) < WIN_RADIUS) {
      triggerWin();
    }
  }

  // Gentle bob on the marker ring.
  marker.scale.setScalar(1 + Math.sin(clock.elapsedTime * 2) * 0.04);

  // Third-person camera follows the player.
  const desired = new THREE.Vector3(
    player.position.x,
    player.position.y + 6,
    player.position.z + 11,
  );
  camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
  camera.lookAt(player.position.x, player.position.y + 0.5, player.position.z);

  renderer.render(scene, camera);
  sentryCanvasSnapshot(renderer.domElement); // AFTER render, same frame
}
animate();

// ── Resize ───────────────────────────────────────────────────────────────────
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
