import * as THREE from 'three';

// DOM element references
export const container = document.querySelector('#scene-container');
export const introOverlay = document.getElementById('intro-overlay');
export const introVideo = document.getElementById('intro-video');
export const introPrompt = document.getElementById('intro-cursor-prompt');
export const gridModeIcon = document.getElementById('grid-mode-icon');
export const soloInfoPanel = document.getElementById('solo-info-panel');
export const soloInfoTitle = document.getElementById('solo-info-title');
export const soloInfoBody = document.getElementById('solo-info-body');

// Mobile dropdown elements
export const mobileHeader = document.getElementById('mobile-header');
export const modelSelectorBtn = document.getElementById('model-selector-btn');
export const currentModelNameEl = document.getElementById('current-model-name');
export const mobileGoTop = document.getElementById('mobile-go-top');
export const modelDropdown = document.getElementById('model-dropdown');
export const modelDropdownList = document.getElementById('model-dropdown-list');
export const modelDropdownInfo = document.getElementById('model-dropdown-info');

// UI elements
export const textContent = document.getElementById('text-content');
export const uiOverlay = document.getElementById('ui-overlay');
export const soloGoTop = document.getElementById('solo-go-top');
export const modelList = document.getElementById('model-list');
export const modelListItems = document.getElementById('model-list-items');
export const modelListGoTop = document.getElementById('model-list-go-top');

// Display state - these are mutable exports that other modules can modify
export const state = {
  currentModelIndex: 0,
  isGridMode: true, // Toggle between solo and grid mode - default to grid
  introActive: true,
  isDarkMode: false,
  isPartyMode: false,
  dropdownOpen: false,

  // Intro state
  introJustExited: false,
  introPromptHideTimer: null,
  introPromptTimer: null,
  gridIntroRandomizationPending: false,
  gridIntroAnimationId: 0,

  // Idle detection for power saving
  isIdle: false,

  // Mobile solo mode state
  mobileCurrentModelIndex: 0,
  mobileHeaderVisible: true,
  mobileSwipeStartX: 0,
  mobileSwipeStartY: 0,
  mobileSwipeDeltaX: 0,
  mobileSwipeDeltaY: 0,
  isMobileSwiping: false,
  mobileSwipeDirection: null, // 'horizontal' or 'vertical'

  // Mobile swipe hint
  mobileSwipeHintTimer: null,
  mobileSwipeHintActive: false,
  mobileSwipeHintPhase: 0,
  mobileSwipeHintShown: false, // Only show hint once per session

  // Loading state
  modelsLoaded: 0,
  totalAssetsToLoad: 0,
  hasCompletedInitialLoad: false,

  // Visibility handling
  isPageVisible: true,
  isSceneVisible: true,
  animationFrameId: null,
  lastFrameTime: 0,
  lastInteractionTime: Date.now(),

  // Wiggle effect
  wiggleTime: 0,

  // Model list state
  modelListHovering: false,
  modelListShowingGoTop: false,
  modelListAnimationTimeouts: [],

  // Word reveal
  wordRevealQueue: [],
  isProcessingWords: false,
  lastScrollY: 0,
  scrollDirection: 'down',

  // FPS counter
  fpsDisplayVisible: false,
  fpsElement: null,
  fpsFrameCount: 0,
  fpsLastTime: performance.now(),
  currentFps: 0
};

// Models data - arrays that store loaded models
export let models = [];
export const sceneModels = []; // Single set of models used for both grid and solo modes
export let modelInfoById = new Map();

// Functions to update module-level variables (needed because ES6 modules export bindings, not values)
export function setModels(newModels) {
  models = newModels;
}

export function setModelInfoById(newMap) {
  modelInfoById = newMap;
}

// Scale factors for different modes
export const GRID_MODEL_SIZE = 2.916;
export const SOLO_MODEL_SIZE = 4.725;

export const SOLO_MODEL_TRANSITION_SPEED = 0.12;
export const SOLO_MODEL_TRANSITION_THRESHOLD = 0.01;
export const SOLO_MOUSE_ROTATION_Y_FACTOR = 0.25;
export const SOLO_MOUSE_ROTATION_X_FACTOR = 0.15;

// Grid presentation
export const DEFAULT_GRID_ROTATION_DEG = 15;
export const GRID_ROTATION_OVERRIDE_DEG = {};

// Swipe hint constants
export const SWIPE_HINT_DELAY = 4000; // 4 seconds before showing hint
export const SWIPE_HINT_OFFSET = 2.0; // How far to slide to reveal adjacent models

// Touch constants
export const TAP_THRESHOLD = 200; // ms - taps shorter than this trigger interaction
export const DOUBLE_TAP_THRESHOLD = 300; // ms - taps within this time are double tap
export const DRAG_THRESHOLD = 10; // pixels - movement beyond this is a drag

// Frame rate constants
export const BASE_FRAME_INTERVAL = 16; // ms - cap at ~60fps
export const IDLE_FRAME_INTERVAL = 200; // ms - 5fps when idle
export const IDLE_TIMEOUT = 3000; // 3 seconds of no interaction = idle

// Shake detection constants
export const SHAKE_THRESHOLD = 15; // Acceleration threshold
export const SHAKE_RESET_TIME = 500; // Reset shake count after this many ms
export const SHAKES_NEEDED = 3; // Number of shakes to trigger disco

// Gyro smoothing constant
export const GYRO_SMOOTHING = 0.15; // Lower = smoother but slower response

// Texture size limit
export const MAX_TEXTURE_SIZE = 1024;

// Model list styling constants
export const MODEL_LIST_ACTIVE_SIZE = 12; // px
export const MODEL_LIST_ACTIVE_OPACITY = 0.6;
export const MODEL_LIST_MIN_SIZE = 7;
export const MODEL_LIST_MIN_OPACITY = 0.15;
export const GOLDEN_RATIO = 1.618;

// Color constants
export const lightModeBackground = 0xf7f6f3;
export const darkModeBackground = 0x0a0a0a;

// Mouse tracking
export const mouse = new THREE.Vector2();
export const mouseState = {
  isMoving: false,
  idleTimer: null
};

// Gyroscope support
export const gyro = { beta: 0, gamma: 0 }; // beta = front/back tilt, gamma = left/right tilt
export const gyroState = {
  enabled: false,
  permissionGranted: false,
  smoothedBeta: 0,
  smoothedGamma: 0,
  lastShakeTime: 0,
  shakeCount: 0
};

// Touch drag for solo mode rotation
export const touchState = {
  dragging: false,
  startX: 0,
  startY: 0,
  dragRotationX: 0,
  dragRotationY: 0,
  dragTargetX: 0,
  dragTargetY: 0,
  startTime: 0,
  lastEndTime: 0, // Prevent click firing after touch
  lastTapTime: 0,
  lastY: 0,
  lastTime: 0
};

// Mobile / touch detection
export const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// Camera frustum size
export const baseFrustumSize = 12;

// Grid layout configuration
export function getGridConfig() {
  const isMobile = window.innerWidth <= 900;

  if (isMobile) {
    // Mobile: Solo mode only - one model at a time, swipe to change
    return {
      cols: 1,
      rows: 1,
      cellWidth: 0,
      cellHeight: 0,
      modelSize: 3.6, // Smaller for mobile screens
      isMobileSolo: true,
      isMobileScroll: false
    };
  } else {
    // Desktop/landscape: 5 columns, 2 rows
    return {
      cols: 5,
      rows: 2,
      cellWidth: 3.96,
      cellHeight: 4.32,
      modelSize: 2.916,
      isMobileSolo: false,
      isMobileScroll: false
    };
  }
}

export function getGridPosition(modelIndex) {
  const config = getGridConfig();
  const { cols, cellWidth, cellHeight } = config;

  // Mobile solo mode doesn't use grid positions
  if (config.isMobileSolo) {
    return { x: 0, y: 0 };
  }

  const rows = Math.ceil(models.length / cols);
  const gridWidth = cols * cellWidth;

  const col = modelIndex % cols;
  const row = Math.floor(modelIndex / cols);

  const x = (col * cellWidth) - (gridWidth / 2) + (cellWidth / 2);
  // Center the grid vertically, offset for bottom-aligned models
  const y = (rows / 2 - row - 0.5) * cellHeight - (config.modelSize / 2);

  return { x, y };
}
