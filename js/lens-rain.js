import * as THREE from 'three/webgpu';
import {
  Fn,
  uniform,
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
  length,
  dot,
  sqrt,
  screenUV,
  screenSize,
  time,
  texture
} from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';

// =========================================================================
// 1. PURE LOGICAL HELPERS (Decoupled for unit testing in Node.js)
// =========================================================================

/**
 * Weather-driven lens rain parameters
 */
function calculateLensRainParams(weatherId) {
  switch (weatherId) {
    case 'downpour':
      return {
        intensity: 1.0,
        trickleSpeed: 1.35,
        dropDensity: 1.0,
        splashRate: 1.0,
        dropletScale: 1.0
      };
    case 'rain':
      return {
        intensity: 0.65,
        trickleSpeed: 0.75,
        dropDensity: 0.65,
        splashRate: 0.45,
        dropletScale: 0.85
      };
    case 'fog':
    case 'clear':
    default:
      return {
        intensity: 0.0,
        trickleSpeed: 0.0,
        dropDensity: 0.0,
        splashRate: 0.0,
        dropletScale: 0.0
      };
  }
}

/**
 * Deterministic 2D pseudo-random hash generator for cell indexing
 */
function hash2D(x, y) {
  let px = (x * 123.34 + y * 456.21) % 1.0;
  if (px < 0) px += 1.0;
  const dotVal = (px * (px + 45.32) + y * (y + 45.32)) % 1.0;
  const hx = (px * dotVal) % 1.0;
  const hy = (px + dotVal) % 1.0;
  return {
    x: hx < 0 ? hx + 1.0 : hx,
    y: hy < 0 ? hy + 1.0 : hy
  };
}

/**
 * Pure calculation of spherical droplet metrics (distance, normal, highlight, meniscus)
 */
function calculateDropletMetrics(localX, localY, centerX, centerY, radius) {
  const dx = localX - centerX;
  const dy = localY - centerY;
  const dist = Math.hypot(dx, dy);
  const inside = dist <= radius ? Math.max(0, Math.min(1, (radius - dist) / (radius * 0.15))) : 0;
  const normDist = Math.min(1.0, dist / Math.max(0.0001, radius));
  const nz = Math.sqrt(Math.max(0.001, 1.0 - normDist * normDist));
  const normalX = inside > 0 ? (dx / radius) * (1.0 - nz) : 0;
  const normalY = inside > 0 ? (dy / radius) * (1.0 - nz) : 0;

  // Specular gleam offset toward top-left
  const gx = dx - radius * 0.2;
  const gy = dy - radius * 0.2;
  const gDist = Math.hypot(gx, gy);
  const highlight = inside > 0 ? Math.max(0, Math.min(1, (radius * 0.22 - gDist) / (radius * 0.22))) : 0;

  // Dark meniscus border ring near outer circumference
  const meniscus = inside > 0 && dist >= radius * 0.72 ? Math.min(1, (dist - radius * 0.72) / (radius * 0.28)) : 0;

  return {
    dist,
    inside,
    normalX,
    normalY,
    highlight,
    meniscus
  };
}

/**
 * Pure calculation of splash impact ripple wave
 */
function calculateSplashWave(dist, phase, maxRadius = 0.22, waveWidth = 0.025) {
  const currentRadius = phase * maxRadius;
  const ringDist = Math.abs(dist - currentRadius);
  const waveIntensity = ringDist <= waveWidth ? (1.0 - ringDist / waveWidth) * (1.0 - phase) : 0;
  return {
    currentRadius,
    waveIntensity,
    fade: 1.0 - phase
  };
}

/**
 * Pure calculation of sliding trickle path
 */
function calculateTrickleTrail(localX, localY, timeY, columnWidth = 0.14) {
  const wiggle = Math.sin(timeY * 5.0) * 0.035;
  const centerDist = Math.abs(localX - wiggle);
  const insideTrail = centerDist <= columnWidth * 0.5;
  const trailNormalX = insideTrail ? (localX - wiggle) / (columnWidth * 0.5) : 0;
  return {
    wiggle,
    centerDist,
    insideTrail,
    trailNormalX
  };
}

// =========================================================================
// 2. TSL SCREEN-SPACE LENS RAIN & SPLASH OVERLAY SHADER
// =========================================================================

/**
 * Creates the TSL lens raindrop shader node.
 * Evaluates in screen space and returns normal deflection, droplet mask, specular highlight, and meniscus.
 */
function createLensRainOverlay(uLensRainIntensity) {
  // Screen aspect ratio for round spherical droplets
  const aspect = screenSize.x.div(screenSize.y);
  const uvs = screenUV.mul(vec2(aspect, float(1.0)));

  // 2D pseudo-random hash in TSL
  const hash22 = Fn(([p]) => {
    const p1 = fract(p.mul(vec2(123.34, 456.21)));
    const p2 = p1.add(dot(p1, p1.add(45.32)));
    return fract(vec2(p2.x.mul(p2.y), p2.x.add(p2.y)));
  });

  // Layer 1: Medium & large static beaded drops
  const calcStaticDrops = Fn(() => {
    const scale = float(14.0);
    const st = uvs.mul(scale);
    const id = floor(st);
    const f = fract(st).sub(0.5);

    const h = hash22(id);
    const hasDrop = smoothstep(0.42, 0.45, h.x);
    const center = h.sub(0.5).mul(0.58);
    const radius = mix(float(0.12), float(0.34), h.y);

    const d = f.sub(center);
    const dist = length(d);

    const inDrop = smoothstep(radius, radius.mul(0.85), dist);
    const normDist = clamp(dist.div(radius), 0.0, 1.0);
    const nz = sqrt(max(float(0.001), float(1.0).sub(normDist.mul(normDist))));
    const norm = d.div(radius).mul(float(1.0).sub(nz));

    // Specular gleam (top-left offset)
    const gleamOffset = d.sub(vec2(radius.mul(0.20), radius.mul(0.20)));
    const gleam = smoothstep(radius.mul(0.24), float(0.0), length(gleamOffset));

    // Meniscus dark absorption ring
    const meniscus = smoothstep(radius.mul(0.70), radius, dist).mul(inDrop);

    return vec4(
      norm.x.mul(hasDrop),
      norm.y.mul(hasDrop),
      inDrop.mul(hasDrop),
      gleam.mul(hasDrop).add(meniscus.mul(0.1))
    );
  });

  // Layer 2: Fine condensation micro-droplets
  const calcMicroDrops = Fn(() => {
    const scale = float(28.0);
    const st = uvs.mul(scale);
    const id = floor(st);
    const f = fract(st).sub(0.5);

    const h = hash22(id.add(vec2(17.41, 43.19)));
    const hasDrop = smoothstep(0.55, 0.58, h.x);
    const center = h.sub(0.5).mul(0.5);
    const radius = mix(float(0.09), float(0.22), h.y);

    const d = f.sub(center);
    const dist = length(d);

    const inDrop = smoothstep(radius, radius.mul(0.82), dist);
    const norm = d.div(radius).mul(0.65);
    const gleamOffset = d.sub(vec2(radius.mul(0.16), radius.mul(0.16)));
    const gleam = smoothstep(radius.mul(0.25), float(0.0), length(gleamOffset));

    return vec4(
      norm.x.mul(hasDrop),
      norm.y.mul(hasDrop),
      inDrop.mul(hasDrop),
      gleam.mul(hasDrop)
    );
  });

  // Layer 3: Sliding / Trickling rain streaks with gravity
  const calcTrickleStreaks = Fn(() => {
    const colScale = float(8.0);
    const colId = floor(uvs.x.mul(colScale));
    const colSeed = hash22(vec2(colId, float(9.12)));

    // Gravity trickle speed
    const fallSpeed = mix(float(0.55), float(1.25), colSeed.x);
    const yProg = uvs.y.mul(2.6).add(time.mul(fallSpeed));
    const yFract = fract(yProg);

    // Sinuous path wiggle
    const wiggle = sin(yProg.mul(5.2).add(colSeed.y.mul(11.0))).mul(0.032);
    const colFract = fract(uvs.x.mul(colScale)).sub(0.5).add(wiggle);

    // Sliding teardrop head
    const headDist = length(vec2(colFract, yFract.sub(0.5).mul(1.85)));
    const headRadius = mix(float(0.11), float(0.21), colSeed.y);
    const headInside = smoothstep(headRadius, headRadius.mul(0.78), headDist);
    const headNorm = vec2(colFract, yFract.sub(0.5).mul(1.85)).div(headRadius);

    // Trail micro-beads trailing behind sliding drop
    const trailProg = yProg.mul(4.0);
    const trailFract = fract(trailProg);
    const trailDist = length(vec2(colFract, trailFract.sub(0.5).mul(2.2)));
    const trailInside = smoothstep(0.07, 0.03, trailDist).mul(smoothstep(0.05, 0.45, yFract));

    const totalStreakMask = clamp(headInside.add(trailInside.mul(0.75)), 0.0, 1.0);
    const streakNorm = headNorm.mul(headInside);
    const streakGleam = smoothstep(headRadius.mul(0.22), float(0.0), headDist);

    return vec4(streakNorm.x, streakNorm.y, totalStreakMask, streakGleam);
  });

  // Layer 4: Splash impact bursts (direct hits on lens)
  const calcSplashImpacts = Fn(() => {
    const totalNormal = vec2(0.0, 0.0).toVar();
    const totalMask = float(0.0).toVar();
    const totalHighlight = float(0.0).toVar();

    // 3 staggered splash centers
    for (let i = 0; i < 3; i++) {
      const seed = hash22(vec2(float(i * 3.7 + 1.2), float(14.8 + i * 2.3)));
      const splashCenter = seed.mul(vec2(aspect, float(1.0)));
      const splashPhase = fract(time.mul(0.42).add(float(i * 0.33)));

      const d = uvs.sub(splashCenter);
      const dist = length(d);
      const maxRadius = float(0.22);
      const currentRadius = splashPhase.mul(maxRadius);
      const ringDist = abs(dist.sub(currentRadius));

      // Expanding circular ripple wave
      const ripple = smoothstep(0.024, 0.0, ringDist).mul(float(1.0).sub(splashPhase));
      const rippleNorm = d.div(max(dist, 0.001)).mul(ripple);

      // Impact center droplet burst
      const burstInside = smoothstep(0.06, 0.02, dist).mul(smoothstep(0.3, 0.0, splashPhase));

      totalNormal.addAssign(rippleNorm.mul(1.2));
      totalMask.addAssign(clamp(ripple.add(burstInside), 0.0, 1.0));
      totalHighlight.addAssign(ripple.mul(0.65).add(burstInside.mul(0.8)));
    }

    return vec4(totalNormal.x, totalNormal.y, clamp(totalMask, 0.0, 1.0), totalHighlight);
  });

  // Master composite function returning vec4: (normal.x, normal.y, mask, highlight)
  return Fn(() => {
    const staticDrops = calcStaticDrops();
    const microDrops = calcMicroDrops();
    const trickles = calcTrickleStreaks();
    const splashes = calcSplashImpacts();

    // Combine normals
    const norm = staticDrops.xy
      .add(microDrops.xy.mul(0.45))
      .add(trickles.xy.mul(1.25))
      .add(splashes.xy.mul(0.85))
      .mul(uLensRainIntensity);

    // Combine masks
    const mask = clamp(
      staticDrops.z
        .add(microDrops.z.mul(0.55))
        .add(trickles.z.mul(1.1))
        .add(splashes.z.mul(0.8))
        .mul(uLensRainIntensity),
      0.0,
      1.0
    );

    // Combine highlights
    const highlight = staticDrops.w
      .add(microDrops.w.mul(0.4))
      .add(trickles.w.mul(0.9))
      .add(splashes.w.mul(0.75))
      .mul(uLensRainIntensity);

    return vec4(norm.x, norm.y, mask, highlight);
  });
}

export {
  calculateLensRainParams,
  hash2D,
  calculateDropletMetrics,
  calculateSplashWave,
  calculateTrickleTrail,
  createLensRainOverlay
};
