import * as THREE from 'three';

// Snow system state
let snowParticles = null;
let snowGeometry = null;
const SNOW_COUNT = 6000;
const snowData = []; // velocity, drift, size, phase for each particle
let currentPrecipType = 'none';

// Wind state - varies over time for gusts
let windTime = 0;
let gustStrength = 0;
let gustTarget = 0;

// References
let scene = null;
let camera = null;
let sceneModels = null;

export function initSnow(sceneRef, cameraRef, modelsRef) {
  scene = sceneRef;
  camera = cameraRef;
  sceneModels = modelsRef;
  createSnowSystem();
  createTextSnow();
}

function createSnowSystem() {
  snowGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(SNOW_COUNT * 3);
  const sizes = new Float32Array(SNOW_COUNT);

  for (let i = 0; i < SNOW_COUNT; i++) {
    // Spread across view
    positions[i * 3] = (Math.random() - 0.5) * 25;
    positions[i * 3 + 1] = Math.random() * 20 - 5;
    positions[i * 3 + 2] = 3 + Math.random() * 5;

    // Each snowflake has unique properties
    snowData.push({
      velocity: 0.015 + Math.random() * 0.04,  // Fall speed varies a lot
      drift: (Math.random() - 0.5) * 0.03,     // Horizontal drift
      wobble: Math.random() * Math.PI * 2,      // Phase for wobble
      wobbleSpeed: 0.5 + Math.random() * 1.5,   // Wobble frequency
      wobbleAmp: 0.002 + Math.random() * 0.008, // Wobble amount
      size: 0.8 + Math.random() * 1.5           // Size variation
    });

    sizes[i] = snowData[i].size;
  }

  snowGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  snowGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const snowMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.2,
    transparent: true,
    opacity: 0.9,
    sizeAttenuation: false
  });

  snowParticles = new THREE.Points(snowGeometry, snowMaterial);
  snowParticles.visible = false;
  snowParticles.renderOrder = 999;
  scene.add(snowParticles);
}

// CSS snow for text section
let textSnowElement = null;
function createTextSnow() {
  const style = document.createElement('style');
  style.textContent = `
    .text-snow-container {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 40vh;
      pointer-events: none;
      overflow: hidden;
      z-index: 100;
      display: none;
    }
    .text-snow-container.visible {
      display: block;
    }
    .text-snowflake {
      position: absolute;
      width: 4px;
      height: 4px;
      background: white;
      border-radius: 50%;
      opacity: 0;
      animation: textSnowFall linear infinite;
    }
    @keyframes textSnowFall {
      0% {
        opacity: 0;
        transform: translateY(-20px) rotate(0deg);
      }
      10% {
        opacity: 0.8;
      }
      90% {
        opacity: 0.6;
      }
      100% {
        opacity: 0;
        transform: translateY(40vh) rotate(360deg);
      }
    }
  `;
  document.head.appendChild(style);

  textSnowElement = document.createElement('div');
  textSnowElement.className = 'text-snow-container';

  // Create varied snowflakes
  for (let i = 0; i < 80; i++) {
    const flake = document.createElement('div');
    flake.className = 'text-snowflake';
    const size = 2 + Math.random() * 4;
    const left = Math.random() * 100;
    const delay = Math.random() * 8;
    const duration = 4 + Math.random() * 6;

    flake.style.cssText = `
      left: ${left}%;
      width: ${size}px;
      height: ${size}px;
      animation-duration: ${duration}s;
      animation-delay: ${delay}s;
    `;
    textSnowElement.appendChild(flake);
  }

  document.body.appendChild(textSnowElement);
}

// Update snow accumulation on models - attached to innerObject so it rotates with model
export function updateSnowAccumulation() {
  if (currentPrecipType !== 'snow' || !sceneModels) return;

  sceneModels.forEach((model) => {
    if (!model || !model.object) return;

    const innerObj = model.object.userData.innerObject;
    if (!innerObj) return;

    // Add snow particles on top-facing surfaces - attach to innerObject
    if (!innerObj.userData.snowParticles) {
      const snowPositions = [];

      // Collect top-facing vertices from all meshes
      innerObj.traverse((child) => {
        if (child.isMesh && child.geometry) {
          const geo = child.geometry;
          const pos = geo.attributes.position;
          const normal = geo.attributes.normal;

          if (!pos) return;

          // Sample more vertices for better coverage
          for (let i = 0; i < pos.count; i += 2) {
            let facesUp = true;
            if (normal) {
              const ny = normal.getY(i);
              facesUp = ny > 0.2; // More lenient - catch more surfaces
            }

            if (facesUp) {
              snowPositions.push(
                pos.getX(i),
                pos.getY(i) + 0.03,
                pos.getZ(i)
              );
            }
          }
        }
      });

      if (snowPositions.length === 0) return;

      // Create varied clumpy snow - more organic
      const maxSnow = 500;
      const clumpedPositions = [];
      const numClumps = Math.min(120, Math.floor(snowPositions.length / 6));

      for (let c = 0; c < numClumps; c++) {
        const srcIdx = Math.floor(Math.random() * (snowPositions.length / 3)) * 3;
        const baseX = snowPositions[srcIdx];
        const baseY = snowPositions[srcIdx + 1];
        const baseZ = snowPositions[srcIdx + 2];

        // Vary clump sizes more - 2 to 8 particles
        const clumpSize = 2 + Math.floor(Math.random() * 7);
        // Vary clump spread
        const spread = 0.04 + Math.random() * 0.1;

        for (let p = 0; p < clumpSize && clumpedPositions.length / 3 < maxSnow; p++) {
          clumpedPositions.push(
            baseX + (Math.random() - 0.5) * spread,
            baseY + Math.random() * 0.04,
            baseZ + (Math.random() - 0.5) * spread
          );
        }
      }

      if (clumpedPositions.length === 0) return;

      const snowGeo = new THREE.BufferGeometry();
      snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(clumpedPositions), 3));

      // Detect mobile for bigger particles
      const isMobile = window.innerWidth < window.innerHeight;
      const snowMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: isMobile ? 2.5 : 1.8,
        transparent: true,
        opacity: 0.9,
        sizeAttenuation: false
      });

      const snowPoints = new THREE.Points(snowGeo, snowMat);
      snowPoints.renderOrder = 998;
      innerObj.add(snowPoints);
      innerObj.userData.snowParticles = snowPoints;
    }

    if (innerObj.userData.snowParticles) {
      innerObj.userData.snowParticles.visible = model.object.visible;
    }
  });
}

export function hideSnowAccumulation() {
  if (!sceneModels) return;
  sceneModels.forEach((model) => {
    const innerObj = model?.object?.userData?.innerObject;
    if (innerObj?.userData?.snowParticles) {
      innerObj.userData.snowParticles.visible = false;
    }
  });
}

export function updatePrecipitation(windSpeed, isSnow) {
  if (!snowParticles || !snowParticles.visible) return;

  const positions = snowGeometry.attributes.position.array;
  const time = Date.now() * 0.001;

  // Update wind gusts - random changes over time
  windTime += 0.016;
  if (Math.random() < 0.01) {
    gustTarget = (Math.random() - 0.3) * 0.03; // Occasional gusts, mostly one direction
  }
  gustStrength += (gustTarget - gustStrength) * 0.02;

  const baseWind = windSpeed * 0.008 + gustStrength;

  for (let i = 0; i < SNOW_COUNT; i++) {
    const data = snowData[i];

    // Fall with individual velocity
    positions[i * 3 + 1] -= data.velocity;

    // Horizontal movement: wind + drift + wobble
    const wobble = Math.sin(time * data.wobbleSpeed + data.wobble) * data.wobbleAmp;
    positions[i * 3] += baseWind + data.drift + wobble;

    // Slight z wobble too
    positions[i * 3 + 2] += Math.cos(time * data.wobbleSpeed * 0.7 + data.wobble) * data.wobbleAmp * 0.5;

    // Reset when below view - follow camera Y
    const resetY = camera.position.y + 12;
    const bottomY = camera.position.y - 10;
    if (positions[i * 3 + 1] < bottomY) {
      positions[i * 3 + 1] = resetY + Math.random() * 3;
      positions[i * 3] = (Math.random() - 0.5) * 25;
      positions[i * 3 + 2] = 3 + Math.random() * 5;
    }

    // Wrap horizontally
    if (positions[i * 3] > 15) positions[i * 3] = -15;
    if (positions[i * 3] < -15) positions[i * 3] = 15;
  }

  snowGeometry.attributes.position.needsUpdate = true;
}

export function setPrecipitation(type) {
  currentPrecipType = type;

  if (!snowParticles) return;

  const isMobile = window.innerWidth < window.innerHeight;

  if (type === 'none') {
    snowParticles.visible = false;
    hideSnowAccumulation();
    if (textSnowElement) textSnowElement.classList.remove('visible');
    return;
  }

  snowParticles.visible = true;

  if (type === 'snow') {
    snowParticles.material.color.setHex(0xffffff);
    snowParticles.material.size = isMobile ? 3 : 2;
    snowParticles.material.opacity = 0.9;
    updateSnowAccumulation();
    if (textSnowElement) textSnowElement.classList.add('visible');
  } else {
    snowParticles.material.color.setHex(0x99aacc);
    snowParticles.material.size = isMobile ? 2 : 1.5;
    snowParticles.material.opacity = 0.6;
    hideSnowAccumulation();
    if (textSnowElement) textSnowElement.classList.remove('visible');
  }
}

export function getCurrentPrecipType() {
  return currentPrecipType;
}
