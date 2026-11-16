import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  color,
  uniform,
  positionWorld,
  normalWorldGeometry,
  cameraPosition,
  floor,
  fract,
  sin,
  dot,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  abs,
  normalize,
  reflect,
  pow,
  fwidth
} from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';

/**
 * Automated Light-Switching Schedule & Materials for Government Complex Sejong (정부세종청사)
 * Toggles building facades, elevated S-curve skybridges, piloti lobbies, and rooftop garden
 * strips between daytime natural light reflection and night office illumination by time-of-day.
 */

const SEJONG_LIGHTING_MODES = {
  midday: {
    id: 'midday',
    mode: 'daylight-reflection',
    labelKo: '주간 자연광 반사 (자동 소등)',
    officeIllumination: 0.0,
    occupancyRatio: 0.0,
    skybridgeIllumination: 0.0,
    lobbyGlow: 0.0,
    pergolaGlow: 0.0,
    daylightReflection: 1.0,
    glassReflectivity: 0.96,
    glassRoughness: 0.06,
    glassMetalness: 0.84,
    solarSpecularStrength: 1.35
  },
  golden: {
    id: 'golden',
    mode: 'dusk-transition',
    labelKo: '노을 반사 · 부분 점등 전환',
    officeIllumination: 0.38,
    occupancyRatio: 0.34,
    skybridgeIllumination: 0.44,
    lobbyGlow: 0.56,
    pergolaGlow: 0.48,
    daylightReflection: 0.74,
    glassReflectivity: 0.90,
    glassRoughness: 0.08,
    glassMetalness: 0.78,
    solarSpecularStrength: 1.15
  },
  twilight: {
    id: 'twilight',
    mode: 'evening-illumination',
    labelKo: '매직아워 · 청사 야간 근무 점등',
    officeIllumination: 0.96,
    occupancyRatio: 0.78,
    skybridgeIllumination: 0.88,
    lobbyGlow: 1.12,
    pergolaGlow: 1.08,
    daylightReflection: 0.24,
    glassReflectivity: 0.72,
    glassRoughness: 0.11,
    glassMetalness: 0.62,
    solarSpecularStrength: 0.42
  },
  midnight: {
    id: 'midnight',
    mode: 'night-office-illumination',
    labelKo: '심야 청사 자동 절전 · 스카이브리지 야경',
    officeIllumination: 1.28,
    occupancyRatio: 0.52,
    skybridgeIllumination: 1.18,
    lobbyGlow: 1.36,
    pergolaGlow: 1.42,
    daylightReflection: 0.07,
    glassReflectivity: 0.56,
    glassRoughness: 0.14,
    glassMetalness: 0.50,
    solarSpecularStrength: 0.18
  }
};

function getSejongLightingPreset(timeId) {
  return SEJONG_LIGHTING_MODES[timeId] || SEJONG_LIGHTING_MODES.golden;
}

function computeSejongLightingState(timeId) {
  const p = getSejongLightingPreset(timeId);
  return {
    id: p.id,
    mode: p.mode,
    labelKo: p.labelKo,
    officeIllumination: p.officeIllumination,
    occupancyRatio: p.occupancyRatio,
    skybridgeIllumination: p.skybridgeIllumination,
    lobbyGlow: p.lobbyGlow,
    pergolaGlow: p.pergolaGlow,
    daylightReflection: p.daylightReflection,
    glassReflectivity: p.glassReflectivity,
    glassRoughness: p.glassRoughness,
    glassMetalness: p.glassMetalness,
    solarSpecularStrength: p.solarSpecularStrength
  };
}

/**
 * Deterministic architectural office-bay switching oracle matching the TSL facade rule.
 * Used for unit verification and diagnostics across wings, floors, and bays.
 */
function evaluateBuildingLightSchedule(wingIndex, floorIndex, bayIndex, timeId, seed = 77.4) {
  const preset = getSejongLightingPreset(timeId);
  const officeCol = Math.floor(bayIndex / 2);
  const dotVal = (officeCol + seed) * 127.1 + (floorIndex + 19.7 + wingIndex * 7.0) * 311.7;
  const roomRand = Math.sin(dotVal) * 43758.5453 - Math.floor(Math.sin(dotVal) * 43758.5453);
  const tempDot = (officeCol + 41.2) * 127.1 + (floorIndex + seed) * 311.7;
  const tempRand = Math.sin(tempDot) * 43758.5453 - Math.floor(Math.sin(tempDot) * 43758.5453);

  const lit = preset.officeIllumination > 0.01 && roomRand <= preset.occupancyRatio;
  return {
    lit,
    mode: preset.mode,
    intensity: lit ? preset.officeIllumination : 0.0,
    colorTempK: tempRand >= 0.38 ? 4500 : 3000,
    daylightReflection: preset.daylightReflection
  };
}

const hash2DLocal = Fn(([p]) => {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

/**
 * TSL Curtain-Wall Glass Material for Sejong Government Buildings.
 * Automatically shifts between daytime sky/solar reflection (office lights off)
 * and staggered 2-bay office illumination at twilight/midnight.
 */
function createSejongFacadeMaterial(uniforms, opts = {}) {
  const {
    glassTint = 0x20425f,
    frameTint = 0xcad4de,
    windowWidth = 3.2,
    floorHeight = 4.2,
    mullionThickness = 0.065,
    spandrelRatio = 0.24,
    seed = 77.4
  } = opts;

  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.72,
    roughness: 0.12
  });

  const cGlass = color(glassTint);
  const cFrame = color(frameTint);
  const uSeed = float(seed);

  const alongZ = step(abs(normalWorldGeometry.z).sub(0.0001), abs(normalWorldGeometry.x));
  const isRoof = step(0.55, abs(normalWorldGeometry.y));
  const uWorld = mix(positionWorld.x, positionWorld.z, alongZ);
  const vWorld = positionWorld.y;

  const gridU = uWorld.div(windowWidth);
  const gridV = vWorld.div(floorHeight);
  const cellId = vec2(floor(gridU), floor(gridV));
  const cellUV = vec2(fract(gridU), fract(gridV));
  const fw = vec2(fwidth(gridU), fwidth(gridV)).max(0.001);

  const paneX = smoothstep(float(mullionThickness).sub(fw.x), float(mullionThickness).add(fw.x), cellUV.x)
    .mul(float(1.0).sub(smoothstep(float(1.0 - mullionThickness).sub(fw.x), float(1.0 - mullionThickness).add(fw.x), cellUV.x)));
  const paneY = smoothstep(float(spandrelRatio).sub(fw.y), float(spandrelRatio).add(fw.y), cellUV.y)
    .mul(float(1.0).sub(smoothstep(float(1.0 - mullionThickness).sub(fw.y), float(1.0 - mullionThickness).add(fw.y), cellUV.y)));
  const isGlassPane = paneX.mul(paneY).mul(float(1.0).sub(isRoof));

  // Group into 2-bay office zones so entire rooms toggle coherently
  const officeId = vec2(floor(gridU.div(2.0)), floor(gridV));
  const roomRand = hash2DLocal(officeId.add(vec2(uSeed, 19.7)));
  const tempRand = hash2DLocal(officeId.add(vec2(41.2, uSeed)));
  const wingCoord = clamp(positionWorld.x.add(160.0).div(500.0), 0.0, 1.0);
  const switchThreshold = mix(roomRand.add(wingCoord.mul(0.24)).sub(0.12), roomRand, uniforms.uSwitchWave);
  const roomLit = float(1.0).sub(smoothstep(uniforms.uOccupancyRatio.sub(0.03), uniforms.uOccupancyRatio.add(0.03), switchThreshold));
  const roomTint = mix(color(0xffd699), color(0xeaf4ff), step(0.38, tempRand));
  const ceilingBias = smoothstep(0.25, 0.90, cellUV.y).mul(0.55).add(0.45);

  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const paneRand = hash2DLocal(cellId.add(vec2(uSeed, 3.1))).sub(0.5);
  const nPane = normalize(normalWorldGeometry.add(vec3(paneRand.mul(0.035), 0.015, paneRand.negate().mul(0.035))));
  const reflectDir = reflect(viewDir.negate(), nPane);
  const fresnel = pow(clamp(float(1.0).sub(abs(dot(viewDir, nPane))), 0.0, 1.0), 2.1);

  mat.colorNode = Fn(() => {
    const skyElev = clamp(reflectDir.y.mul(0.72).add(0.32), 0.0, 1.0);
    const skyReflect = mix(cityUniforms.uSkyHorizonColor, cityUniforms.uSkyTopColor, clamp(skyElev.mul(1.35), 0.0, 1.0));
    const sunDir = normalize(cityUniforms.uSkySunDir);
    const sunSpec = pow(max(dot(reflectDir, sunDir), 0.0), 42.0).mul(uniforms.uSolarSpecularStrength);
    const parkHorizon = mix(color(0x4b6355), skyReflect, smoothstep(-0.08, 0.14, reflectDir.y));

    const naturalEnv = mix(parkHorizon, cityUniforms.uSunColor, clamp(sunSpec.mul(0.75), 0.0, 1.0))
      .mul(float(0.65).add(uniforms.uDaylightReflection.mul(0.62)));

    const interiorVisible = roomTint.mul(roomLit).mul(uniforms.uOfficeIllumination).mul(0.42);
    const baseGlass = cGlass.add(interiorVisible);
    const reflectionMix = clamp(fresnel.mul(uniforms.uGlassReflectivity).add(uniforms.uDaylightReflection.mul(0.34)), 0.0, 0.96);
    const glassSurface = mix(baseGlass, naturalEnv, reflectionMix).add(cityUniforms.uSunColor.mul(sunSpec.mul(0.45)));

    const spandrelMask = float(1.0).sub(smoothstep(float(spandrelRatio).sub(fw.y), float(spandrelRatio).add(fw.y), cellUV.y));
    const frameSurface = mix(cFrame, cFrame.mul(0.62), spandrelMask);
    const facadeCol = mix(frameSurface, glassSurface, isGlassPane);
    const roofCol = color(0xd8e0e8);
    return mix(facadeCol, roofCol, isRoof);
  })();

  mat.roughnessNode = Fn(() => {
    const paneRough = uniforms.uGlassRoughness;
    const frameRough = float(0.48);
    return mix(mix(frameRough, paneRough, isGlassPane), float(0.70), isRoof);
  })();

  mat.metalnessNode = Fn(() => {
    return mix(float(0.28), uniforms.uGlassMetalness, isGlassPane);
  })();

  mat.emissiveNode = Fn(() => {
    const trans = float(1.0).sub(fresnel.mul(0.55));
    return roomTint
      .mul(roomLit)
      .mul(ceilingBias)
      .mul(isGlassPane)
      .mul(uniforms.uOfficeIllumination)
      .mul(trans);
  })();

  return mat;
}

/**
 * TSL Skybridge Corridor Glass Material for Sejong's elevated S-curve skybridges.
 * Reflects crisp daylight/sky by day, glows smoothly as an elevated pedestrian beacon by night.
 */
function createSejongSkybridgeMaterial(uniforms) {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.68,
    roughness: 0.12
  });

  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const nW = normalize(normalWorldGeometry);
  const reflectDir = reflect(viewDir.negate(), nW);
  const fresnel = pow(clamp(float(1.0).sub(abs(dot(viewDir, nW))), 0.0, 1.0), 2.0);
  const isSideWall = float(1.0).sub(step(0.55, abs(nW.y)));

  mat.colorNode = Fn(() => {
    const skyElev = clamp(reflectDir.y.mul(0.65).add(0.35), 0.0, 1.0);
    const skyReflect = mix(cityUniforms.uSkyHorizonColor, cityUniforms.uSkyTopColor, skyElev);
    const sunDir = normalize(cityUniforms.uSkySunDir);
    const sunSpec = pow(max(dot(reflectDir, sunDir), 0.0), 36.0).mul(uniforms.uSolarSpecularStrength);
    const glassCol = mix(color(0x284e6e), skyReflect, clamp(fresnel.mul(uniforms.uGlassReflectivity).add(uniforms.uDaylightReflection.mul(0.38)), 0.0, 0.95))
      .add(cityUniforms.uSunColor.mul(sunSpec.mul(0.45)));
    return mix(color(0xd8e0e8), glassCol, isSideWall);
  })();

  mat.roughnessNode = mix(float(0.52), uniforms.uGlassRoughness, isSideWall);

  mat.emissiveNode = Fn(() => {
    // Rhythmic structural window mullions along the bridge curve
    const rib = smoothstep(0.15, 0.35, fract(positionWorld.x.add(positionWorld.z).div(4.5)));
    return color(0xffe4b5)
      .mul(uniforms.uSkybridgeIllumination)
      .mul(rib)
      .mul(isSideWall)
      .mul(0.85);
  })();

  return mat;
}

/**
 * TSL Accent Glow Material for 1st-floor piloti lobbies & rooftop garden pergolas.
 * Switches cleanly OFF at midday and illuminates warmly at dusk/night.
 */
function createSejongAccentGlowMaterial(uniforms, kind = 'lobby') {
  const isPergola = kind === 'pergola';
  const mat = new THREE.MeshStandardNodeMaterial({
    color: isPergola ? 0xebeff4 : 0x2f4358,
    roughness: isPergola ? 0.34 : 0.14,
    metalness: isPergola ? 0.22 : 0.65
  });

  const targetUniform = isPergola ? uniforms.uPergolaGlow : uniforms.uLobbyGlow;
  const glowColor = isPergola ? color(0xffc970) : color(0xffdfb0);

  mat.emissiveNode = glowColor.mul(targetUniform);
  return mat;
}

/**
 * Creates the runtime Government Complex Sejong Light-Switching Controller & shared TSL materials.
 */
function createSejongLightingSystem(initialTimeId = 'golden') {
  const initial = getSejongLightingPreset(initialTimeId);

  const uniforms = {
    uOfficeIllumination: uniform(initial.officeIllumination),
    uOccupancyRatio: uniform(initial.occupancyRatio),
    uSkybridgeIllumination: uniform(initial.skybridgeIllumination),
    uLobbyGlow: uniform(initial.lobbyGlow),
    uPergolaGlow: uniform(initial.pergolaGlow),
    uDaylightReflection: uniform(initial.daylightReflection),
    uGlassReflectivity: uniform(initial.glassReflectivity),
    uGlassRoughness: uniform(initial.glassRoughness),
    uGlassMetalness: uniform(initial.glassMetalness),
    uSolarSpecularStrength: uniform(initial.solarSpecularStrength),
    uSwitchWave: uniform(1.0)
  };

  let activeTimeId = initial.id;
  let activeMode = initial.mode;
  let target = { ...initial };
  const current = { ...initial };
  let switchWave = 1.0;

  function applyCurrentUniforms() {
    uniforms.uOfficeIllumination.value = current.officeIllumination;
    uniforms.uOccupancyRatio.value = current.occupancyRatio;
    uniforms.uSkybridgeIllumination.value = current.skybridgeIllumination;
    uniforms.uLobbyGlow.value = current.lobbyGlow;
    uniforms.uPergolaGlow.value = current.pergolaGlow;
    uniforms.uDaylightReflection.value = current.daylightReflection;
    uniforms.uGlassReflectivity.value = current.glassReflectivity;
    uniforms.uGlassRoughness.value = current.glassRoughness;
    uniforms.uGlassMetalness.value = current.glassMetalness;
    uniforms.uSolarSpecularStrength.value = current.solarSpecularStrength;
    uniforms.uSwitchWave.value = switchWave;
  }

  function setTimeOfDay(timeId, { immediate = false } = {}) {
    const next = getSejongLightingPreset(timeId);
    const changed = next.id !== activeTimeId;
    activeTimeId = next.id;
    activeMode = next.mode;
    target = { ...next };

    if (immediate) {
      Object.assign(current, next);
      switchWave = 1.0;
      applyCurrentUniforms();
    } else if (changed) {
      switchWave = 0.0;
      uniforms.uSwitchWave.value = 0.0;
    }
    return getState();
  }

  function update(dt) {
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0.016;
    const alpha = 1.0 - Math.exp(-3.4 * safeDt);
    const keys = [
      'officeIllumination',
      'occupancyRatio',
      'skybridgeIllumination',
      'lobbyGlow',
      'pergolaGlow',
      'daylightReflection',
      'glassReflectivity',
      'glassRoughness',
      'glassMetalness',
      'solarSpecularStrength'
    ];
    for (const k of keys) {
      current[k] += (target[k] - current[k]) * alpha;
    }
    if (switchWave < 1.0) {
      switchWave = Math.min(1.0, switchWave + safeDt * 0.95);
    }
    applyCurrentUniforms();
  }

  function getState() {
    return {
      activeTimeId,
      activeMode,
      labelKo: target.labelKo,
      switchWave,
      current: { ...current },
      target: { ...target }
    };
  }

  const materials = {
    sejongSilverCurtainMat: createSejongFacadeMaterial(uniforms, {
      glassTint: 0x20425f,
      frameTint: 0xcad4de,
      seed: 77.4
    }),
    sejongBronzeCurtainMat: createSejongFacadeMaterial(uniforms, {
      glassTint: 0x232d37,
      frameTint: 0x524b43,
      seed: 58.2
    }),
    sejongSkybridgeMat: createSejongSkybridgeMaterial(uniforms),
    sejongLobbyGlowMat: createSejongAccentGlowMaterial(uniforms, 'lobby'),
    sejongPergolaGlowMat: createSejongAccentGlowMaterial(uniforms, 'pergola')
  };

  return {
    uniforms,
    materials,
    setTimeOfDay,
    update,
    getState
  };
}

export {
  SEJONG_LIGHTING_MODES,
  getSejongLightingPreset,
  computeSejongLightingState,
  evaluateBuildingLightSchedule,
  createSejongLightingSystem
};
