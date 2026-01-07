import * as THREE from 'three';

// Precipitation system state
let precipitationParticles = null;
let precipitationGeometry = null;
const PRECIP_COUNT = 5000;
const precipVelocities = [];
const precipDrift = [];
let currentPrecipType = 'none';

// References set by init
let scene = null;
let camera = null;
let sceneModels = null;

export function initSnow(sceneRef, cameraRef, modelsRef) {
  scene = sceneRef;
  camera = cameraRef;
  sceneModels = modelsRef;
  createPrecipitationSystem();
}

function createPrecipitationSystem() {
  precipitationGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(PRECIP_COUNT * 3);

  for (let i = 0; i < PRECIP_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 15;
    positions[i * 3 + 2] = 5 + Math.random() * 3;
    precipVelocities.push(0.03 + Math.random() * 0.05);
    precipDrift.push((Math.random() - 0.5) * 0.02);
  }

  precipitationGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const precipMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.5,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: false
  });

  precipitationParticles = new THREE.Points(precipitationGeometry, precipMaterial);
  precipitationParticles.visible = false;
  precipitationParticles.renderOrder = 999;
  scene.add(precipitationParticles);
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

          // Sample vertices that face upward in local space
          for (let i = 0; i < pos.count; i += 3) {
            let facesUp = true;
            if (normal) {
              const ny = normal.getY(i);
              facesUp = ny > 0.3;
            }

            if (facesUp) {
              // Local position relative to innerObject
              snowPositions.push(
                pos.getX(i),
                pos.getY(i) + 0.05,
                pos.getZ(i)
              );
            }
          }
        }
      });

      if (snowPositions.length === 0) return;

      // Create clumpy snow
      const maxSnow = 400;
      const clumpedPositions = [];
      const numClumps = Math.min(80, snowPositions.length / 9);

      for (let c = 0; c < numClumps; c++) {
        const srcIdx = Math.floor(Math.random() * (snowPositions.length / 3)) * 3;
        const baseX = snowPositions[srcIdx];
        const baseY = snowPositions[srcIdx + 1];
        const baseZ = snowPositions[srcIdx + 2];

        const clumpSize = 3 + Math.floor(Math.random() * 4);
        for (let p = 0; p < clumpSize && clumpedPositions.length / 3 < maxSnow; p++) {
          clumpedPositions.push(
            baseX + (Math.random() - 0.5) * 0.08,
            baseY + Math.random() * 0.03,
            baseZ + (Math.random() - 0.5) * 0.08
          );
        }
      }

      if (clumpedPositions.length === 0) return;

      const snowGeo = new THREE.BufferGeometry();
      snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(clumpedPositions), 3));

      const snowMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 1.2,
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
  if (!precipitationParticles || !precipitationParticles.visible) return;

  const positions = precipitationGeometry.attributes.position.array;
  const windOffset = windSpeed * 0.01;
  const fallSpeed = isSnow ? 1.0 : 2.5;

  for (let i = 0; i < PRECIP_COUNT; i++) {
    positions[i * 3 + 1] -= precipVelocities[i] * fallSpeed;
    positions[i * 3] += windOffset + (isSnow ? precipDrift[i] : 0);

    if (isSnow) {
      positions[i * 3] += Math.sin(Date.now() * 0.001 + i) * 0.005;
    }

    const resetY = camera.position.y + 10;
    const bottomY = camera.position.y - 8;
    if (positions[i * 3 + 1] < bottomY) {
      positions[i * 3 + 1] = resetY;
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 2] = 5 + Math.random() * 3;
    }

    if (positions[i * 3] > 12) positions[i * 3] = -12;
    if (positions[i * 3] < -12) positions[i * 3] = 12;
  }

  precipitationGeometry.attributes.position.needsUpdate = true;
}

export function setPrecipitation(type) {
  currentPrecipType = type;

  if (!precipitationParticles) return;

  if (type === 'none') {
    precipitationParticles.visible = false;
    hideSnowAccumulation();
    return;
  }

  precipitationParticles.visible = true;

  if (type === 'snow') {
    precipitationParticles.material.color.setHex(0xffffff);
    precipitationParticles.material.size = 1.5;
    precipitationParticles.material.opacity = 0.85;
    updateSnowAccumulation();
  } else {
    precipitationParticles.material.color.setHex(0x99aacc);
    precipitationParticles.material.size = 1;
    precipitationParticles.material.opacity = 0.6;
    hideSnowAccumulation();
  }
}

export function getCurrentPrecipType() {
  return currentPrecipType;
}
