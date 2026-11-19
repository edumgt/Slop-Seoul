// =========================================================================
// ROAD-SEGMENT REAL-TIME TRAFFIC CONGESTION CYCLING SYSTEM
// =========================================================================
// Pure, framework-free traffic segment manager that cycles different road
// segments across Sejong City and Seoul City through four congestion levels:
//   - Congested (정체) — red dot, bumper-to-bumper slow traffic
//   - Heavy     (혼잡) — orange dot, dense stop-and-go flow
//   - Normal    (보통) — yellow dot, steady urban pace
//   - Smooth    (원활) — green dot, free-flowing open lanes

const TRAFFIC_LEVEL_ORDER = ['congested', 'heavy', 'normal', 'smooth'];

const TRAFFIC_LEVELS = {
  congested: {
    id: 'congested',
    label: 'Congested',
    labelKo: '정체',
    dotClass: 'congested',
    dotColor: '#ff4d4f',
    congestionIndex: 0.94,
    speedMultiplier: 0.36,
    accelFactor: 0.68,
    standstillGap: 1.15,
    timeHeadway: 1.95
  },
  heavy: {
    id: 'heavy',
    label: 'Heavy',
    labelKo: '혼잡',
    dotClass: 'heavy',
    dotColor: '#fb923c',
    congestionIndex: 0.72,
    speedMultiplier: 0.62,
    accelFactor: 0.82,
    standstillGap: 1.45,
    timeHeadway: 1.60
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    labelKo: '보통',
    dotClass: 'normal',
    dotColor: '#facc15',
    congestionIndex: 0.45,
    speedMultiplier: 0.92,
    accelFactor: 1.0,
    standstillGap: 1.95,
    timeHeadway: 1.30
  },
  smooth: {
    id: 'smooth',
    label: 'Smooth',
    labelKo: '원활',
    dotClass: 'smooth',
    dotColor: '#22c55e',
    congestionIndex: 0.16,
    speedMultiplier: 1.24,
    accelFactor: 1.22,
    standstillGap: 2.45,
    timeHeadway: 1.05
  }
};

const ROAD_SEGMENTS = [
  // Sejong City government & BRT corridors
  { id: 'sejong-dasom', city: 'sejong', nameKo: '다솜로', nameEn: 'Dasom-ro' },
  { id: 'sejong-hannuri', city: 'sejong', nameKo: '한누리대로', nameEn: 'Hannuri-daero' },
  { id: 'sejong-jeoljae', city: 'sejong', nameKo: '절재로', nameEn: 'Jeoljae-ro' },
  { id: 'sejong-doum', city: 'sejong', nameKo: '도움로', nameEn: 'Doum-ro' },
  { id: 'sejong-galmae', city: 'sejong', nameKo: '갈매로', nameEn: 'Galmae-ro' },
  // Seoul Teheran-ro & Gangnam corridors
  { id: 'seoul-teheran-west', city: 'seoul', nameKo: '테헤란로 서단', nameEn: 'Teheran-ro W' },
  { id: 'seoul-teheran-east', city: 'seoul', nameKo: '테헤란로 동단', nameEn: 'Teheran-ro E' },
  { id: 'seoul-gangnam', city: 'seoul', nameKo: '강남대로', nameEn: 'Gangnam-daero' },
  { id: 'seoul-yeongdong', city: 'seoul', nameKo: '영동대로', nameEn: 'Yeongdong-daero' },
  { id: 'seoul-seolleung', city: 'seoul', nameKo: '선릉로', nameEn: 'Seolleung-ro' }
];

const SEGMENT_BY_ID = Object.fromEntries(ROAD_SEGMENTS.map((s) => [s.id, s]));

// Soft time-of-day transition weights so random cycling stays plausible while still visiting all 4 levels
const TIME_LEVEL_WEIGHTS = {
  golden:   { congested: 0.36, heavy: 0.32, normal: 0.20, smooth: 0.12 },
  twilight: { congested: 0.24, heavy: 0.34, normal: 0.26, smooth: 0.16 },
  midday:   { congested: 0.16, heavy: 0.26, normal: 0.34, smooth: 0.24 },
  midnight: { congested: 0.10, heavy: 0.16, normal: 0.28, smooth: 0.46 }
};

function getTrafficLevel(levelId) {
  return TRAFFIC_LEVELS[levelId] || TRAFFIC_LEVELS.normal;
}

/**
 * Resolves any world coordinate (x, z) and optional cityId into one of the named road segments.
 */
function resolveRoadSegment(x, z, cityId = null) {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeZ = Number.isFinite(z) ? z : 0;
  const isSejong = cityId ? cityId === 'sejong' : (safeZ < -900 || safeZ >= 4200);

  if (isSejong) {
    if (safeZ >= 4200 || safeZ < -2200) return SEGMENT_BY_ID['sejong-doum'];
    if (safeZ >= -2120 && safeZ <= -1720 && Math.abs(safeX) <= 520) return SEGMENT_BY_ID['sejong-dasom'];
    if (safeZ > -1720 && safeZ <= -1180) return SEGMENT_BY_ID['sejong-jeoljae'];
    if (Math.abs(safeX) <= 360) return SEGMENT_BY_ID['sejong-hannuri'];
    return SEGMENT_BY_ID['sejong-galmae'];
  }

  if (Math.abs(safeZ) < 170) {
    return safeX < -80 ? SEGMENT_BY_ID['seoul-teheran-west'] : SEGMENT_BY_ID['seoul-teheran-east'];
  }
  if (safeX < -280) return SEGMENT_BY_ID['seoul-gangnam'];
  if (safeX >= 360) return SEGMENT_BY_ID['seoul-yeongdong'];
  return SEGMENT_BY_ID['seoul-seolleung'];
}

function pickWeightedLevel(excludeId, timeId = 'golden', rng = Math.random) {
  const weights = TIME_LEVEL_WEIGHTS[timeId] || TIME_LEVEL_WEIGHTS.midday;
  const candidates = TRAFFIC_LEVEL_ORDER.filter((id) => id !== excludeId);
  let total = 0;
  for (let i = 0; i < candidates.length; i++) {
    total += weights[candidates[i]] || 0.25;
  }
  let roll = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    const id = candidates[i];
    roll -= weights[id] || 0.25;
    if (roll <= 0) return id;
  }
  return candidates[candidates.length - 1];
}

function createTrafficSegmentManager(options = {}) {
  const rng = typeof options.rng === 'function' ? options.rng : Math.random;
  const minInterval = Number.isFinite(options.minInterval) ? Math.max(1, options.minInterval) : 5.5;
  const maxInterval = Number.isFinite(options.maxInterval) ? Math.max(minInterval, options.maxInterval) : 10.5;
  let activeTimeId = options.timeId || 'golden';
  let elapsedClock = 0;

  const nextDuration = () => minInterval + rng() * (maxInterval - minInterval);

  const states = new Map();
  ROAD_SEGMENTS.forEach((seg, idx) => {
    // Seed initial states across all four levels so different road segments immediately vary
    const initialLevelId = TRAFFIC_LEVEL_ORDER[(idx + Math.floor(rng() * TRAFFIC_LEVEL_ORDER.length)) % TRAFFIC_LEVEL_ORDER.length];
    // Stagger initial timers so segments cycle naturally at different moments
    const initialTimer = minInterval * 0.45 + rng() * (maxInterval - minInterval * 0.45);
    states.set(seg.id, {
      segment: seg,
      levelId: initialLevelId,
      timeRemaining: initialTimer,
      cycleCount: 0,
      lastChangedAt: 0
    });
  });

  function setTimeOfDay(timeId) {
    if (!timeId || activeTimeId === timeId) return;
    activeTimeId = timeId;
    // Gently shorten remaining timers so segments reflect the new time-of-day distribution promptly
    for (const entry of states.values()) {
      entry.timeRemaining = Math.min(entry.timeRemaining, minInterval * 0.75 + rng() * 2.5);
    }
  }

  function cycleSegment(segmentId) {
    const entry = states.get(segmentId);
    if (!entry) return null;
    const nextLevelId = pickWeightedLevel(entry.levelId, activeTimeId, rng);
    entry.levelId = nextLevelId;
    entry.timeRemaining = nextDuration();
    entry.cycleCount += 1;
    entry.lastChangedAt = elapsedClock;
    return getTrafficLevel(nextLevelId);
  }

  function update(dt) {
    const step = Math.max(0, Math.min(dt || 0, 1.0));
    if (step <= 0) return [];
    elapsedClock += step;
    const changed = [];
    for (const [segId, entry] of states.entries()) {
      entry.timeRemaining -= step;
      if (entry.timeRemaining <= 0) {
        const level = cycleSegment(segId);
        changed.push({ segmentId: segId, levelId: level.id, level });
      }
    }
    return changed;
  }

  function getSegmentState(segmentId) {
    const entry = states.get(segmentId) || states.values().next().value;
    const level = getTrafficLevel(entry.levelId);
    return {
      segmentId: entry.segment.id,
      segmentNameKo: entry.segment.nameKo,
      segmentNameEn: entry.segment.nameEn,
      city: entry.segment.city,
      levelId: level.id,
      level,
      timeRemaining: entry.timeRemaining,
      cycleCount: entry.cycleCount,
      lastChangedAt: entry.lastChangedAt
    };
  }

  function getStateAt(x, z, cityId = null) {
    const seg = resolveRoadSegment(x, z, cityId);
    return getSegmentState(seg.id);
  }

  function getAllSegmentStates() {
    const snapshot = {};
    for (const segId of states.keys()) {
      const s = getSegmentState(segId);
      snapshot[segId] = {
        segmentId: s.segmentId,
        segmentNameKo: s.segmentNameKo,
        segmentNameEn: s.segmentNameEn,
        city: s.city,
        levelId: s.levelId,
        label: s.level.label,
        labelKo: s.level.labelKo,
        dotColor: s.level.dotColor,
        cycleCount: s.cycleCount
      };
    }
    return snapshot;
  }

  return {
    update,
    setTimeOfDay,
    cycleSegment,
    getSegmentState,
    getStateAt,
    getAllSegmentStates
  };
}

export {
  TRAFFIC_LEVEL_ORDER,
  TRAFFIC_LEVELS,
  ROAD_SEGMENTS,
  getTrafficLevel,
  resolveRoadSegment,
  pickWeightedLevel,
  createTrafficSegmentManager
};
