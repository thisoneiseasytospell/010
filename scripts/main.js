import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const container = document.querySelector('#scene-container');
const introOverlay = document.getElementById('intro-overlay');
const introVideo = document.getElementById('intro-video');
const introPrompt = document.getElementById('intro-cursor-prompt');
const gridModeIcon = document.getElementById('grid-mode-icon');
const soloInfoPanel = document.getElementById('solo-info-panel');
const soloInfoTitle = document.getElementById('solo-info-title');
const soloInfoBody = document.getElementById('solo-info-body');

// Mobile dropdown elements
const mobileHeader = document.getElementById('mobile-header');
const modelSelectorBtn = document.getElementById('model-selector-btn');
const currentModelNameEl = document.getElementById('current-model-name');
const modelDropdown = document.getElementById('model-dropdown');
const modelDropdownList = document.getElementById('model-dropdown-list');
const modelDropdownInfo = document.getElementById('model-dropdown-info');
let dropdownOpen = false;

// Display state
let currentModelIndex = 0;
let isGridMode = true; // Toggle between solo and grid mode - default to grid
let models = [];
const mainModels = []; // Large display models (one per model config)
const thumbnailModels = []; // Small preview models
const gridModels = []; // Grid layout models (5x2)
let modelInfoById = new Map();

const SOLO_MODEL_X_OFFSET = 0; // Centered on desktop
const SOLO_INFO_MAX_ROT_Y_DEG = 20;
const SOLO_INFO_MAX_ROT_Y_RAD = THREE.MathUtils.degToRad(SOLO_INFO_MAX_ROT_Y_DEG);
const SOLO_INFO_MAX_ROT_X_DEG = 2;
const SOLO_INFO_MAX_ROT_X_RAD = THREE.MathUtils.degToRad(SOLO_INFO_MAX_ROT_X_DEG);
const SOLO_MODEL_TRANSITION_SPEED = 0.12;
const SOLO_MODEL_TRANSITION_THRESHOLD = 0.01;
const SOLO_MOUSE_ROTATION_Y_FACTOR = 0.25;
const SOLO_MOUSE_ROTATION_X_FACTOR = 0.15;

let introActive = true;
let introPromptHideTimer = null;
let introPromptMoveHandle = null;
let introPromptPendingPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let introPromptCurrentPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let introPromptAnimating = false;

let gridIntroRandomizationPending = false;
let gridIntroAnimationId = 0;
let infoRotationX = 0;
let infoRotationY = 0;

function softenVerticalRotation(radians) {
  if (SOLO_INFO_MAX_ROT_X_RAD === 0) return 0;
  const normalized = THREE.MathUtils.clamp(radians / SOLO_INFO_MAX_ROT_X_RAD, -1, 1);
  const softened = Math.sign(normalized) * Math.pow(Math.abs(normalized), 1.35);
  return softened * SOLO_INFO_MAX_ROT_X_RAD;
}

if (gridModeIcon) {
  gridModeIcon.addEventListener('click', (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (introActive || isGridMode) return;
    toggleMode();
  });
}

// Grid presentation
const DEFAULT_GRID_ROTATION_DEG = 15;
const GRID_ROTATION_OVERRIDE_DEG = {};

// Grid layout configuration
function getGridConfig() {
  const aspect = window.innerWidth / window.innerHeight;
  const isPortrait = aspect < 1;

  if (isPortrait) {
    // Mobile portrait: 1 column, vertical scroll
    // cellHeight controls spacing - smaller = closer together
    return {
      cols: 1,
      rows: 10, // All models in one column
      cellWidth: 0, // Not used for single column
      cellHeight: 5.0, // Closer spacing between models
      modelSize: 3.0, // Model size
      isMobileScroll: true
    };
  } else {
    // Desktop/landscape: 5 columns, 2 rows
    return {
      cols: 5,
      rows: 2,
      cellWidth: 3.96,
      cellHeight: 4.32,
      modelSize: 2.916,
      isMobileScroll: false
    };
  }
}

function getGridPosition(modelIndex) {
  const config = getGridConfig();
  const { cols, cellWidth, cellHeight, isMobileScroll } = config;

  if (isMobileScroll) {
    // Mobile: single column, vertically stacked
    // Models are center-aligned, negative offset pushes down
    return {
      x: 0,
      y: -modelIndex * cellHeight - 1.0 // Push down more for top padding
    };
  }

  const rows = Math.ceil(models.length / cols);
  const gridWidth = cols * cellWidth;
  const gridHeight = rows * cellHeight;

  const col = modelIndex % cols;
  const row = Math.floor(modelIndex / cols);

  const x = (col * cellWidth) - (gridWidth / 2) + (cellWidth / 2);
  const gridTop = gridHeight / 2;
  const y = gridTop - (row + 1) * cellHeight;

  return { x, y };
}

function updateGridLayout() {
  const config = getGridConfig();

  gridModels.forEach((entry, index) => {
    if (!entry || !entry.object) return;

    const pos = getGridPosition(index);
    entry.object.position.set(pos.x, pos.y, 0);

    // Update model scale based on current config
    const innerObj = entry.object.userData.innerObject;
    if (innerObj && entry.object.userData.baseScale) {
      const baseScale = entry.object.userData.baseScale;
      const targetScale = baseScale * (config.modelSize / 2.916); // Scale relative to desktop size
      innerObj.scale.setScalar(targetScale);
    }
  });
}

// Mobile scroll state
let mobileScrollY = 0;
let mobileScrollTarget = 0;
let mobileScrollVelocity = 0;
let mobileTouchStartY = 0;
let mobileTouchStartScroll = 0;
let mobileCurrentModelIndex = 0;
let isMobileScrolling = false;

function getMobileScrollBounds() {
  const config = getGridConfig();
  if (!config.isMobileScroll) return { min: 0, max: 0 };
  const totalHeight = (models.length - 1) * config.cellHeight;
  return { min: 0, max: totalHeight };
}

function snapToNearestModel() {
  const config = getGridConfig();
  if (!config.isMobileScroll) return;

  const cellHeight = config.cellHeight;
  const nearestIndex = Math.round(mobileScrollTarget / cellHeight);
  const clampedIndex = Math.max(0, Math.min(nearestIndex, models.length - 1));
  mobileScrollTarget = clampedIndex * cellHeight;
  mobileCurrentModelIndex = clampedIndex;
}

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5f5f0);

// Camera
const aspect = window.innerWidth / window.innerHeight;
const frustumSize = 12;
const camera = new THREE.OrthographicCamera(
  frustumSize * aspect / -2,
  frustumSize * aspect / 2,
  frustumSize / 2,
  frustumSize / -2,
  0.1,
  100
);
camera.position.set(0, 0, 10);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.166.0/examples/jsm/libs/draco/');

// Lighting - Studio setup
const ambient = new THREE.AmbientLight(0xffffff, 2.0);
scene.add(ambient);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.4);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0x9c9c9c, 1.5);
keyLight.position.set(8, 10, 6);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xf0f4ff, 1.6);
fillLight.position.set(-6, 5, 5);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
rimLight.position.set(0, 3, -8);
scene.add(rimLight);

// Dark mode
let isDarkMode = false;
const lightModeBackground = 0xf5f5f0;
const darkModeBackground = 0x0a0a0a;

// Store light mode values for toggle
const lightModeValues = {
  ambient: { color: 0xffffff, intensity: 2.0 },
  hemi: { sky: 0xffffff, ground: 0xffffff, intensity: 0.4 },
  key: { color: 0x9c9c9c, intensity: 1.5 },
  fill: { color: 0xf0f4ff, intensity: 1.6 },
  rim: { color: 0xffffff, intensity: 0.3 }
};

const darkModeValues = {
  ambient: { color: 0x222233, intensity: 0.3 },
  hemi: { sky: 0x111122, ground: 0x000000, intensity: 0.2 },
  key: { color: 0x6666aa, intensity: 1.2 },
  fill: { color: 0x4444aa, intensity: 0.6 },
  rim: { color: 0x8888ff, intensity: 0.8 }
};

function flickerLights(callback) {
  const flickerCount = 4;
  const flickerDuration = 80;
  let flickerIndex = 0;

  const originalIntensities = {
    ambient: ambient.intensity,
    key: keyLight.intensity,
    fill: fillLight.intensity,
    rim: rimLight.intensity,
    hemi: hemiLight.intensity
  };

  function flicker() {
    if (flickerIndex >= flickerCount) {
      // Restore and apply final values
      if (callback) callback();
      return;
    }

    // Random dim
    const dimFactor = 0.1 + Math.random() * 0.3;
    ambient.intensity = originalIntensities.ambient * dimFactor;
    keyLight.intensity = originalIntensities.key * dimFactor;
    fillLight.intensity = originalIntensities.fill * dimFactor;
    rimLight.intensity = originalIntensities.rim * dimFactor;
    hemiLight.intensity = originalIntensities.hemi * dimFactor;

    setTimeout(() => {
      // Brief restore
      ambient.intensity = originalIntensities.ambient * 0.7;
      keyLight.intensity = originalIntensities.key * 0.7;
      fillLight.intensity = originalIntensities.fill * 0.7;
      rimLight.intensity = originalIntensities.rim * 0.7;
      hemiLight.intensity = originalIntensities.hemi * 0.7;

      flickerIndex++;
      setTimeout(flicker, flickerDuration / 2);
    }, flickerDuration);
  }

  flicker();
}

function applyLightingMode(values) {
  ambient.color.setHex(values.ambient.color);
  ambient.intensity = values.ambient.intensity;
  hemiLight.color.setHex(values.hemi.sky);
  hemiLight.groundColor.setHex(values.hemi.ground);
  hemiLight.intensity = values.hemi.intensity;
  keyLight.color.setHex(values.key.color);
  keyLight.intensity = values.key.intensity;
  fillLight.color.setHex(values.fill.color);
  fillLight.intensity = values.fill.intensity;
  rimLight.color.setHex(values.rim.color);
  rimLight.intensity = values.rim.intensity;
}

function toggleDarkMode() {
  flickerLights(() => {
    isDarkMode = !isDarkMode;
    scene.background.setHex(isDarkMode ? darkModeBackground : lightModeBackground);
    applyLightingMode(isDarkMode ? darkModeValues : lightModeValues);

    // Toggle dark mode class on body for text colors
    document.body.classList.toggle('dark-mode', isDarkMode);

    // Update controls if visible
    if (lightingControlsVisible) {
      setupLightingControls();
    }
  });
}

// PARTY MODE 🎉
let isPartyMode = false;
let partyAnimationId = null;
let partyStartTime = 0;
const partyColors = [
  0xff0066, 0x00ff66, 0x6600ff, 0xff6600, 0x00ffff, 0xff00ff, 0xffff00
];
const policeRed = 0xff0022;
const policeBlue = 0x0044ff;

function startPartyMode() {
  if (isPartyMode) return;
  isPartyMode = true;
  isDarkMode = true;
  partyStartTime = Date.now();

  document.body.classList.add('dark-mode', 'party-mode');
  scene.background.setHex(darkModeBackground); // Keep dark background

  animateParty();
}

function stopPartyMode() {
  isPartyMode = false;
  document.body.classList.remove('party-mode');

  if (partyAnimationId) {
    cancelAnimationFrame(partyAnimationId);
    partyAnimationId = null;
  }
}

let partyToggleCooldown = false;

function togglePartyMode() {
  // Prevent rapid toggling
  if (partyToggleCooldown) return;
  partyToggleCooldown = true;
  setTimeout(() => { partyToggleCooldown = false; }, 1500);

  // Always flicker before toggling
  flickerLights(() => {
    if (isPartyMode) {
      // Exit party mode - go back to light mode
      stopPartyMode();
      isDarkMode = false;
      document.body.classList.remove('dark-mode', 'party-mode');
      scene.background.setHex(lightModeBackground);
      applyLightingMode(lightModeValues);
    } else {
      // Enter party mode
      isDarkMode = true;
      document.body.classList.add('dark-mode');
      scene.background.setHex(darkModeBackground);
      startPartyMode();
    }
  });
}

function animateParty() {
  if (!isPartyMode) return;

  const time = (Date.now() - partyStartTime) / 1000;
  const beat = Math.sin(time * 8) * 0.5 + 0.5;
  const fastBeat = Math.sin(time * 16) * 0.5 + 0.5;

  // Police lights - alternating red and blue
  const policePhase = Math.floor(time * 6) % 2;
  const policeFlash = Math.sin(time * 20) > 0;

  // Explosion effect - random bright white flash
  const isExplosion = Math.random() > 0.97;
  const explosionIntensity = isExplosion ? 8 + Math.random() * 5 : 0;

  // Cycle through disco colors
  const colorIndex = Math.floor(time * 2) % partyColors.length;
  const nextColorIndex = (colorIndex + 1) % partyColors.length;
  const colorLerp = (time * 2) % 1;

  const discoColor1 = new THREE.Color(partyColors[colorIndex]);
  const discoColor2 = new THREE.Color(partyColors[nextColorIndex]);
  discoColor1.lerp(discoColor2, colorLerp);

  // Key light - disco colors with explosions
  if (isExplosion) {
    keyLight.color.setHex(0xffffff);
    keyLight.intensity = explosionIntensity;
  } else {
    keyLight.color.copy(discoColor1);
    keyLight.intensity = 1.5 + beat * 2;
  }

  // Fill light - police red
  if (policePhase === 0 && policeFlash) {
    fillLight.color.setHex(policeRed);
    fillLight.intensity = 3 + fastBeat * 2;
  } else {
    fillLight.color.setHex(partyColors[(colorIndex + 2) % partyColors.length]);
    fillLight.intensity = 1 + fastBeat;
  }

  // Rim light - police blue
  if (policePhase === 1 && policeFlash) {
    rimLight.color.setHex(policeBlue);
    rimLight.intensity = 3 + fastBeat * 2;
  } else {
    rimLight.color.setHex(partyColors[(colorIndex + 4) % partyColors.length]);
    rimLight.intensity = 0.8 + beat * 1.5;
  }

  // Ambient - pulsing with occasional explosion boost
  ambient.color.setHex(isExplosion ? 0xffffff : 0x222233);
  ambient.intensity = isExplosion ? 2 : (0.15 + beat * 0.15);

  // Hemisphere for extra police effect
  if (policeFlash) {
    hemiLight.color.setHex(policePhase === 0 ? policeRed : policeBlue);
    hemiLight.groundColor.setHex(policePhase === 0 ? policeBlue : policeRed);
    hemiLight.intensity = 0.5 + fastBeat * 0.5;
  } else {
    hemiLight.color.setHex(0x111122);
    hemiLight.groundColor.setHex(0x000000);
    hemiLight.intensity = 0.2;
  }

  partyAnimationId = requestAnimationFrame(animateParty);
}

// Lighting debug controls
const lightingControls = document.getElementById('lighting-controls');
let lightingControlsVisible = false;

function setupLightingControls() {
  const ctrlAmbient = document.getElementById('ctrl-ambient');
  const ctrlKey = document.getElementById('ctrl-key');
  const ctrlKeyColor = document.getElementById('ctrl-key-color');
  const ctrlFill = document.getElementById('ctrl-fill');
  const ctrlFillColor = document.getElementById('ctrl-fill-color');
  const ctrlRim = document.getElementById('ctrl-rim');
  const ctrlRimColor = document.getElementById('ctrl-rim-color');
  const ctrlHemiSky = document.getElementById('ctrl-hemi-sky');
  const ctrlHemiGround = document.getElementById('ctrl-hemi-ground');
  const ctrlCopy = document.getElementById('ctrl-copy');

  // Set initial values from current lighting
  if (ctrlAmbient) {
    ctrlAmbient.value = ambient.intensity;
    document.getElementById('val-ambient').textContent = ambient.intensity.toFixed(1);
    ctrlAmbient.addEventListener('input', (e) => {
      ambient.intensity = parseFloat(e.target.value);
      document.getElementById('val-ambient').textContent = ambient.intensity.toFixed(1);
    });
  }

  if (ctrlKey) {
    ctrlKey.value = keyLight.intensity;
    document.getElementById('val-key').textContent = keyLight.intensity.toFixed(1);
    ctrlKey.addEventListener('input', (e) => {
      keyLight.intensity = parseFloat(e.target.value);
      document.getElementById('val-key').textContent = keyLight.intensity.toFixed(1);
    });
  }
  if (ctrlKeyColor) {
    ctrlKeyColor.value = '#' + keyLight.color.getHexString();
    ctrlKeyColor.addEventListener('input', (e) => {
      keyLight.color.set(e.target.value);
    });
  }

  if (ctrlFill) {
    ctrlFill.value = fillLight.intensity;
    document.getElementById('val-fill').textContent = fillLight.intensity.toFixed(1);
    ctrlFill.addEventListener('input', (e) => {
      fillLight.intensity = parseFloat(e.target.value);
      document.getElementById('val-fill').textContent = fillLight.intensity.toFixed(1);
    });
  }
  if (ctrlFillColor) {
    ctrlFillColor.value = '#' + fillLight.color.getHexString();
    ctrlFillColor.addEventListener('input', (e) => {
      fillLight.color.set(e.target.value);
    });
  }

  if (ctrlRim) {
    ctrlRim.value = rimLight.intensity;
    document.getElementById('val-rim').textContent = rimLight.intensity.toFixed(1);
    ctrlRim.addEventListener('input', (e) => {
      rimLight.intensity = parseFloat(e.target.value);
      document.getElementById('val-rim').textContent = rimLight.intensity.toFixed(1);
    });
  }
  if (ctrlRimColor) {
    ctrlRimColor.value = '#' + rimLight.color.getHexString();
    ctrlRimColor.addEventListener('input', (e) => {
      rimLight.color.set(e.target.value);
    });
  }

  if (ctrlHemiSky) {
    ctrlHemiSky.value = '#' + hemiLight.color.getHexString();
    ctrlHemiSky.addEventListener('input', (e) => {
      hemiLight.color.set(e.target.value);
    });
  }
  if (ctrlHemiGround) {
    ctrlHemiGround.value = '#' + hemiLight.groundColor.getHexString();
    ctrlHemiGround.addEventListener('input', (e) => {
      hemiLight.groundColor.set(e.target.value);
    });
  }

  if (ctrlCopy) {
    ctrlCopy.addEventListener('click', () => {
      const values = `
ambient: 0x${ambient.color.getHexString()}, ${ambient.intensity.toFixed(1)}
hemi: sky 0x${hemiLight.color.getHexString()}, ground 0x${hemiLight.groundColor.getHexString()}, ${hemiLight.intensity.toFixed(1)}
key: 0x${keyLight.color.getHexString()}, ${keyLight.intensity.toFixed(1)}
fill: 0x${fillLight.color.getHexString()}, ${fillLight.intensity.toFixed(1)}
rim: 0x${rimLight.color.getHexString()}, ${rimLight.intensity.toFixed(1)}
      `.trim();
      navigator.clipboard.writeText(values).then(() => {
        ctrlCopy.textContent = 'Copied!';
        setTimeout(() => { ctrlCopy.textContent = 'Copy Values'; }, 1500);
      });
    });
  }
}

function toggleLightingControls() {
  lightingControlsVisible = !lightingControlsVisible;
  if (lightingControls) {
    lightingControls.classList.toggle('hidden', !lightingControlsVisible);
  }
}

// Press 'L' to toggle lighting controls
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) return;

  if (e.key === 'l' || e.key === 'L') {
    toggleLightingControls();
  }
});

setupLightingControls();

// Mouse tracking
const mouse = new THREE.Vector2();
let mouseIsMoving = false;
let mouseIdleTimer = null;
const raycaster = new THREE.Raycaster();

// Mobile / touch detection
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const isMobile = isTouchDevice && window.innerWidth <= 900;

// Gyroscope support
let gyroEnabled = false;
let gyroPermissionGranted = false;
const gyro = { beta: 0, gamma: 0 }; // beta = front/back tilt, gamma = left/right tilt

function requestGyroPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+ requires permission
    DeviceOrientationEvent.requestPermission()
      .then((response) => {
        if (response === 'granted') {
          gyroPermissionGranted = true;
          gyroEnabled = true;
          window.addEventListener('deviceorientation', handleGyro);
        }
      })
      .catch(console.error);
  } else if ('DeviceOrientationEvent' in window) {
    // Non-iOS devices
    gyroPermissionGranted = true;
    gyroEnabled = true;
    window.addEventListener('deviceorientation', handleGyro);
  }
}

// Smoothed gyro values to prevent jitter
let smoothedBeta = 0;
let smoothedGamma = 0;
const GYRO_SMOOTHING = 0.15; // Lower = smoother but slower response

function handleGyro(event) {
  if (!gyroEnabled) return;
  try {
    // beta: -180 to 180 (front/back tilt, phone flat = 0 when horizontal, ~90 when vertical)
    // gamma: -90 to 90 (left/right tilt)
    const beta = event.beta || 0;
    const gamma = event.gamma || 0;

    // Skip invalid readings
    if (!isFinite(beta) || !isFinite(gamma)) return;

    // Handle gimbal lock when phone is near upright (beta near 90 or -90)
    // When beta is close to ±90, gamma becomes unreliable
    const isNearUpright = Math.abs(Math.abs(beta) - 90) < 10;

    // Comfortable holding angle: 50-60 degrees from horizontal
    const comfortableBeta = 55;
    let normalizedBeta = THREE.MathUtils.clamp((beta - comfortableBeta) / 45, -1, 1);

    // Map gamma -45 to 45 to -1 to 1 for horizontal tilt (left/right)
    // Reduce gamma influence when near upright to prevent wild swings
    let normalizedGamma = THREE.MathUtils.clamp(gamma / 45, -1, 1);
    if (isNearUpright) {
      normalizedGamma *= 0.3; // Dampen gamma when near upright
    }

    // Apply smoothing to prevent jitter
    smoothedBeta = THREE.MathUtils.lerp(smoothedBeta, normalizedBeta, GYRO_SMOOTHING);
    smoothedGamma = THREE.MathUtils.lerp(smoothedGamma, normalizedGamma, GYRO_SMOOTHING);

    gyro.beta = smoothedBeta;
    gyro.gamma = smoothedGamma;
  } catch (e) {
    // Silently ignore errors
  }
}

// Accelerometer for shake/motion physics
let motionEnabled = false;
const motion = { x: 0, y: 0, z: 0 }; // acceleration values
const modelVelocity = { x: 0, y: 0 }; // model movement velocity (solo mode)
const modelOffset = { x: 0, y: 0 }; // current model offset from center (solo mode)
const BOX_BOUNDS = 1.5; // invisible box size
const MOTION_DAMPING = 0.92; // velocity decay
const MOTION_SENSITIVITY = 0.008; // how much acceleration affects velocity
const BOUNCE_FACTOR = 0.6; // energy retained on bounce

// Shake detection for party mode
let shakeDetectionBuffer = [];
const SHAKE_THRESHOLD = 30; // acceleration magnitude to trigger shake
const SHAKE_WINDOW = 600; // ms to detect shake pattern
let lastMotionTime = 0;
const MOTION_THROTTLE = 50; // Only process motion every 50ms

function requestMotionPermission() {
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    // iOS 13+ requires permission
    DeviceMotionEvent.requestPermission()
      .then((response) => {
        if (response === 'granted') {
          motionEnabled = true;
          window.addEventListener('devicemotion', handleMotion);
        }
      })
      .catch(console.error);
  } else if ('DeviceMotionEvent' in window) {
    // Non-iOS devices
    motionEnabled = true;
    window.addEventListener('devicemotion', handleMotion);
  }
}

function handleMotion(event) {
  if (!motionEnabled) return;

  // Throttle motion events to reduce CPU load
  const now = Date.now();
  if (now - lastMotionTime < MOTION_THROTTLE) return;
  lastMotionTime = now;

  try {
    const accel = event.accelerationIncludingGravity;
    if (!accel) return;

    // Get acceleration, skip invalid readings
    const x = accel.x || 0;
    const y = accel.y || 0;
    const z = accel.z || 0;
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;

    motion.x = x;
    motion.y = y;
    motion.z = z;

    // Detect shake gesture to toggle party mode
    const magnitude = Math.sqrt(x * x + y * y + z * z);

    // Only track high acceleration events
    if (magnitude > SHAKE_THRESHOLD) {
      shakeDetectionBuffer.push(now);
    }

    // Remove old entries (keep only timestamps)
    shakeDetectionBuffer = shakeDetectionBuffer.filter(t => now - t < SHAKE_WINDOW);

    // Check for shake pattern
    if (shakeDetectionBuffer.length >= 4) {
      shakeDetectionBuffer = [];
      togglePartyMode();
    }
  } catch (e) {
    // Silently ignore errors
  }
}

// Old infinite grid shake removed - shake now toggles party mode

function updateMotionPhysics() {
  if (!motionEnabled || isGridMode) return;

  // Apply acceleration to velocity
  modelVelocity.x += motion.x * MOTION_SENSITIVITY;
  modelVelocity.y -= motion.y * MOTION_SENSITIVITY; // invert Y for screen coords

  // Apply damping
  modelVelocity.x *= MOTION_DAMPING;
  modelVelocity.y *= MOTION_DAMPING;

  // Update position
  modelOffset.x += modelVelocity.x;
  modelOffset.y += modelVelocity.y;

  // Bounce off invisible box walls
  if (modelOffset.x > BOX_BOUNDS) {
    modelOffset.x = BOX_BOUNDS;
    modelVelocity.x = -modelVelocity.x * BOUNCE_FACTOR;
  } else if (modelOffset.x < -BOX_BOUNDS) {
    modelOffset.x = -BOX_BOUNDS;
    modelVelocity.x = -modelVelocity.x * BOUNCE_FACTOR;
  }

  if (modelOffset.y > BOX_BOUNDS) {
    modelOffset.y = BOX_BOUNDS;
    modelVelocity.y = -modelVelocity.y * BOUNCE_FACTOR;
  } else if (modelOffset.y < -BOX_BOUNDS) {
    modelOffset.y = -BOX_BOUNDS;
    modelVelocity.y = -modelVelocity.y * BOUNCE_FACTOR;
  }
}

// Touch drag for solo mode rotation
let touchDragging = false;
let touchStartX = 0;
let touchStartY = 0;
let touchDragRotationX = 0;
let touchDragRotationY = 0;
let touchDragTargetX = 0;
let touchDragTargetY = 0;

// Mobile grid touch rotation with momentum (horizontal only)
let mobileGridTouchRotating = false;
let mobileGridTouchRotationY = 0;
let mobileGridTouchTargetY = 0;
let mobileGridRotationVelocityY = 0;
let lastMobileRotationTime = 0;
const MOBILE_ROTATION_FRICTION = 0.95; // Velocity decay per frame
const MOBILE_ROTATION_SENSITIVITY = 1.5; // How fast rotation responds to touch

// Pinch to zoom
let isPinching = false;
let initialPinchDistance = 0;
let currentZoom = 1; // 1 = default, < 1 = zoomed in, > 1 = zoomed out
const MIN_ZOOM = 0.5; // Maximum zoom in (smaller frustum)
const MAX_ZOOM = 2.0; // Maximum zoom out (larger frustum)
const baseFrustumSize = 12; // Original frustum size

function updateMousePosition(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  mouseIsMoving = true;
  clearTimeout(mouseIdleTimer);
  mouseIdleTimer = setTimeout(() => {
    mouseIsMoving = false;
  }, 3000);

  updateIntroPrompt(event);
}

// Touch handlers
let touchStartTime = 0;
let lastTapTime = 0;
const TAP_THRESHOLD = 200; // ms - taps shorter than this trigger interaction
const DOUBLE_TAP_THRESHOLD = 300; // ms - taps within this time are double tap
const DRAG_THRESHOLD = 10; // pixels - movement beyond this is a drag

function getPinchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function updateCameraZoom() {
  const zoomedFrustum = baseFrustumSize * currentZoom;
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = zoomedFrustum * aspect / -2;
  camera.right = zoomedFrustum * aspect / 2;
  camera.top = zoomedFrustum / 2;
  camera.bottom = zoomedFrustum / -2;
  camera.updateProjectionMatrix();
}

function onTouchStart(event) {
  if (event.touches.length === 2) {
    // Pinch gesture start
    isPinching = true;
    initialPinchDistance = getPinchDistance(event.touches);
    touchDragging = false;
  } else if (event.touches.length === 1) {
    const touch = event.touches[0];
    mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;

    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartTime = Date.now();
    touchDragging = false;
    isPinching = false;

    // Mobile scroll
    const config = getGridConfig();
    if (config.isMobileScroll && isGridMode) {
      mobileTouchStartY = touch.clientY;
      mobileTouchStartScroll = mobileScrollTarget;
      isMobileScrolling = true;
      mobileScrollVelocity = 0;
    }
  }
}

let lastTouchY = 0;
let lastTouchTime = 0;

function onTouchMove(event) {
  if (introActive) return;

  // Handle pinch gesture (only in solo mode)
  if (event.touches.length === 2 && isPinching && !isGridMode) {
    event.preventDefault();
    const currentDistance = getPinchDistance(event.touches);
    const scale = initialPinchDistance / currentDistance;

    // Update zoom (pinch in = smaller distance = zoom in = smaller frustum)
    const newZoom = THREE.MathUtils.clamp(currentZoom * scale, MIN_ZOOM, MAX_ZOOM);

    // Only update if changed significantly
    if (Math.abs(newZoom - currentZoom) > 0.01) {
      currentZoom = newZoom;
      initialPinchDistance = currentDistance; // Reset for continuous pinch
      updateCameraZoom();
    }
    return;
  }

  if (event.touches.length !== 1) return;

  const touch = event.touches[0];
  const deltaX = touch.clientX - touchStartX;
  const deltaY = touch.clientY - touchStartY;

  // Check if this is a drag
  if (Math.abs(deltaX) > DRAG_THRESHOLD || Math.abs(deltaY) > DRAG_THRESHOLD) {
    touchDragging = true;
  }

  // Mobile scroll in grid mode
  const config = getGridConfig();
  if (config.isMobileScroll && isGridMode && isMobileScrolling) {
    event.preventDefault();

    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - mobileTouchStartY;

    // Determine if this is rotation or vertical scroll
    // Horizontal movement = rotation, vertical movement = scroll
    // Once we start one mode, stick with it until touch ends
    if (!mobileGridTouchRotating && Math.abs(deltaX) > 15) {
      // Any horizontal movement enables rotation mode
      mobileGridTouchRotating = true;
    }

    if (mobileGridTouchRotating) {
      // Horizontal rotation only (Y axis) - no vertical to avoid scroll conflicts
      const newTargetY = (deltaX / window.innerWidth) * Math.PI * MOBILE_ROTATION_SENSITIVITY;

      // Track velocity for momentum
      const now = Date.now();
      if (lastMobileRotationTime > 0) {
        const dt = Math.max(now - lastMobileRotationTime, 1);
        mobileGridRotationVelocityY = (newTargetY - mobileGridTouchTargetY) / dt * 16; // Normalize to ~60fps
      }
      lastMobileRotationTime = now;

      mobileGridTouchTargetY = newTargetY;
    } else {
      // Vertical scroll
      const scrollDelta = mobileTouchStartY - touch.clientY;
      // Convert screen pixels to scene units (larger divisor = slower scroll)
      const scrollAmount = scrollDelta / 80;

      const bounds = getMobileScrollBounds();
      mobileScrollTarget = THREE.MathUtils.clamp(
        mobileTouchStartScroll + scrollAmount,
        bounds.min,
        bounds.max
      );

      // Track velocity for momentum
      const now = Date.now();
      if (lastTouchTime > 0) {
        const dt = now - lastTouchTime;
        if (dt > 0) {
          mobileScrollVelocity = (touch.clientY - lastTouchY) / dt * -0.5;
        }
      }
      lastTouchY = touch.clientY;
      lastTouchTime = now;
    }
    return;
  }

  // In solo mode, use touch drag to rotate model
  if (!isGridMode && touchDragging) {
    // Prevent scrolling when dragging
    event.preventDefault();

    // Map drag to rotation (full screen drag = full rotation)
    touchDragTargetY = (deltaX / window.innerWidth) * Math.PI * 1.5;
    touchDragTargetX = (deltaY / window.innerHeight) * Math.PI * 0.8; // Mirrored: swipe up = look up
  }
}

function onTouchEnd(event) {
  // Reset pinch state
  if (isPinching) {
    isPinching = false;
    // Don't trigger tap/interaction after pinch
    if (event.touches.length === 0) {
      return;
    }
  }

  // Handle mobile scroll end - snap to nearest
  const config = getGridConfig();
  if (config.isMobileScroll && isMobileScrolling) {
    isMobileScrolling = false;
    lastTouchTime = 0;

    if (mobileGridTouchRotating) {
      // Save rotation and apply momentum
      mobileGridTouchRotationY += mobileGridTouchTargetY;
      mobileGridTouchTargetY = 0;
      mobileGridTouchRotating = false;
      lastMobileRotationTime = 0;
      // Momentum continues in animate loop via velocity
    } else {
      // Apply momentum then snap
      const bounds = getMobileScrollBounds();
      mobileScrollTarget = THREE.MathUtils.clamp(
        mobileScrollTarget + mobileScrollVelocity * 10,
        bounds.min,
        bounds.max
      );

      // Snap to nearest model
      snapToNearestModel();
    }
  }

  if (introActive) {
    exitIntro();
    // Request gyro and motion permissions on first touch (required by iOS)
    if (isTouchDevice && !gyroPermissionGranted) {
      requestGyroPermission();
    }
    if (isTouchDevice && !motionEnabled) {
      requestMotionPermission();
    }
    return;
  }

  const touchDuration = Date.now() - touchStartTime;
  const wasTap = !touchDragging && !isPinching && touchDuration < TAP_THRESHOLD;

  // Reset drag state
  touchDragging = false;
  // Keep the rotation where it ended
  touchDragRotationX += touchDragTargetX;
  touchDragRotationY += touchDragTargetY;
  touchDragTargetX = 0;
  touchDragTargetY = 0;

  // Only trigger interaction on tap, not drag
  if (wasTap && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0];
    mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;

    const now = Date.now();
    const timeSinceLastTap = now - lastTapTime;
    lastTapTime = now;

    // Double tap in solo mode goes back to grid
    if (!isGridMode && timeSinceLastTap < DOUBLE_TAP_THRESHOLD) {
      toggleMode();
      return;
    }

    // On mobile scroll, tap on model goes to solo mode
    if (config.isMobileScroll && isGridMode) {
      currentModelIndex = mobileCurrentModelIndex;
      switchToModel(currentModelIndex);
      return;
    }

    handleInteraction();
  }
}

function handleInteraction() {
  if (models.length === 0) return;
  if (introJustExited) return; // Ignore click that dismissed intro

  if (isGridMode) {
    raycaster.setFromCamera(mouse, camera);

    const gridObjects = gridModels
      .map((entry) => entry.object)
      .filter((object) => object && object.visible);

    if (gridObjects.length > 0) {
      const intersections = raycaster.intersectObjects(gridObjects, true);
      if (intersections.length > 0) {
        let target = intersections[0].object;
        while (target && !target.userData?.isGrid && target.parent) {
          target = target.parent;
        }

        if (target && target.userData?.isGrid) {
          const targetIndex = target.userData.modelIndex;
          if (typeof targetIndex === 'number') {
            switchToModel(targetIndex);
            toggleMode();
            return;
          }
        }
      }
    }
  }

  const newIndex = (currentModelIndex + 1) % models.length;
  switchToModel(newIndex);
}

function onClick(event) {
  if (introActive) {
    exitIntro();
    // Request gyro permission on click for iOS (needs user gesture)
    if (isTouchDevice && !gyroPermissionGranted) {
      requestGyroPermission();
    }
    return;
  }

  if (models.length === 0) return;

  // Don't trigger interaction if user is selecting text
  const selection = window.getSelection();
  if (selection && selection.toString().length > 0) {
    return;
  }

  updateMousePosition(event);
  handleInteraction();
}

// Switch to different model
function switchToModel(index) {
  currentModelIndex = index;

  // Reset touch drag rotation when switching models
  touchDragRotationX = 0;
  touchDragRotationY = 0;
  touchDragTargetX = 0;
  touchDragTargetY = 0;

  // Reset motion physics when switching models
  modelOffset.x = 0;
  modelOffset.y = 0;
  modelVelocity.x = 0;
  modelVelocity.y = 0;

  // Reset all model positions to their base when switching
  const isPortrait = window.innerWidth / window.innerHeight < 1;
  mainModels.forEach((model) => {
    if (model.object) {
      model.object.position.x = isPortrait ? 0 : (model.object.userData.soloXPos ?? SOLO_MODEL_X_OFFSET);
      model.object.position.y = isPortrait ? 0.5 : (model.object.userData.soloYPos || 0);
    }
  });

  if (!isGridMode) {
    // Solo mode: Show/hide main models with random initial rotation
    mainModels.forEach((model, i) => {
      if (model.object) {
        const wasVisible = model.object.visible;
        model.object.visible = (i === index);

        // Set random rotation when model becomes visible
        if (!wasVisible && model.object.visible) {
          const innerObj = model.object.userData.innerObject;
          if (innerObj) {
            innerObj.rotation.x = (Math.random() - 0.5) * Math.PI * 0.8;
            innerObj.rotation.y = (Math.random() - 0.5) * Math.PI * 2;
            innerObj.rotation.z = (Math.random() - 0.5) * Math.PI * 0.3;

            // Mark as transitioning to neutral
            model.object.userData.isTransitioning = true;
          }
        }
      }
    });
  }

  updateModelInfoDisplay();
}

// Toggle between grid and solo mode
function toggleMode() {
  isGridMode = !isGridMode;

  if (isGridMode) {
    // GRID MODE
    // Reset zoom to default when entering grid mode
    if (currentZoom !== 1) {
      currentZoom = 1;
      updateCameraZoom();
    }

    // Hide solo mode elements
    mainModels.forEach(model => {
      if (model.object) model.object.visible = false;
    });
    thumbnailModels.forEach(thumb => {
      if (thumb.object) thumb.object.visible = false;
    });

    // Show grid mode elements
    gridModels.forEach(model => {
      if (model.object) model.object.visible = true;
    });
  } else {
    // SOLO MODE
    // Hide grid mode elements
    gridModels.forEach(model => {
      if (model.object) model.object.visible = false;
    });

    // Hide thumbnails in solo mode
    thumbnailModels.forEach(thumb => {
      if (thumb.object) thumb.object.visible = false;
    });

    // Show main model centered (no gallery)
    const isPortrait = window.innerWidth / window.innerHeight < 1;
    // Reset motion physics when entering solo mode
    modelOffset.x = 0;
    modelOffset.y = 0;
    modelVelocity.x = 0;
    modelVelocity.y = 0;

    mainModels.forEach((model, i) => {
      if (model.object) {
        model.object.visible = (i === currentModelIndex);
        // Center the object - on mobile center horizontally, on desktop use offset
        // Reset ALL models to their base position
        model.object.position.x = isPortrait ? 0 : (model.object.userData.soloXPos ?? SOLO_MODEL_X_OFFSET);
        model.object.position.y = isPortrait ? 0.5 : (model.object.userData.soloYPos || 0);
      }
    });
  }

  updateModeIcon();
  updateModelInfoDisplay();
}

function updateModeIcon() {
  if (!gridModeIcon) return;
  if (isGridMode) {
    gridModeIcon.classList.add('hidden');
  } else {
    gridModeIcon.classList.remove('hidden');
  }
}

function updateModelInfoDisplay() {
  if (!soloInfoPanel || !soloInfoTitle) return;

  // On mobile scroll, show current scroll model's name
  const config = getGridConfig();
  const displayIndex = (config.isMobileScroll && isGridMode)
    ? mobileCurrentModelIndex
    : currentModelIndex;

  const currentModel = models[displayIndex];
  const info = currentModel ? modelInfoById.get(currentModel.id) : null;

  // Remove description body
  if (soloInfoBody) soloInfoBody.innerHTML = '';

  if (!currentModel) {
    soloInfoTitle.textContent = '';
    soloInfoPanel.classList.remove('visible');
    return;
  }

  // Just show the name
  const heading = (info && typeof info.heading === 'string' && info.heading.trim().length > 0)
    ? info.heading
    : (currentModel.title || '');
  soloInfoTitle.textContent = heading;

  // Update mobile header model name
  if (currentModelNameEl) {
    currentModelNameEl.textContent = heading || 'Model';
  }

  const hasContent = Boolean(heading);
  // Show in solo mode OR in mobile scroll grid mode
  const shouldShow = !introActive && hasContent && (!isGridMode || config.isMobileScroll);
  if (shouldShow) {
    soloInfoPanel.classList.add('visible');
  } else {
    soloInfoPanel.classList.remove('visible');
  }

  // Update dropdown active state
  updateDropdownActiveState(displayIndex);
}

function updateSoloInfoTransform() {
  // Label is now static - no mouse following or special effects
  // Color is handled by CSS dark mode classes
}

// Mobile dropdown functions
function toggleDropdown() {
  dropdownOpen = !dropdownOpen;
  if (modelDropdown) {
    modelDropdown.classList.toggle('visible', dropdownOpen);
    modelDropdown.classList.toggle('hidden', !dropdownOpen);
  }
  if (modelSelectorBtn) {
    modelSelectorBtn.classList.toggle('open', dropdownOpen);
  }
}

function closeDropdown() {
  dropdownOpen = false;
  if (modelDropdown) {
    modelDropdown.classList.remove('visible');
    modelDropdown.classList.add('hidden');
  }
  if (modelSelectorBtn) {
    modelSelectorBtn.classList.remove('open');
  }
}

function populateDropdown() {
  if (!modelDropdownList) return;
  modelDropdownList.innerHTML = '';

  models.forEach((model, index) => {
    const info = modelInfoById.get(model.id);
    const name = (info && info.heading) ? info.heading : (model.title || `Model ${index + 1}`);

    const item = document.createElement('div');
    item.className = 'dropdown-item';
    item.textContent = name;
    item.dataset.index = index;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      scrollToModel(index);
      closeDropdown();
    });

    modelDropdownList.appendChild(item);
  });
}

function updateDropdownActiveState(activeIndex) {
  if (!modelDropdownList) return;
  const items = modelDropdownList.querySelectorAll('.dropdown-item');
  items.forEach((item, index) => {
    item.classList.toggle('active', index === activeIndex);
  });
}

function scrollToModel(index) {
  const config = getGridConfig();
  if (!config.isMobileScroll) return;

  // Smooth scroll by setting target - the animate loop will interpolate
  mobileScrollTarget = index * config.cellHeight;
  mobileCurrentModelIndex = index;

  // Reset touch rotation for new model
  mobileGridTouchRotationY = 0;
  mobileGridTouchTargetY = 0;
  mobileGridRotationVelocityY = 0;

  updateModelInfoDisplay();
}

// Setup dropdown event listeners
if (modelSelectorBtn) {
  modelSelectorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });
}

if (modelDropdownInfo) {
  modelDropdownInfo.addEventListener('click', (e) => {
    e.stopPropagation();
    closeDropdown();
    // Scroll to text section
    const textSection = document.getElementById('text-section');
    if (textSection) {
      textSection.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (dropdownOpen && modelDropdown && !modelDropdown.contains(e.target) && e.target !== modelSelectorBtn) {
    closeDropdown();
  }
});

// Prevent immediate interaction after intro exit
let introJustExited = false;

function exitIntro() {
  if (!introActive) return;
  introActive = false;
  introJustExited = true;

  // Small delay before allowing interactions
  setTimeout(() => {
    introJustExited = false;
  }, 300);

  // Enable scrolling
  document.body.classList.remove('intro-active');

  if (introOverlay) {
    introOverlay.classList.add('hidden');
  }

  if (introVideo) {
    introVideo.pause();
  }

  if (introPrompt) {
    introPrompt.classList.remove('visible');
  }

  clearIntroPromptTimers();

  // Always enter grid mode after intro (for both desktop and mobile)
  isGridMode = false; // Force to false first
  toggleMode(); // Then toggle to grid mode

  // Trigger grid intro animation
  gridIntroAnimationId += 1;
  gridIntroRandomizationPending = true;
  triggerGridIntroRandomization();

  updateModelInfoDisplay();
}

function showIntro() {
  if (!introOverlay) return;

  introActive = true;
  introOverlay.classList.remove('hidden');

  if (introPrompt) {
    introPrompt.classList.remove('visible');
  }

  clearIntroPromptTimers();

  if (introVideo) {
    introVideo.currentTime = 0;
    const playPromise = introVideo.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }

  updateModelInfoDisplay();
}

function clearIntroPromptTimers() {
  if (introPromptHideTimer) {
    clearTimeout(introPromptHideTimer);
    introPromptHideTimer = null;
  }
  if (introPromptMoveHandle) {
    cancelAnimationFrame(introPromptMoveHandle);
    introPromptMoveHandle = null;
  }
  introPromptPendingPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  introPromptCurrentPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  introPromptAnimating = false;
}

function scheduleIntroPromptHide() {
  if (!introPrompt) return;
  if (introPromptHideTimer) {
    clearTimeout(introPromptHideTimer);
  }
  introPromptHideTimer = setTimeout(() => {
    introPrompt.classList.remove('visible');
    introPromptHideTimer = null;
  }, 2000);
}

function updateIntroPrompt(event) {
  if (!introPrompt) return;

  if (!introActive) {
    introPrompt.classList.remove('visible');
    clearIntroPromptTimers();
    return;
  }

  // On touch devices, always show centered prompt
  if (isTouchDevice) {
    if (!introPrompt.classList.contains('visible')) {
      introPrompt.classList.add('visible');
    }
    return;
  }

  const offsetX = 18;
  const offsetY = 28;
  const promptWidth = introPrompt.offsetWidth || 0;
  const promptHeight = introPrompt.offsetHeight || 0;
  const maxX = window.innerWidth - promptWidth - 20;
  const maxY = window.innerHeight - promptHeight - 20;
  const minX = 20;
  const minY = 20;

  const targetX = Math.min(maxX, Math.max(minX, event.clientX + offsetX));
  const targetY = Math.min(maxY, Math.max(minY, event.clientY + offsetY));

  introPromptPendingPosition = { x: targetX, y: targetY };

  if (!introPrompt.classList.contains('visible')) {
    introPrompt.classList.add('visible');
  }

  scheduleIntroPromptHide();

  if (!introPromptAnimating) {
    introPromptAnimating = true;
    animateIntroPrompt();
  }
}

function animateIntroPrompt() {
  if (!introPromptAnimating) return;
  if (!introActive) {
    introPromptAnimating = false;
    introPromptMoveHandle = null;
    return;
  }

  const { x: targetX, y: targetY } = introPromptPendingPosition || introPromptCurrentPosition;
  introPromptCurrentPosition.x += (targetX - introPromptCurrentPosition.x) * 0.12;
  introPromptCurrentPosition.y += (targetY - introPromptCurrentPosition.y) * 0.12;

  introPrompt.style.left = `${introPromptCurrentPosition.x}px`;
  introPrompt.style.top = `${introPromptCurrentPosition.y}px`;

  const dx = targetX - introPromptCurrentPosition.x;
  const dy = targetY - introPromptCurrentPosition.y;
  const closeEnough = Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5;

  if (closeEnough) {
    introPromptCurrentPosition.x = targetX;
    introPromptCurrentPosition.y = targetY;
    introPromptPendingPosition = null;
    introPromptMoveHandle = null;
    introPromptAnimating = false;
    return;
  }

  introPromptMoveHandle = requestAnimationFrame(animateIntroPrompt);
}

function triggerGridIntroRandomization() {
  if (!gridIntroRandomizationPending || !isGridMode) return;

  let awaiting = false;
  gridModels.forEach((entry) => {
    if (!entry || !entry.object) {
      awaiting = true;
      return;
    }
    applyGridIntroRandomization(entry);
  });

  if (!awaiting) {
    gridIntroRandomizationPending = false;
  }
}

function applyGridIntroRandomization(entry) {
  const group = entry && entry.object;
  if (!group) return false;
  if (group.userData.gridIntroAnimationId === gridIntroAnimationId) {
    group.userData.gridIntroAnimating = true;
    return false;
  }

  const innerObj = group.userData.innerObject;
  if (!innerObj) return false;

  innerObj.rotation.x = (Math.random() - 0.5) * Math.PI * 1.2;
  innerObj.rotation.y = (Math.random() - 0.5) * Math.PI * 2;
  innerObj.rotation.z = (Math.random() - 0.5) * Math.PI * 0.4;

  group.userData.gridIntroAnimating = true;
  group.userData.gridIntroAnimationId = gridIntroAnimationId;
  return true;
}

// Update thumbnail opacity
function updateThumbnailHighlights() {
  thumbnailModels.forEach((thumb, index) => {
    if (thumb.object) {
      const opacity = index === currentModelIndex ? 1.0 : 0.4;
      thumb.object.traverse((child) => {
        if (child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach(mat => {
            mat.transparent = true;
            mat.opacity = opacity;
          });
        }
      });
    }
  });
}

window.addEventListener('mousemove', updateMousePosition);
window.addEventListener('click', onClick);
window.addEventListener('touchstart', onTouchStart, { passive: true });
window.addEventListener('touchmove', onTouchMove, { passive: false });
window.addEventListener('touchend', onTouchEnd);

// iOS Safari: also add touch listeners directly to intro overlay and video
// because touch events on video elements can behave differently
if (introOverlay) {
  introOverlay.addEventListener('click', onClick);
  introOverlay.addEventListener('touchend', onTouchEnd);
}
if (introVideo) {
  introVideo.addEventListener('click', onClick);
  introVideo.addEventListener('touchend', onTouchEnd);
}

// Keyboard navigation
window.addEventListener('keydown', (event) => {
  if (event.key === 'r' || event.key === 'R') {
    event.preventDefault();
    showIntro();
    return;
  }

  if (introActive) return;
  if (models.length === 0) return;
  if (event.key === 'ArrowLeft') {
    const newIndex = (currentModelIndex - 1 + models.length) % models.length;
    switchToModel(newIndex);
  } else if (event.key === 'ArrowRight') {
    const newIndex = (currentModelIndex + 1) % models.length;
    switchToModel(newIndex);
  } else if (event.key === 'g' || event.key === 'G') {
    toggleMode();
  } else if (event.code === 'Space') {
    event.preventDefault();
    togglePartyMode();
  }
});

// Loading
let modelsLoaded = 0;
let totalAssetsToLoad = 0;
let hasCompletedInitialLoad = false;
const loadingScreen = document.getElementById('loading-screen');

const loadingBar = document.getElementById('loading-bar');

function checkLoadingComplete() {
  modelsLoaded++;

  // Update loading bar progress
  if (loadingBar && totalAssetsToLoad > 0) {
    const progress = Math.min((modelsLoaded / totalAssetsToLoad) * 100, 100);
    loadingBar.style.width = `${progress}%`;
  }

  if (!hasCompletedInitialLoad && totalAssetsToLoad > 0 && modelsLoaded >= totalAssetsToLoad) {
    hasCompletedInitialLoad = true;
    prewarmGridModels();
    setTimeout(() => {
      loadingScreen.classList.add('hidden');
      // Show intro prompt only after loading is complete
      if (introPrompt && introActive) {
        introPrompt.textContent = isTouchDevice ? 'TAP TO ENTER' : 'CLICK TO ENTER';
        introPrompt.classList.add('visible');
      }
    }, 500);
  }
}

function prewarmGridModels() {
  if (!renderer) return;

  const mainVisibility = mainModels.map((model) => model.object ? model.object.visible : false);
  const gridVisibility = gridModels.map((model) => model.object ? model.object.visible : false);

  mainModels.forEach((model) => {
    if (model.object) model.object.visible = false;
  });
  gridModels.forEach((model) => {
    if (model.object) model.object.visible = true;
  });

  if (typeof renderer.compile === 'function') {
    renderer.compile(scene, camera);
  }
  renderer.render(scene, camera);

  gridModels.forEach((model, index) => {
    if (model.object) model.object.visible = gridVisibility[index];
  });
  mainModels.forEach((model, index) => {
    if (model.object) model.object.visible = mainVisibility[index];
  });
}

function showLoadingError(message) {
  if (!loadingScreen) return;
  loadingScreen.classList.remove('hidden');
  let messageElement = loadingScreen.querySelector('.loading-error');
  if (!messageElement) {
    messageElement = document.createElement('p');
    messageElement.classList.add('loading-error');
    loadingScreen.appendChild(messageElement);
  }
  messageElement.textContent = message;
}

// Helper to split file paths
function splitPath(path) {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash === -1) return { basePath: '', fileName: path };
  return {
    basePath: path.slice(0, lastSlash + 1),
    fileName: path.slice(lastSlash + 1),
  };
}

// Process loaded model
function processModel(object3d, modelConfig, isMain, modelIndex) {
  // Setup materials
  object3d.traverse((child) => {
    if (child.isMesh) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material) return;
        material.flatShading = false;

        const hasPBRMaps = material.map || material.normalMap || material.roughnessMap || material.metalnessMap || material.transmissionMap || material.clearcoatMap;
        const usesTransmission = material.transmission !== undefined && material.transmission > 0;

        if (!hasPBRMaps && !usesTransmission) {
          if (material.roughness !== undefined) material.roughness *= 0.3;
          if (material.metalness !== undefined) material.metalness = Math.max(material.metalness, 0.6);
        }

        material.needsUpdate = true;
      });
    }
  });

  // Center and scale
  const initialBBox = new THREE.Box3().setFromObject(object3d);
  const initialSize = new THREE.Vector3();
  const initialCenter = new THREE.Vector3();
  initialBBox.getSize(initialSize);
  initialBBox.getCenter(initialCenter);

  object3d.position.sub(initialCenter);

  const maxDimension = Math.max(initialSize.x, initialSize.y, initialSize.z) || 1;
  const desiredSize = isMain ? 4.725 : 0.8; // Solo figurines are now ~30% smaller
  const computedScale = desiredSize / maxDimension;
  const manualScale = typeof modelConfig.scale === 'number' ? modelConfig.scale : 1;
  object3d.scale.multiplyScalar(computedScale * manualScale);

  // Recalculate after scaling for perfect centering
  object3d.updateMatrixWorld(true);
  const scaledBBox = new THREE.Box3().setFromObject(object3d);
  const scaledCenter = new THREE.Vector3();
  scaledBBox.getCenter(scaledCenter);
  object3d.position.sub(scaledCenter);

  // Create group
  const group = new THREE.Group();
  group.add(object3d);

  if (isMain) {
    // Main model - starts in solo mode centered vertically
    const soloXPos = SOLO_MODEL_X_OFFSET + (modelConfig.xOffset || 0);
    const soloYPos = (modelConfig.yOffset || 0);
    const galleryYPos = 1.0 + (modelConfig.yOffset || 0);
    group.position.set(soloXPos, soloYPos, 0); // Start in solo position
    group.visible = !isGridMode && (modelIndex === currentModelIndex);
    group.userData.modelIndex = modelIndex;
    group.userData.isMain = isMain;
    group.userData.innerObject = object3d;
    group.userData.soloXPos = soloXPos;
    group.userData.soloYPos = soloYPos;
    group.userData.galleryYPos = galleryYPos;
    scene.add(group);
    mainModels[modelIndex] = { object: group };
    // Count main model loading completion
    checkLoadingComplete();
  } else {
    // Thumbnail - bottom row, smaller spacing for smaller thumbs
    const thumbSpacing = 1.5;
    const totalWidth = (models.length - 1) * thumbSpacing;
    const startX = -totalWidth / 2;
    group.position.set(startX + (modelIndex * thumbSpacing), -5.5, 0);
    group.userData.modelIndex = modelIndex;
    group.userData.isMain = isMain;
    group.userData.innerObject = object3d;
    scene.add(group);
    thumbnailModels[modelIndex] = { object: group };
  }
}

// Process grid model (for 5x2 grid layout)
function processGridModel(object3d, modelConfig, modelIndex) {
  // Setup materials
  object3d.traverse((child) => {
    if (child.isMesh) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material) return;
        material.flatShading = false;

        const hasPBRMaps = material.map || material.normalMap || material.roughnessMap || material.metalnessMap || material.transmissionMap || material.clearcoatMap;
        const usesTransmission = material.transmission !== undefined && material.transmission > 0;

        if (!hasPBRMaps && !usesTransmission) {
          if (material.roughness !== undefined) material.roughness *= 0.3;
          if (material.metalness !== undefined) material.metalness = Math.max(material.metalness, 0.6);
        }

        material.needsUpdate = true;
      });
    }
  });

  // Center and scale for grid
  const initialBBox = new THREE.Box3().setFromObject(object3d);
  const initialSize = new THREE.Vector3();
  const initialCenter = new THREE.Vector3();
  initialBBox.getSize(initialSize);
  initialBBox.getCenter(initialCenter);

  object3d.position.sub(initialCenter);

  const maxDimension = Math.max(initialSize.x, initialSize.y, initialSize.z) || 1;
  const gridConfig = getGridConfig();
  const desiredSize = gridConfig.modelSize; // Use responsive model size
  const computedScale = desiredSize / maxDimension;
  const manualScale = typeof modelConfig.scale === 'number' ? modelConfig.scale : 1;
  object3d.scale.multiplyScalar(computedScale * manualScale);

  // Recalculate after scaling
  object3d.updateMatrixWorld(true);
  const scaledBBox = new THREE.Box3().setFromObject(object3d);
  const scaledCenter = new THREE.Vector3();
  scaledBBox.getCenter(scaledCenter);
  object3d.position.sub(scaledCenter);

  // For desktop grid: align base so models rest on same baseline
  // For mobile scroll: keep center-aligned for even visual spacing
  if (!gridConfig.isMobileScroll) {
    object3d.updateMatrixWorld(true);
    const finalBBox = new THREE.Box3().setFromObject(object3d);
    const minY = finalBBox.min.y;
    object3d.position.y -= minY;
  }

  const overrideDeg = GRID_ROTATION_OVERRIDE_DEG[modelConfig.id];
  const rotationDeg = typeof modelConfig.gridRotationDeg === 'number'
    ? modelConfig.gridRotationDeg
    : (overrideDeg !== undefined ? overrideDeg : DEFAULT_GRID_ROTATION_DEG);
  const rotationRad = THREE.MathUtils.degToRad(rotationDeg);
  object3d.rotation.y += rotationRad;

  // Create group
  const group = new THREE.Group();
  group.add(object3d);

  // Responsive grid layout: 5x2 on desktop, 2x5 on mobile
  const gridPosition = getGridPosition(modelIndex);
  group.position.set(gridPosition.x, gridPosition.y, 0);
  group.visible = isGridMode; // Match current mode so intro toggles work even before load completes
  group.userData.modelIndex = modelIndex;
  group.userData.isGrid = true;
  group.userData.innerObject = object3d;
  group.userData.baseRotationY = object3d.rotation.y;
  group.userData.baseRotationX = object3d.rotation.x;
  group.userData.baseScale = object3d.scale.x; // Store for responsive rescaling

  scene.add(group);
  gridModels[modelIndex] = { object: group };
  triggerGridIntroRandomization();
  checkLoadingComplete();
}

// Load a single model
function loadModel(modelConfig, modelIndex, isMain) {
  if (modelConfig.glb) {
    const gltfLoader = new GLTFLoader();
    if (dracoLoader) {
      gltfLoader.setDRACOLoader(dracoLoader);
    }
    const { basePath: glbBasePath, fileName: glbFileName } = splitPath(modelConfig.glb);

    if (glbBasePath) {
      gltfLoader.setPath(glbBasePath);
      gltfLoader.setResourcePath(glbBasePath);
    }

    gltfLoader.load(
      glbBasePath ? glbFileName : modelConfig.glb,
      (gltf) => {
        const source = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (!source) {
          console.error('GLB does not contain a scene:', modelConfig.glb);
          return;
        }
        const mainClone = source.clone(true);
        processModel(mainClone, modelConfig, isMain, modelIndex);

        if (isMain) {
          const gridClone = source.clone(true);
          processGridModel(gridClone, modelConfig, modelIndex);
        }
      },
      undefined,
      (error) => {
        console.error('Error loading GLB:', error);
      }
    );
    return;
  }

  if (!modelConfig.obj) {
    console.error('Model configuration missing obj or glb path:', modelConfig);
    return;
  }

  const objLoader = new OBJLoader();
  const { basePath: objBasePath, fileName: objFileName } = splitPath(modelConfig.obj);

  if (objBasePath) {
    objLoader.setPath(objBasePath);
    objLoader.setResourcePath(objBasePath);
  }

  const loadObj = () => {
    objLoader.load(
      objBasePath ? objFileName : modelConfig.obj,
      (object) => {
        const mainClone = object.clone(true);
        processModel(mainClone, modelConfig, isMain, modelIndex);

        if (isMain) {
          const gridClone = object.clone(true);
          processGridModel(gridClone, modelConfig, modelIndex);
        }
      },
      undefined,
      (error) => {
        console.error('Error loading OBJ:', error);
      }
    );
  };

  if (modelConfig.mtl) {
    const { basePath: mtlBasePath, fileName: mtlFileName } = splitPath(modelConfig.mtl);
    const mtlLoader = new MTLLoader();

    if (mtlBasePath) {
      mtlLoader.setPath(mtlBasePath);
      mtlLoader.setResourcePath(mtlBasePath);
    }

    mtlLoader.load(
      mtlBasePath ? mtlFileName : modelConfig.mtl,
      (materials) => {
        materials.preload();
        objLoader.setMaterials(materials);
        loadObj();
      },
      undefined,
      (error) => {
        console.error('Error loading MTL:', error);
        loadObj();
      }
    );
  } else {
    loadObj();
  }
}

async function loadModelManifest() {
  const response = await fetch('./models.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Model manifest must be an array');
  }
  return data;
}

async function loadModelInfo() {
  const response = await fetch('./model-info.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const entries = await response.json();
  if (!Array.isArray(entries)) {
    throw new Error('Model info manifest must be an array');
  }

  const infoMap = new Map();
  entries.forEach((entry) => {
    if (!entry || typeof entry.id !== 'string') return;
    const id = entry.id.trim();
    if (!id) return;

    const heading = typeof entry.heading === 'string' ? entry.heading : '';
    const lines = Array.isArray(entry.lines)
      ? entry.lines
          .map((line) => typeof line === 'string' ? line.trim() : '')
          .filter((line) => line.length > 0)
      : [];

    infoMap.set(id, { heading, lines });
  });
  return infoMap;
}

async function init() {
  try {
    models = await loadModelManifest();
  } catch (error) {
    console.error('Failed to load model manifest:', error);
    showLoadingError('Failed to load models. Check the console for details.');
    return;
  }

  try {
    modelInfoById = await loadModelInfo();
  } catch (error) {
    console.warn('Failed to load model info:', error);
    modelInfoById = new Map();
  }

  if (models.length === 0) {
    console.warn('No models found in models.json.');
    showLoadingError('No models available. Add files to the objs folder and rebuild.');
    return;
  }

  modelsLoaded = 0;
  totalAssetsToLoad = models.length * 2;
  hasCompletedInitialLoad = false;
  mainModels.length = 0;
  gridModels.length = 0;
  thumbnailModels.length = 0;

  models.forEach((modelConfig, index) => {
    loadModel(modelConfig, index, true);  // Main model + grid variant
  });

  switchToModel(0);
  updateThumbnailHighlights();
  updateModeIcon();
  updateModelInfoDisplay();
  populateDropdown();
}

init();

// Request gyro/motion permissions early on touch devices
// iOS requires user gesture, but Android can request immediately
if (isTouchDevice) {
  // Try requesting immediately (works on Android)
  requestGyroPermission();
  requestMotionPermission();
}

// Text section - load and reveal
const textContent = document.getElementById('text-content');
const goUpBtn = document.getElementById('go-up-btn');

// Set intro-active class initially to prevent scrolling
document.body.classList.add('intro-active');

async function loadTextContent() {
  try {
    const response = await fetch('./text.txt');
    if (!response.ok) throw new Error('Failed to load text.txt');
    const text = await response.text();

    // Split into lines - each line becomes its own element
    const lines = text.split('\n');

    lines.forEach((line, index) => {
      const p = document.createElement('p');
      p.className = 'text-line';
      p.dataset.index = index;

      if (line.trim() === '') {
        // Empty line becomes a spacer
        p.innerHTML = '&nbsp;';
        p.classList.add('spacer');
      } else {
        // Parse **bold** text
        const parsedLine = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        p.innerHTML = parsedLine;
      }

      textContent.appendChild(p);
    });

    // Setup intersection observer for blur reveal
    setupBlurReveal();
  } catch (error) {
    console.warn('Could not load text.txt:', error);
  }
}

let revealQueue = [];
let isRevealing = false;

function setupBlurReveal() {
  const textLines = document.querySelectorAll('.text-line');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.classList.contains('revealed')) {
        // Add to queue for staggered reveal
        if (!revealQueue.includes(entry.target)) {
          revealQueue.push(entry.target);
        }
        processRevealQueue();
      } else if (!entry.isIntersecting && entry.target.classList.contains('revealed')) {
        // Blur back when scrolling out of view
        entry.target.classList.remove('revealed');
        // Remove from queue if it was waiting
        const queueIndex = revealQueue.indexOf(entry.target);
        if (queueIndex > -1) {
          revealQueue.splice(queueIndex, 1);
        }
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '50px 0px -50px 0px'
  });

  textLines.forEach(line => observer.observe(line));
}

function processRevealQueue() {
  if (isRevealing || revealQueue.length === 0) return;

  isRevealing = true;

  // Sort by index to reveal in order
  revealQueue.sort((a, b) => parseInt(a.dataset.index) - parseInt(b.dataset.index));

  const element = revealQueue.shift();
  element.classList.add('revealed');

  // Delay before revealing next line
  setTimeout(() => {
    isRevealing = false;
    processRevealQueue();
  }, 60);
}

// Go Up button
if (goUpBtn) {
  goUpBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

loadTextContent();

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  // Mobile scroll - smooth interpolation
  const config = getGridConfig();
  if (config.isMobileScroll && isGridMode) {
    // Smoothly move toward target
    mobileScrollY = THREE.MathUtils.lerp(mobileScrollY, mobileScrollTarget, 0.15);

    // Move camera to show current scroll position
    camera.position.y = -mobileScrollY;

    // Update current model index based on scroll
    const newIndex = Math.round(mobileScrollY / config.cellHeight);
    if (newIndex !== mobileCurrentModelIndex && newIndex >= 0 && newIndex < models.length) {
      mobileCurrentModelIndex = newIndex;
      // Reset touch rotation when switching to new model
      mobileGridTouchRotationY = 0;
      mobileGridTouchTargetY = 0;
      mobileGridRotationVelocityY = 0;
      updateModelInfoDisplay();
    }
  } else if (isGridMode) {
    // Desktop grid mode - camera at origin
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, 0, 0.1);
  }

  if (isGridMode) {
    // GRID MODE: Mouse-follow rotation for all grid models
    gridModels.forEach((model, modelIndex) => {
      const group = model.object;
      if (!group || !group.visible) return;
      const innerObj = group.userData.innerObject;
      if (!innerObj) return;

      const baseRotationY = group.userData.baseRotationY || 0;
      const baseRotationX = group.userData.baseRotationX || 0;

      // Debug mode: return to default rotation
      if (lightingControlsVisible) {
        innerObj.rotation.y = THREE.MathUtils.lerp(innerObj.rotation.y, baseRotationY, 0.1);
        innerObj.rotation.x = THREE.MathUtils.lerp(innerObj.rotation.x, baseRotationX, 0.1);
        innerObj.rotation.z = THREE.MathUtils.lerp(innerObj.rotation.z, 0, 0.1);
        return;
      }

      if (group.userData.gridIntroAnimating) {
        innerObj.rotation.y = THREE.MathUtils.lerp(innerObj.rotation.y, baseRotationY, 0.08);
        innerObj.rotation.x = THREE.MathUtils.lerp(innerObj.rotation.x, baseRotationX, 0.08);
        innerObj.rotation.z = THREE.MathUtils.lerp(innerObj.rotation.z, 0, 0.08);

        const delta = Math.abs(innerObj.rotation.y - baseRotationY)
          + Math.abs(innerObj.rotation.x - baseRotationX)
          + Math.abs(innerObj.rotation.z);

        if (delta < 0.02) {
          innerObj.rotation.set(baseRotationX, baseRotationY, 0);
          group.userData.gridIntroAnimating = false;
        }
        return;
      }

      // Mobile grid touch rotation - only for current model
      // Horizontal (Y) from touch, vertical (X) from gyro only
      const isMobileScrollConfig = config.isMobileScroll;
      if (isMobileScrollConfig && modelIndex === mobileCurrentModelIndex) {
        // Apply momentum when not actively touching
        if (!mobileGridTouchRotating) {
          mobileGridTouchRotationY += mobileGridRotationVelocityY;
          mobileGridRotationVelocityY *= MOBILE_ROTATION_FRICTION;

          // Stop tiny movements
          if (Math.abs(mobileGridRotationVelocityY) < 0.0001) mobileGridRotationVelocityY = 0;
        }

        const touchRotY = mobileGridTouchRotationY + mobileGridTouchTargetY;
        const targetRotationY = baseRotationY + touchRotY;

        // Gyro controls both axes - touch only adds to horizontal
        let gyroOffsetY = 0;
        let gyroOffsetX = 0;
        if (gyroEnabled) {
          gyroOffsetY = gyro.gamma * Math.PI * 0.2;
          gyroOffsetX = gyro.beta * Math.PI * 0.15; // Vertical tilt from gyro
        }

        innerObj.rotation.y = THREE.MathUtils.lerp(innerObj.rotation.y, targetRotationY + gyroOffsetY, 0.15);
        innerObj.rotation.x = THREE.MathUtils.lerp(innerObj.rotation.x, baseRotationX + gyroOffsetX, 0.12);
        innerObj.rotation.z = THREE.MathUtils.lerp(innerObj.rotation.z, 0, 0.08);
        return;
      }

      // All models rotate based on gyroscope (mobile) or mouse (desktop)
      let inputX, inputY;
      if (gyroEnabled) {
        inputX = gyro.gamma; // left/right tilt
        inputY = gyro.beta;  // front/back tilt
      } else {
        inputX = mouse.x;
        inputY = mouse.y;
      }

      // Vertical rotation limits - see more top, less bottom
      const MAX_TILT_UP = Math.PI * 0.18;   // ~32 degrees - can see top nicely
      const MAX_TILT_DOWN = Math.PI * 0.06; // ~11 degrees - very limited bottom view

      const targetRotationY = baseRotationY + inputX * Math.PI * 0.4;
      let targetRotationX = baseRotationX - inputY * Math.PI * 0.4;
      // Clamp vertical rotation relative to base
      const relativeX = targetRotationX - baseRotationX;
      const clampedRelativeX = THREE.MathUtils.clamp(relativeX, -MAX_TILT_DOWN, MAX_TILT_UP);
      targetRotationX = baseRotationX + clampedRelativeX;

      innerObj.rotation.y = THREE.MathUtils.lerp(innerObj.rotation.y, targetRotationY, 0.1);
      innerObj.rotation.x = THREE.MathUtils.lerp(innerObj.rotation.x, targetRotationX, 0.1);
      innerObj.rotation.z = THREE.MathUtils.lerp(innerObj.rotation.z, 0, 0.08);
    });
  } else {
    // SOLO MODE: Model pinned at center, full rotation inspection via drag or gyro
    const mainModel = mainModels[currentModelIndex];
    if (mainModel && mainModel.object) {
      const innerObj = mainModel.object.userData.innerObject;

      // Keep model centered (no position movement)
      const isPortrait = window.innerWidth / window.innerHeight < 1;
      mainModel.object.position.x = isPortrait ? 0 : (mainModel.object.userData.soloXPos ?? SOLO_MODEL_X_OFFSET);
      mainModel.object.position.y = isPortrait ? 0.5 : (mainModel.object.userData.soloYPos || 0);

      // Debug mode: return to default rotation
      if (lightingControlsVisible && innerObj) {
        innerObj.rotation.x = THREE.MathUtils.lerp(innerObj.rotation.x, 0, 0.1);
        innerObj.rotation.y = THREE.MathUtils.lerp(innerObj.rotation.y, 0, 0.1);
        innerObj.rotation.z = THREE.MathUtils.lerp(innerObj.rotation.z, 0, 0.1);
      } else {
      // Get input from touch drag, gyroscope, or mouse
      let targetRotationX, targetRotationY;
      const hasGyroInput = gyroEnabled && (Math.abs(gyro.gamma) > 0.01 || Math.abs(gyro.beta) > 0.01);
      const hasTouchDragInput = touchDragging || (touchDragRotationX !== 0 || touchDragRotationY !== 0);

      if (hasTouchDragInput) {
        // Touch drag - full rotation control
        targetRotationY = touchDragRotationY + touchDragTargetY;
        targetRotationX = touchDragRotationX + touchDragTargetX;
      } else if (hasGyroInput) {
        // Gyro control - amplified for full inspection
        targetRotationY = gyro.gamma * Math.PI * 0.5;
        targetRotationX = gyro.beta * Math.PI * 0.4; // Mirrored: tilt forward = look up
      } else if (mouseIsMoving) {
        targetRotationY = mouse.x * Math.PI * SOLO_MOUSE_ROTATION_Y_FACTOR;
        targetRotationX = -mouse.y * Math.PI * SOLO_MOUSE_ROTATION_X_FACTOR; // Mouse up = look at top
      } else {
        targetRotationX = 0;
        targetRotationY = 0;
      }

      const hasActiveInput = hasGyroInput || mouseIsMoving || hasTouchDragInput;

      // Check if transitioning from initial random rotation
      if (mainModel.object.userData.isTransitioning && innerObj) {
        innerObj.rotation.x = THREE.MathUtils.lerp(innerObj.rotation.x, targetRotationX, SOLO_MODEL_TRANSITION_SPEED);
        innerObj.rotation.y = THREE.MathUtils.lerp(innerObj.rotation.y, targetRotationY, SOLO_MODEL_TRANSITION_SPEED);
        innerObj.rotation.z = THREE.MathUtils.lerp(innerObj.rotation.z, 0, SOLO_MODEL_TRANSITION_SPEED);

        const rotationDelta = Math.abs(innerObj.rotation.x - targetRotationX)
          + Math.abs(innerObj.rotation.y - targetRotationY)
          + Math.abs(innerObj.rotation.z);
        if (rotationDelta < SOLO_MODEL_TRANSITION_THRESHOLD) {
          innerObj.rotation.set(targetRotationX, targetRotationY, 0);
          mainModel.object.userData.isTransitioning = false;
        }
      } else if (innerObj && hasActiveInput) {
        // Active input control (touch drag, gyro, or mouse)
        innerObj.rotation.y = THREE.MathUtils.lerp(innerObj.rotation.y, targetRotationY, 0.12);
        innerObj.rotation.x = THREE.MathUtils.lerp(innerObj.rotation.x, targetRotationX, 0.12);
      } else if (innerObj && !mainModel.object.userData.isTransitioning) {
        // Return to neutral when input stops
        innerObj.rotation.x *= 0.94;
        innerObj.rotation.y *= 0.94;
      }
      } // end of else (not debug mode)
    }
  }

  updateSoloInfoTransform();
  renderer.render(scene, camera);
}

animate();

// Handle resize
window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  const zoomedFrustum = baseFrustumSize * currentZoom;
  camera.left = zoomedFrustum * aspect / -2;
  camera.right = zoomedFrustum * aspect / 2;
  camera.top = zoomedFrustum / 2;
  camera.bottom = zoomedFrustum / -2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Update grid layout for orientation changes
  updateGridLayout();
});
