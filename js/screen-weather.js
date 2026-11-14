import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  sin,
  cos,
  abs,
  fract,
  floor,
  min,
  max,
  clamp,
  mix,
  smoothstep,
  pow,
  exp,
  length,
  dot,
  screenUV,
  time,
  getViewPosition,
  isBackgroundDepth
} from 'three/tsl';

// =========================================================================
// 1. PURE LOGICAL HELPERS (Decoupled for Node.js unit testing)
// =========================================================================

const SCREEN_WEATHER_PRESETS = {
  clear: {
    id: 'clear',
    fogShift: 0.0,
    fogDensity: 0.0,
    fogHeight: 600.0,
    contrastShift: 0.0,
    saturationShift: 0.0,
    rippleIntensity: 0.0,
    rippleDensity: 0.0,
    lensIntensity: 0.0
  },
  fog: {
    id: 'fog',
    fogShift: 0.78,
    fogDensity: 0.0038,
    fogHeight: 150.0,
    contrastShift: -0.12,
    saturationShift: -0.16,
    rippleIntensity: 0.0,
    rippleDensity: 0.0,
    lensIntensity: 0.0
  },
  rain: {
    id: 'rain',
    fogShift: 0.28,
    fogDensity: 0.0014,
    fogHeight: 340.0,
    contrastShift: -0.04,
    saturationShift: -0.06,
    rippleIntensity: 0.62,
    rippleDensity: 0.55,
    lensIntensity: 0.65
  },
  downpour: {
    id: 'downpour',
    fogShift: 0.56,
    fogDensity: 0.0028,
    fogHeight: 220.0,
    contrastShift: -0.09,
    saturationShift: -0.12,
    rippleIntensity: 1.0,
    rippleDensity: 1.0,
    lensIntensity: 1.0
  }
};

function getScreenWeatherTargets(weatherId) {
  return SCREEN_WEATHER_PRESETS[weatherId] || SCREEN_WEATHER_PRESETS.clear;
}

/**
 * Frame-rate-independent exponential smoothing for weather transitions.
 */
function stepWeatherValue(current, target, dt, rate = 2.6) {
  const safeDt = Math.max(0, Math.min(dt || 0, 0.25));
  const alpha = 1.0 - Math.exp(-rate * safeDt);
  const next = current + (target - current) * alpha;
  return Math.abs(target - next) < 0.0005 ? target : next;
}

/**
 * Pure depth- and altitude-attenuated screen-space fog density shift calculation.
 */
function calculateScreenFogFactor(linearDist, worldY, fogDensity, fogShift, fogHeight = 200.0) {
  if (fogShift <= 0 || fogDensity <= 0) return 0.0;
  const dist = Math.max(0, Math.min(linearDist, 900.0));
  const h = Math.max(40.0, fogHeight);
  const heightAtten = Math.exp(-Math.max(0, worldY) / h);
  const depthTerm = 1.0 - Math.exp(-dist * fogDensity);
  const mistFactor = 0.45 + 0.55 * heightAtten;
  return Math.max(0.0, Math.min(0.75, depthTerm * fogShift * mistFactor));
}

/**
 * Pure concentric raindrop ripple evaluation for surface splash waves.
 */
function calculateSurfaceRippleWave(cellDist, phase, seed, rippleDensity = 1.0) {
  const activeThreshold = 1.0 - Math.max(0.0, Math.min(1.0, rippleDensity)) * 0.85;
  if (seed < activeThreshold) return 0.0;
  const maxRadius = 0.42;
  const radius = phase * maxRadius;
  const ringDist = Math.abs(cellDist - radius);
  const ringWidth = 0.075;
  if (ringDist >= ringWidth) return 0.0;
  const wave = Math.cos(((cellDist - radius) / ringWidth) * Math.PI * 0.5);
  const fade = (1.0 - phase) * (1.0 - phase);
  return Math.max(0.0, wave * fade);
}

/**
 * Deterministic 1D pseudo-random hash in [0, 1).
 */
function hash1D(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Pure multi-pulse periodic lightning flash envelope for downpour storm states.
 * Produces an initial strike shortly after entering downpour (~0.75s) followed by
 * irregular periodic double/triple-flicker strikes every ~4–8.5 seconds.
 */
function calculateLightningFlash(stormTime, intensity = 1.0) {
  const clampedIntensity = Math.max(0.0, Math.min(1.0, intensity || 0.0));
  if (clampedIntensity <= 0.001 || stormTime < 0) {
    return { flash: 0.0, skyGlow: 0.0, boltX: 0.5, cycleIndex: 0, isStrike: false };
  }

  const slotDuration = 6.0;
  const cycleIndex = Math.floor(stormTime / slotDuration);
  const strikeOffset = cycleIndex === 0 ? 0.75 : 0.8 + hash1D(cycleIndex + 1.37) * 3.6;
  const strikeStart = cycleIndex * slotDuration + strikeOffset;
  const localT = stormTime - strikeStart;
  const boltX = 0.16 + hash1D(cycleIndex * 17.3 + 3.1) * 0.68;

  if (localT < 0.0 || localT > 0.78) {
    return { flash: 0.0, skyGlow: 0.0, boltX, cycleIndex, isStrike: false };
  }

  // Primary cloud-to-ground bolt pulse
  const attack1 = Math.min(1.0, localT / 0.018);
  const pulse1 = attack1 * Math.exp(-localT * 16.5);

  // Secondary restrike flicker
  const t2 = localT - 0.16;
  const pulse2 = t2 > 0.0 ? 0.82 * Math.min(1.0, t2 / 0.015) * Math.exp(-t2 * 13.5) : 0.0;

  // Tertiary residual discharge shimmer
  const t3 = localT - 0.39;
  const pulse3 = t3 > 0.0 ? 0.38 * Math.min(1.0, t3 / 0.02) * Math.exp(-t3 * 11.5) : 0.0;

  const rawFlash = Math.min(1.0, pulse1 + pulse2 + pulse3);
  const flash = rawFlash * clampedIntensity;
  const skyGlow = Math.min(1.0, (pulse1 * 1.15 + pulse2 * 0.95 + pulse3 * 0.55) * clampedIntensity);

  return {
    flash,
    skyGlow,
    boltX,
    cycleIndex,
    isStrike: flash > 0.02
  };
}

// =========================================================================
// 2. TSL SCREEN-SPACE SURFACE RIPPLES & FOG DENSITY SHIFT SHADER
// =========================================================================

/**
 * Builds the TSL screen-space weather pass evaluating:
 * - Concentric raindrop ripples on wet upward-facing world surfaces
 * - Subtle screen-space depth fog density shifts and drifting mist
 *
 * Returns a TSL Fn evaluating to vec4(rippleGlint, rippleNormalShift, fogAmount, surfaceMask).
 */
function createScreenWeatherEffect({
  sceneDepth,
  sceneNormal,
  sceneMetalRough,
  uCameraProjInverse,
  uCameraWorldMatrix,
  uSurfaceRippleIntensity,
  uScreenFogShift,
  uScreenFogDensity,
  uScreenFogHeight
}) {
  const hash22 = Fn(([p]) => {
    const p1 = fract(p.mul(vec2(127.1, 311.7)));
    const p2 = p1.add(dot(p1, p1.add(34.5)));
    return fract(vec2(p2.x.mul(p2.y), p2.x.add(p2.y)));
  });

  // Evaluate a single tiled layer of expanding surface raindrop ripples in world XZ
  const evalRippleLayer = Fn(([worldXZ, scale, speed]) => {
    const st = worldXZ.mul(scale);
    const id = floor(st);
    const f = fract(st).sub(0.5);

    const h = hash22(id);
    const phase = fract(time.mul(speed).add(h.x.mul(6.2831)));
    const cycleId = floor(time.mul(speed).add(h.x.mul(6.2831)));
    const hCycle = hash22(id.add(vec2(cycleId.mul(13.7), cycleId.mul(7.3))));

    const dropCenter = hCycle.sub(0.5).mul(0.55);
    const d = f.sub(dropCenter);
    const dist = length(d);

    const radius = phase.mul(0.42);
    const ringDist = abs(dist.sub(radius));
    const ringEnvelope = smoothstep(0.0, 0.085, ringDist).oneMinus();
    // Double ring harmonic for realistic water meniscus wave
    const doubleRing = smoothstep(0.0, 0.045, abs(dist.sub(radius.mul(0.62)))).oneMinus().mul(0.5);

    const fade = pow(float(1.0).sub(phase), 1.7);
    const activeMask = smoothstep(0.15, 0.45, hCycle.y);

    const wave = ringEnvelope.add(doubleRing).mul(fade).mul(activeMask);
    const radialDir = d.x.div(max(dist, 0.001));
    return vec2(wave, radialDir.mul(wave));
  });

  return Fn(() => {
    const depth = sceneDepth.r;
    const isSky = isBackgroundDepth(depth);
    const bgMask = isSky.select(float(0.0), float(1.0));

    // Reconstruct view-space and world-space coordinates from depth buffer
    const viewPos = getViewPosition(screenUV, depth, uCameraProjInverse).toVar();
    const worldPos = uCameraWorldMatrix.mul(vec4(viewPos, 1.0)).xyz.toVar();
    const viewDist = isSky.select(float(680.0), clamp(length(viewPos), 0.0, 900.0)).toVar();

    // ---------------------------------------------------------------------
    // A. Surface Rain Ripples (wet roads, sidewalks, rooftops)
    // ---------------------------------------------------------------------
    const rawNorm = sceneNormal.rgb;
    const normLen = length(rawNorm);
    const validNorm = smoothstep(0.1, 0.5, normLen);
    const viewN = rawNorm.div(max(normLen, 0.001));
    const worldNorm = uCameraWorldMatrix.mul(vec4(viewN, 0.0)).xyz;
    const upMask = smoothstep(0.62, 0.90, worldNorm.y).mul(validNorm);

    // Distance & grazing fade so distant tiles don't shimmer/alias
    const rippleDistFade = smoothstep(14.0, 72.0, viewDist).oneMinus().mul(smoothstep(0.35, 1.8, viewDist));
    const wetSurfaceMask = mix(float(0.42), float(1.0), smoothstep(0.16, 0.92, sceneMetalRough.g).oneMinus());
    const surfaceMask = upMask.mul(rippleDistFade).mul(bgMask).mul(wetSurfaceMask).mul(uSurfaceRippleIntensity);

    const layer1 = evalRippleLayer(worldPos.xz, float(0.85), float(1.55));
    const layer2 = evalRippleLayer(worldPos.xz.add(vec2(3.7, 8.1)), float(1.45), float(2.05));

    const rippleGlint = layer1.x.add(layer2.x.mul(0.75)).mul(surfaceMask);
    const rippleShift = layer1.y.add(layer2.y.mul(0.65)).mul(surfaceMask);

    // ---------------------------------------------------------------------
    // B. Subtle Screen-Space Fog Density Shift & Drifting Mist
    // ---------------------------------------------------------------------
    const worldY = isSky.select(float(120.0), max(worldPos.y, 0.0));
    const heightAtten = exp(worldY.div(max(uScreenFogHeight, 40.0)).negate());

    // Subtle animated atmospheric mist veil modulated across screen space
    const mistWave = sin(screenUV.x.mul(5.2).add(time.mul(0.18)))
      .mul(cos(screenUV.y.mul(3.8).sub(time.mul(0.11))))
      .mul(0.12)
      .add(0.92);

    const depthTerm = float(1.0).sub(exp(viewDist.mul(uScreenFogDensity).negate()));
    const skyMistBoost = isSky.select(float(0.38), mix(float(0.45), float(1.0), heightAtten));
    const fogAmount = clamp(depthTerm.mul(uScreenFogShift).mul(skyMistBoost).mul(mistWave), 0.0, 0.72);

    return vec4(rippleGlint, rippleShift, fogAmount, surfaceMask);
  });
}

// =========================================================================
// 3. TSL DOWNPOUR LIGHTNING FLASH & DYNAMIC SCREEN BRIGHTNESS SPIKE
// =========================================================================

/**
 * Evaluates screen-space sheet-lightning sky discharge, atmospheric haze scatter,
 * and dynamic screen brightness spikes during downpour storms.
 *
 * Returns a TSL Fn evaluating to vec4(skyDischarge, brightnessSpike, hazeScatter, boltMask).
 */
function createLightningWeatherEffect({
  sceneDepth,
  uLightningFlash,
  uLightningIntensity,
  uLightningOrigin
}) {
  return Fn(() => {
    const isSky = isBackgroundDepth(sceneDepth.r);
    const skyMask = isSky.select(float(1.0), float(0.0));

    // Rapid GPU sub-frame plasma flicker synchronized with the storm strike envelope
    const plasmaFlicker = float(0.86)
      .add(sin(time.mul(94.0)).mul(0.09))
      .add(cos(time.mul(157.0)).mul(0.05));
    const activeFlash = clamp(uLightningFlash.mul(uLightningIntensity).mul(plasmaFlicker), 0.0, 1.35);

    // Sheet-lightning origin in upper sky + forked atmospheric filament glow
    const skyDelta = screenUV.sub(uLightningOrigin);
    const radialDist = length(skyDelta.mul(vec2(1.1, 1.85)));
    const sheetGlow = exp(radialDist.mul(-3.2));

    // Jagged lightning filament accent across upper sky canopy
    const zig = sin(screenUV.y.mul(34.0).add(time.mul(22.0)))
      .mul(0.018)
      .add(sin(screenUV.y.mul(78.0)).mul(0.008));
    const boltDist = abs(screenUV.x.sub(uLightningOrigin.x).add(zig));
    const verticalSpan = smoothstep(0.08, 0.44, screenUV.y).oneMinus();
    const boltCore = smoothstep(0.001, 0.014, boltDist).oneMinus().mul(verticalSpan);
    const boltHalo = exp(boltDist.mul(-28.0)).mul(verticalSpan).mul(0.55);

    // Sky pixels receive intense sheet discharge + bolt halo; upper screen gets subtle bloom spillover
    const upperCanopy = smoothstep(0.05, 0.75, screenUV.y).oneMinus();
    const skyDischarge = activeFlash
      .mul(skyMask.mul(sheetGlow.mul(1.25).add(boltCore.mul(2.4)).add(boltHalo)).add(upperCanopy.mul(0.18)));

    // Dynamic screen brightness spike across the entire viewport (stronger toward horizon/sky)
    const brightnessSpike = activeFlash.mul(mix(float(0.85), float(1.35), upperCanopy));

    // Atmospheric fog/haze scatter illumination during discharge
    const hazeScatter = activeFlash.mul(mix(float(0.45), float(1.0), sheetGlow));

    return vec4(skyDischarge, brightnessSpike, hazeScatter, boltCore.mul(activeFlash).mul(skyMask));
  });
}

export {
  SCREEN_WEATHER_PRESETS,
  getScreenWeatherTargets,
  stepWeatherValue,
  calculateScreenFogFactor,
  calculateSurfaceRippleWave,
  hash1D,
  calculateLightningFlash,
  createScreenWeatherEffect,
  createLightningWeatherEffect
};
