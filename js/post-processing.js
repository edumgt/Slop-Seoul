import * as THREE from 'three/webgpu';
import {
  Fn,
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  dot,
  mix,
  min,
  max,
  clamp,
  pow,
  smoothstep,
  length,
  screenUV,
  screenSize,
  texture
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { createLensRainOverlay } from './lens-rain.js';
import { createScreenWeatherEffect, createLightningWeatherEffect } from './screen-weather.js';
import { cityUniforms } from './tsl-materials.js';

// Scene-linear color grading and lens bloom, composed in the existing final render pass.

// Exposure and white balance belong to the camera, independently of the physical lighting presets.
// Keep exposure restrained for ACES; stronger bloom stays selective so midtones retain their contrast.
const LOOKS = {
  golden:   { exposure: 1.04, contrast: 1.12, saturation: 1.08, balance: [1.045, 1.00, 0.955], bloom: 0.24, threshold: 1.20 },
  midday:   { exposure: 1.00, contrast: 1.10, saturation: 1.06, balance: [1.015, 1.00, 0.985], bloom: 0.18, threshold: 1.35 },
  twilight: { exposure: 1.06, contrast: 1.10, saturation: 1.08, balance: [1.025, 0.995, 1.015], bloom: 0.28, threshold: 1.05 },
  midnight: { exposure: 1.04, contrast: 1.08, saturation: 1.06, balance: [0.985, 1.00, 1.035], bloom: 0.30, threshold: 1.00 }
};

function createPostProcessing(renderer, sceneColor, reflections, options = {}) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Exposure is applied before bloom so its threshold follows the image's exposed brightness.
  // RenderPipeline performs ACES and the output color-space conversion exactly once, after this graph.
  renderer.toneMappingExposure = 1.0;

  const exposure = uniform(1.0);
  const contrast = uniform(1.0);
  const saturation = uniform(1.0);
  const balance = uniform(new THREE.Vector3(1, 1, 1));
  const exposed = max(sceneColor.rgb.add(reflections.rgb), vec3(0)).mul(exposure).mul(balance);

  // Camera matrices for screen-space depth & normal reconstruction
  const uCameraProjInverse = uniform(new THREE.Matrix4());
  const uCameraWorldMatrix = uniform(new THREE.Matrix4());

  function update(cam = options?.camera) {
    if (!cam) return;
    uCameraProjInverse.value.copy(cam.projectionMatrixInverse);
    uCameraWorldMatrix.value.copy(cam.matrixWorld);
  }
  update(options?.camera);

  // Dynamic screen-space weather uniforms (smoothly animated by WeatherSystem)
  const uLensRainIntensity = options?.uLensRainIntensity || uniform(float(0.0));
  const uScreenFogShift = options?.uScreenFogShift || uniform(float(0.0));
  const uScreenFogDensity = options?.uScreenFogDensity || uniform(float(0.0));
  const uScreenFogHeight = options?.uScreenFogHeight || uniform(float(600.0));
  const uSurfaceRippleIntensity = options?.uSurfaceRippleIntensity || uniform(float(0.0));
  const uWeatherContrastShift = options?.uWeatherContrastShift || uniform(float(0.0));
  const uWeatherSaturationShift = options?.uWeatherSaturationShift || uniform(float(0.0));
  const uWeatherFogColor = options?.uWeatherFogColor || uniform(new THREE.Color(0xdcc5ae));
  const uLightningFlash = options?.uLightningFlash || uniform(float(0.0));
  const uLightningIntensity = options?.uLightningIntensity || uniform(float(0.0));
  const uLightningOrigin = options?.uLightningOrigin || uniform(new THREE.Vector2(0.5, 0.16));

  const lensRainOverlay = createLensRainOverlay(uLensRainIntensity);

  const hasDepthInputs = Boolean(options?.sceneDepth && options?.sceneNormal && options?.sceneMetalRough);
  const screenWeatherEffect = hasDepthInputs
    ? createScreenWeatherEffect({
        sceneDepth: options.sceneDepth,
        sceneNormal: options.sceneNormal,
        sceneMetalRough: options.sceneMetalRough,
        uCameraProjInverse,
        uCameraWorldMatrix,
        uSurfaceRippleIntensity,
        uScreenFogShift,
        uScreenFogDensity,
        uScreenFogHeight
      })
    : null;

  const lightningWeatherEffect = options?.sceneDepth
    ? createLightningWeatherEffect({
        sceneDepth: options.sceneDepth,
        uLightningFlash,
        uLightningIntensity,
        uLightningOrigin
      })
    : null;

  // Limit only bloom's peak radiance, scaling RGB together to retain neon and lamp colors.
  // The original HDR image keeps its full range for the tone mapper's highlight shoulder.
  const peak = max(max(exposed.r, exposed.g), exposed.b);
  const bloomInput = vec4(exposed.mul(float(8.0).div(max(peak, 8.0))), 1.0);
  const bloomPass = bloom(bloomInput, 0.24, 0.40, 1.20);
  bloomPass.smoothWidth.value = 0.30;
  bloomPass.setResolutionScale(0.35);

  const outputNode = Fn(() => {
    const color = exposed.add(bloomPass.rgb).toVar();

    // 1. Screen-space surface rain ripples, subtle depth fog shift & lightning flash scatter
    const fogAmount = float(0.0).toVar();
    const lightningVec = lightningWeatherEffect ? lightningWeatherEffect() : vec4(0.0);
    const lightningSkyGlow = lightningVec.x;
    const lightningBrightness = lightningVec.y;
    const lightningHaze = lightningVec.z;
    const lightningBolt = lightningVec.w;
    const stormFogColor = uWeatherFogColor.add(vec3(0.45, 0.62, 0.92).mul(lightningHaze)).toVar();

    if (screenWeatherEffect) {
      const sw = screenWeatherEffect();
      const rippleGlint = sw.x;
      const rippleShift = sw.y;
      fogAmount.assign(sw.z);

      // Subtle refractive ripple distortion on wet pavement/rooftop reflections
      const rippleUvOffset = vec2(rippleShift.mul(0.0045), rippleShift.mul(0.0028));
      const rippleUV = clamp(screenUV.add(rippleUvOffset), vec2(0.001), vec2(0.999));
      const rippleSample = texture(sceneColor, rippleUV);
      const rippleRefracted = max(rippleSample.rgb.add(reflections.rgb), vec3(0))
        .mul(exposure)
        .mul(balance)
        .add(bloomPass.rgb);
      const rippleBlend = clamp(rippleGlint.mul(0.55), 0.0, 0.65);
      color.assign(mix(color, rippleRefracted, rippleBlend));

      // Specular ripple ring sheen reflecting sky, neon, & lightning bursts
      const rippleSpec = mix(vec3(0.68, 0.78, 0.90), cityUniforms.uSkyHorizonColor, 0.45)
        .add(vec3(0.75, 0.88, 1.15).mul(lightningBrightness));
      color.addAssign(rippleSpec.mul(rippleGlint).mul(0.38));

      // Subtle screen-space fog density veil illuminated by storm lightning
      color.assign(mix(color, stormFogColor, fogAmount));
    }

    // 2. Sheet-lightning sky/cloud discharge & core bolt flash
    color.addAssign(vec3(0.72, 0.86, 1.08).mul(lightningSkyGlow));
    color.addAssign(vec3(0.95, 0.98, 1.15).mul(lightningBolt).mul(2.5));

    // 3. Screen-space camera lens raindrops & splashes overlay (vec4: xy=normal, z=mask, w=highlight)
    const rain = lensRainOverlay();
    const refractOffset = rain.xy.mul(float(0.038));
    const distortedUV = clamp(screenUV.add(refractOffset), vec2(0.001), vec2(0.999));
    const sceneRefracted = texture(sceneColor, distortedUV);
    const refractedExposed = max(sceneRefracted.rgb.add(reflections.rgb), vec3(0))
      .mul(exposure)
      .mul(balance)
      .add(bloomPass.rgb)
      .toVar();
    if (screenWeatherEffect) {
      refractedExposed.assign(mix(refractedExposed, stormFogColor, fogAmount));
    }

    // Refractive optical displacement
    color.assign(mix(color, refractedExposed, rain.z));

    // Meniscus dark boundary ring (Fresnel total internal reflection border)
    const meniscus = rain.z.mul(smoothstep(0.05, 0.35, length(rain.xy)));
    const darkRim = float(1.0).sub(meniscus.mul(0.32));
    color.mulAssign(darkRim);

    // Water specular bead highlight (calibrated glint from sky, neon, & lightning strikes)
    const skyGlint = mix(vec3(0.85), cityUniforms.uSkyHorizonColor, 0.45)
      .add(vec3(0.25))
      .add(vec3(0.72, 0.86, 1.08).mul(lightningBrightness));
    color.addAssign(skyGlint.mul(rain.w).mul(1.05));

    // 4. Dynamic screen brightness spike & electric temperature shift during downpour lightning
    const flashBoost = float(1.0).add(lightningBrightness.mul(1.05));
    const flashTint = mix(vec3(1.0), vec3(0.90, 0.96, 1.10), clamp(lightningBrightness, 0.0, 1.0));
    color.mulAssign(flashBoost);
    color.mulAssign(flashTint);

    const luma = dot(color, vec3(0.2126, 0.7152, 0.0722)).toVar();

    // Gentle cool shadow / warm highlight separation; multiply rather than lifting the black level.
    const shadows = mix(vec3(0.965, 1.005, 1.045), vec3(1), smoothstep(0.02, 0.60, luma));
    const highlights = mix(vec3(1), vec3(1.035, 1.005, 0.965), smoothstep(0.60, 3.0, luma));
    color.mulAssign(shadows.mul(highlights));

    // Contrast pivots around middle gray and scales RGB together, modulated gently by atmospheric weather.
    const effectiveContrast = max(float(0.72), contrast.add(uWeatherContrastShift));
    const effectiveSaturation = max(float(0.15), saturation.add(uWeatherSaturationShift));
    color.mulAssign(pow(max(luma, 0.0001).div(0.18), effectiveContrast.sub(1.0)));
    const gray = dot(color, vec3(0.2126, 0.7152, 0.0722));
    const chroma = max(max(color.r, color.g), color.b).sub(min(min(color.r, color.g), color.b));
    const vibrance = float(0.10).mul(float(1).sub(chroma.div(max(max(max(color.r, color.g), color.b), 0.0001))));
    color.assign(max(mix(vec3(gray), color, effectiveSaturation.add(vibrance)), vec3(0)));

    // Normalize by the corner radius so the lens falloff remains subtle in portrait and landscape.
    const aspect = screenSize.x.div(screenSize.y);
    const radius = length(screenUV.sub(0.5).mul(vec2(aspect, 1))).div(length(vec2(aspect, 1).mul(0.5)));
    const vignette = float(1).sub(smoothstep(0.35, 1.0, radius).mul(0.12));
    return vec4(color.mul(vignette), 1.0);
  })();

  function applyPreset(id) {
    const look = LOOKS[id] || LOOKS.golden;
    exposure.value = look.exposure;
    contrast.value = look.contrast;
    saturation.value = look.saturation;
    balance.value.set(...look.balance);
    bloomPass.strength.value = look.bloom;
    bloomPass.threshold.value = look.threshold;
  }

  applyPreset('golden');
  return { outputNode, applyPreset, update };
}

export { createPostProcessing };
