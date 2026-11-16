const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');

function makeNodeChain(op = 'node') {
  const fn = () => makeNodeChain(op);
  return new Proxy(fn, {
    get(target, prop) {
      if (prop === 'value') return target.value ?? 0;
      if (prop === 'op') return op;
      if (prop === 'then') return undefined;
      return makeNodeChain(String(prop));
    }
  });
}

function loadSejongLighting() {
  const makeMat = (kind) => class {
    constructor(opts = {}) {
      this.kind = kind;
      Object.assign(this, opts);
    }
  };
  const stubThree = {
    Color: class { constructor(v = 0) { this.v = v; } },
    Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } },
    MeshStandardNodeMaterial: makeMat('standard')
  };
  const tslFns = [
    'Fn', 'float', 'vec2', 'vec3', 'color',
    'floor', 'fract', 'sin', 'dot', 'max', 'clamp', 'mix',
    'step', 'smoothstep', 'abs', 'normalize', 'reflect', 'pow', 'fwidth'
  ];
  const stubTsl = {
    uniform: (val) => Object.assign(makeNodeChain('uniform'), { value: val }),
    positionWorld: makeNodeChain('positionWorld'),
    normalWorldGeometry: makeNodeChain('normalWorldGeometry'),
    cameraPosition: makeNodeChain('cameraPosition'),
    Fn: (bodyFn) => (..._args) => makeNodeChain('Fn')
  };
  for (const name of tslFns) {
    if (name !== 'Fn') stubTsl[name] = () => makeNodeChain(name);
  }
  const stubCityUniforms = {
    uSunColor: stubTsl.uniform(0xffca92),
    uSkyTopColor: stubTsl.uniform(0x2c568c),
    uSkyHorizonColor: stubTsl.uniform(0xebd1b5),
    uSkySunDir: stubTsl.uniform({ x: 0, y: 1, z: 0 })
  };

  return loadModule(read('js/sejong-lighting.js'), {
    imports: {
      'three/webgpu': stubThree,
      'three/tsl': stubTsl,
      './tsl-materials.js': { cityUniforms: stubCityUniforms }
    }
  });
}

test('SEJONG_LIGHTING_MODES cleanly contrasts daytime natural reflection vs night office illumination', () => {
  const { SEJONG_LIGHTING_MODES, getSejongLightingPreset, computeSejongLightingState } = loadSejongLighting();

  assert.deepEqual(Object.keys(SEJONG_LIGHTING_MODES).sort(), ['golden', 'midday', 'midnight', 'twilight']);

  const midday = computeSejongLightingState('midday');
  assert.equal(midday.mode, 'daylight-reflection');
  assert.equal(midday.officeIllumination, 0);
  assert.equal(midday.occupancyRatio, 0);
  assert.equal(midday.skybridgeIllumination, 0);
  assert.equal(midday.lobbyGlow, 0);
  assert.equal(midday.pergolaGlow, 0);
  assert.equal(midday.daylightReflection, 1.0);
  assert.ok(midday.glassReflectivity >= 0.94, 'Daytime glass should maintain strong sky reflection');
  assert.ok(midday.glassRoughness <= 0.08, 'Daytime glass should be crisp and smooth');

  const twilight = computeSejongLightingState('twilight');
  assert.equal(twilight.mode, 'evening-illumination');
  assert.ok(twilight.officeIllumination >= 0.8 && twilight.occupancyRatio >= 0.7);
  assert.ok(twilight.skybridgeIllumination > 0.7 && twilight.lobbyGlow > 0.9);

  const midnight = computeSejongLightingState('midnight');
  assert.equal(midnight.mode, 'night-office-illumination');
  assert.ok(midnight.officeIllumination > twilight.officeIllumination, 'Night office glow intensity exceeds dusk');
  assert.ok(midnight.occupancyRatio > 0.3 && midnight.occupancyRatio < 0.75, 'Late night uses realistic partial occupancy');
  assert.ok(midnight.daylightReflection < 0.15, 'Nighttime drops daytime sun reflection');

  assert.equal(getSejongLightingPreset('invalid').id, 'golden', 'Unknown time mode falls back to golden');
});

test('evaluateBuildingLightSchedule turns off all bays at midday and switches realistic office zones at night', () => {
  const { evaluateBuildingLightSchedule } = loadSejongLighting();

  let middayLit = 0;
  let twilightLit = 0;
  let midnightLit = 0;
  const temps = new Set();

  for (let wing = 0; wing < 4; wing++) {
    for (let floor = 1; floor <= 5; floor++) {
      for (let bay = 0; bay < 16; bay++) {
        if (evaluateBuildingLightSchedule(wing, floor, bay, 'midday').lit) middayLit++;
        if (evaluateBuildingLightSchedule(wing, floor, bay, 'twilight').lit) twilightLit++;
        const nightCell = evaluateBuildingLightSchedule(wing, floor, bay, 'midnight');
        if (nightCell.lit) {
          midnightLit++;
          temps.add(nightCell.colorTempK);
        }
      }
    }
  }

  assert.equal(middayLit, 0, 'Automated daylight sensor turns all Sejong office lights OFF at midday');
  assert.ok(twilightLit > 180, `Twilight should illuminate most bays (got ${twilightLit})`);
  assert.ok(midnightLit > 80 && midnightLit < 260, `Midnight should leave selective night-shift bays lit (got ${midnightLit})`);
  assert.ok(temps.has(3000) && temps.has(4500), 'Lit offices mix warm 3000K and cool-white 4500K luminaires');
});

test('createSejongLightingSystem exposes adaptive TSL materials and smoothly transitions between modes', () => {
  const { createSejongLightingSystem } = loadSejongLighting();
  const sys = createSejongLightingSystem('midday');

  for (const key of [
    'sejongSilverCurtainMat',
    'sejongBronzeCurtainMat',
    'sejongSkybridgeMat',
    'sejongLobbyGlowMat',
    'sejongPergolaGlowMat'
  ]) {
    assert.ok(sys.materials[key], `Missing material ${key}`);
    assert.ok(sys.materials[key].emissiveNode, `${key} must bind an emissiveNode`);
  }

  assert.equal(sys.getState().activeMode, 'daylight-reflection');
  assert.equal(sys.uniforms.uOfficeIllumination.value, 0);
  assert.equal(sys.uniforms.uDaylightReflection.value, 1.0);

  // Trigger automated switch to midnight and step simulation forward
  sys.setTimeOfDay('midnight');
  assert.equal(sys.getState().activeMode, 'night-office-illumination');
  assert.equal(sys.uniforms.uSwitchWave.value, 0, 'Mode transition resets sweep wave cleanly');

  const firstOffice = sys.uniforms.uOfficeIllumination.value;
  sys.update(0.2);
  const midOffice = sys.uniforms.uOfficeIllumination.value;
  assert.ok(midOffice > firstOffice, 'Office illumination ramps smoothly over dt');
  assert.ok(sys.uniforms.uDaylightReflection.value < 1.0, 'Daylight reflection dims smoothly during transition');

  for (let i = 0; i < 40; i++) sys.update(0.1);
  assert.ok(sys.uniforms.uOfficeIllumination.value > 1.2, 'Converges to night office illumination');
  assert.ok(sys.uniforms.uSkybridgeIllumination.value > 1.1, 'Skybridges converge to illuminated night corridor');
  assert.ok(sys.uniforms.uSwitchWave.value === 1.0, 'Sweep wave completes to 1.0');
});
