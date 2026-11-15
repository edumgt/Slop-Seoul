const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModule } = require('./helpers/module.cjs');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');

let ROADS, NYC_LANDMARKS, SEJONG_GOV_ROADS, TELEPORT_LOCATIONS, CITY_REGIONS,
  getCityRegion, inferCityFromCoords, getCityLandmarks, getCityTeleports, getLocationLabel;
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
    getLocationLabel
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
  assert.deepEqual(Object.keys(CITY_REGIONS).sort(), ['sejong', 'seoul']);
  assert.equal(getCityRegion('unknown').id, 'sejong');
  assert.equal(getCityRegion('seoul').id, 'seoul');

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
