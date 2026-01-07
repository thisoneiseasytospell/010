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
const sceneModels = []; // Single set of models used for both grid and solo modes
let modelInfoById = new Map();

// Scale factors for different modes
const GRID_MODEL_SIZE = 2.916;
const SOLO_MODEL_SIZE = 4.725;

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
    // cellHeight controls spacing - larger = more space between models
    return {
      cols: 1,
      rows: 10, // All models in one column
      cellWidth: 0, // Not used for single column
      cellHeight: 7.0, // Spacing between models
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
    // Mobile: single column, vertically stacked, centered at camera y position
    return {
      x: 0,
      y: -modelIndex * cellHeight
    };
  }

  const rows = Math.ceil(models.length / cols);
  const gridWidth = cols * cellWidth;
  const gridHeight = rows * cellHeight;

  const col = modelIndex % cols;
  const row = Math.floor(modelIndex / cols);

  const x = (col * cellWidth) - (gridWidth / 2) + (cellWidth / 2);
  // Center the grid vertically, offset for bottom-aligned models
  const y = (rows / 2 - row - 0.5) * cellHeight - (config.modelSize / 2);

  return { x, y };
}

function updateGridLayout() {
  const config = getGridConfig();

  sceneModels.forEach((entry, index) => {
    if (!entry || !entry.object) return;

    const pos = getGridPosition(index);
    entry.object.position.set(pos.x, pos.y, 0);

    // Update model scale based on current config
    const innerObj = entry.object.userData.innerObject;
    if (innerObj && entry.object.userData.baseScale) {
      const baseScale = entry.object.userData.baseScale;
      const targetScale = baseScale * (config.modelSize / GRID_MODEL_SIZE);
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
let mobileHeaderVisible = true;
let mobileScrollShowTimer = null;

function getMobileScrollBounds() {
  const config = getGridConfig();
  if (!config.isMobileScroll) return { min: 0, max: 0 };
  // Add extra position for Info at the end
  const totalHeight = models.length * config.cellHeight;
  return { min: 0, max: totalHeight };
}

function showMobileHeader() {
  if (!mobileHeader || mobileHeaderVisible) return;
  mobileHeaderVisible = true;
  mobileHeader.classList.remove('hidden');
}

function hideMobileHeader() {
  if (!mobileHeader || !mobileHeaderVisible) return;
  mobileHeaderVisible = false;
  mobileHeader.classList.add('hidden');
}

function scheduleMobileHeaderShow() {
  if (mobileScrollShowTimer) clearTimeout(mobileScrollShowTimer);
  mobileScrollShowTimer = setTimeout(() => {
    showMobileHeader();
  }, 150);
}

function snapToNearestModel() {
  const config = getGridConfig();
  if (!config.isMobileScroll) return;

  const cellHeight = config.cellHeight;
  const nearestIndex = Math.round(mobileScrollTarget / cellHeight);
  // Allow scrolling to Info position (models.length) as last item
  const clampedIndex = Math.max(0, Math.min(nearestIndex, models.length));
  mobileScrollTarget = clampedIndex * cellHeight;
  mobileCurrentModelIndex = clampedIndex;

  // If at Info position (past last model), scroll page to text section
  if (clampedIndex >= models.length) {
    const textSection = document.getElementById('text-section');
    if (textSection) {
      setTimeout(() => {
        textSection.scrollIntoView({ behavior: 'smooth' });
      }, 200);
    }
  }
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

// Reusable loaders (created once for performance)
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
const objLoader = new OBJLoader();
const mtlLoader = new MTLLoader();

// Cleanup on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
  // Dispose renderer
  renderer.dispose();

  // Dispose all geometries and materials in scene
  scene.traverse((object) => {
    if (object.geometry) {
      object.geometry.dispose();
    }
    if (object.material) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (material.map) material.map.dispose();
        if (material.normalMap) material.normalMap.dispose();
        if (material.roughnessMap) material.roughnessMap.dispose();
        if (material.metalnessMap) material.metalnessMap.dispose();
        material.dispose();
      });
    }
  });

  // Dispose DRACO decoder
  dracoLoader.dispose();
});

// Lighting - Bright studio setup for ceramic look
const ambient = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambient);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0xf5f5f5, 0.5);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyLight.position.set(5, 8, 6);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xf8f8ff, 0.9);
fillLight.position.set(-6, 4, 4);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.6);
rimLight.position.set(0, 2, -6);
scene.add(rimLight);

// Dark mode
let isDarkMode = false;
const lightModeBackground = 0xf5f5f0;
const darkModeBackground = 0x0a0a0a;

// Studio light values (bright, ceramic look)
const studioLightValues = {
  ambient: { color: 0xffffff, intensity: 0.8 },
  hemi: { sky: 0xffffff, ground: 0xf5f5f5, intensity: 0.5 },
  key: { color: 0xffffff, intensity: 1.4 },
  fill: { color: 0xf8f8ff, intensity: 0.9 },
  rim: { color: 0xffffff, intensity: 0.6 }
};

// Disco mode values
const discoModeValues = {
  ambient: { color: 0xffffff, intensity: 2.0 },
  hemi: { sky: 0xffffff, ground: 0xffffff, intensity: 0.4 },
  key: { color: 0x9c9c9c, intensity: 1.5 },
  fill: { color: 0xf0f4ff, intensity: 1.6 },
  rim: { color: 0xffffff, intensity: 0.3 }
};

// Weather state
let currentWeather = {
  condition: 'clear', // clear, clouds, rain, snow, fog
  windSpeed: 0, // m/s
  temperature: 15, // celsius
  cloudCover: 0, // 0-100
  isDay: true
};

// Precipitation system (rain/snow)
let precipitationParticles = null;
let precipitationGeometry = null;
let snowAccumulationParticles = null;
let snowAccumulationGeometry = null;
const PRECIP_COUNT = 4000;
const SNOW_ACCUMULATION_COUNT = 1500;
const precipVelocities = [];
const precipDrift = []; // horizontal drift for snow
let currentPrecipType = 'none'; // 'rain', 'snow', 'none'

function createPrecipitationSystem() {
  // Falling precipitation
  precipitationGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(PRECIP_COUNT * 3);

  for (let i = 0; i < PRECIP_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 30;
    positions[i * 3 + 1] = Math.random() * 25 - 5;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 15;
    precipVelocities.push(0.02 + Math.random() * 0.03); // slow for snow
    precipDrift.push((Math.random() - 0.5) * 0.02);
  }

  precipitationGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const precipMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.08,
    transparent: true,
    opacity: 0.9
  });

  precipitationParticles = new THREE.Points(precipitationGeometry, precipMaterial);
  precipitationParticles.visible = false;
  scene.add(precipitationParticles);

  // Snow accumulation on/around models
  snowAccumulationGeometry = new THREE.BufferGeometry();
  const accumPositions = new Float32Array(SNOW_ACCUMULATION_COUNT * 3);

  for (let i = 0; i < SNOW_ACCUMULATION_COUNT; i++) {
    // Distribute around model areas in grid
    const gridX = (Math.random() - 0.5) * 20;
    const gridY = (Math.random() - 0.5) * 12;
    accumPositions[i * 3] = gridX;
    accumPositions[i * 3 + 1] = gridY + Math.random() * 2; // on top of models
    accumPositions[i * 3 + 2] = (Math.random() - 0.5) * 3;
  }

  snowAccumulationGeometry.setAttribute('position', new THREE.BufferAttribute(accumPositions, 3));

  const accumMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.12,
    transparent: true,
    opacity: 0.85
  });

  snowAccumulationParticles = new THREE.Points(snowAccumulationGeometry, accumMaterial);
  snowAccumulationParticles.visible = false;
  scene.add(snowAccumulationParticles);
}

function updatePrecipitation(windSpeed, isSnow) {
  if (!precipitationParticles || !precipitationParticles.visible) return;

  const positions = precipitationGeometry.attributes.position.array;
  const windOffset = windSpeed * 0.015;
  const fallSpeed = isSnow ? 1.0 : 3.0; // snow falls slower

  for (let i = 0; i < PRECIP_COUNT; i++) {
    // Fall down
    positions[i * 3 + 1] -= precipVelocities[i] * fallSpeed;

    // Wind and drift
    positions[i * 3] += windOffset + (isSnow ? precipDrift[i] : 0);

    // Snow has gentle swaying
    if (isSnow) {
      positions[i * 3] += Math.sin(Date.now() * 0.001 + i) * 0.005;
    }

    // Reset when below view
    if (positions[i * 3 + 1] < -12) {
      positions[i * 3 + 1] = 18;
      positions[i * 3] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 15;
    }

    // Wrap around
    if (positions[i * 3] > 18) positions[i * 3] = -18;
    if (positions[i * 3] < -18) positions[i * 3] = 18;
  }

  precipitationGeometry.attributes.position.needsUpdate = true;

  // Update accumulation position with camera (for mobile scroll)
  if (snowAccumulationParticles && snowAccumulationParticles.visible) {
    snowAccumulationParticles.position.y = camera.position.y;
  }
}

function setPrecipitation(type) {
  currentPrecipType = type;

  if (!precipitationParticles) return;

  if (type === 'none') {
    precipitationParticles.visible = false;
    if (snowAccumulationParticles) snowAccumulationParticles.visible = false;
    return;
  }

  precipitationParticles.visible = true;

  if (type === 'snow') {
    // Snow: white, larger, with accumulation
    precipitationParticles.material.color.setHex(0xffffff);
    precipitationParticles.material.size = 0.1;
    precipitationParticles.material.opacity = 0.9;
    if (snowAccumulationParticles) snowAccumulationParticles.visible = true;
  } else {
    // Rain: bluish, smaller streaks
    precipitationParticles.material.color.setHex(0x8899bb);
    precipitationParticles.material.size = 0.04;
    precipitationParticles.material.opacity = 0.6;
    if (snowAccumulationParticles) snowAccumulationParticles.visible = false;
  }
}

// Wind wiggle effect - works in all modes
let windTime = 0;
function applyWindWiggle(windSpeed) {
  windTime += 0.016; // ~60fps
  const wiggleStrength = Math.min(windSpeed / 20, 1) * 0.03; // Subtle wiggle

  sceneModels.forEach((model, index) => {
    if (!model || !model.object || !model.object.visible) return;
    const innerObj = model.object.userData.innerObject;
    if (!innerObj) return;

    // Skip during grid intro animation
    if (model.object.userData.gridIntroAnimating) return;

    // Each model wiggles slightly differently
    const offset = index * 0.5;
    const wiggle = Math.sin(windTime * 2 + offset) * wiggleStrength;

    // Apply wiggle to Z rotation
    innerObj.rotation.z += wiggle * 0.1; // Additive, subtle
  });
}

// Restore studio lighting (after disco mode)
function applyStudioLighting() {
  ambient.color.setHex(studioLightValues.ambient.color);
  ambient.intensity = studioLightValues.ambient.intensity;
  hemiLight.color.setHex(studioLightValues.hemi.sky);
  hemiLight.groundColor.setHex(studioLightValues.hemi.ground);
  hemiLight.intensity = studioLightValues.hemi.intensity;
  keyLight.color.setHex(studioLightValues.key.color);
  keyLight.intensity = studioLightValues.key.intensity;
  fillLight.color.setHex(studioLightValues.fill.color);
  fillLight.intensity = studioLightValues.fill.intensity;
  rimLight.color.setHex(studioLightValues.rim.color);
  rimLight.intensity = studioLightValues.rim.intensity;
}

// Fetch Rotterdam weather from Open-Meteo (free, no API key)
async function fetchRotterdamWeather() {
  try {
    // Rotterdam coordinates: 51.9225, 4.47917
    const response = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=51.9225&longitude=4.47917&current=temperature_2m,weather_code,wind_speed_10m,cloud_cover,is_day'
    );

    if (!response.ok) throw new Error('Weather fetch failed');

    const data = await response.json();
    const current = data.current;

    // Map WMO weather codes to conditions
    // https://open-meteo.com/en/docs#weathervariables
    const weatherCode = current.weather_code;
    let condition = 'clear';

    if (weatherCode === 0) condition = 'clear';
    else if (weatherCode <= 3) condition = 'clouds';
    else if (weatherCode >= 45 && weatherCode <= 48) condition = 'fog';
    else if (weatherCode >= 51 && weatherCode <= 67) condition = 'rain';
    else if (weatherCode >= 71 && weatherCode <= 77) condition = 'snow';
    else if (weatherCode >= 80 && weatherCode <= 82) condition = 'rain';
    else if (weatherCode >= 85 && weatherCode <= 86) condition = 'snow';
    else if (weatherCode >= 95) condition = 'rain'; // thunderstorm

    currentWeather = {
      condition,
      windSpeed: current.wind_speed_10m || 0,
      temperature: current.temperature_2m || 15,
      cloudCover: current.cloud_cover || 0,
      isDay: current.is_day === 1
    };

    console.log('Rotterdam weather:', currentWeather);

    // Apply precipitation (rain/snow) - lighting stays constant
    if (condition === 'snow') {
      setPrecipitation('snow');
    } else if (condition === 'rain') {
      setPrecipitation('rain');
    } else {
      setPrecipitation('none');
    }

  } catch (error) {
    console.warn('Could not fetch weather:', error);
    // Use defaults
  }
}

// Initialize rain and fetch weather
createPrecipitationSystem();
fetchRotterdamWeather();
// Refresh weather every 10 minutes
setInterval(fetchRotterdamWeather, 10 * 60 * 1000);

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
      if (callback) callback();
      return;
    }

    const dimFactor = 0.1 + Math.random() * 0.3;
    ambient.intensity = originalIntensities.ambient * dimFactor;
    keyLight.intensity = originalIntensities.key * dimFactor;
    fillLight.intensity = originalIntensities.fill * dimFactor;
    rimLight.intensity = originalIntensities.rim * dimFactor;
    hemiLight.intensity = originalIntensities.hemi * dimFactor;

    setTimeout(() => {
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

// PARTY MODE 🎉
let isPartyMode = false;
let partyAnimationId = null;
let partyStartTime = 0;
let partyToggleCooldown = false;
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
  scene.background.setHex(darkModeBackground);

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

function togglePartyMode() {
  if (partyToggleCooldown) return;
  partyToggleCooldown = true;
  setTimeout(() => { partyToggleCooldown = false; }, 1500);

  flickerLights(() => {
    if (isPartyMode) {
      stopPartyMode();
      isDarkMode = false;
      document.body.classList.remove('dark-mode', 'party-mode');
      scene.background.setHex(lightModeBackground);
      // Restore studio lighting
      applyStudioLighting();
      // Restore precipitation
      if (currentWeather.condition === 'snow') {
        setPrecipitation('snow');
      } else if (currentWeather.condition === 'rain') {
        setPrecipitation('rain');
      } else {
        setPrecipitation('none');
      }
    } else {
      isDarkMode = true;
      document.body.classList.add('dark-mode');
      scene.background.setHex(darkModeBackground);
      setPrecipitation('none'); // No precipitation in disco mode
      startPartyMode();
    }
    // Update model list colors for dark/light mode
    if (typeof updateModelListActiveState === 'function') {
      updateModelListActiveState();
    }
  });
}

function animateParty() {
  if (!isPartyMode) return;

  const time = (Date.now() - partyStartTime) / 1000;
  const beat = Math.sin(time * 8) * 0.5 + 0.5;
  const fastBeat = Math.sin(time * 16) * 0.5 + 0.5;

  const policePhase = Math.floor(time * 6) % 2;
  const policeFlash = Math.sin(time * 20) > 0;

  const isExplosion = Math.random() > 0.97;
  const explosionIntensity = isExplosion ? 8 + Math.random() * 5 : 0;

  const colorIndex = Math.floor(time * 2) % partyColors.length;
  const nextColorIndex = (colorIndex + 1) % partyColors.length;
  const colorLerp = (time * 2) % 1;

  const discoColor1 = new THREE.Color(partyColors[colorIndex]);
  const discoColor2 = new THREE.Color(partyColors[nextColorIndex]);
  discoColor1.lerp(discoColor2, colorLerp);

  if (isExplosion) {
    keyLight.color.setHex(0xffffff);
    keyLight.intensity = explosionIntensity;
  } else {
    keyLight.color.copy(discoColor1);
    keyLight.intensity = 1.5 + beat * 2;
  }

  if (policePhase === 0 && policeFlash) {
    fillLight.color.setHex(policeRed);
    fillLight.intensity = 3 + fastBeat * 2;
  } else {
    fillLight.color.setHex(partyColors[(colorIndex + 2) % partyColors.length]);
    fillLight.intensity = 1 + fastBeat;
  }

  if (policePhase === 1 && policeFlash) {
    rimLight.color.setHex(policeBlue);
    rimLight.intensity = 3 + fastBeat * 2;
  } else {
    rimLight.color.setHex(partyColors[(colorIndex + 4) % partyColors.length]);
    rimLight.intensity = 0.8 + beat * 1.5;
  }

  ambient.color.setHex(isExplosion ? 0xffffff : 0x222233);
  ambient.intensity = isExplosion ? 2 : (0.15 + beat * 0.15);

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

// Mouse tracking
const mouse = new THREE.Vector2();
let mouseIsMoving = false;
let mouseIdleTimer = null;
const raycaster = new THREE.Raycaster();

// Mobile / touch detection
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

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
          window.addEventListener('devicemotion', handleShake);
        }
      })
      .catch(console.error);

    // Also request motion permission for shake detection
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission().catch(() => {});
    }
  } else if ('DeviceOrientationEvent' in window) {
    // Non-iOS devices
    gyroPermissionGranted = true;
    gyroEnabled = true;
    window.addEventListener('deviceorientation', handleGyro);
    window.addEventListener('devicemotion', handleShake);
  }
}

// Shake detection for disco mode
let lastShakeTime = 0;
let shakeCount = 0;
const SHAKE_THRESHOLD = 15; // Acceleration threshold
const SHAKE_RESET_TIME = 500; // Reset shake count after this many ms
const SHAKES_NEEDED = 3; // Number of shakes to trigger disco

function handleShake(event) {
  const acc = event.accelerationIncludingGravity;
  if (!acc) return;

  const totalAcceleration = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
  const now = Date.now();

  // Detect sudden acceleration change (shake)
  if (totalAcceleration > SHAKE_THRESHOLD) {
    if (now - lastShakeTime > 100) { // Debounce
      shakeCount++;
      lastShakeTime = now;

      if (shakeCount >= SHAKES_NEEDED) {
        shakeCount = 0;
        togglePartyMode();
      }
    }
  }

  // Reset shake count if no shakes for a while
  if (now - lastShakeTime > SHAKE_RESET_TIME) {
    shakeCount = 0;
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

    // Comfortable holding angle: phone held in palm ~30 degrees from horizontal
    const comfortableBeta = 30;
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

function onTouchStart(event) {
  if (event.touches.length === 1) {
    const touch = event.touches[0];
    mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;

    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartTime = Date.now();
    touchDragging = false;

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
      // Track swipe delta for discrete model switching
      lastTouchY = touch.clientY;
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
  // Handle mobile scroll end - discrete model switching
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
    } else {
      // Discrete swipe: detect direction and switch model
      const swipeDelta = mobileTouchStartY - lastTouchY;
      const swipeThreshold = 50; // pixels needed to trigger switch

      if (Math.abs(swipeDelta) > swipeThreshold) {
        if (swipeDelta > 0) {
          // Swipe up - next model
          mobileCurrentModelIndex = Math.min(mobileCurrentModelIndex + 1, models.length);
        } else {
          // Swipe down - previous model
          mobileCurrentModelIndex = Math.max(mobileCurrentModelIndex - 1, 0);
        }
      }

      // Snap to current model
      mobileScrollTarget = mobileCurrentModelIndex * config.cellHeight;
      updateModelInfoDisplay();

      // If at Info position, scroll to text section
      if (mobileCurrentModelIndex >= models.length) {
        const textSection = document.getElementById('text-section');
        if (textSection) {
          setTimeout(() => {
            textSection.scrollIntoView({ behavior: 'smooth' });
          }, 200);
        }
      }
    }
  }

  if (introActive) {
    exitIntro();
    // Request gyro permission on first touch (required by iOS)
    if (isTouchDevice && !gyroPermissionGranted) {
      requestGyroPermission();
    }
    return;
  }

  const touchDuration = Date.now() - touchStartTime;
  const wasTap = !touchDragging && touchDuration < TAP_THRESHOLD;

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
      toggleMode(); // Enter solo mode
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

    const modelObjects = sceneModels
      .map((entry) => entry?.object)
      .filter((object) => object && object.visible);

    if (modelObjects.length > 0) {
      const intersections = raycaster.intersectObjects(modelObjects, true);
      if (intersections.length > 0) {
        let target = intersections[0].object;
        while (target && target.userData?.modelIndex === undefined && target.parent) {
          target = target.parent;
        }

        if (target && typeof target.userData?.modelIndex === 'number') {
          switchToModel(target.userData.modelIndex);
          toggleMode();
          return;
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

// Helper: Set up a model for solo mode (scale, center, optional random rotation)
function setupModelForSoloMode(model, applyRandomRotation = false) {
  if (!model || !model.object) return;

  const innerObj = model.object.userData.innerObject;

  // Scale up for solo mode
  if (innerObj && model.object.userData.baseScale) {
    const soloScale = model.object.userData.baseScale * (SOLO_MODEL_SIZE / GRID_MODEL_SIZE);
    innerObj.scale.setScalar(soloScale);
  }

  // Center dynamically using bounding box
  model.object.position.set(0, 0, 0);
  model.object.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(model.object);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  model.object.position.x = -center.x;
  model.object.position.y = -center.y;

  // Apply random rotation if requested
  if (applyRandomRotation && innerObj) {
    innerObj.rotation.x = (Math.random() - 0.5) * Math.PI * 0.8;
    innerObj.rotation.y = (Math.random() - 0.5) * Math.PI * 2;
    innerObj.rotation.z = (Math.random() - 0.5) * Math.PI * 0.3;
    model.object.userData.isTransitioning = true;
  }
}

// Switch to different model
function switchToModel(index) {
  currentModelIndex = index;

  // Reset touch drag rotation when switching models
  touchDragRotationX = 0;
  touchDragRotationY = 0;
  touchDragTargetX = 0;
  touchDragTargetY = 0;

  if (!isGridMode) {
    sceneModels.forEach((model, i) => {
      if (model && model.object) {
        model.object.visible = (i === index);
        if (i === index) {
          // No random rotation when cycling - smooth transition only
          setupModelForSoloMode(model, false);
        }
      }
    });
  }

  updateModelInfoDisplay();
  updateModelListActiveState();
}

// Toggle between grid and solo mode
function toggleMode() {
  isGridMode = !isGridMode;
  const config = getGridConfig();

  if (isGridMode) {
    // GRID MODE - show all models in grid positions, scale down
    sceneModels.forEach((model, index) => {
      if (model && model.object) {
        model.object.visible = true;
        const pos = getGridPosition(index);
        model.object.position.set(pos.x, pos.y, 0);

        const innerObj = model.object.userData.innerObject;
        if (innerObj && model.object.userData.baseScale) {
          const gridScale = model.object.userData.baseScale * (config.modelSize / GRID_MODEL_SIZE);
          innerObj.scale.setScalar(gridScale);
        }
      }
    });
  } else {
    // SOLO MODE - show only current model
    // Reset camera to origin (important for mobile where camera follows scroll)
    camera.position.y = 0;

    sceneModels.forEach((model, i) => {
      if (model && model.object) {
        model.object.visible = (i === currentModelIndex);
        if (i === currentModelIndex) {
          setupModelForSoloMode(model, false);
        }
      }
    });
  }

  updateModeIcon();
  updateModelInfoDisplay();
  updateHeaderVisibility();
  updateModelListVisibility();
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

  // Check if we're at the Info position (past last model)
  const isAtInfoPosition = config.isMobileScroll && isGridMode && displayIndex >= models.length;

  const currentModel = models[displayIndex];
  const info = currentModel ? modelInfoById.get(currentModel.id) : null;

  // Remove description body
  if (soloInfoBody) soloInfoBody.innerHTML = '';

  if (isAtInfoPosition) {
    // Show "Info" when scrolled past last model
    soloInfoTitle.textContent = 'Info';
    if (currentModelNameEl) {
      currentModelNameEl.textContent = 'Info';
    }
    soloInfoPanel.classList.add('visible');
    updateDropdownActiveState(-1); // No model active
    return;
  }

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
  document.documentElement.classList.remove('intro-active');
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
  sceneModels.forEach((entry) => {
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

// Keyboard shortcuts
window.addEventListener('keydown', (event) => {
  if (event.key === 'r' || event.key === 'R') {
    event.preventDefault();
    showIntro();
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    togglePartyMode();
  }
});

// Loading
let modelsLoaded = 0;
let totalAssetsToLoad = 0;
let hasCompletedInitialLoad = false;

function checkLoadingComplete() {
  modelsLoaded++;

  if (!hasCompletedInitialLoad && totalAssetsToLoad > 0 && modelsLoaded >= totalAssetsToLoad) {
    hasCompletedInitialLoad = true;
    prewarmGridModels();
    // Show intro prompt only after loading is complete
    if (introPrompt && introActive) {
      introPrompt.textContent = isTouchDevice ? 'TAP TO ENTER' : 'CLICK TO ENTER';
      introPrompt.classList.add('visible');
    }
  }
}

function prewarmGridModels() {
  if (!renderer) return;

  const visibility = sceneModels.map((model) => model?.object?.visible ?? false);

  sceneModels.forEach((model) => {
    if (model?.object) model.object.visible = true;
  });

  if (typeof renderer.compile === 'function') {
    renderer.compile(scene, camera);
  }
  renderer.render(scene, camera);

  sceneModels.forEach((model, index) => {
    if (model?.object) model.object.visible = visibility[index];
  });
}

function showLoadingError(message) {
  console.error('Loading error:', message);
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

// Process and add model to scene (unified - single model per config)
function processSceneModel(object3d, modelConfig, modelIndex) {
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
  // Center horizontally (X,Z) but bottom-align vertically (Y)
  // This ensures all models appear to sit at the same level in grid
  object3d.position.x -= scaledCenter.x;
  object3d.position.z -= scaledCenter.z;
  object3d.position.y -= scaledBBox.min.y;

  const overrideDeg = GRID_ROTATION_OVERRIDE_DEG[modelConfig.id];
  const rotationDeg = typeof modelConfig.gridRotationDeg === 'number'
    ? modelConfig.gridRotationDeg
    : (overrideDeg !== undefined ? overrideDeg : DEFAULT_GRID_ROTATION_DEG);
  const rotationRad = THREE.MathUtils.degToRad(rotationDeg);
  object3d.rotation.y += rotationRad;

  // Create group
  const group = new THREE.Group();
  group.add(object3d);

  // Position in grid by default
  const gridPosition = getGridPosition(modelIndex);
  group.position.set(gridPosition.x, gridPosition.y, 0);
  group.visible = isGridMode;
  group.userData.modelIndex = modelIndex;
  group.userData.innerObject = object3d;
  group.userData.baseRotationY = object3d.rotation.y;
  group.userData.baseRotationX = object3d.rotation.x;
  group.userData.baseScale = object3d.scale.x;

  scene.add(group);
  sceneModels[modelIndex] = { object: group };
  triggerGridIntroRandomization();
  checkLoadingComplete();
}

// Load a single model
function loadModel(modelConfig, modelIndex) {
  if (modelConfig.glb) {
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
        processSceneModel(source, modelConfig, modelIndex);
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

  const { basePath: objBasePath, fileName: objFileName } = splitPath(modelConfig.obj);

  if (objBasePath) {
    objLoader.setPath(objBasePath);
    objLoader.setResourcePath(objBasePath);
  }

  const loadObj = () => {
    objLoader.load(
      objBasePath ? objFileName : modelConfig.obj,
      (object) => {
        processSceneModel(object, modelConfig, modelIndex);
      },
      undefined,
      (error) => {
        console.error('Error loading OBJ:', error);
      }
    );
  };

  if (modelConfig.mtl) {
    const { basePath: mtlBasePath, fileName: mtlFileName } = splitPath(modelConfig.mtl);

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
  totalAssetsToLoad = models.length; // Only 10 models now (no cloning)
  hasCompletedInitialLoad = false;
  sceneModels.length = 0;

  models.forEach((modelConfig, index) => {
    loadModel(modelConfig, index);
  });

  switchToModel(0);
  updateModeIcon();
  updateModelInfoDisplay();
  populateDropdown();
  populateModelList();
}

init();

// Request gyro permissions early on touch devices
// iOS requires user gesture, but Android can request immediately
if (isTouchDevice) {
  // Check if this is iOS (has requestPermission method)
  const isIOS = typeof DeviceOrientationEvent !== 'undefined' &&
                typeof DeviceOrientationEvent.requestPermission === 'function';
  if (!isIOS) {
    // Android/other: Request immediately (no user gesture needed)
    requestGyroPermission();
  }
  // iOS will request on first touch in intro exit
}

// Text section - load and reveal
const textContent = document.getElementById('text-content');
const uiOverlay = document.getElementById('ui-overlay');
const soloGoTop = document.getElementById('solo-go-top');
const modelList = document.getElementById('model-list');
const modelListItems = document.getElementById('model-list-items');
const modelListGoTop = document.getElementById('model-list-go-top');

// Set intro-active class initially to prevent scrolling
document.documentElement.classList.add('intro-active');
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

// Solo mode go to top
if (soloGoTop) {
  soloGoTop.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// Model list go to top (desktop sidebar)
if (modelListGoTop) {
  modelListGoTop.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// Populate model list (desktop sidebar)
function populateModelList() {
  if (!modelListItems) return;
  modelListItems.innerHTML = '';

  models.forEach((model, index) => {
    const info = modelInfoById.get(model.id);
    const name = (info && info.heading) ? info.heading : (model.title || `Model ${index + 1}`);

    const item = document.createElement('div');
    item.className = 'model-list-item';
    item.textContent = name;
    item.dataset.index = index;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      switchToModel(index);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    modelListItems.appendChild(item);
  });

  updateModelListActiveState();
}

// Model list state
let modelListHovering = false;

// Shared constants for model list styling
const MODEL_LIST_ACTIVE_SIZE = 12; // px - same as 010 Totems
const MODEL_LIST_ACTIVE_OPACITY = 0.6;
const MODEL_LIST_MIN_SIZE = 7;
const MODEL_LIST_MIN_OPACITY = 0.15;
const GOLDEN_RATIO = 1.618;

function getModelListColor(opacity) {
  // Return appropriate color based on dark mode
  return isDarkMode
    ? `rgba(245, 247, 255, ${opacity})`
    : `rgba(8, 9, 13, ${opacity})`;
}

function updateModelListActiveState() {
  if (!modelListItems) return;
  const items = modelListItems.querySelectorAll('.model-list-item');
  const activeIndex = currentModelIndex;
  // Use full golden ratio when not hovering
  const ratio = GOLDEN_RATIO;

  items.forEach((item, index) => {
    const distance = Math.abs(index - activeIndex);
    const isActive = index === activeIndex;

    item.classList.toggle('active', isActive);

    // Progressive sizing: each step away divides by ratio
    const size = Math.max(MODEL_LIST_MIN_SIZE, MODEL_LIST_ACTIVE_SIZE / Math.pow(ratio, distance * 0.5));
    const opacity = Math.max(MODEL_LIST_MIN_OPACITY, MODEL_LIST_ACTIVE_OPACITY / Math.pow(ratio, distance * 0.6));

    item.style.fontSize = `${size}px`;
    item.style.color = getModelListColor(opacity);
  });
}

function updateModelListHover(mouseY) {
  if (!modelListItems) return;
  const items = modelListItems.querySelectorAll('.model-list-item');

  // Find which item is closest to mouse
  let closestIndex = 0;
  let closestDistance = Infinity;

  items.forEach((item, index) => {
    const rect = item.getBoundingClientRect();
    const itemCenterY = rect.top + rect.height / 2;
    const dist = Math.abs(mouseY - itemCenterY);
    if (dist < closestDistance) {
      closestDistance = dist;
      closestIndex = index;
    }
  });

  // Scale based on distance from hovered item (half golden ratio effect)
  items.forEach((item, index) => {
    const distance = Math.abs(index - closestIndex);

    const size = Math.max(MODEL_LIST_MIN_SIZE, MODEL_LIST_ACTIVE_SIZE / Math.pow(GOLDEN_RATIO, distance * 0.25));
    const opacity = Math.max(MODEL_LIST_MIN_OPACITY, MODEL_LIST_ACTIVE_OPACITY / Math.pow(GOLDEN_RATIO, distance * 0.3));

    item.style.fontSize = `${size}px`;
    item.style.color = getModelListColor(opacity);
  });
}

// Setup model list hover listeners
if (modelList) {
  modelList.addEventListener('mouseenter', () => {
    modelListHovering = true;
  });

  modelList.addEventListener('mousemove', (e) => {
    if (!modelListHovering) return;
    updateModelListHover(e.clientY);
  });

  modelList.addEventListener('mouseleave', () => {
    modelListHovering = false;
    updateModelListActiveState();
  });
}

function updateModelListVisibility() {
  if (!modelList) return;
  // Show in solo mode on desktop
  const isDesktop = window.innerWidth > 900;
  if (!isGridMode && !introActive && isDesktop) {
    modelList.classList.add('visible');
  } else {
    modelList.classList.remove('visible');
  }
}

// Track state for sequential animation
let modelListShowingGoTop = false;
let modelListAnimationTimeouts = [];

// Clear all pending animation timeouts
function clearModelListAnimations() {
  modelListAnimationTimeouts.forEach(id => clearTimeout(id));
  modelListAnimationTimeouts = [];
}

// Toggle model list between model picker and go-to-top based on scroll
function updateModelListState() {
  if (!modelList || !modelListItems || isGridMode || introActive) {
    // Reset state when not in solo mode
    if (modelListShowingGoTop) {
      showModelListItems();
    }
    return;
  }

  const sceneRect = container?.getBoundingClientRect();
  const isModelVisible = sceneRect && sceneRect.bottom > 100;

  if (isModelVisible && modelListShowingGoTop) {
    // Scroll back up - show model items
    showModelListItems();
  } else if (!isModelVisible && !modelListShowingGoTop) {
    // Scroll down - blur out items sequentially
    blurOutModelListItems();
  }
}

function blurOutModelListItems() {
  // Cancel any pending animations
  clearModelListAnimations();
  modelListShowingGoTop = true;

  // Hide go-to-top immediately in case it's visible
  modelListGoTop?.classList.remove('visible');

  const items = modelListItems.querySelectorAll('.model-list-item');
  const activeIndex = currentModelIndex;

  // Sort items by distance from active (furthest first)
  const sortedItems = Array.from(items).map((item, index) => ({
    item,
    distance: Math.abs(index - activeIndex),
    index
  })).sort((a, b) => b.distance - a.distance);

  // Blur out items sequentially (furthest from active first)
  sortedItems.forEach((entry, i) => {
    const id = setTimeout(() => {
      entry.item.classList.add('blurring-out');
    }, i * 40);
    modelListAnimationTimeouts.push(id);
  });

  // After all items blur out, show go-to-top
  const finalId = setTimeout(() => {
    modelListGoTop?.classList.add('visible');
  }, sortedItems.length * 40 + 100);
  modelListAnimationTimeouts.push(finalId);
}

function showModelListItems() {
  // Cancel any pending animations
  clearModelListAnimations();
  modelListShowingGoTop = false;

  // Hide go-to-top immediately
  modelListGoTop?.classList.remove('visible');

  const items = modelListItems.querySelectorAll('.model-list-item');
  const activeIndex = currentModelIndex;

  // Sort items by distance from active (closest first)
  const sortedItems = Array.from(items).map((item, index) => ({
    item,
    distance: Math.abs(index - activeIndex),
    index
  })).sort((a, b) => a.distance - b.distance);

  // Remove blur from all items immediately then animate in
  const startId = setTimeout(() => {
    sortedItems.forEach((entry, i) => {
      const id = setTimeout(() => {
        entry.item.classList.remove('blurring-out');
      }, i * 40);
      modelListAnimationTimeouts.push(id);
    });
  }, 100);
  modelListAnimationTimeouts.push(startId);
}

// Show header when in solo mode or when scrolled to text section
function updateHeaderVisibility() {
  const sceneBottom = container?.getBoundingClientRect().bottom || 0;
  const isScrolledPastScene = sceneBottom < window.innerHeight * 0.5;

  if ((!isGridMode && !introActive) || (isScrolledPastScene && !introActive)) {
    uiOverlay?.classList.add('visible');
  } else {
    uiOverlay?.classList.remove('visible');
  }
}

// Toggle model name / go to top based on model visibility
function updateSoloInfoState() {
  if (isGridMode || introActive) {
    soloInfoPanel?.classList.remove('show-go-top');
    return;
  }

  const sceneRect = container?.getBoundingClientRect();
  const isModelVisible = sceneRect && sceneRect.bottom > 100;

  if (isModelVisible) {
    soloInfoPanel?.classList.remove('show-go-top');
  } else {
    soloInfoPanel?.classList.add('show-go-top');
  }
}

// Track page scroll for mobile back-from-info navigation
let lastPageScrollY = 0;

// Scroll listener for header and solo info state
window.addEventListener('scroll', () => {
  updateHeaderVisibility();
  updateSoloInfoState();
  updateModelListState();

  // On mobile, detect scroll back to top from text section
  const config = getGridConfig();
  if (config.isMobileScroll && isGridMode) {
    const currentScroll = window.scrollY;
    const sceneHeight = window.innerHeight;

    // If scrolling up while in text section area, check if we should go back to models
    if (currentScroll < sceneHeight * 0.3 && lastPageScrollY > currentScroll && mobileCurrentModelIndex >= models.length) {
      // User scrolled back up - reset to last model
      mobileScrollTarget = (models.length - 1) * config.cellHeight;
      mobileCurrentModelIndex = models.length - 1;
      updateModelInfoDisplay();
    }

    lastPageScrollY = currentScroll;
  }
});
loadTextContent();

// Visibility handling - pause rendering when tab is hidden or models not in viewport
let isPageVisible = true;
let isSceneVisible = true;
let animationFrameId = null;
let lastFrameTime = 0;
const THROTTLED_FRAME_INTERVAL = 100; // ms - when scene not visible, render at 10fps max

document.addEventListener('visibilitychange', () => {
  isPageVisible = !document.hidden;
  if (isPageVisible && !animationFrameId) {
    animationFrameId = requestAnimationFrame(animate);
  }
});

// Check if scene container is in viewport
function checkSceneVisibility() {
  if (!container) return true;
  const rect = container.getBoundingClientRect();
  // Scene is visible if any part is in viewport
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

// Animation loop
function animate() {
  // Stop rendering if page is not visible
  if (!isPageVisible) {
    animationFrameId = null;
    return;
  }

  animationFrameId = requestAnimationFrame(animate);

  // Check if scene is visible and throttle if not
  isSceneVisible = checkSceneVisibility();
  if (!isSceneVisible) {
    const now = performance.now();
    if (now - lastFrameTime < THROTTLED_FRAME_INTERVAL) {
      return; // Skip this frame
    }
    lastFrameTime = now;
  }

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
    // GRID MODE: Mouse-follow rotation for all models in grid
    sceneModels.forEach((model, modelIndex) => {
      if (!model) return;
      const group = model.object;
      if (!group || !group.visible) return;
      const innerObj = group.userData.innerObject;
      if (!innerObj) return;

      const baseRotationY = group.userData.baseRotationY || 0;
      const baseRotationX = group.userData.baseRotationX || 0;

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
    const currentModel = sceneModels[currentModelIndex];
    if (currentModel && currentModel.object) {
      const innerObj = currentModel.object.userData.innerObject;

      // Position is set when entering solo mode, no need to update every frame

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
        targetRotationX = gyro.beta * Math.PI * 0.4;
      } else if (mouseIsMoving) {
        targetRotationY = mouse.x * Math.PI * SOLO_MOUSE_ROTATION_Y_FACTOR;
        targetRotationX = -mouse.y * Math.PI * SOLO_MOUSE_ROTATION_X_FACTOR;
      } else {
        targetRotationX = 0;
        targetRotationY = 0;
      }

      const hasActiveInput = hasGyroInput || mouseIsMoving || hasTouchDragInput;

      // Check if transitioning from initial random rotation
      if (currentModel.object.userData.isTransitioning && innerObj) {
        innerObj.rotation.x = THREE.MathUtils.lerp(innerObj.rotation.x, targetRotationX, SOLO_MODEL_TRANSITION_SPEED);
        innerObj.rotation.y = THREE.MathUtils.lerp(innerObj.rotation.y, targetRotationY, SOLO_MODEL_TRANSITION_SPEED);
        innerObj.rotation.z = THREE.MathUtils.lerp(innerObj.rotation.z, 0, SOLO_MODEL_TRANSITION_SPEED);

        const rotationDelta = Math.abs(innerObj.rotation.x - targetRotationX)
          + Math.abs(innerObj.rotation.y - targetRotationY)
          + Math.abs(innerObj.rotation.z);
        if (rotationDelta < SOLO_MODEL_TRANSITION_THRESHOLD) {
          innerObj.rotation.set(targetRotationX, targetRotationY, 0);
          currentModel.object.userData.isTransitioning = false;
        }
      } else if (innerObj && hasActiveInput) {
        // Active input control (touch drag, gyro, or mouse)
        innerObj.rotation.y = THREE.MathUtils.lerp(innerObj.rotation.y, targetRotationY, 0.12);
        innerObj.rotation.x = THREE.MathUtils.lerp(innerObj.rotation.x, targetRotationX, 0.12);
      } else if (innerObj && !currentModel.object.userData.isTransitioning) {
        // Return to neutral when input stops
        innerObj.rotation.x *= 0.94;
        innerObj.rotation.y *= 0.94;
      }
    }
  }

  updateSoloInfoTransform();

  // Weather effects
  updatePrecipitation(currentWeather.windSpeed, currentPrecipType === 'snow');
  applyWindWiggle(currentWeather.windSpeed);

  renderer.render(scene, camera);
}

animate();

// Handle resize
window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = baseFrustumSize * aspect / -2;
  camera.right = baseFrustumSize * aspect / 2;
  camera.top = baseFrustumSize / 2;
  camera.bottom = baseFrustumSize / -2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Update grid layout for orientation changes
  updateGridLayout();
});
