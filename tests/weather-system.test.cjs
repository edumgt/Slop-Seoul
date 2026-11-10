const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/weather-system.js'), 'utf8');

// Extract the weather presets and pure logic helpers
const presetsMatch = source.match(/const WEATHER_PRESETS = (\{[\s\S]*?\n\};)/);
assert.ok(presetsMatch, 'WEATHER_PRESETS must be defined in weather-system.js');

const helpersMatch = source.match(/function getWeatherPreset\([\s\S]*?function calculateCloudParameters\([\s\S]*?\n\}/);
assert.ok(helpersMatch, 'Weather helper functions must be defined in weather-system.js');

const {
  WEATHER_PRESETS,
  getWeatherPreset,
  calculateAtmosphericFogParams,
  calculateRoadWetness,
  calculateCloudParameters
} = vm.runInNewContext(`
  ${presetsMatch[0]}
  ${helpersMatch[0]}
  ({ WEATHER_PRESETS, getWeatherPreset, calculateAtmosphericFogParams, calculateRoadWetness, calculateCloudParameters });
`);

test('WEATHER_PRESETS defines all 4 required weather states', () => {
  const expected = ['clear', 'fog', 'rain', 'downpour'];
  for (const id of expected) {
    const p = WEATHER_PRESETS[id];
    assert.ok(p, `Weather preset ${id} must exist`);
    assert.equal(p.id, id);
    assert.ok(typeof p.nameKo === 'string' && p.nameKo.length > 0);
    assert.ok(typeof p.rainIntensity === 'number');
    assert.ok(typeof p.fogMult === 'number');
    assert.ok(typeof p.fogHeight === 'number');
    assert.ok(typeof p.wetnessTarget === 'number');
  }
});

test('Rain intensity and particle density scale from clear to downpour', () => {
  const { clear, fog, rain, downpour } = WEATHER_PRESETS;
  assert.equal(clear.rainIntensity, 0.0);
  assert.equal(fog.rainIntensity, 0.0);
  assert.ok(rain.rainIntensity > 0.2 && rain.rainIntensity < 0.8, 'Light rain has moderate rain intensity');
  assert.equal(downpour.rainIntensity, 1.0, 'Heavy downpour has maximum rain intensity');

  assert.equal(clear.rainDropCount, 0);
  assert.equal(fog.rainDropCount, 0);
  assert.ok(rain.rainDropCount > 5000 && rain.rainDropCount < downpour.rainDropCount);
  assert.ok(downpour.rainDropCount >= 30000, 'Downpour deploys dense particle stream');
});

test('Fog preset increases atmospheric fog density and lowers fog ceiling', () => {
  const { clear, fog, rain, downpour } = WEATHER_PRESETS;
  assert.ok(fog.fogMult > clear.fogMult * 3.5, 'Fog preset drastically increases fog density');
  assert.ok(fog.fogHeight < clear.fogHeight * 0.35, 'Fog preset brings fog ceiling close to street canyon level');
  assert.ok(downpour.fogMult > rain.fogMult, 'Downpour produces heavier rain mist than light rain');
});

test('getWeatherPreset returns matching preset and falls back to clear on unknown', () => {
  assert.equal(getWeatherPreset('rain').id, 'rain');
  assert.equal(getWeatherPreset('downpour').id, 'downpour');
  assert.equal(getWeatherPreset('fog').id, 'fog');
  assert.equal(getWeatherPreset('clear').id, 'clear');
  assert.equal(getWeatherPreset('unknown_weather').id, 'clear');
  assert.equal(getWeatherPreset(null).id, 'clear');
});

test('calculateAtmosphericFogParams harmonizes weather with time-of-day presets', () => {
  // Test baseline sunny golden hour
  const goldenBase = { fogDensity: 0.00024, fogColor: 0xdcc5ae, roadWetness: 0.28 };
  const goldenFog = calculateAtmosphericFogParams('fog', goldenBase);
  assert.ok(goldenFog.density > goldenBase.fogDensity * 3.5);
  assert.ok(goldenFog.height <= 200.0);

  // Test downpour in midnight setting
  const midnightBase = { fogDensity: 0.00036, fogColor: 0x0c1424, roadWetness: 0.62 };
  const midnightStorm = calculateAtmosphericFogParams('downpour', midnightBase);
  assert.ok(midnightStorm.density > midnightBase.fogDensity * 2.5);
  assert.equal(midnightStorm.roadWetness, 1.0, 'Road wetness is fully flooded in downpour');
});

test('calculateRoadWetness ensures wetness increases with precipitation', () => {
  assert.ok(calculateRoadWetness('clear', 0.1) <= 0.2);
  assert.ok(calculateRoadWetness('fog', 0.1) >= 0.35);
  assert.ok(calculateRoadWetness('rain', 0.1) >= 0.7);
  assert.equal(calculateRoadWetness('downpour', 0.1), 1.0);
});

test('calculateCloudParameters increases cloud cover and density during storms', () => {
  const clearClouds = calculateCloudParameters('clear', 0.3, 0.3);
  const rainClouds = calculateCloudParameters('rain', 0.3, 0.3);
  const downpourClouds = calculateCloudParameters('downpour', 0.3, 0.3);

  assert.ok(rainClouds.coverage > clearClouds.coverage);
  assert.ok(downpourClouds.coverage > rainClouds.coverage);
  assert.ok(downpourClouds.density >= 0.9);
});
