import * as THREE from 'three';
import {
  state,
  sceneModels,
  introOverlay,
  introVideo,
  introPrompt,
  getGridConfig
} from './state.js';
import { toggleMode, updateModeIcon, setupModelForMobileSolo } from './models.js';

// Forward declarations for functions that will be set by other modules
let updateModelInfoDisplayFunc = null;
let startMobileSwipeHintFunc = null;

export function setUpdateModelInfoDisplay(fn) {
  updateModelInfoDisplayFunc = fn;
}

export function setStartMobileSwipeHint(fn) {
  startMobileSwipeHintFunc = fn;
}

export function clearIntroPromptTimers() {
  if (state.introPromptHideTimer) {
    clearTimeout(state.introPromptHideTimer);
    state.introPromptHideTimer = null;
  }
}

export function scheduleIntroPromptHide() {
  if (!introPrompt) return;
  if (state.introPromptHideTimer) {
    clearTimeout(state.introPromptHideTimer);
  }
  state.introPromptHideTimer = setTimeout(() => {
    introPrompt.classList.remove('visible');
    state.introPromptHideTimer = null;
  }, 2000);
}

export function updateIntroPrompt() {
  // Intro prompt is now static - no mouse following needed
}

export function triggerGridIntroRandomization() {
  if (!state.gridIntroRandomizationPending || !state.isGridMode) return;

  let awaiting = false;
  sceneModels.forEach((entry) => {
    if (!entry || !entry.object) {
      awaiting = true;
      return;
    }
    applyGridIntroRandomization(entry);
  });

  if (!awaiting) {
    state.gridIntroRandomizationPending = false;
  }
}

export function applyGridIntroRandomization(entry) {
  const group = entry && entry.object;
  if (!group) return false;
  if (group.userData.gridIntroAnimationId === state.gridIntroAnimationId) {
    group.userData.gridIntroAnimating = true;
    return false;
  }

  const innerObj = group.userData.innerObject;
  if (!innerObj) return false;

  innerObj.rotation.x = (Math.random() - 0.5) * Math.PI * 1.2;
  innerObj.rotation.y = (Math.random() - 0.5) * Math.PI * 2;
  innerObj.rotation.z = (Math.random() - 0.5) * Math.PI * 0.4;

  group.userData.gridIntroAnimating = true;
  group.userData.gridIntroAnimationId = state.gridIntroAnimationId;
  return true;
}

export function exitIntro() {
  if (!state.introActive) return;
  state.introActive = false;
  state.introJustExited = true;

  // Small delay before allowing interactions
  setTimeout(() => {
    state.introJustExited = false;
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

  const config = getGridConfig();
  const delay = config.isMobileSolo ? 300 : 0;

  setTimeout(() => {
    if (config.isMobileSolo) {
      // Mobile: Start in solo mode with first model
      state.isGridMode = false;
      state.mobileCurrentModelIndex = 0;
      state.currentModelIndex = 0;

      // Setup first model, ensure others are hidden
      const firstModel = sceneModels[0];
      if (firstModel && firstModel.object) {
        // Hide all models first
        sceneModels.forEach((model) => {
          if (model && model.object) {
            model.object.visible = false;
          }
        });

        // Setup and show only the first model
        setupModelForMobileSolo(firstModel);
        firstModel.object.visible = true;
      }

      updateModeIcon();
      if (updateModelInfoDisplayFunc) updateModelInfoDisplayFunc();
      if (startMobileSwipeHintFunc) startMobileSwipeHintFunc(); // Start hint timer
    } else {
      // Desktop: Enter grid mode after intro
      state.isGridMode = false;
      toggleMode(); // Toggle to grid mode

      // Trigger grid intro animation
      state.gridIntroAnimationId += 1;
      state.gridIntroRandomizationPending = true;
      triggerGridIntroRandomization();

      if (updateModelInfoDisplayFunc) updateModelInfoDisplayFunc();
    }
  }, delay);
}

export function showIntro() {
  if (!introOverlay) return;

  state.introActive = true;
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

  if (updateModelInfoDisplayFunc) updateModelInfoDisplayFunc();
}
