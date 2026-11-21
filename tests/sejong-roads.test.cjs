const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModule } = require('./helpers/module.cjs');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');

let ROADS, NYC_LANDMARKS, SEJONG_GOV_ROADS, TELEPORT_LOCATIONS, CITY_REGIONS,
  getCityRegion, inferCityFromCoords, getCityLandmarks, getCityTeleports, getLocationLabel, nearestRoads;
test.before(async () => {
  ({
    ROADS,
    NYC_LANDMARKS,
    SEJONG_GOV_ROADS,
    TELEPORT_LOCATIONS,
    CITY_REGIONS,
    getCityRegion,
    inferCityFromCoords,
    getCityLandmarks,
    getCityTeleports,
    getLocationLabel,
    nearestRoads
  } = await import('../js/city-config.js'));
});

test('SEJONG_GOV_ROADS defines Sejong administrative arteries present in ROADS', () => {
  assert.ok(Array.isArray(SEJONG_GOV_ROADS) && SEJONG_GOV_ROADS.length >= 6);
  const roadNames = ROADS.map((r) => r.name);
  for (const keyword of ['한누리대로', '다솜로', '절재로', '도움6로', '갈매로', '시청대로']) {
    assert.ok(
      roadNames.some((name) => name.includes(keyword)),
      `ROADS should contain Sejong government road matching "${keyword}"`
    );
  }
});

test('Sejong government landmarks and teleports are registered and labeled accurately', () => {
  const landmarkIds = new Set(NYC_LANDMARKS.map((lm) => lm.id));
  for (const id of ['sejong_complex', 'sejong_library', 'sejong_archives', 'sejong_pmo', 'sejong_cityhall']) {
    assert.ok(landmarkIds.has(id), `NYC_LANDMARKS should include ${id}`);
  }
  for (const tpId of ['sejong_complex', 'sejong_library', 'sejong_brt', 'sejong_pmo', 'sejong_cityhall']) {
    assert.ok(TELEPORT_LOCATIONS[tpId], `TELEPORT_LOCATIONS should include ${tpId}`);
  }

  const complexTp = TELEPORT_LOCATIONS.sejong_complex;
  const complexLabel = getLocationLabel(complexTp.x, complexTp.z);
  assert.ok(complexLabel.includes('정부세종청사'), `Expected 정부세종청사 in "${complexLabel}"`);

  const libraryTp = TELEPORT_LOCATIONS.sejong_library;
  const libraryRoadLabel = getLocationLabel(libraryTp.x, libraryTp.z);
  assert.ok(libraryRoadLabel.includes('국립도서관길'), `Expected 국립도서관길 in "${libraryRoadLabel}"`);

  const librarySite = NYC_LANDMARKS.find((lm) => lm.id === 'sejong_library');
  const librarySiteLabel = getLocationLabel(librarySite.x, librarySite.z);
  assert.ok(librarySiteLabel.includes('국립세종도서관'), `Expected 국립세종도서관 in "${librarySiteLabel}"`);
});

test('isSejongGovCoordinate identifies Sejong government corridors vs unrelated districts', () => {
  const trafficSource = read('js/traffic.js');
  const fnMatch = trafficSource.match(/function isSejongGovCoordinate\([\s\S]*?\n\}/);
  assert.ok(fnMatch, 'isSejongGovCoordinate must exist in js/traffic.js');
  const { isSejongGovCoordinate } = vm.runInNewContext(`${fnMatch[0]}\n({ isSejongGovCoordinate });`);

  assert.equal(isSejongGovCoordinate(159, -1204), true, '정부세종청사 central corridor');
  assert.equal(isSejongGovCoordinate(-110, -2430), true, '국립세종도서관 & 다솜/호수권');
  assert.equal(isSejongGovCoordinate(469, 4799), true, '세종특별자치시청 보람동 행정타운');
  assert.equal(isSejongGovCoordinate(0, 0), false, 'Teheran-ro origin is outside Sejong corridors');
  assert.equal(isSejongGovCoordinate(0, 2000), false, 'Midtown/lower blocks outside Sejong corridors');
});

test('GNB is relocated into vertical LNB (.hud-left / .toolbar-lnb) with right-opening popover', () => {
  const html = read('index.html');
  const css = read('css/style.css');
  const mainJs = read('js/main.js');

  assert.equal(html.includes('hud-top-right'), false, 'Old top-right GNB container must be removed from index.html');
  assert.match(html, /<aside[^>]*class="hud hud-left"[\s\S]*?id="hud-toolbar"[^>]*class="[^"]*toolbar-lnb/);
  assert.match(html, /id="teleport-popover"[^>]*data-side="right"/);
  assert.equal(css.includes('.hud-top-right'), false, 'Old .hud-top-right rule must be replaced in css/style.css');
  assert.match(css, /\.hud-left\s*\{/);
  assert.match(css, /\.toolbar-lnb\s*\{/);
  assert.match(css, /\.popover\[data-side='right'\]/);
  assert.match(mainJs, /pop\.dataset\.side === 'right'/);
});

test('Sejong and Seoul regions cleanly partition landmarks, teleports, coordinates, and fallback labels', () => {
  assert.deepEqual(Object.keys(CITY_REGIONS).sort(), ['museum', 'sejong', 'seoul']);
  assert.equal(getCityRegion('unknown').id, 'sejong');
  assert.equal(getCityRegion('seoul').id, 'seoul');
  assert.equal(getCityRegion('museum').id, 'museum');

  assert.equal(inferCityFromCoords(159, -1204), 'sejong');
  assert.equal(inferCityFromCoords(469, 4799), 'sejong');
  assert.equal(inferCityFromCoords(0, 0), 'seoul');

  const sejongLandmarks = getCityLandmarks('sejong');
  const seoulLandmarks = getCityLandmarks('seoul');
  assert.ok(sejongLandmarks.length >= 5);
  assert.ok(seoulLandmarks.length >= 10);
  assert.ok(sejongLandmarks.every((l) => l.city === 'sejong'));
  assert.ok(seoulLandmarks.every((l) => l.city === 'seoul'));

  const sejongTps = getCityTeleports('sejong').map((t) => t.id);
  const seoulTps = getCityTeleports('seoul').map((t) => t.id);
  assert.ok(sejongTps.includes('sejong_complex') && sejongTps.includes('sejong_cityhall'));
  assert.ok(seoulTps.includes('empire') && seoulTps.includes('timessq'));
  assert.equal(sejongTps.some((id) => seoulTps.includes(id)), false, 'Teleport destinations do not overlap between cities');

  assert.ok(getLocationLabel(0, -99999, 'sejong').includes('세종'));
  assert.ok(getLocationLabel(0, -99999, 'seoul').includes('서울'));
  assert.ok(getLocationLabel(99999, 99999, 'sejong').includes('금강'));
  assert.ok(getLocationLabel(99999, 99999, 'seoul').includes('한강'));
});

test('CAMERA_PRESETS and city UI elements provide distinct Sejong and Seoul views', () => {
  const { CAMERA_PRESETS } = loadModule(read('js/cameras.js'), {
    imports: { 'three/webgpu': {}, './landmarks.js': {} }
  });
  const follow = CAMERA_PRESETS.filter((p) => p.city === 'all');
  const sejong = CAMERA_PRESETS.filter((p) => p.city === 'sejong');
  const seoul = CAMERA_PRESETS.filter((p) => p.city === 'seoul');
  assert.equal(follow.length, 3);
  assert.ok(sejong.length >= 3, 'Sejong should have multiple scenic presets');
  assert.ok(seoul.length >= 5, 'Seoul should have multiple scenic presets');

  const html = read('index.html');
  const css = read('css/style.css');
  const mainJs = read('js/main.js');
  for (const id of ['city-sejong', 'city-seoul', 'fullmap-city-sejong', 'fullmap-city-seoul', 'tp-switch-city']) {
    assert.ok(html.includes(`id="${id}"`), `index.html missing #${id}`);
  }
  assert.match(html, /data-city-group="sejong"/);
  assert.match(html, /data-city-group="seoul"/);
  assert.match(css, /body\[data-city='sejong'\] \[data-city-group='seoul'\]/);
  assert.match(css, /body\[data-city='seoul'\] \[data-city-group='sejong'\]/);
  assert.match(mainJs, /function selectCity\(/);
  assert.match(mainJs, /querySelectorAll\(['"]\.city-btn\[data-city\]['"]\)/);
});

test('Sejong landmarks stay clear of roads & teleports, keep elevated skybridges high, and expose custom geometries', () => {
  class StubShape {
    constructor() { this.ops = []; }
    moveTo(x, y) { this.ops.push(['M', x, y]); }
    lineTo(x, y) { this.ops.push(['L', x, y]); }
    quadraticCurveTo(cx, cy, x, y) { this.ops.push(['Q', cx, cy, x, y]); }
    closePath() { this.ops.push(['Z']); }
  }
  class StubGeometry {
    constructor(type, args = {}) {
      this.type = type;
      this.args = args;
      this.attributes = { position: { count: 24 }, normal: { count: 24 }, uv: { count: 24 } };
    }
    translate() { return this; }
    rotateX() { return this; }
  }
  class StubObject3D {
    constructor() {
      this.children = [];
      this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; }, copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; } };
      this.rotation = { x: 0, y: 0, z: 0 };
    }
    add(child) { this.children.push(child); }
  }
  class StubMesh extends StubObject3D {
    constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
  }
  class StubVector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    clone() { return new StubVector3(this.x, this.y, this.z); }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    length() { return Math.hypot(this.x, this.y, this.z); }
  }
  class StubCurve3 {
    constructor(pts) { this.pts = pts; }
    getPoint(t) {
      const a = this.pts[0];
      const b = this.pts[this.pts.length - 1];
      return new StubVector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    }
  }
  const makeMat = (kind) => class { constructor(opts = {}) { this.kind = kind; Object.assign(this, opts); } };
  const stubThree = {
    Shape: StubShape,
    ExtrudeGeometry: class extends StubGeometry { constructor(shape, opts) { super('ExtrudeGeometry', { shape, opts }); } },
    BoxGeometry: class extends StubGeometry { constructor(...a) { super('BoxGeometry', a); } },
    CylinderGeometry: class extends StubGeometry { constructor(...a) { super('CylinderGeometry', a); } },
    PlaneGeometry: class extends StubGeometry { constructor(...a) { super('PlaneGeometry', a); } },
    TorusGeometry: class extends StubGeometry { constructor(...a) { super('TorusGeometry', a); } },
    Group: StubObject3D,
    Mesh: StubMesh,
    Vector3: StubVector3,
    CatmullRomCurve3: StubCurve3,
    CanvasTexture: class { constructor(canvas) { this.canvas = canvas; } },
    SRGBColorSpace: 'srgb',
    MeshStandardNodeMaterial: makeMat('standard'),
    MeshPhysicalNodeMaterial: makeMat('physical'),
    MeshBasicNodeMaterial: makeMat('basic')
  };
  const stubDoc = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        font: '',
        textAlign: '',
        textBaseline: '',
        fillRect() {},
        strokeRect() {},
        fillText() {}
      })
    })
  };

  const {
    SEJONG_BUILDING_LAYOUT,
    createOpenBookRoofGeometry,
    createCivicArcGeometry,
    buildSejongLandmarks
  } = loadModule(read('js/sejong-landmarks.js'), {
    imports: {
      'three/webgpu': stubThree,
      './sejong-lighting.js': { createSejongLightingSystem: () => null }
    },
    globals: { document: stubDoc }
  });

  // Custom architectural shapes produce valid curve/extrusion paths & UV/normal attributes
  const bookGeo = createOpenBookRoofGeometry(56, 33, 1.35);
  assert.equal(bookGeo.type, 'ExtrudeGeometry');
  assert.ok(bookGeo.args.shape.ops.filter((op) => op[0] === 'Q').length >= 4, 'Open-book roof must have curved quadratic arches');
  assert.ok(bookGeo.attributes.position && bookGeo.attributes.normal && bookGeo.attributes.uv);

  const arcGeo = createCivicArcGeometry(30, 52, Math.PI * 0.12, Math.PI * 1.48, 21);
  assert.equal(arcGeo.type, 'ExtrudeGeometry');
  assert.ok(arcGeo.args.shape.ops.length >= 58, 'Circular civic ring should sample inner & outer arcs smoothly');

  // Build Sejong landmarks and check colliders + batch exclusion set
  const root = new StubObject3D();
  const colliders = [];
  const mats = {
    limestoneTrimMat: { name: 'limestone' },
    stainlessSteelMat: { name: 'steel' },
    darkBronzeFrameMat: { name: 'bronze' },
    warmFloodMat: { name: 'flood' },
    landmarkSilverCurtainMat: { name: 'silverCurtain' },
    landmarkBronzeCurtainMat: { name: 'bronzeCurtain' }
  };
  const exclude = buildSejongLandmarks(root, colliders, mats);

  assert.equal(root.children.length, 6, 'Should mount all 6 Sejong landmark groups');
  assert.equal(colliders.length, 9, 'Should register 9 ground footprint colliders');
  assert.ok(exclude.has(mats.stainlessSteelMat), 'Stainless steel stays excluded from static batching');
  assert.equal(exclude.size, 7, 'Should exclude steel, translucent glass cube, and 5 canvas signs from batching');

  // Verify no teleport landing spot falls inside or within 3m of any Sejong collider
  for (const [tpId, tp] of Object.entries(TELEPORT_LOCATIONS)) {
    for (const c of colliders) {
      const inside = tp.x >= c.minX - 3 && tp.x <= c.maxX + 3 && tp.z >= c.minZ - 3 && tp.z <= c.maxZ + 3;
      assert.equal(inside, false, `Teleport ${tpId} (${tp.x}, ${tp.z}) overlaps collider [${c.minX}..${c.maxX}, ${c.minZ}..${c.maxZ}]`);
    }
  }

  // Verify road-grid Sejong complex/PMO/CityHall footprints stay >= 4m clear of adjacent roadways
  for (const key of ['complexNW', 'complexSW', 'complexNW2', 'complexNE', 'pmo', 'cityHall']) {
    const lot = SEJONG_BUILDING_LAYOUT[key];
    const samples = [
      [lot.minX, lot.minZ], [lot.maxX, lot.minZ],
      [lot.minX, lot.maxZ], [lot.maxX, lot.maxZ],
      [lot.cx, lot.minZ], [lot.cx, lot.maxZ],
      [lot.minX, lot.cz], [lot.maxX, lot.cz]
    ];
    for (const [sx, sz] of samples) {
      for (const hit of nearestRoads(sx, sz, 30)) {
        const clearance = hit.dist - hit.road.w * 0.5;
        assert.ok(
          clearance >= 4.0,
          `${key} perimeter (${sx}, ${sz}) too close to ${hit.road.name}: clearance=${clearance.toFixed(1)}m`
        );
      }
    }
  }

  // Verify skybridge spans maintain >= 17.5m vertical clearance above street level
  for (const br of SEJONG_BUILDING_LAYOUT.skybridges) {
    assert.ok(br.deckY >= 17.5, `Skybridge ${br.id} deckY ${br.deckY}m must clear street traffic`);
    for (const [, py] of br.points) {
      assert.ok(py >= 17.5, `Skybridge ${br.id} control point y=${py}m must stay >= 17.5m`);
    }
  }
});

test('Strict Sejong vs Seoul separation prevents cross-city road/landmark label leakage', () => {
  const seoulForbiddenInSejong = ['테헤란', '강남', '역삼', '선릉', '삼성', '코엑스', '서초', '한강', '올림픽', '봉은사', '학동'];
  const sejongForbiddenInSeoul = ['세종', '정부청사', '다솜', '한누리', '도움', '국무총리', '국무조정실', '갈매', '보듬', '금강', '국립도서관'];

  for (const tp of getCityTeleports('sejong')) {
    const label = getLocationLabel(tp.x, tp.z, 'sejong');
    for (const bad of seoulForbiddenInSejong) {
      assert.equal(label.includes(bad), false, `Sejong teleport "${tp.id}" leaked Seoul term "${bad}" in "${label}"`);
    }
  }
  const midtownAtOriginInSejong = getLocationLabel(0, 0, 'sejong');
  for (const bad of seoulForbiddenInSejong) {
    assert.equal(midtownAtOriginInSejong.includes(bad), false, `Sejong road at (0,0) leaked Seoul term "${bad}" in "${midtownAtOriginInSejong}"`);
  }

  for (const tp of getCityTeleports('seoul')) {
    const label = getLocationLabel(tp.x, tp.z, 'seoul');
    for (const bad of sejongForbiddenInSeoul) {
      assert.equal(label.includes(bad), false, `Seoul teleport "${tp.id}" leaked Sejong term "${bad}" in "${label}"`);
    }
  }
  const sejongComplexCoordsInSeoul = getLocationLabel(159, -1204, 'seoul');
  for (const bad of sejongForbiddenInSeoul) {
    assert.equal(sejongComplexCoordsInSeoul.includes(bad), false, `Seoul view at (159,-1204) leaked Sejong term "${bad}" in "${sejongComplexCoordsInSeoul}"`);
  }
});

test('landmarks.js and nyc-map.js separate SeoulLandmarks vs SejongLandmarks and map search/minimap per city', () => {
  const landmarksSrc = read('js/landmarks.js');
  assert.match(landmarksSrc, /seoulGroup\.name = ['"]SeoulLandmarks['"]/);
  assert.match(landmarksSrc, /sejongGroup\.name = ['"]SejongLandmarks['"]/);
  assert.match(landmarksSrc, /batchStaticGroupMeshes\(seoulGroup/);
  assert.match(landmarksSrc, /batchStaticGroupMeshes\(sejongGroup/);
  assert.match(landmarksSrc, /function setActiveCity\(cityId\)/);
  assert.match(landmarksSrc, /return \{ group, seoulGroup, sejongGroup, colliders, sejongLighting, setActiveCity \}/);

  const mapSrc = read('js/nyc-map.js');
  assert.match(mapSrc, /textByCity:\s*\{\s*sejong:\s*sejongText,\s*seoul:\s*seoulText\s*\}/);
  assert.match(mapSrc, /if \(!c \|\| c\.city !== this\.activeCity/);
  assert.match(mapSrc, /if \(lm\.city && lm\.city !== this\.activeCity\) continue;/);
  assert.equal(
    /const cityLandmarks[\s\S]*?\|\|\s*NYC_LANDMARKS\.find/.test(mapSrc),
    false,
    'Map search must not fall back to landmarks from the other city'
  );
});


