import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  color,
  uniform,
  attribute,
  positionWorld,
  cameraPosition,
  uv,
  time,
  sin,
  cos,
  abs,
  fract,
  mod,
  min,
  max,
  clamp,
  mix,
  smoothstep,
  pow,
  length,
  mrt
} from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';
import { TIME_PRESETS } from './lighting.js';
import { getScreenWeatherTargets, stepWeatherValue } from './screen-weather.js';

// =========================================================================
// 1. WEATHER PRESETS & CONFIGURATION
// =========================================================================
const WEATHER_PRESETS = {
  clear: {
    id: 'clear',
    nameKo: '맑음',
    descKo: '화창하고 맑은 서울 하늘',
    rainIntensity: 0.0,
    rainDropCount: 0,
    splashCount: 0,
    lensRainIntensity: 0.0,
    fogMult: 1.0,
    fogHeight: 900.0,
    wetnessTarget: 0.12,
    cloudCoverage: 0.0,
    cloudDensity: 0.0,
    turbidityMult: 1.0,
    lightAtten: 1.0,
    fallSpeed: 42.0,
    windX: 0.0,
    windZ: 0.0,
    icon: '#i-sun'
  },
  fog: {
    id: 'fog',
    nameKo: '안개',
    descKo: '한강에서 밀려오는 짙은 도심 해무',
    rainIntensity: 0.0,
    rainDropCount: 0,
    splashCount: 0,
    lensRainIntensity: 0.0,
    fogMult: 4.5,
    fogHeight: 160.0,
    wetnessTarget: 0.42,
    cloudCoverage: 0.45,
    cloudDensity: 0.48,
    turbidityMult: 1.45,
    lightAtten: 0.82,
    fallSpeed: 35.0,
    windX: 0.08,
    windZ: 0.05,
    icon: '#i-cloud-fog'
  },
  rain: {
    id: 'rain',
    nameKo: '비 (Light Rain)',
    descKo: '테헤란로에 촉촉하게 내리는 가벼운 비',
    rainIntensity: 0.45,
    rainDropCount: 16000,
    splashCount: 1200,
    lensRainIntensity: 0.65,
    fogMult: 1.85,
    fogHeight: 480.0,
    wetnessTarget: 0.78,
    cloudCoverage: 0.55,
    cloudDensity: 0.52,
    turbidityMult: 1.25,
    lightAtten: 0.75,
    fallSpeed: 46.0,
    windX: 0.16,
    windZ: 0.10,
    icon: '#i-cloud-rain'
  },
  downpour: {
    id: 'downpour',
    nameKo: '폭우 (Heavy Downpour)',
    descKo: '빌딩 숲을 적시는 강한 장대비와 돌풍',
    rainIntensity: 1.0,
    rainDropCount: 36000,
    splashCount: 2800,
    lensRainIntensity: 1.0,
    fogMult: 3.2,
    fogHeight: 260.0,
    wetnessTarget: 1.0,
    cloudCoverage: 0.68,
    cloudDensity: 0.65,
    turbidityMult: 1.6,
    lightAtten: 0.58,
    fallSpeed: 56.0,
    windX: 0.38,
    windZ: 0.22,
    icon: '#i-cloud-downpour'
  }
};

function getWeatherPreset(weatherId) {
  return WEATHER_PRESETS[weatherId] || WEATHER_PRESETS.clear;
}

function calculateAtmosphericFogParams(weatherId, timePreset) {
  const w = getWeatherPreset(weatherId);
  const baseDensity = timePreset?.fogDensity ?? 0.00024;
  const baseColor = timePreset?.fogColor ?? 0xdcc5ae;
  const baseWetness = timePreset?.roadWetness ?? 0.28;

  const density = baseDensity * w.fogMult;
  const height = w.fogHeight;
  const roadWetness = Math.max(baseWetness, w.wetnessTarget);

  // Fog color tinting based on weather condition
  let fogColor = baseColor;
  if (w.id === 'fog') {
    // Soft desaturated mist blending with time of day
    const r = ((baseColor >> 16) & 0xff) * 0.7 + 0x9a * 0.3;
    const g = ((baseColor >> 8) & 0xff) * 0.7 + 0xa8 * 0.3;
    const b = (baseColor & 0xff) * 0.7 + 0xb8 * 0.3;
    fogColor = ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
  } else if (w.id === 'rain') {
    const r = ((baseColor >> 16) & 0xff) * 0.75 + 0x6a * 0.25;
    const g = ((baseColor >> 8) & 0xff) * 0.75 + 0x75 * 0.25;
    const b = (baseColor & 0xff) * 0.75 + 0x82 * 0.25;
    fogColor = ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
  } else if (w.id === 'downpour') {
    const r = ((baseColor >> 16) & 0xff) * 0.55 + 0x3a * 0.45;
    const g = ((baseColor >> 8) & 0xff) * 0.55 + 0x42 * 0.45;
    const b = (baseColor & 0xff) * 0.55 + 0x4e * 0.45;
    fogColor = ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
  }

  return { density, height, fogColor, roadWetness };
}

function calculateRoadWetness(weatherId, baseWetness = 0.1) {
  const w = getWeatherPreset(weatherId);
  return Math.max(baseWetness, w.wetnessTarget);
}

function calculateCloudParameters(weatherId, baseCoverage = 0.3, baseDensity = 0.3) {
  const w = getWeatherPreset(weatherId);
  return {
    coverage: Math.min(1.0, baseCoverage + w.cloudCoverage),
    density: Math.min(1.0, baseDensity + w.cloudDensity)
  };
}

// MRT node preserving G-buffer on transparent particle passes
const _transparentEffectMRT = mrt({
  normal: vec4(0.0, 0.0, 0.0, 0.0),
  metalRough: vec4(0.0, 0.0, 0.0, 0.0)
});

// =========================================================================
// 2. WEATHER SYSTEM CLASS WITH TSL PARTICLE SHADERS
// =========================================================================
const MAX_RAIN_PARTICLES = 36000;
const MAX_SPLASH_PARTICLES = 2800;

class WeatherSystem {
  constructor(scene, lightingSystem) {
    this.scene = scene;
    this.lightingSystem = lightingSystem;
    this.activeWeatherId = 'clear';
    this.targetWeatherId = 'clear';
    this.transitionTime = 0;
    this.currentRainIntensity = 0.0;
    this.currentFogMult = 1.0;
    this.currentWetness = 0.12;

    this.group = new THREE.Group();
    this.group.name = 'DynamicWeatherSystem';
    this.scene.add(this.group);

    // Uniforms driving the TSL weather shaders
    this.uCamPos = uniform(vec3(0, 0, 0));
    this.uRainParams = uniform(vec4(0, 46.0, 0.1, 0.05)); // x: intensity, y: fallSpeed, z: windX, w: windZ
    this.uBoxSize = uniform(vec3(85.0, 46.0, 85.0));
    this.uLensRainIntensity = uniform(float(0.0));
    this.targetLensRainIntensity = 0.0;
    this.currentLensRainIntensity = 0.0;

    // Screen-space post-processing weather uniforms (smoothly transitioned in update)
    this.uScreenFogShift = uniform(float(0.0));
    this.uScreenFogDensity = uniform(float(0.0));
    this.uScreenFogHeight = uniform(float(600.0));
    this.uSurfaceRippleIntensity = uniform(float(0.0));
    this.uWeatherContrastShift = uniform(float(0.0));
    this.uWeatherSaturationShift = uniform(float(0.0));
    this.uWeatherFogColor = uniform(new THREE.Color(0xdcc5ae));

    this.targetRainIntensity = 0.0;
    this.targetScreenFogShift = 0.0;
    this.targetScreenFogDensity = 0.0;
    this.targetScreenFogHeight = 600.0;
    this.targetSurfaceRippleIntensity = 0.0;
    this.targetContrastShift = 0.0;
    this.targetSaturationShift = 0.0;
    this.targetWeatherFogColor = new THREE.Color(0xdcc5ae);
    this.targetFogDensity = 0.00024;
    this.targetFogHeight = 900.0;
    this.targetWetness = 0.12;
    this.targetRainDropCount = 0;
    this.targetSplashCount = 0;

    this.initRainParticles();
    this.initSplashParticles();
    this.applyWeather('clear', this.lightingSystem.activePresetId || 'golden', true);
  }

  initRainParticles() {
    // Rain streaks: vertical camera-facing billboards instanced in a wrapped 3D volume
    const rainGeo = new THREE.PlaneGeometry(1, 1);
    const rainMat = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.NormalBlending
    });
    rainMat.mrtNode = _transparentEffectMRT;

    const aOffset = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RAIN_PARTICLES * 3), 3);
    const aSpeedPhase = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RAIN_PARTICLES * 4), 4);

    for (let i = 0; i < MAX_RAIN_PARTICLES; i++) {
      // Uniform random dispersion in local box [-0.5, 0.5]
      aOffset.setXYZ(i, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      // x: fall speed multiplier, y: phase offset, z: length scale, w: seed
      aSpeedPhase.setXYZW(
        i,
        0.82 + Math.random() * 0.36,
        Math.random(),
        0.75 + Math.random() * 0.65,
        Math.random()
      );
    }

    rainGeo.setAttribute('aOffset', aOffset);
    rainGeo.setAttribute('aSpeedPhase', aSpeedPhase);

    const aOff = attribute('aOffset', 'vec3');
    const aSpd = attribute('aSpeedPhase', 'vec4');

    // TSL wrapped particle world position
    rainMat.positionNode = Fn(() => {
      const box = this.uBoxSize;
      const halfBox = box.mul(0.5);
      const fall = time.mul(this.uRainParams.y).mul(aSpd.x);

      // Modular wrap around moving camera in all 3 dimensions
      const relY = mod(aOff.y.mul(box.y).sub(fall).sub(this.uCamPos.y).add(halfBox.y), box.y).sub(halfBox.y);
      const relX = mod(aOff.x.mul(box.x).sub(this.uCamPos.x).add(halfBox.x), box.x).sub(halfBox.x);
      const relZ = mod(aOff.z.mul(box.z).sub(this.uCamPos.z).add(halfBox.z), box.z).sub(halfBox.z);

      // Wind slant across vertical drop
      const windX = this.uRainParams.z.mul(relY.mul(0.12));
      const windZ = this.uRainParams.w.mul(relY.mul(0.12));

      return this.uCamPos.add(vec3(relX.add(windX), relY, relZ.add(windZ)));
    })();

    // Streak billboard size
    rainMat.scaleNode = Fn(() => {
      const w = float(0.042);
      const h = float(1.85).mul(aSpd.z);
      return vec2(w, h);
    })();

    // Wind tilt angle
    rainMat.rotationNode = Fn(() => {
      return this.uRainParams.z.mul(0.24);
    })();

    // Dynamic color matching the time-of-day sky & urban lights
    rainMat.colorNode = Fn(() => {
      const sunTint = cityUniforms.uSunColor.mul(0.32);
      const skyTint = cityUniforms.uSkyHorizonColor.mul(0.38);
      const nightGlint = smoothstep(0.4, 1.25, cityUniforms.uInteriorGlow).mul(1.45);
      const baseCol = mix(color(0xaec8df), skyTint, 0.35).add(sunTint);
      return baseCol.add(color(0xffffff).mul(nightGlint));
    })();

    // Streak transparency with soft trailing tail
    rainMat.opacityNode = Fn(() => {
      const vUv = uv();
      const dx = abs(vUv.x.sub(0.5)).mul(2.0);
      const lateralFade = smoothstep(1.0, 0.0, dx);
      // Falling down: bottom head is sharp, top tail trails off
      const tailFade = pow(vUv.y, 2.2);
      return lateralFade.mul(tailFade).mul(this.uRainParams.x).mul(0.52);
    })();

    this.rainMesh = new THREE.InstancedMesh(rainGeo, rainMat, MAX_RAIN_PARTICLES);
    this.rainMesh.count = 0;
    this.rainMesh.frustumCulled = false;
    this.group.add(this.rainMesh);
  }

  initSplashParticles() {
    // Ground splash rings: horizontal quads flat on the pavement around the player
    const splashGeo = new THREE.PlaneGeometry(0.55, 0.55);
    splashGeo.rotateX(-Math.PI * 0.5); // Align flat on XZ ground plane

    const splashMat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      blending: THREE.NormalBlending
    });
    splashMat.mrtNode = _transparentEffectMRT;

    const aSplashOffset = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPLASH_PARTICLES * 3), 3);
    const aSplashParams = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPLASH_PARTICLES * 4), 4);

    for (let i = 0; i < MAX_SPLASH_PARTICLES; i++) {
      // Random circular distribution around player, radius up to 34m
      const r = Math.sqrt(Math.random()) * 34.0;
      const theta = Math.random() * Math.PI * 2;
      aSplashOffset.setXYZ(i, Math.cos(theta) * r, 0.05, Math.sin(theta) * r);
      // x: time phase, y: animation speed, z: max radius scale, w: seed
      aSplashParams.setXYZW(i, Math.random(), 2.8 + Math.random() * 2.2, 0.8 + Math.random() * 0.5, Math.random());
    }

    splashGeo.setAttribute('aSplashOffset', aSplashOffset);
    splashGeo.setAttribute('aSplashParams', aSplashParams);

    const aSOff = attribute('aSplashOffset', 'vec3');
    const aSParam = attribute('aSplashParams', 'vec4');

    splashMat.positionNode = Fn(() => {
      const radius = 34.0;
      const relX = mod(aSOff.x.sub(this.uCamPos.x).add(radius), radius * 2.0).sub(radius);
      const relZ = mod(aSOff.z.sub(this.uCamPos.z).add(radius), radius * 2.0).sub(radius);
      // Pavement height (ground level)
      return vec3(this.uCamPos.x.add(relX), float(0.06), this.uCamPos.z.add(relZ));
    })();

    // Animated expanding ripple ring
    splashMat.colorNode = Fn(() => {
      const skyTint = cityUniforms.uSkyHorizonColor.mul(0.35);
      const nightGlint = smoothstep(0.4, 1.25, cityUniforms.uInteriorGlow).mul(1.2);
      return mix(color(0xb8d4ea), skyTint, 0.3).add(color(0xffffff).mul(nightGlint));
    })();

    splashMat.opacityNode = Fn(() => {
      const cycle = fract(aSParam.x.add(time.mul(aSParam.y).mul(0.25)));
      const dist = uv().sub(0.5).length().mul(2.0);
      const ring = smoothstep(cycle.mul(0.6), cycle, dist).mul(smoothstep(cycle.add(0.2), cycle, dist));
      const fade = float(1.0).sub(cycle);
      return ring.mul(fade).mul(this.uRainParams.x).mul(0.42);
    })();

    this.splashMesh = new THREE.InstancedMesh(splashGeo, splashMat, MAX_SPLASH_PARTICLES);
    this.splashMesh.count = 0;
    this.splashMesh.frustumCulled = false;
    this.group.add(this.splashMesh);
  }

  setWeather(weatherId) {
    if (!WEATHER_PRESETS[weatherId]) return;
    this.targetWeatherId = weatherId;
    this.applyWeather(weatherId, this.lightingSystem?.activePresetId || 'golden');
  }

  getWeather() {
    return this.activeWeatherId;
  }

  applyWeather(weatherId, timeId, immediate = false) {
    const w = getWeatherPreset(weatherId);
    this.activeWeatherId = w.id;

    const timePreset = TIME_PRESETS[timeId] || TIME_PRESETS.golden;
    const fogParams = calculateAtmosphericFogParams(weatherId, timePreset);
    const clouds = calculateCloudParameters(weatherId, timePreset.cloudCoverage, timePreset.cloudDensity);
    const screenTargets = getScreenWeatherTargets(weatherId);

    // Rain particle physics & target intensity
    this.targetRainIntensity = w.rainIntensity;
    this.targetRainDropCount = w.rainDropCount;
    this.targetSplashCount = w.splashCount;
    this.uRainParams.value.y = w.fallSpeed;
    this.uRainParams.value.z = w.windX;
    this.uRainParams.value.w = w.windZ;

    if (w.rainDropCount > 0) {
      this.rainMesh.count = w.rainDropCount;
      this.rainMesh.visible = true;
      this.rainMesh.instanceMatrix.needsUpdate = true;
    } else if (immediate || this.currentRainIntensity <= 0.005) {
      this.rainMesh.count = 0;
      this.rainMesh.visible = false;
    }

    if (w.splashCount > 0) {
      this.splashMesh.count = w.splashCount;
      this.splashMesh.visible = true;
      this.splashMesh.instanceMatrix.needsUpdate = true;
    } else if (immediate || this.currentRainIntensity <= 0.005) {
      this.splashMesh.count = 0;
      this.splashMesh.visible = false;
    }

    // LightingSystem sky clouds & directional light attenuation
    if (this.lightingSystem) {
      if (this.lightingSystem.sky) {
        this.lightingSystem.sky.cloudCoverage.value = clouds.coverage;
        this.lightingSystem.sky.cloudDensity.value = clouds.density;
        this.lightingSystem.sky.turbidity.value = timePreset.turbidity * w.turbidityMult;
      }

      if (this.lightingSystem.sunLight) {
        this.lightingSystem.sunLight.intensity = timePreset.sunIntensity * w.lightAtten;
      }
      if (this.lightingSystem.hemiLight) {
        this.lightingSystem.hemiLight.intensity = timePreset.hemiIntensity * Math.max(0.6, w.lightAtten);
      }
    }

    // Set transition targets for atmospheric & screen-space shaders
    this.targetFogDensity = fogParams.density;
    this.targetFogHeight = fogParams.height;
    this.targetWetness = fogParams.roadWetness;
    this.targetWeatherFogColor.setHex(fogParams.fogColor);

    this.targetLensRainIntensity = w.lensRainIntensity !== undefined
      ? w.lensRainIntensity
      : screenTargets.lensIntensity;
    this.targetScreenFogShift = screenTargets.fogShift;
    this.targetScreenFogDensity = screenTargets.fogDensity;
    this.targetScreenFogHeight = screenTargets.fogHeight;
    this.targetSurfaceRippleIntensity = screenTargets.rippleIntensity;
    this.targetContrastShift = screenTargets.contrastShift;
    this.targetSaturationShift = screenTargets.saturationShift;

    if (immediate) {
      this.currentRainIntensity = this.targetRainIntensity;
      this.uRainParams.value.x = this.currentRainIntensity;
      this.currentLensRainIntensity = this.targetLensRainIntensity;
      this.uLensRainIntensity.value = this.currentLensRainIntensity;
      this.currentWetness = this.targetWetness;
      cityUniforms.uRoadWetness.value = this.currentWetness;
      this.uScreenFogShift.value = this.targetScreenFogShift;
      this.uScreenFogDensity.value = this.targetScreenFogDensity;
      this.uScreenFogHeight.value = this.targetScreenFogHeight;
      this.uSurfaceRippleIntensity.value = this.targetSurfaceRippleIntensity;
      this.uWeatherContrastShift.value = this.targetContrastShift;
      this.uWeatherSaturationShift.value = this.targetSaturationShift;
      this.uWeatherFogColor.value.copy(this.targetWeatherFogColor);

      if (this.lightingSystem) {
        if (this.lightingSystem.uFogDensity) this.lightingSystem.uFogDensity.value = this.targetFogDensity;
        if (this.lightingSystem.uFogHeight) this.lightingSystem.uFogHeight.value = this.targetFogHeight;
        if (this.lightingSystem.scene?.fog) {
          this.lightingSystem.scene.fog.density = this.targetFogDensity;
          this.lightingSystem.scene.fog.color.copy(this.targetWeatherFogColor);
        }
      }
    }
  }

  update(dt, elapsed, camera, focusPos, activePresetId) {
    if (camera) {
      this.uCamPos.value.copy(camera.position);
    }
    const stepDt = dt || 0.016;

    // Smoothly transition precipitation & screen-space weather uniforms
    this.currentRainIntensity = stepWeatherValue(this.currentRainIntensity, this.targetRainIntensity, stepDt, 2.8);
    this.uRainParams.value.x = this.currentRainIntensity;
    if (this.targetRainDropCount === 0 && this.currentRainIntensity <= 0.005) {
      this.rainMesh.count = 0;
      this.rainMesh.visible = false;
    }
    if (this.targetSplashCount === 0 && this.currentRainIntensity <= 0.005) {
      this.splashMesh.count = 0;
      this.splashMesh.visible = false;
    }

    this.currentLensRainIntensity = stepWeatherValue(this.currentLensRainIntensity, this.targetLensRainIntensity, stepDt, 2.4);
    this.uLensRainIntensity.value = this.currentLensRainIntensity;

    this.uScreenFogShift.value = stepWeatherValue(this.uScreenFogShift.value, this.targetScreenFogShift, stepDt, 2.2);
    this.uScreenFogDensity.value = stepWeatherValue(this.uScreenFogDensity.value, this.targetScreenFogDensity, stepDt, 2.2);
    this.uScreenFogHeight.value = stepWeatherValue(this.uScreenFogHeight.value, this.targetScreenFogHeight, stepDt, 2.2);
    this.uSurfaceRippleIntensity.value = stepWeatherValue(this.uSurfaceRippleIntensity.value, this.targetSurfaceRippleIntensity, stepDt, 2.2);
    this.uWeatherContrastShift.value = stepWeatherValue(this.uWeatherContrastShift.value, this.targetContrastShift, stepDt, 2.2);
    this.uWeatherSaturationShift.value = stepWeatherValue(this.uWeatherSaturationShift.value, this.targetSaturationShift, stepDt, 2.2);

    const colorAlpha = 1.0 - Math.exp(-3.0 * Math.min(stepDt, 0.25));
    this.uWeatherFogColor.value.lerp(this.targetWeatherFogColor, colorAlpha);

    // Smoothly transition road wetness & scene atmospheric fog
    this.currentWetness = stepWeatherValue(this.currentWetness, this.targetWetness, stepDt, 1.8);
    cityUniforms.uRoadWetness.value = this.currentWetness;

    if (this.lightingSystem) {
      if (this.lightingSystem.uFogDensity) {
        this.lightingSystem.uFogDensity.value = stepWeatherValue(this.lightingSystem.uFogDensity.value, this.targetFogDensity, stepDt, 2.2);
      }
      if (this.lightingSystem.uFogHeight) {
        this.lightingSystem.uFogHeight.value = stepWeatherValue(this.lightingSystem.uFogHeight.value, this.targetFogHeight, stepDt, 2.2);
      }
      if (this.lightingSystem.scene?.fog) {
        this.lightingSystem.scene.fog.density = stepWeatherValue(this.lightingSystem.scene.fog.density, this.targetFogDensity, stepDt, 2.2);
        this.lightingSystem.scene.fog.color.lerp(this.targetWeatherFogColor, colorAlpha);
      }
    }
  }
}

export {
  WEATHER_PRESETS,
  getWeatherPreset,
  calculateAtmosphericFogParams,
  calculateRoadWetness,
  calculateCloudParameters,
  WeatherSystem
};
