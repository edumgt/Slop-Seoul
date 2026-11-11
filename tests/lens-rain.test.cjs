const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/lens-rain.js'), 'utf8');

// Extract pure logic helpers
const helpersMatch = source.match(/function calculateLensRainParams\([\s\S]*?function calculateTrickleTrail\([\s\S]*?\n\}/);
assert.ok(helpersMatch, 'Pure logical helper functions must be defined in lens-rain.js');

const {
  calculateLensRainParams,
  hash2D,
  calculateDropletMetrics,
  calculateSplashWave,
  calculateTrickleTrail
} = vm.runInNewContext(`
  ${helpersMatch[0]}
  ({ calculateLensRainParams, hash2D, calculateDropletMetrics, calculateSplashWave, calculateTrickleTrail });
`);

test('calculateLensRainParams maps all weather states correctly', () => {
  const clear = calculateLensRainParams('clear');
  const fog = calculateLensRainParams('fog');
  const rain = calculateLensRainParams('rain');
  const downpour = calculateLensRainParams('downpour');
  const unknown = calculateLensRainParams('unknown');

  // Clear & fog must have zero intensity
  assert.equal(clear.intensity, 0.0);
  assert.equal(clear.trickleSpeed, 0.0);
  assert.equal(clear.dropDensity, 0.0);
  assert.equal(clear.splashRate, 0.0);

  assert.equal(fog.intensity, 0.0);
  assert.equal(fog.trickleSpeed, 0.0);
  assert.equal(unknown.intensity, 0.0);

  // Rain must have moderate intensity
  assert.equal(rain.intensity, 0.65);
  assert.ok(rain.trickleSpeed > 0.5 && rain.trickleSpeed < 1.0);
  assert.equal(rain.dropDensity, 0.65);
  assert.ok(rain.splashRate > 0.0);

  // Downpour must have maximum intensity and higher trickle/splash rates
  assert.equal(downpour.intensity, 1.0);
  assert.ok(downpour.trickleSpeed > rain.trickleSpeed);
  assert.ok(downpour.dropDensity > rain.dropDensity);
  assert.ok(downpour.splashRate > rain.splashRate);
});

test('hash2D provides deterministic pseudorandom coordinates in [0, 1]', () => {
  const h1 = hash2D(12.5, 4.2);
  const h2 = hash2D(12.5, 4.2);
  const h3 = hash2D(13.5, 4.2);

  assert.equal(h1.x, h2.x, 'hash must be deterministic');
  assert.equal(h1.y, h2.y, 'hash must be deterministic');
  assert.notEqual(h1.x, h3.x, 'different coordinates must produce different hashes');

  for (let x = 0; x < 10; x++) {
    for (let y = 0; y < 10; y++) {
      const h = hash2D(x * 1.7, y * 3.1);
      assert.ok(h.x >= 0 && h.x <= 1.0, `hash.x out of range: ${h.x}`);
      assert.ok(h.y >= 0 && h.y <= 1.0, `hash.y out of range: ${h.y}`);
    }
  }
});

test('calculateDropletMetrics computes spherical convex normal and boundaries', () => {
  const radius = 0.25;
  const center = 0.0;

  // Center point
  const atCenter = calculateDropletMetrics(0, 0, center, center, radius);
  assert.equal(atCenter.dist, 0);
  assert.equal(atCenter.inside, 1);
  assert.ok(Math.abs(atCenter.normalX) < 1e-4);
  assert.ok(Math.abs(atCenter.normalY) < 1e-4);

  // Inside point at +X
  const insideX = calculateDropletMetrics(0.15, 0, center, center, radius);
  assert.ok(insideX.inside > 0);
  assert.ok(insideX.normalX > 0, 'Normal points outward in +X');
  assert.equal(insideX.normalY, 0);

  // Outside point
  const outside = calculateDropletMetrics(0.35, 0, center, center, radius);
  assert.equal(outside.inside, 0);
  assert.equal(outside.normalX, 0);
  assert.equal(outside.normalY, 0);
  assert.equal(outside.highlight, 0);

  // Meniscus boundary near outer circumference
  const atMeniscus = calculateDropletMetrics(0.22, 0, center, center, radius);
  assert.ok(atMeniscus.meniscus > 0, 'Meniscus should be positive near outer ring');

  // Specular gleam offset
  const atGleam = calculateDropletMetrics(radius * 0.2, radius * 0.2, center, center, radius);
  assert.ok(atGleam.highlight > 0.8, 'Specular gleam reaches peak near light offset');
});

test('calculateSplashWave expands radially and fades over phase', () => {
  const maxRadius = 0.20;
  const waveWidth = 0.02;

  // Initial impact (phase 0)
  const p0 = calculateSplashWave(0.0, 0.0, maxRadius, waveWidth);
  assert.equal(p0.currentRadius, 0.0);
  assert.equal(p0.fade, 1.0);
  assert.ok(p0.waveIntensity > 0.9);

  // Halfway through splash (phase 0.5)
  const targetDist = 0.5 * maxRadius;
  const pHalfOnRing = calculateSplashWave(targetDist, 0.5, maxRadius, waveWidth);
  const pHalfOffRing = calculateSplashWave(targetDist + 0.1, 0.5, maxRadius, waveWidth);

  assert.ok(pHalfOnRing.waveIntensity > 0);
  assert.equal(pHalfOffRing.waveIntensity, 0);
  assert.equal(pHalfOnRing.fade, 0.5);

  // End of splash (phase 1.0)
  const pEnd = calculateSplashWave(maxRadius, 1.0, maxRadius, waveWidth);
  assert.equal(pEnd.fade, 0.0);
  assert.equal(pEnd.waveIntensity, 0.0);
});

test('calculateTrickleTrail simulates sinuous gravity runoff', () => {
  const colWidth = 0.12;

  // At center of wiggle
  const time1 = 1.0;
  const wiggle1 = Math.sin(time1 * 5.0) * 0.035;
  const onTrickle = calculateTrickleTrail(wiggle1, 0.5, time1, colWidth);
  assert.ok(onTrickle.insideTrail);
  assert.ok(Math.abs(onTrickle.trailNormalX) < 1e-4);

  // Off trickle
  const offTrickle = calculateTrickleTrail(wiggle1 + 0.2, 0.5, time1, colWidth);
  assert.equal(offTrickle.insideTrail, false);
  assert.equal(offTrickle.trailNormalX, 0);

  // Movement over time
  const time2 = 2.5;
  const wiggle2 = Math.sin(time2 * 5.0) * 0.035;
  assert.notEqual(wiggle1, wiggle2, 'Wiggle must animate over time');
});
