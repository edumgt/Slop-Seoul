const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadTrafficSegmentsModule() {
  const srcPath = path.join(__dirname, '..', 'js', 'traffic-segments.js');
  const raw = fs.readFileSync(srcPath, 'utf8');
  const transformed = raw.replace(
    /export\s*\{([\s\S]*?)\};?\s*$/,
    'module.exports = { $1 };'
  );
  const mod = { exports: {} };
  vm.runInNewContext(transformed, { module: mod, exports: mod.exports, Math, Number, Map, Object, Set });
  return mod.exports;
}

function makeSeededRng(seed = 123456789) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const segmentsApi = loadTrafficSegmentsModule();

test('TRAFFIC_LEVELS defines Congested, Heavy, Normal, and Smooth with monotonic speeds and distinct colors', () => {
  const { TRAFFIC_LEVEL_ORDER, TRAFFIC_LEVELS } = segmentsApi;
  assert.deepEqual(Array.from(TRAFFIC_LEVEL_ORDER), ['congested', 'heavy', 'normal', 'smooth']);

  assert.equal(TRAFFIC_LEVELS.congested.label, 'Congested');
  assert.equal(TRAFFIC_LEVELS.heavy.label, 'Heavy');
  assert.equal(TRAFFIC_LEVELS.normal.label, 'Normal');
  assert.equal(TRAFFIC_LEVELS.smooth.label, 'Smooth');

  const colors = new Set(TRAFFIC_LEVEL_ORDER.map((id) => TRAFFIC_LEVELS[id].dotColor));
  assert.equal(colors.size, 4, 'each traffic level should have a unique dot color');

  assert.ok(TRAFFIC_LEVELS.congested.speedMultiplier < TRAFFIC_LEVELS.heavy.speedMultiplier);
  assert.ok(TRAFFIC_LEVELS.heavy.speedMultiplier < TRAFFIC_LEVELS.normal.speedMultiplier);
  assert.ok(TRAFFIC_LEVELS.normal.speedMultiplier < TRAFFIC_LEVELS.smooth.speedMultiplier);

  assert.ok(TRAFFIC_LEVELS.congested.congestionIndex > TRAFFIC_LEVELS.heavy.congestionIndex);
  assert.ok(TRAFFIC_LEVELS.heavy.congestionIndex > TRAFFIC_LEVELS.normal.congestionIndex);
  assert.ok(TRAFFIC_LEVELS.normal.congestionIndex > TRAFFIC_LEVELS.smooth.congestionIndex);
});

test('resolveRoadSegment resolves Sejong and Seoul road coordinates to distinct named segments', () => {
  const { resolveRoadSegment } = segmentsApi;

  assert.equal(resolveRoadSegment(0, -1900, 'sejong').id, 'sejong-dasom');
  assert.equal(resolveRoadSegment(0, -1450, 'sejong').id, 'sejong-jeoljae');
  assert.equal(resolveRoadSegment(100, -1050, 'sejong').id, 'sejong-hannuri');
  assert.equal(resolveRoadSegment(0, -2400, 'sejong').id, 'sejong-doum');
  assert.equal(resolveRoadSegment(700, -1050, 'sejong').id, 'sejong-galmae');

  assert.equal(resolveRoadSegment(-300, 0, 'seoul').id, 'seoul-teheran-west');
  assert.equal(resolveRoadSegment(250, 0, 'seoul').id, 'seoul-teheran-east');
  assert.equal(resolveRoadSegment(-500, 320, 'seoul').id, 'seoul-gangnam');
  assert.equal(resolveRoadSegment(500, 320, 'seoul').id, 'seoul-yeongdong');
  assert.equal(resolveRoadSegment(40, 320, 'seoul').id, 'seoul-seolleung');
});

test('createTrafficSegmentManager randomly cycles segments through all 4 levels without self-repeating', () => {
  const { createTrafficSegmentManager, ROAD_SEGMENTS, TRAFFIC_LEVEL_ORDER } = segmentsApi;
  const manager = createTrafficSegmentManager({
    rng: makeSeededRng(42),
    minInterval: 3.0,
    maxInterval: 6.0,
    timeId: 'midday'
  });

  const initialStates = manager.getAllSegmentStates();
  assert.equal(Object.keys(initialStates).length, ROAD_SEGMENTS.length);
  const initialLevels = new Set(Object.values(initialStates).map((s) => s.levelId));
  assert.ok(initialLevels.size >= 3, 'different road segments should start with varied traffic levels');

  const seenLevels = new Set();
  const prevLevelBySeg = new Map(
    Object.values(initialStates).map((s) => [s.segmentId, s.levelId])
  );
  let totalChanges = 0;

  for (let step = 0; step < 400; step++) {
    const changed = manager.update(0.5);
    for (const evt of changed) {
      totalChanges++;
      const prev = prevLevelBySeg.get(evt.segmentId);
      assert.notEqual(evt.levelId, prev, `segment ${evt.segmentId} must transition to a different level`);
      prevLevelBySeg.set(evt.segmentId, evt.levelId);
      seenLevels.add(evt.levelId);
    }
  }

  assert.ok(totalChanges >= ROAD_SEGMENTS.length * 10, 'segments should cycle repeatedly over time');
  for (const levelId of TRAFFIC_LEVEL_ORDER) {
    assert.ok(seenLevels.has(levelId), `all 4 levels should be visited during cycling (missing ${levelId})`);
  }
});

test('setTimeOfDay shortens remaining timers and getStateAt returns live segment metadata', () => {
  const { createTrafficSegmentManager } = segmentsApi;
  const manager = createTrafficSegmentManager({
    rng: makeSeededRng(777),
    minInterval: 8.0,
    maxInterval: 12.0,
    timeId: 'golden'
  });

  manager.setTimeOfDay('midnight');
  const sejongState = manager.getStateAt(0, -1900, 'sejong');
  assert.equal(sejongState.segmentId, 'sejong-dasom');
  assert.equal(sejongState.city, 'sejong');
  assert.ok(['Congested', 'Heavy', 'Normal', 'Smooth'].includes(sejongState.level.label));
  assert.ok(sejongState.timeRemaining <= 8.5, 'time-of-day switch should clamp remaining timer promptly');

  const prevLevel = sejongState.levelId;
  const nextLevel = manager.cycleSegment('sejong-dasom');
  assert.notEqual(nextLevel.id, prevLevel);
  assert.equal(manager.getSegmentState('sejong-dasom').cycleCount, 1);
});
