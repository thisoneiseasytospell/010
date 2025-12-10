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

// Display state
let currentModelIndex = 0;
let isGridMode = false; // Toggle between solo and grid mode
let models = [];
const mainModels = []; // Large display models (one per model config)
const thumbnailModels = []; // Small preview models
const gridModels = []; // Grid layout models (5x2)
let modelInfoById = new Map();

const SOLO_MODEL_X_OFFSET = -3.1;
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
    // Mobile portrait: 2 columns, 5 rows
    return {
      cols: 2,
      rows: 5,
      cellWidth: 3.2,
      cellHeight: 2.2,
      modelSize: 1.8
    };
  } else {
    // Desktop/landscape: 5 columns, 2 rows
    return {
      cols: 5,
      rows: 2,
      cellWidth: 3.96,
      cellHeight: 4.32,
      modelSize: 2.916
    };
  }
}

function getGridPosition(modelIndex) {
  const config = getGridConfig();
  const { cols, cellWidth, cellHeight } = config;
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

    // Update model scale for mobile
    const innerObj = entry.object.userData.innerObject;
    if (innerObj) {
      // Reset scale and recompute
      const currentScale = innerObj.scale.x;
      const isPortrait = window.innerWidth / window.innerHeight < 1;
      const targetScale = isPortrait ? 0.617 : 1; // Ratio of 1.8/2.916

      // Only rescale if layout changed significantly
      if (Math.abs(currentScale - targetScale) > 0.01) {
        const scaleFactor = targetScale / currentScale;
        innerObj.scale.multiplyScalar(scaleFactor);
      }
    }
  });
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

// Lighting
const ambient = new THREE.AmbientLight(0xffffff, 1.4);
scene.add(ambient);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0xcccccc, 0.8);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(8, 10, 6);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 1.3);
fillLight.position.set(-6, 5, 5);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.9);
rimLight.position.set(0, 3, -8);
scene.add(rimLight);

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

function handleGyro(event) {
  if (!gyroEnabled) return;
  // beta: -180 to 180 (front/back tilt, phone flat = 0 when horizontal, ~90 when vertical)
  // gamma: -90 to 90 (left/right tilt)
  // Normalize to -1 to 1 range similar to mouse
  const beta = event.beta || 0;
  const gamma = event.gamma || 0;

  // When phone is held vertically, beta is around 90
  // Map beta 45-135 to -1 to 1 for vertical tilt (front/back)
  const normalizedBeta = THREE.MathUtils.clamp((beta - 90) / 45, -1, 1);
  // Map gamma -45 to 45 to -1 to 1 for horizontal tilt (left/right)
  const normalizedGamma = THREE.MathUtils.clamp(gamma / 45, -1, 1);

  gyro.beta = normalizedBeta;
  gyro.gamma = normalizedGamma;
}

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

// Click handler - advance to next model
function onTouchStart(event) {
  if (event.touches.length === 1) {
    const touch = event.touches[0];
    mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
  }
}

function onTouchEnd(event) {
  if (introActive) {
    exitIntro();
    // Request gyro permission on first touch (required by iOS)
    if (isTouchDevice && !gyroPermissionGranted) {
      requestGyroPermission();
    }
    return;
  }

  // Use changedTouches for the touch that ended
  if (event.changedTouches.length > 0) {
    const touch = event.changedTouches[0];
    mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;

    // Simulate click behavior
    handleInteraction();
  }
}

function handleInteraction() {
  if (models.length === 0) return;

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

  updateMousePosition(event);
  handleInteraction();
}

// Switch to different model
function switchToModel(index) {
  currentModelIndex = index;

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
    mainModels.forEach((model, i) => {
      if (model.object) {
        model.object.visible = (i === currentModelIndex);
        // Center the object vertically when in solo mode
        if (model.object.visible) {
          model.object.position.x = model.object.userData.soloXPos ?? SOLO_MODEL_X_OFFSET;
          model.object.position.y = model.object.userData.soloYPos;
        }
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
  if (!soloInfoPanel || !soloInfoTitle || !soloInfoBody) return;

  const currentModel = models[currentModelIndex];
  const info = currentModel ? modelInfoById.get(currentModel.id) : null;

  soloInfoBody.innerHTML = '';

  if (!currentModel || !info) {
    soloInfoTitle.textContent = '';
    soloInfoPanel.classList.remove('visible');
    return;
  }

  const heading = (typeof info.heading === 'string' && info.heading.trim().length > 0)
    ? info.heading
    : (currentModel.title || '');
  soloInfoTitle.textContent = heading;

  if (Array.isArray(info.lines)) {
    info.lines.forEach((line) => {
      if (typeof line !== 'string' || !line.trim()) return;
      const paragraph = document.createElement('p');
      paragraph.textContent = line.trim();
      soloInfoBody.appendChild(paragraph);
    });
  }

  const hasContent = Boolean(heading || soloInfoBody.children.length > 0);
  if (!introActive && !isGridMode && hasContent) {
    soloInfoPanel.classList.add('visible');
  } else {
    soloInfoPanel.classList.remove('visible');
  }
}

function updateSoloInfoTransform() {
  if (!soloInfoPanel) return;

  const canAnimate = soloInfoPanel.classList.contains('visible') && !introActive && !isGridMode;
  const mainModel = mainModels[currentModelIndex];
  const modelGroup = mainModel && mainModel.object;
  const innerObj = modelGroup && modelGroup.userData.innerObject;
  const modelTransitioning = Boolean(modelGroup && modelGroup.userData && modelGroup.userData.isTransitioning);
  const fallbackY = THREE.MathUtils.clamp(mouse.x * Math.PI * SOLO_MOUSE_ROTATION_Y_FACTOR, -SOLO_INFO_MAX_ROT_Y_RAD, SOLO_INFO_MAX_ROT_Y_RAD);
  const fallbackX = softenVerticalRotation(-mouse.y * Math.PI * SOLO_MOUSE_ROTATION_X_FACTOR);

  if (canAnimate) {
    if (modelTransitioning) {
      infoRotationX = THREE.MathUtils.lerp(infoRotationX, fallbackX, 0.35);
      infoRotationY = THREE.MathUtils.lerp(infoRotationY, fallbackY, 0.35);
    } else if (innerObj) {
      const limitedY = THREE.MathUtils.clamp(innerObj.rotation.y, -SOLO_INFO_MAX_ROT_Y_RAD, SOLO_INFO_MAX_ROT_Y_RAD);
      const limitedX = softenVerticalRotation(innerObj.rotation.x);
      infoRotationX = limitedX;
      infoRotationY = limitedY;
    } else {
      infoRotationX = fallbackX;
      infoRotationY = fallbackY;
    }
  } else {
    infoRotationX = THREE.MathUtils.lerp(infoRotationX, 0, 0.18);
    infoRotationY = THREE.MathUtils.lerp(infoRotationY, 0, 0.18);
  }

  const xDeg = THREE.MathUtils.radToDeg(infoRotationX);
  const yDeg = THREE.MathUtils.radToDeg(infoRotationY);
  soloInfoPanel.style.setProperty('--solo-info-rot-x', `${xDeg.toFixed(3)}deg`);
  soloInfoPanel.style.setProperty('--solo-info-rot-y', `${yDeg.toFixed(3)}deg`);
}

function exitIntro() {
  if (!introActive) return;
  introActive = false;

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

  if (!isGridMode) {
    toggleMode();
  }

  if (isGridMode) {
    gridIntroAnimationId += 1;
    gridIntroRandomizationPending = true;
    triggerGridIntroRandomization();
  }

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
window.addEventListener('touchend', onTouchEnd);

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
  } else if (event.key === 'g' || event.key === 'G' || event.code === 'Space') {
    if (event.code === 'Space') {
      event.preventDefault();
    }
    toggleMode();
  }
});

// Loading
let modelsLoaded = 0;
let totalAssetsToLoad = 0;
let hasCompletedInitialLoad = false;
const loadingScreen = document.getElementById('loading-screen');

function checkLoadingComplete() {
  modelsLoaded++;
  if (!hasCompletedInitialLoad && totalAssetsToLoad > 0 && modelsLoaded >= totalAssetsToLoad) {
    hasCompletedInitialLoad = true;
    prewarmGridModels();
    setTimeout(() => {
      loadingScreen.classList.add('hidden');
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
  const desiredSize = 2.916; // Grid model size reduced by an additional 10%
  const computedScale = desiredSize / maxDimension;
  const manualScale = typeof modelConfig.scale === 'number' ? modelConfig.scale : 1;
  object3d.scale.multiplyScalar(computedScale * manualScale);

  // Recalculate after scaling
  object3d.updateMatrixWorld(true);
  const scaledBBox = new THREE.Box3().setFromObject(object3d);
  const scaledCenter = new THREE.Vector3();
  scaledBBox.getCenter(scaledCenter);
  object3d.position.sub(scaledCenter);

  // Align the base so every grid item rests on the same baseline
  object3d.updateMatrixWorld(true);
  const finalBBox = new THREE.Box3().setFromObject(object3d);
  const minY = finalBBox.min.y;
  object3d.position.y -= minY;

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
}

init();

// Show intro prompt immediately on touch devices
if (isTouchDevice && introPrompt) {
  introPrompt.textContent = 'TAP TO ENTER';
  introPrompt.classList.add('visible');
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  if (isGridMode) {
    // GRID MODE: Mouse-follow rotation for all grid models
    gridModels.forEach((model) => {
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

      // All models rotate based on gyroscope (mobile) or mouse (desktop)
      let inputX, inputY;
      if (gyroEnabled) {
        inputX = gyro.gamma; // left/right tilt
        inputY = gyro.beta;  // front/back tilt
      } else {
        inputX = mouse.x;
        inputY = mouse.y;
      }

      const targetRotationY = baseRotationY + inputX * Math.PI * 0.4;
      const targetRotationX = baseRotationX - inputY * Math.PI * 0.4;
      innerObj.rotation.y = THREE.MathUtils.lerp(innerObj.rotation.y, targetRotationY, 0.1);
      innerObj.rotation.x = THREE.MathUtils.lerp(innerObj.rotation.x, targetRotationX, 0.1);
      innerObj.rotation.z = THREE.MathUtils.lerp(innerObj.rotation.z, 0, 0.08);
    });
  } else {
    // SOLO MODE: Rotate main model with gyroscope (mobile) or mouse (desktop)
    const mainModel = mainModels[currentModelIndex];
    if (mainModel && mainModel.object) {
      const innerObj = mainModel.object.userData.innerObject;

      // Get input from gyroscope or mouse
      let inputX, inputY;
      const hasGyroInput = gyroEnabled && (Math.abs(gyro.gamma) > 0.01 || Math.abs(gyro.beta) > 0.01);

      if (hasGyroInput) {
        inputX = gyro.gamma; // left/right tilt
        inputY = gyro.beta;  // front/back tilt
      } else {
        inputX = mouse.x;
        inputY = mouse.y;
      }

      const hasActiveInput = hasGyroInput || mouseIsMoving;

      // Check if transitioning from initial random rotation
      if (mainModel.object.userData.isTransitioning && innerObj) {
        const targetRotationY = hasActiveInput ? inputX * Math.PI * SOLO_MOUSE_ROTATION_Y_FACTOR : 0;
        const targetRotationX = hasActiveInput ? -inputY * Math.PI * SOLO_MOUSE_ROTATION_X_FACTOR : 0;
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
        // Gyroscope or mouse control
        const targetRotationY = inputX * Math.PI * SOLO_MOUSE_ROTATION_Y_FACTOR;
        const targetRotationX = -inputY * Math.PI * SOLO_MOUSE_ROTATION_X_FACTOR;
        innerObj.rotation.y = THREE.MathUtils.lerp(innerObj.rotation.y, targetRotationY, 0.12);
        innerObj.rotation.x = THREE.MathUtils.lerp(innerObj.rotation.x, targetRotationX, 0.12);
      } else if (innerObj && !mainModel.object.userData.isTransitioning) {
        // Return to neutral when input stops (if not transitioning)
        innerObj.rotation.x *= 0.94;
        innerObj.rotation.y *= 0.94;
      }
    }
  }

  updateSoloInfoTransform();
  renderer.render(scene, camera);
}

animate();

// Handle resize
window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = frustumSize * aspect / -2;
  camera.right = frustumSize * aspect / 2;
  camera.top = frustumSize / 2;
  camera.bottom = frustumSize / -2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Update grid layout for orientation changes
  updateGridLayout();
});
