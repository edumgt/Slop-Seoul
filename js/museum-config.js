// =========================================================================
// NATIONAL MUSEUM OF KOREA (국립중앙박물관) INDOOR CONFIGURATION & POLICIES
// =========================================================================
// Pure, framework-free module defining the indoor floorplan, exhibits,
// collision bounds, zone lookup, skylight lighting moods, and walk-only
// mode enforcement for the National Museum of Korea interior.

const MUSEUM_ORIGIN = Object.freeze({ x: 24000, y: 0, z: 0 });

// Playable interior footprint (136m long Path of History x 46m wide hall)
const MUSEUM_HALL = Object.freeze({
  halfWidth: 23,
  halfLength: 68,
  ceilingY: 17.5,
  mezzanineY: 7.4,
  floorY: 0
});

const MUSEUM_BOUNDS = Object.freeze({
  minX: MUSEUM_ORIGIN.x - MUSEUM_HALL.halfWidth + 1.1,
  maxX: MUSEUM_ORIGIN.x + MUSEUM_HALL.halfWidth - 1.1,
  minZ: MUSEUM_ORIGIN.z - MUSEUM_HALL.halfLength + 1.4,
  maxZ: MUSEUM_ORIGIN.z + MUSEUM_HALL.halfLength - 1.4,
  floorY: MUSEUM_HALL.floorY,
  ceilingY: MUSEUM_HALL.ceilingY
});

// Helper to convert museum-local coordinates (lx, lz) into world coordinates
function museumToWorld(lx, lz) {
  return { x: MUSEUM_ORIGIN.x + lx, z: MUSEUM_ORIGIN.z + lz };
}

function worldToMuseum(x, z) {
  return { lx: x - MUSEUM_ORIGIN.x, lz: z - MUSEUM_ORIGIN.z };
}

// Strict city travel-mode policies:
// National Museum of Korea interior strictly allows walking on foot ('person') only.
const CITY_ALLOWED_MODES = Object.freeze({
  sejong: Object.freeze(['person', 'car', 'cyclist', 'helicopter']),
  seoul: Object.freeze(['person', 'car', 'cyclist', 'helicopter']),
  museum: Object.freeze(['person'])
});

function getAllowedModesForCity(cityId) {
  return CITY_ALLOWED_MODES[cityId] || CITY_ALLOWED_MODES.sejong;
}

function isModeAllowedInCity(cityId, mode) {
  return getAllowedModesForCity(cityId).includes(mode);
}

function resolveModeForCity(cityId, requestedMode) {
  const allowed = getAllowedModesForCity(cityId);
  return allowed.includes(requestedMode) ? requestedMode : allowed[0];
}

// Indoor named gallery zones (evaluated in order; first matching zone wins)
const MUSEUM_ZONES = Object.freeze([
  {
    id: 'contemplation_room',
    nameKo: '사유의 방',
    nameEn: 'Room of Quiet Contemplation',
    floor: '1F 동관',
    descKo: '국보 금동미륵보살반가사유상 두 점이 모셔진 고요한 명상 전시실',
    bounds: { minLx: 11.2, maxLx: 23.0, minLz: -13.5, maxLz: 13.5 }
  },
  {
    id: 'pagoda_atrium',
    nameKo: '경천사지 십층석탑 광장',
    nameEn: 'Ten-Story Pagoda Atrium',
    floor: '1F 역사의 길 북단',
    descKo: '고려시대 대리석 걸작 국보 경천사지 십층석탑(높이 13.5m)',
    bounds: { minLx: -13.5, maxLx: 13.5, minLz: -66.0, maxLz: -25.0 }
  },
  {
    id: 'great_hall',
    nameKo: '으뜸홀 · 중앙 로비',
    nameEn: 'Great Hall & Lobby',
    floor: '1F 남측 출입구',
    descKo: '국립중앙박물관 남측 입구 및 중앙 안내 데스크',
    bounds: { minLx: -23.0, maxLx: 23.0, minLz: 43.0, maxLz: 68.0 }
  },
  {
    id: 'west_gallery',
    nameKo: '선사·고대·공예 명품 회랑',
    nameEn: 'West Artifact Arcade',
    floor: '1F 서측 전시회랑',
    descKo: '신라 금관 · 백제 금동대향로 · 고려 청자 · 조선 백자 진열장',
    bounds: { minLx: -23.0, maxLx: -10.5, minLz: -48.0, maxLz: 43.0 }
  },
  {
    id: 'east_gallery',
    nameKo: '중·근세 · 서화 명품 회랑',
    nameEn: 'East Heritage Arcade',
    floor: '1F 동측 전시회랑',
    descKo: '청자·백자 명품 및 금속·불교 조각 진열장',
    bounds: { minLx: 10.5, maxLx: 23.0, minLz: -48.0, maxLz: 43.0 }
  },
  {
    id: 'path_of_history',
    nameKo: '역사의 길 (중앙 홀)',
    nameEn: 'Path of History',
    floor: '1F 중앙 아트리움',
    descKo: '국립중앙박물관을 남북으로 관통하는 대표 중앙 전시 회랑',
    bounds: { minLx: -23.0, maxLx: 23.0, minLz: -68.0, maxLz: 68.0 }
  }
]);

function getMuseumZoneAt(x, z) {
  const { lx, lz } = worldToMuseum(x, z);
  for (const zone of MUSEUM_ZONES) {
    const b = zone.bounds;
    if (lx >= b.minLx && lx <= b.maxLx && lz >= b.minLz && lz <= b.maxLz) {
      return zone;
    }
  }
  return MUSEUM_ZONES[MUSEUM_ZONES.length - 1];
}

// Curated Korean National Treasure exhibits inside the museum
const MUSEUM_EXHIBITS = Object.freeze([
  {
    id: 'gyeongcheonsa_pagoda',
    kind: 'pagoda',
    nameKo: '경천사지 십층석탑',
    nameEn: 'Ten-Story Stone Pagoda of Gyeongcheonsa',
    treasureNo: '국보',
    era: '고려 1348년',
    lx: 0,
    lz: -40,
    radius: 5.2
  },
  {
    id: 'pensive_78',
    kind: 'bodhisattva',
    nameKo: '금동미륵보살반가사유상 (국보 78호)',
    nameEn: 'Gilt-Bronze Pensive Bodhisattva (NT 78)',
    treasureNo: '국보',
    era: '삼국시대 6세기 후반',
    lx: 18.2,
    lz: -3.2,
    radius: 1.5
  },
  {
    id: 'pensive_83',
    kind: 'bodhisattva',
    nameKo: '금동미륵보살반가사유상 (국보 83호)',
    nameEn: 'Gilt-Bronze Pensive Bodhisattva (NT 83)',
    treasureNo: '국보',
    era: '삼국시대 7세기 전반',
    lx: 18.2,
    lz: 3.2,
    radius: 1.5
  },
  {
    id: 'silla_gold_crown',
    kind: 'crown',
    nameKo: '황남대총 북분 금관',
    nameEn: 'Gold Crown of Silla',
    treasureNo: '국보',
    era: '신라 5세기',
    lx: -15.5,
    lz: 26,
    radius: 1.4
  },
  {
    id: 'baekje_incense_burner',
    kind: 'incense',
    nameKo: '백제 금동대향로',
    nameEn: 'Gilt-Bronze Incense Burner of Baekje',
    treasureNo: '국보',
    era: '백제 6세기',
    lx: -15.5,
    lz: 10,
    radius: 1.4
  },
  {
    id: 'goryeo_celadon',
    kind: 'celadon',
    nameKo: '청자 상감운학문 매병',
    nameEn: 'Inlaid Celadon Maebyeong',
    treasureNo: '국보',
    era: '고려 12세기',
    lx: -15.5,
    lz: -6,
    radius: 1.4
  },
  {
    id: 'joseon_moon_jar',
    kind: 'moonjar',
    nameKo: '백자 달항아리',
    nameEn: 'White Porcelain Moon Jar',
    treasureNo: '보물',
    era: '조선 18세기',
    lx: -15.5,
    lz: -22,
    radius: 1.4
  },
  {
    id: 'gilt_buddha',
    kind: 'buddha',
    nameKo: '연가7년명 금동여래입상',
    nameEn: 'Gilt-Bronze Standing Buddha',
    treasureNo: '국보',
    era: '고구려 539년',
    lx: 15.5,
    lz: 26,
    radius: 1.4
  },
  {
    id: 'blue_white_jar',
    kind: 'bluejar',
    nameKo: '백자 청화매죽문 항아리',
    nameEn: 'Blue-and-White Porcelain Jar',
    treasureNo: '국보',
    era: '조선 15세기',
    lx: 15.5,
    lz: -22,
    radius: 1.4
  }
]);

// Indoor teleport destinations (local coordinates -> world coordinates, heading in radians; PI faces north toward Pagoda)
const MUSEUM_TELEPORT_SPECS = Object.freeze({
  museum_lobby: {
    lx: 0,
    lz: 48,
    heading: Math.PI,
    nameKo: '으뜸홀 · 중앙 로비',
    subKo: '1F 남측 출입구 · 역사의 길 시작점'
  },
  museum_path: {
    lx: 0,
    lz: 12,
    heading: Math.PI,
    nameKo: '역사의 길 (Path of History)',
    subKo: '1F 중앙 아트리움 · 전시 회랑 중심'
  },
  museum_pagoda: {
    lx: 0,
    lz: -24,
    heading: Math.PI,
    nameKo: '경천사지 십층석탑 광장',
    subKo: '1F 북단 아트리움 · 국보 대리석 석탑'
  },
  museum_contemplation: {
    lx: 12.6,
    lz: 0,
    heading: Math.PI * 0.5,
    nameKo: '사유의 방 (반가사유상)',
    subKo: '1F 동관 명상실 · 국보 78호·83호'
  },
  museum_craft: {
    lx: -10.8,
    lz: 10,
    heading: -Math.PI * 0.5,
    nameKo: '신라 금관 · 고려 청자 회랑',
    subKo: '1F 서측 명품 진열장'
  }
});

const MUSEUM_TELEPORTS = Object.freeze(
  Object.fromEntries(
    Object.entries(MUSEUM_TELEPORT_SPECS).map(([key, spec]) => {
      const world = museumToWorld(spec.lx, spec.lz);
      return [key, { x: world.x, z: world.z, heading: spec.heading, ...spec }];
    })
  )
);

// Colonnade pier Z positions along both sides of the Path of History (x = ±10.2)
const COLONNADE_ZS = Object.freeze([-52, -36, -20, -4, 12, 28, 44]);

// Build static AABB colliders in world coordinates so the walking player cannot pass through
// stone pillars, display vitrines, the Ten-Story Pagoda plinth, benches, info desk, or sanctuary walls.
function makeLocalBoxCollider(lx, lz, width, depth, maxY = 17.5, minY = 0) {
  const hw = width * 0.5;
  const hd = depth * 0.5;
  return {
    minX: MUSEUM_ORIGIN.x + lx - hw,
    maxX: MUSEUM_ORIGIN.x + lx + hw,
    minZ: MUSEUM_ORIGIN.z + lz - hd,
    maxZ: MUSEUM_ORIGIN.z + lz + hd,
    minY,
    maxY,
    isMuseum: true
  };
}

const MUSEUM_COLLIDERS = Object.freeze((() => {
  const list = [];

  // 1. Monumental colonnade stone pillars lining the Path of History (x = ±10.2)
  for (const lz of COLONNADE_ZS) {
    list.push(makeLocalBoxCollider(-10.2, lz, 1.55, 1.55, 17.5));
    // Keep the central archway into the Room of Quiet Contemplation clear (lz = -4..+12 on east side)
    if (lz !== -4 && lz !== 12) {
      list.push(makeLocalBoxCollider(10.2, lz, 1.55, 1.55, 17.5));
    }
  }

  // 2. Ten-Story Stone Pagoda podium & protective glass rail (center at 0, -40)
  list.push(makeLocalBoxCollider(0, -40, 8.8, 8.8, 14.2));

  // 3. Great Hall information counter (off-center right at lobby south)
  list.push(makeLocalBoxCollider(6.8, 56, 6.2, 2.2, 1.25));

  // 4. Museum benches along the Path of History
  for (const lz of [22, -14]) {
    list.push(makeLocalBoxCollider(-6.2, lz, 1.1, 3.6, 0.9));
    list.push(makeLocalBoxCollider(6.2, lz, 1.1, 3.6, 0.9));
  }

  // 5. Display Vitrines along West & East arcades
  const vitrinePositions = [
    [-15.5, 26], [-15.5, 10], [-15.5, -6], [-15.5, -22],
    [15.5, 26], [15.5, -22]
  ];
  for (const [lx, lz] of vitrinePositions) {
    list.push(makeLocalBoxCollider(lx, lz, 2.5, 2.5, 3.3));
  }

  // 6. Room of Quiet Contemplation (사유의 방) partition walls (east chamber x = 11..23, z = -13.5..+13.5)
  // North wall of chamber
  list.push(makeLocalBoxCollider(17.0, -13.2, 12.2, 0.8, 7.4));
  // South wall of chamber
  list.push(makeLocalBoxCollider(17.0, 13.2, 12.2, 0.8, 7.4));
  // West partition wall with a wide 6.8m central entrance archway (z = -3.4 .. +3.4)
  list.push(makeLocalBoxCollider(11.1, -8.4, 0.8, 9.6, 7.4));
  list.push(makeLocalBoxCollider(11.1, 8.4, 0.8, 9.6, 7.4));
  // Twin Pensive Bodhisattva pedestals inside the chamber
  list.push(makeLocalBoxCollider(18.2, -3.2, 2.4, 2.4, 2.6));
  list.push(makeLocalBoxCollider(18.2, 3.2, 2.4, 2.4, 2.6));

  return list;
})());

// Calibrated indoor skylight & gallery lighting moods by time-of-day preset
const MUSEUM_LIGHTING_MOODS = Object.freeze({
  golden: {
    id: 'golden',
    labelKo: '오후 자연광 (노을)',
    backgroundHex: 0x1b1714,
    fogHex: 0x241e19,
    fogDensity: 0.0042,
    skylightColor: 0xffd7a8,
    skylightIntensity: 1.55,
    ambientColor: 0xd8c9b8,
    ambientIntensity: 0.78,
    spotIntensity: 3.1,
    skylightGlow: 1.15
  },
  midday: {
    id: 'midday',
    labelKo: '주간 아트리움 채광',
    backgroundHex: 0x201e1c,
    fogHex: 0x2b2824,
    fogDensity: 0.0034,
    skylightColor: 0xfff8ee,
    skylightIntensity: 1.95,
    ambientColor: 0xe6e2dc,
    ambientIntensity: 0.96,
    spotIntensity: 2.6,
    skylightGlow: 1.55
  },
  twilight: {
    id: 'twilight',
    labelKo: '황혼 갤러리 조명',
    backgroundHex: 0x14151c,
    fogHex: 0x1b1c24,
    fogDensity: 0.0048,
    skylightColor: 0x9fb8e0,
    skylightIntensity: 0.88,
    ambientColor: 0xb9c2d6,
    ambientIntensity: 0.56,
    spotIntensity: 3.85,
    skylightGlow: 0.72
  },
  midnight: {
    id: 'midnight',
    labelKo: '야간 개장 스포트라이트',
    backgroundHex: 0x0d0d11,
    fogHex: 0x121218,
    fogDensity: 0.0054,
    skylightColor: 0x4c5d7e,
    skylightIntensity: 0.42,
    ambientColor: 0x8d8882,
    ambientIntensity: 0.38,
    spotIntensity: 4.6,
    skylightGlow: 0.24
  }
});

function getMuseumLightingMood(timeId) {
  return MUSEUM_LIGHTING_MOODS[timeId] || MUSEUM_LIGHTING_MOODS.midday;
}

export {
  MUSEUM_ORIGIN,
  MUSEUM_HALL,
  MUSEUM_BOUNDS,
  MUSEUM_ZONES,
  MUSEUM_EXHIBITS,
  MUSEUM_TELEPORT_SPECS,
  MUSEUM_TELEPORTS,
  MUSEUM_COLLIDERS,
  MUSEUM_LIGHTING_MOODS,
  COLONNADE_ZS,
  CITY_ALLOWED_MODES,
  museumToWorld,
  worldToMuseum,
  getAllowedModesForCity,
  isModeAllowedInCity,
  resolveModeForCity,
  getMuseumZoneAt,
  getMuseumLightingMood
};
