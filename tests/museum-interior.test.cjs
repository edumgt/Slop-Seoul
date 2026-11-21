const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMuseumConfig() {
  const srcPath = path.join(__dirname, '..', 'js', 'museum-config.js');
  const raw = fs.readFileSync(srcPath, 'utf8');
  const transformed = raw.replace(
    /export\s*\{([\s\S]*?)\};?\s*$/,
    'module.exports = { $1 };'
  );
  const mod = { exports: {} };
  vm.runInNewContext(transformed, { module: mod, exports: mod.exports, Math, Object, Number });
  return mod.exports;
}

const museum = loadMuseumConfig();

test('National Museum of Korea strictly allows walk-only (person) travel mode', () => {
  const { getAllowedModesForCity, isModeAllowedInCity, resolveModeForCity } = museum;

  assert.deepEqual(Array.from(getAllowedModesForCity('museum')), ['person']);
  assert.equal(isModeAllowedInCity('museum', 'person'), true);
  assert.equal(isModeAllowedInCity('museum', 'car'), false);
  assert.equal(isModeAllowedInCity('museum', 'cyclist'), false);
  assert.equal(isModeAllowedInCity('museum', 'helicopter'), false);

  assert.equal(resolveModeForCity('museum', 'car'), 'person');
  assert.equal(resolveModeForCity('museum', 'cyclist'), 'person');
  assert.equal(resolveModeForCity('museum', 'helicopter'), 'person');
  assert.equal(resolveModeForCity('museum', 'person'), 'person');

  // Outdoor cities retain all four travel modes
  assert.deepEqual(Array.from(getAllowedModesForCity('sejong')), ['person', 'car', 'cyclist', 'helicopter']);
  assert.deepEqual(Array.from(getAllowedModesForCity('seoul')), ['person', 'car', 'cyclist', 'helicopter']);
  assert.equal(resolveModeForCity('seoul', 'car'), 'car');
});

test('all museum teleport destinations sit inside MUSEUM_BOUNDS and clear of MUSEUM_COLLIDERS', () => {
  const { MUSEUM_TELEPORTS, MUSEUM_BOUNDS, MUSEUM_COLLIDERS } = museum;
  const personRadius = 0.48;

  for (const [key, loc] of Object.entries(MUSEUM_TELEPORTS)) {
    assert.ok(
      loc.x >= MUSEUM_BOUNDS.minX + personRadius && loc.x <= MUSEUM_BOUNDS.maxX - personRadius,
      `teleport ${key} x=${loc.x} should stay inside MUSEUM_BOUNDS`
    );
    assert.ok(
      loc.z >= MUSEUM_BOUNDS.minZ + personRadius && loc.z <= MUSEUM_BOUNDS.maxZ - personRadius,
      `teleport ${key} z=${loc.z} should stay inside MUSEUM_BOUNDS`
    );

    for (const c of MUSEUM_COLLIDERS) {
      const overlaps =
        loc.x + personRadius > c.minX &&
        loc.x - personRadius < c.maxX &&
        loc.z + personRadius > c.minZ &&
        loc.z - personRadius < c.maxZ;
      assert.equal(overlaps, false, `teleport ${key} must not spawn inside museum collider`);
    }
  }
});

test('getMuseumZoneAt resolves Great Hall, Path of History, Ten-Story Pagoda, Room of Quiet Contemplation, and Craft Galleries', () => {
  const { museumToWorld, getMuseumZoneAt } = museum;

  const lobby = museumToWorld(0, 50);
  assert.equal(getMuseumZoneAt(lobby.x, lobby.z).id, 'great_hall');

  const path = museumToWorld(0, 12);
  assert.equal(getMuseumZoneAt(path.x, path.z).id, 'path_of_history');

  const pagoda = museumToWorld(0, -34);
  assert.equal(getMuseumZoneAt(pagoda.x, pagoda.z).id, 'pagoda_atrium');

  const contemplation = museumToWorld(15.5, 0);
  assert.equal(getMuseumZoneAt(contemplation.x, contemplation.z).id, 'contemplation_room');

  const westCraft = museumToWorld(-14, 10);
  assert.equal(getMuseumZoneAt(westCraft.x, westCraft.z).id, 'west_gallery');
});

test('getMuseumLightingMood calibrates skylight and spotlight intensities across all time presets', () => {
  const { getMuseumLightingMood } = museum;

  const midday = getMuseumLightingMood('midday');
  const golden = getMuseumLightingMood('golden');
  const twilight = getMuseumLightingMood('twilight');
  const midnight = getMuseumLightingMood('midnight');

  assert.ok(midday.skylightIntensity > golden.skylightIntensity);
  assert.ok(golden.skylightIntensity > twilight.skylightIntensity);
  assert.ok(twilight.skylightIntensity > midnight.skylightIntensity);

  // Night museum spotlighting intensifies as daylight drops
  assert.ok(midnight.spotIntensity > midday.spotIntensity);
  assert.equal(getMuseumLightingMood('unknown').id, 'midday');
});
