const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');

// Extract the dynamic congestion definitions and pure helper functions
const profilesMatch = source.match(/const TIME_CONGESTION_PROFILES = (\{[\s\S]*?\n\};)/);
assert.ok(profilesMatch, 'TIME_CONGESTION_PROFILES must be defined in traffic.js');

const helperMatch = source.match(/function getCongestionProfile\([\s\S]*?function calculateTargetActiveCount\([\s\S]*?\n\}/);
assert.ok(helperMatch, 'Congestion helper functions must be defined in traffic.js');

const {
  TIME_CONGESTION_PROFILES,
  getCongestionProfile,
  isTeheranRoCoordinate,
  calculateTargetActiveCount
} = vm.runInNewContext(`
  ${profilesMatch[0]}
  ${helperMatch[0]}
  ({ TIME_CONGESTION_PROFILES, getCongestionProfile, isTeheranRoCoordinate, calculateTargetActiveCount });
`);

test('TIME_CONGESTION_PROFILES covers all four core time presets', () => {
  const presets = ['golden', 'midday', 'twilight', 'midnight'];
  for (const preset of presets) {
    assert.ok(TIME_CONGESTION_PROFILES[preset], `Profile for ${preset} should exist`);
    const p = TIME_CONGESTION_PROFILES[preset];
    assert.ok(typeof p.nameKo === 'string' && p.nameKo.length > 0);
    assert.ok(typeof p.congestionLevel === 'string');
    assert.ok(typeof p.congestionIndex === 'number' && p.congestionIndex >= 0 && p.congestionIndex <= 1);
    assert.ok(typeof p.densityRatio === 'number' && p.densityRatio > 0 && p.densityRatio <= 1);
    assert.ok(typeof p.speedMultiplier === 'number' && p.speedMultiplier > 0);
    assert.ok(typeof p.teheranSpeedMult === 'number' && p.teheranSpeedMult > 0);
    assert.ok(typeof p.standstillGap === 'number' && p.standstillGap > 0);
    assert.ok(typeof p.timeHeadway === 'number' && p.timeHeadway > 0);
    assert.ok(typeof p.accelFactor === 'number' && p.accelFactor > 0);
    assert.ok(typeof p.statusKo === 'string');
    assert.ok(typeof p.label === 'string');
  }
});

test('Rush hour (golden) has peak congestion index and density ratio, with slowest travel speeds', () => {
  const golden = TIME_CONGESTION_PROFILES.golden;
  const midnight = TIME_CONGESTION_PROFILES.midnight;
  const midday = TIME_CONGESTION_PROFILES.midday;
  const twilight = TIME_CONGESTION_PROFILES.twilight;

  assert.equal(golden.densityRatio, 1.0, 'Rush hour must deploy 100% vehicle density');
  assert.ok(golden.congestionIndex > midday.congestionIndex, 'Rush hour has higher congestion index than midday');
  assert.ok(golden.congestionIndex > midnight.congestionIndex, 'Rush hour has higher congestion index than midnight');
  assert.ok(golden.speedMultiplier < midday.speedMultiplier, 'Rush hour speeds are slower than midday');
  assert.ok(golden.speedMultiplier < midnight.speedMultiplier, 'Rush hour speeds are slower than midnight');
  assert.equal(golden.congestionLevel, 'heavy');
  assert.equal(midnight.congestionLevel, 'light');
});

test('Late night (midnight) allows swift travel speed and lowest density ratio', () => {
  const midnight = TIME_CONGESTION_PROFILES.midnight;
  assert.ok(midnight.densityRatio <= 0.5, 'Midnight vehicle density should be sparse (<= 50%)');
  assert.ok(midnight.speedMultiplier > 1.2, 'Midnight speed multiplier should be brisk (> 120%)');
  assert.ok(midnight.accelFactor >= 1.2, 'Midnight acceleration should be responsive');
});

test('getCongestionProfile returns corresponding profile and falls back gracefully', () => {
  assert.equal(getCongestionProfile('midnight').id, 'midnight');
  assert.equal(getCongestionProfile('midday').id, 'midday');
  assert.equal(getCongestionProfile('twilight').id, 'twilight');
  assert.equal(getCongestionProfile('golden').id, 'golden');
  assert.equal(getCongestionProfile('invalid_time_id').id, 'golden');
  assert.equal(getCongestionProfile(undefined).id, 'golden');
});

test('isTeheranRoCoordinate accurately detects Teheran-ro corridor coordinates', () => {
  // Center of Teheran-ro (z ~ 0.3)
  assert.equal(isTeheranRoCoordinate(0, 0), true);
  // Near Gangnam Station (-800, 15)
  assert.equal(isTeheranRoCoordinate(-800, 15), true);
  // Near Yeoksam Station (-400, -10)
  assert.equal(isTeheranRoCoordinate(-400, -10), true);
  // Near Samseong Station & COEX (500, 5)
  assert.equal(isTeheranRoCoordinate(500, 5), true);

  // Cross streets far off Teheran-ro axis (e.g. Dosan-daero, Hakdong-ro)
  assert.equal(isTeheranRoCoordinate(0, 250), false);
  assert.equal(isTeheranRoCoordinate(0, -350), false);
  // Coordinates far past the corridor endpoints
  assert.equal(isTeheranRoCoordinate(-2000, 0), false);
  assert.equal(isTeheranRoCoordinate(2000, 0), false);
});

test('calculateTargetActiveCount computes realistic fleet density quotas', () => {
  const totalPool = 212; // 200 cars + 12 buses
  assert.equal(calculateTargetActiveCount(totalPool, 'golden'), 212);
  assert.equal(calculateTargetActiveCount(totalPool, 'midday'), 159);
  assert.equal(calculateTargetActiveCount(totalPool, 'twilight'), 187);
  assert.equal(calculateTargetActiveCount(totalPool, 'midnight'), 85);
});

test('Driver headway and standstill distance reflect real-world traffic congestion', () => {
  const golden = TIME_CONGESTION_PROFILES.golden;
  const midnight = TIME_CONGESTION_PROFILES.midnight;

  // In rush hour traffic jams, standstill spacing is compressed (bumper to bumper)
  assert.ok(golden.standstillGap < midnight.standstillGap, 'Rush hour standstill gap is tighter');
  // In rush hour traffic, time headway is higher to absorb stop-and-go waves
  assert.ok(golden.timeHeadway > midnight.timeHeadway, 'Rush hour time headway is higher');
});
