const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/screen-weather.js'), 'utf8');

const presetsMatch = source.match(/const SCREEN_WEATHER_PRESETS = (\{[\s\S]*?\n\};)/);
assert.ok(presetsMatch, 'SCREEN_WEATHER_PRESETS must be defined in screen-weather.js');

const helpersMatch = source.match(/function getScreenWeatherTargets\([\s\S]*?function calculateSurfaceRippleWave\([\s\S]*?\n\}/);
assert.ok(helpersMatch, 'Screen weather pure helper functions must be defined in screen-weather.js');

const {
  SCREEN_WEATHER_PRESETS,
  getScreenWeatherTargets,
  stepWeatherValue,
  calculateScreenFogFactor,
  calculateSurfaceRippleWave
} = vm.runInNewContext(`
  ${presetsMatch[0]}
  ${helpersMatch[0]}
  ({
    SCREEN_WEATHER_PRESETS,
    getScreenWeatherTargets,
    stepWeatherValue,
    calculateScreenFogFactor,
    calculateSurfaceRippleWave
  });
`);

test('SCREEN_WEATHER_PRESETS defines all 4 weather modes with coherent targets', () => {
  const { clear, fog, rain, downpour } = SCREEN_WEATHER_PRESETS;
  assert.ok(clear && fog && rain && downpour);

  assert.equal(clear.fogShift, 0.0);
  assert.equal(clear.rippleIntensity, 0.0);
  assert.equal(clear.lensIntensity, 0.0);

  assert.ok(fog.fogShift > downpour.fogShift, 'Fog preset produces strongest screen-space fog shift');
  assert.equal(fog.rippleIntensity, 0.0, 'Fog alone does not create rain ripples');
  assert.equal(fog.lensIntensity, 0.0, 'Fog alone does not create lens raindrops');

  assert.ok(rain.rippleIntensity > 0.4 && rain.rippleIntensity < downpour.rippleIntensity);
  assert.ok(rain.lensIntensity > 0.4 && rain.lensIntensity < downpour.lensIntensity);
  assert.equal(downpour.rippleIntensity, 1.0);
  assert.equal(downpour.lensIntensity, 1.0);
});

test('getScreenWeatherTargets falls back cleanly to clear on unknown ids', () => {
  assert.equal(getScreenWeatherTargets('rain').id, 'rain');
  assert.equal(getScreenWeatherTargets('fog').id, 'fog');
  assert.equal(getScreenWeatherTargets('downpour').id, 'downpour');
  assert.equal(getScreenWeatherTargets('unknown').id, 'clear');
  assert.equal(getScreenWeatherTargets(null).id, 'clear');
});

test('stepWeatherValue smoothly approaches target regardless of frame delta and snaps near target', () => {
  let v = 0.0;
  for (let i = 0; i < 60; i++) {
    v = stepWeatherValue(v, 1.0, 1 / 60, 2.5);
  }
  assert.ok(v > 0.85 && v < 1.0, `Expected smooth 1-second progress, got ${v}`);

  // Large iteration converges completely
  for (let i = 0; i < 240; i++) {
    v = stepWeatherValue(v, 1.0, 1 / 60, 2.5);
  }
  assert.equal(v, 1.0);

  // Frame-rate independence check (one 0.1s step vs ten 0.01s steps)
  const oneBig = stepWeatherValue(0.0, 1.0, 0.1, 2.6);
  let tenSmall = 0.0;
  for (let i = 0; i < 10; i++) {
    tenSmall = stepWeatherValue(tenSmall, 1.0, 0.01, 2.6);
  }
  assert.ok(Math.abs(oneBig - tenSmall) < 0.002);
});

test('calculateScreenFogFactor increases with distance and lowers at ground level', () => {
  assert.equal(calculateScreenFogFactor(100, 10, 0.0038, 0.0, 150), 0);
  assert.equal(calculateScreenFogFactor(100, 10, 0.0, 0.78, 150), 0);

  const nearGround = calculateScreenFogFactor(20, 1, 0.0038, 0.78, 150);
  const farGround = calculateScreenFogFactor(300, 1, 0.0038, 0.78, 150);
  const farHighAlt = calculateScreenFogFactor(300, 350, 0.0038, 0.78, 150);

  assert.ok(farGround > nearGround, 'Distant geometry receives more fog veil');
  assert.ok(farGround > farHighAlt, 'Low-lying street canyons accumulate denser mist than tall rooftops');
  assert.ok(farGround <= 0.75, 'Fog factor never completely obscures visibility');
});

test('calculateSurfaceRippleWave expands radially, fades over phase, and respects ripple density', () => {
  // Below active seed threshold -> inactive cell
  const inactive = calculateSurfaceRippleWave(0.1, 0.25, 0.05, 0.55);
  assert.equal(inactive, 0.0);

  // Active cell right on the expanding wavefront
  const phase = 0.4;
  const radius = phase * 0.42;
  const onWave = calculateSurfaceRippleWave(radius, phase, 0.95, 1.0);
  const offWave = calculateSurfaceRippleWave(radius + 0.2, phase, 0.95, 1.0);
  const laterOnWave = calculateSurfaceRippleWave(0.8 * 0.42, 0.8, 0.95, 1.0);

  assert.ok(onWave > 0.2, 'Wavefront should peak cleanly at ring radius');
  assert.equal(offWave, 0.0, 'Outside ring envelope must be zero');
  assert.ok(onWave > laterOnWave, 'Ripple amplitude decays as ring expands');
});
