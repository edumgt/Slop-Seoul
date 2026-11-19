import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, positionView, metalness, roughness, vec2, vec4, smoothstep } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { createPostProcessing } from './post-processing.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import {
  getLocationLabel,
  isTypingInField,
  ROADS,
  NYC_LANDMARKS,
  TELEPORT_LOCATIONS,
  TELEPORT_CITY_MAP,
  getCityRegion,
  inferCityFromCoords
} from './city-config.js';
import { buildCityGrid } from './city-grid.js';
import { buildBoroughs } from './boroughs.js';
import { buildLandmarks } from './landmarks.js';
import { buildCityBlocks } from './buildings.js';
import { buildStreetDetails } from './street-details.js';
import { createTrafficSystem, createHighwayTraffic } from './traffic.js';
import { buildRoadPaint } from './road-paint.js';
import { ThirdPersonControllerManager } from './controllers.js';
import { TouchControls } from './touch-controls.js';
import { GamepadControls } from './gamepad-controls.js';
import { CameraSystem, CAMERA_PRESETS } from './cameras.js';
import { LightingSystem } from './lighting.js';
import { NYCMapSystem } from './nyc-map.js';
import { setupSceneCulling, updateSceneCulling } from './scene-culling.js';
import { CityAudioSystem } from './audio-system.js';
import { WeatherSystem } from './weather-system.js';

// Application setup, shader warm-up and frame loop.

async function initApp() {
  const container = document.getElementById('canvas-container');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingStatus = document.getElementById('loading-status');
  const loadingFill = document.getElementById('loading-progress');

  // One progress bar for the whole start-up. Each stage fills a share of it sized after its typical duration (the
  // "[init]" timings logged below, on an M1 MacBook Air; `data` is fetching the code and data before this runs, which
  // the stylesheet animates). The fill glides through a stage as a compositor transition, so it keeps moving while the
  // stage's synchronous work blocks the main thread, at the pace the earlier stages ran at on this machine.
  const STAGE_MS = {
    data: 1800, renderer: 50, lighting: 60, cityGrid: 1800, boroughs: 560, landmarks: 200, blocks: 2100,
    streetDetails: 2200, traffic: 860, roadPaint: 170, controllers: 50, culling: 730, ui: 50, postFX: 60,
    compile: 3900, warmup: 1950, gpu: 300
  };
  const stageNames = Object.keys(STAGE_MS);
  const totalStageMs = stageNames.reduce((sum, name) => sum + STAGE_MS[name], 0);
  const loadingStartedAt = performance.now();
  let loadingStage = { from: 0, to: STAGE_MS.data / totalStageMs };

  const setLoadingProgress = (p, seconds = 0.3) => {
    if (!loadingFill) return;
    loadingFill.style.animation = 'none';
    loadingFill.style.transition = `transform ${seconds}s ${seconds > 0.3 ? 'linear' : 'ease'}`;
    loadingFill.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
  };
  // Progress through the current stage, for stages that can measure it
  const setStageProgress = (f) => setLoadingProgress(loadingStage.from + (loadingStage.to - loadingStage.from) * f);

  function beginLoadingStage(message, name, glide = true) {
    if (loadingStatus) loadingStatus.textContent = message;
    const index = stageNames.indexOf(name);
    const before = stageNames.slice(0, index).reduce((sum, n) => sum + STAGE_MS[n], 0);
    loadingStage = { from: before / totalStageMs, to: (before + STAGE_MS[name]) / totalStageMs };
    if (!glide) return setLoadingProgress(loadingStage.from);
    const ranMs = before - STAGE_MS.data;
    const pace = ranMs >= 1000 ? Math.min(4, Math.max(0.5, (performance.now() - loadingStartedAt) / ranMs)) : 1;
    setLoadingProgress(loadingStage.to, (STAGE_MS[name] * pace) / 1000);
  }

  async function showLoadingStage(message, name, glide) {
    beginLoadingStage(message, name, glide);
    if (document.hidden) return;
    // Let the label paint before synchronous work. The timeout also lets hidden tabs keep loading.
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 100);
      requestAnimationFrame(() => {
        clearTimeout(timeout);
        setTimeout(resolve, 0);
      });
    });
  }

  await showLoadingStage('Initializing graphics...', 'renderer');

  // 1. Initialize Three.js WebGPURenderer with 32-bit float reversedDepthBuffer.
  // Firefox WebGL2 incurs a heavy renderbufferStorageMultisample + blitFramebuffer stall
  // on multisampled floating-point MRT post-processing render targets, so disable MSAA on Firefox.
  const isFirefox = typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);
  const isSoftwareGl = (() => {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param) || '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch {
      return false;
    }
  })();
  const renderer = new THREE.WebGPURenderer({
    antialias: !isFirefox && !isSoftwareGl,
    powerPreference: 'high-performance',
    reversedDepthBuffer: true
  });
  renderer.setPixelRatio(1.0);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.lighting = new ClusteredLighting(256, 32, 28, 48);
  container.appendChild(renderer.domElement);

  // Start-up phase timings (logged once as "[init] ...") to keep load-time regressions traceable
  let initTimings = [];
  let initMark = performance.now();
  const markInit = (label) => {
    const now = performance.now();
    initTimings.push(`${label} ${Math.round(now - initMark)}ms`);
    initMark = now;
  };

  await renderer.init();
  markInit('renderer');

  // 2. Scene, atmosphere and lighting
  await showLoadingStage('Creating sky and environment lighting...', 'lighting');
  const scene = new THREE.Scene();
  const lightingSystem = new LightingSystem(scene, renderer);
  const weatherSystem = new WeatherSystem(scene, lightingSystem);
  markInit('lighting');

  // 3. Build Manhattan Geography, Iconic Landmarks, Blocks, Street Details & Traffic
  await showLoadingStage('Building streets, parks and waterfronts...', 'cityGrid');
  const cityGrid = buildCityGrid(scene);
  markInit('cityGrid');
  await showLoadingStage('Building bridges and surrounding boroughs...', 'boroughs');
  const boroughs = buildBoroughs(scene, { sidewalks: cityGrid.sidewalks });
  markInit('boroughs');
  await showLoadingStage('Building landmarks...', 'landmarks');
  const { colliders: landmarkColliders, sejongLighting, setActiveCity: setLandmarksCity } = buildLandmarks(scene);
  if (sejongLighting) {
    const initSejongState = sejongLighting.setTimeOfDay(lightingSystem.activePresetId, { immediate: true });
    document.body.dataset.sejongLighting = initSejongState.activeMode;
  }
  markInit('landmarks');
  await showLoadingStage('Generating building footprints and facades...', 'blocks');
  const cityBlocks = buildCityBlocks(scene, landmarkColliders);
  markInit('blocks');
  const allColliders = [...landmarkColliders, ...cityBlocks.colliders, ...boroughs.colliders, ...(cityGrid.colliders || [])];

  await showLoadingStage('Placing trees, streetlights and street furniture...', 'streetDetails');
  const streetDetails = buildStreetDetails(scene, allColliders);
  markInit('streetDetails');
  await showLoadingStage('Creating traffic and pedestrian routes...', 'traffic');
  // Buildings turned along non-grid streets have oriented colliders whose world bounds reach past their lots: they stay
  // inside the property line anyway, so the road network (lanes & sidewalks) doesn't need them.
  // Elevated building sections that clear even a bus don't obstruct ground traffic.
  const trafficSystem = createTrafficSystem(scene, cityGrid.sidewalks, [
    ...cityGrid.footprints,
    ...streetDetails.footprints,
    ...allColliders.filter((c) => !c.obb && (c.minY ?? 0) < 3.5)
  ], streetDetails.signalIntersections);
  markInit('traffic');
  const highwayTraffic = createHighwayTraffic(scene, cityGrid.highwayLanes);
  await showLoadingStage('Adding road markings...', 'roadPaint');
  buildRoadPaint(scene, trafficSystem.network, cityGrid.roadPaint);
  markInit('roadPaint');

  // 4. Initialize Third-Person Controllers (Person, Car, Cyclist, Helicopter) & Multi-Camera System
  await showLoadingStage('Preparing player, vehicles and controls...', 'controllers');
  const controllerManager = new ThirdPersonControllerManager(scene, allColliders);
  // Reuse teleport placement so saved players return at rest, close to their last positions.
  let savedPlayerState = null;
  try {
    const saved = JSON.parse(localStorage.getItem('nyc-player-state'));
    if (saved?.version === 1) {
      savedPlayerState = saved;
      for (const mode of Object.keys(controllerManager.entities)) {
        const p = saved.entities?.[mode];
        if (!p || ![p.x, p.y, p.z, p.heading].every(Number.isFinite)) continue;
        controllerManager.setMode(mode);
        controllerManager.teleportActiveTo(p.x, p.z, p.heading, p.y);
      }
      controllerManager.setMode(Object.hasOwn(controllerManager.entities, saved.activeMode) ? saved.activeMode : 'car');
    }
  } catch { /* Missing or unavailable storage does not prevent playing. */ }

  let activeCity = 'sejong';
  if (savedPlayerState) {
    if (savedPlayerState.activeCity === 'sejong' || savedPlayerState.activeCity === 'seoul') {
      activeCity = savedPlayerState.activeCity;
    } else {
      const ent = controllerManager.getActiveEntity();
      activeCity = inferCityFromCoords(ent.position.x, ent.position.z);
    }
  }

  function savePlayerState() {
    try {
      const entities = Object.fromEntries(Object.entries(controllerManager.entities).map(([mode, entity]) => [mode, {
        x: entity.position.x, y: entity.position.y, z: entity.position.z, heading: entity.heading
      }]));
      localStorage.setItem('nyc-player-state', JSON.stringify({
        version: 1,
        activeCity,
        activeMode: controllerManager.activeMode,
        entities
      }));
    } catch { /* Storage may be disabled or full. */ }
  }

  const cameraSystem = new CameraSystem(renderer.domElement, controllerManager);
  const touchControls = new TouchControls(controllerManager);
  const soundButton = document.getElementById('btn-sound');
  const audioSystem = new CityAudioSystem({ controllerManager, trafficSystem, highwayTraffic, streetDetails }, {
    onStateChange: updateSoundButton
  });
  function updateSoundButton() {
    if (!soundButton) return;
    soundButton.disabled = !audioSystem.supported;
    soundButton.setAttribute('aria-pressed', String(audioSystem.enabled));
    soundButton.setAttribute('aria-label', audioSystem.enabled ? 'Mute sound' : 'Enable sound');
    soundButton.title = audioSystem.supported ? `${audioSystem.enabled ? 'Mute' : 'Enable'} sound [N]` : 'Web Audio is unavailable';
    soundButton.querySelector('use').setAttribute('href', audioSystem.enabled ? '#i-sound' : '#i-sound-off');
  }
  soundButton?.addEventListener('click', () => audioSystem.setEnabled(!audioSystem.enabled));
  updateSoundButton();
  // pagehide also covers navigation away on mobile; preserve the context across back-forward cache restores.
  window.addEventListener('pagehide', (event) => {
    savePlayerState();
    if (!event.persisted) audioSystem.dispose();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) savePlayerState(); });
  markInit('controllers');

  // Island-wide static geometry: chunk & distance-cull the small props, shadow stand-ins for the big casters
  // (scene-culling.js)
  await showLoadingStage('Preparing scene visibility and shadows...', 'culling');
  const cullingRoots = ['ManhattanCityGrid', 'ManhattanCityBlocks', 'ManhattanStreetDetails', 'ManhattanLandmarks', 'Boroughs', 'RoadMarkings']
    .map((name) => scene.getObjectByName(name))
    .filter(Boolean);
  const sceneCullingControl = setupSceneCulling(scene, cullingRoots, lightingSystem.sunLight.shadow);
  let worldCitySplitReady = false;
  function applyWorldCityVisibility(cityId) {
    if (!worldCitySplitReady) return;
    setLandmarksCity?.(cityId);
    sceneCullingControl?.setActiveCity(cityId);
  }

  // Initialize static world matrices once, including the chunks and shadow proxies created above.
  // Crowd, tree and building-detail animation changes instance/pose buffers, not Object3D transforms.
  const dynamicRoots = [
    trafficSystem.group,
    highwayTraffic.group,
    weatherSystem.group,
    scene.getObjectByName('StoreClusteredLights'),
    scene.getObjectByName('StreetClusteredLights'),
    ...Object.values(controllerManager.entities).map((entity) => entity.mesh),
    controllerManager.entities.cyclist.helmet
  ];
  scene.updateMatrixWorld(true);
  scene.matrixWorldAutoUpdate = false;
  markInit('culling');

  // 5. TSL RenderPipeline with Half-Res Screen Space Reflections (SSRNode), Bloom & Filmic Toning
  //    Fade out distant and matte surfaces so SSR spends its rays on visible glossy reflections.
  await showLoadingStage('Setting up visual effects, map and interface...', 'ui');
  const scenePass = pass(scene, cameraSystem.camera);
  // The multisampled colour attachments (output, normal, metalRough) only need resolving, never storing: discarding
  // them spares the GPU writing 3 x 4 samples per pixel to memory every frame (transient, memoryless attachments where
  // the browser supports them). The multisampled depth stays stored: SSR reads it.
  scenePass.renderTarget.storeMultisampledColorBuffer = false;
  const ssrFade = smoothstep(360.0, 180.0, positionView.z.negate());
  const maxSSRRoughness = 0.75;
  const sceneMRT = mrt({
    output: output,
    normal: normalView,
    metalRough: vec2(roughness.lessThan(maxSSRRoughness).select(metalness.mul(ssrFade), 0), roughness)
  });
  sceneMRT.setBlendMode('normal', new THREE.BlendMode(THREE.MaterialBlending));
  sceneMRT.setBlendMode('metalRough', new THREE.BlendMode(THREE.MaterialBlending));
  scenePass.setMRT(sceneMRT);

  const scenePassColor = scenePass.getTextureNode('output');
  const scenePassDepth = scenePass.getTextureNode('depth');
  const scenePassNormal = scenePass.getTextureNode('normal');
  const scenePassMetalRough = scenePass.getTextureNode('metalRough');

  let reflections = vec4(0);
  if (!isSoftwareGl) {
    const ssrPass = ssr(scenePassColor, scenePassDepth, scenePassNormal, {
      metalnessNode: scenePassMetalRough.r,
      roughnessNode: scenePassMetalRough.g,
      camera: cameraSystem.camera
    });
    ssrPass.resolutionScale = 0.5;
    ssrPass.blurQuality = 1;
    ssrPass.maxDistance.value = 42;
    ssrPass.thickness.value = 0.85;
    // Fewer coarse steps, then refine detected hits to keep reflection edges precise.
    ssrPass.quality.value = 0.25;
    ssrPass.binaryRefine = true;
    ssrPass.intensity.value = 0.50;
    ssrPass.screenEdgeFadeBlack = true;

    // Roughness mip blur must not spread reflections back onto matte or nonreflective surfaces.
    const reflectionMask = scenePassMetalRough.r.greaterThan(0).select(smoothstep(maxSSRRoughness, 0.55, scenePassMetalRough.g), 0);
    reflections = ssrPass.mul(reflectionMask);
  }
  const colorGrade = createPostProcessing(renderer, scenePassColor, reflections, {
    sceneDepth: scenePassDepth,
    sceneNormal: scenePassNormal,
    sceneMetalRough: scenePassMetalRough,
    camera: cameraSystem.camera,
    uLensRainIntensity: weatherSystem.uLensRainIntensity,
    uScreenFogShift: weatherSystem.uScreenFogShift,
    uScreenFogDensity: weatherSystem.uScreenFogDensity,
    uScreenFogHeight: weatherSystem.uScreenFogHeight,
    uSurfaceRippleIntensity: weatherSystem.uSurfaceRippleIntensity,
    uWeatherContrastShift: weatherSystem.uWeatherContrastShift,
    uWeatherSaturationShift: weatherSystem.uWeatherSaturationShift,
    uWeatherFogColor: weatherSystem.uWeatherFogColor,
    uLightningFlash: weatherSystem.uLightningFlash,
    uLightningIntensity: weatherSystem.uLightningIntensity,
    uLightningOrigin: weatherSystem.uLightningOrigin,
    skipBloom: isSoftwareGl
  });
  const renderPipeline = new THREE.RenderPipeline(renderer, colorGrade.outputNode);
  const renderFrame = () => renderPipeline.render();

  // 6. Wire UI Controls (Strictly using safe DOM APIs: textContent, classList, addEventListener)
  const cityButtons = document.querySelectorAll('.city-btn[data-city]');
  const modeButtons = document.querySelectorAll('[data-mode]');
  const cameraButtons = document.querySelectorAll('[data-camera]');
  const timeButtons = document.querySelectorAll('[data-time]');
  const weatherButtons = document.querySelectorAll('[data-weather]');
  const teleportButtons = document.querySelectorAll('[data-teleport]');
  const hudToggleBtn = document.getElementById('btn-toggle-hud');
  const modeSwitch = document.getElementById('mode-switch');
  touchControls.onAvailabilityChange = placeModeIndicator;

  const elBrandBadge = document.getElementById('brand-badge');
  const elBrandTitle = document.getElementById('brand-title');
  const elBrandSubtitleCity = document.getElementById('brand-subtitle-city');
  const elMinimapCard = document.getElementById('minimap-card');
  const elTrafficInfo = document.getElementById('hud-traffic-info');
  const tpSwitchCityBtn = document.getElementById('tp-switch-city');
  const elFps = document.getElementById('hud-fps');
  const elMode = document.getElementById('hud-active-mode');
  const elCamera = document.getElementById('hud-active-camera');
  const elSpeed = document.getElementById('hud-speed');
  const elSpeedMeter = document.getElementById('hud-speed-meter');
  const elAltitude = document.getElementById('hud-altitude');
  const elLocation = document.getElementById('hud-location');
  const elControlsHint = document.getElementById('hud-controls-hint');
  const elTrafficLabel = document.getElementById('hud-traffic-label');
  const elTrafficDot = document.getElementById('hud-traffic-dot');
  const gamepadControls = new GamepadControls(controllerManager, cameraSystem, {
    onCycleMode: (step) => {
      const modes = ['person', 'car', 'cyclist', 'helicopter'];
      selectMode(modes[(modes.indexOf(controllerManager.activeMode) + step + modes.length) % modes.length]);
    },
    onCycleCamera: cycleCamera,
    onToggleMap: () => mapSystem.toggleFullMap(!mapSystem.isFullMapOpen),
    onCloseMap: () => mapSystem.toggleFullMap(false)
  });

  // Keyboard guide for each mode: [keys, action]
  const controlHints = {
    person: [[['W', 'S'], '걷기 / 달리기'], [['A', 'D'], '방향 전환'], [['Space'], '점프'], [['드래그'], '시점 회전']],
    car: [[['W', 'S'], '가속 / 후진'], [['A', 'D'], '스티어링'], [['B'], '경적'], [['드래그'], '시점 회전']],
    cyclist: [[['W', 'S'], '페달 / 브레이크'], [['A', 'D'], '선회 & 린'], [['드래그'], '시점 회전']],
    helicopter: [[['W', 'S'], '피치 제어'], [['A', 'D'], '요(Yaw) 선회'], [['Space', 'E'], '상승'], [['Q', 'C'], '하강']]
  };
  // Top speeds in km/h (controllers.js caps them at 8.2, 36, 19 & 52 m/s): full scale of the speed meter
  const topSpeedKmh = { person: 30, car: 130, cyclist: 68, helicopter: 187 };

  function renderControlHints(mode) {
    if (!elControlsHint) return;
    const items = (controlHints[mode] || []).map(([keys, action]) => {
      const item = document.createElement('span');
      item.className = 'hint';
      for (const key of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        item.appendChild(kbd);
      }
      const label = document.createElement('span');
      label.className = 'hint-label';
      label.textContent = action;
      item.appendChild(label);
      return item;
    });
    elControlsHint.replaceChildren(...items);
  }

  // The taxi-yellow pill under the selected mode glides from button to button
  function placeModeIndicator() {
    const active = modeSwitch ? modeSwitch.querySelector('.mode-btn.active') : null;
    if (!active) return;
    modeSwitch.style.setProperty('--ind-x', `${active.offsetLeft}px`);
    modeSwitch.style.setProperty('--ind-w', `${active.offsetWidth}px`);
  }

  const CITY_VEHICLE_LABELS = {
    sejong: {
      person: { btnLabel: '도보', btnTitle: '세종 도보 (보행자) [1]', hudLabel: '도보 (Sejong Walk)' },
      car: { btnLabel: '세종 택시', btnTitle: '세종 행복택시 [2]', hudLabel: '세종 택시 (Sejong Taxi)' },
      cyclist: { btnLabel: '어울링', btnTitle: '세종 어울링 자전거 [3]', hudLabel: '세종 어울링 (Eoulling)' },
      helicopter: { btnLabel: '헬기', btnTitle: '금강·세종 투어 헬기 [4]', hudLabel: '금강·세종 헬기 (Helicopter)' }
    },
    seoul: {
      person: { btnLabel: '도보', btnTitle: '서울 도보 (보행자) [1]', hudLabel: '도보 (Seoul Walk)' },
      car: { btnLabel: '서울 택시', btnTitle: '서울 택시 [2]', hudLabel: '서울 택시 (Seoul Taxi)' },
      cyclist: { btnLabel: '따릉이', btnTitle: '서울 따릉이 [3]', hudLabel: '서울 따릉이 (Ddareungi)' },
      helicopter: { btnLabel: '헬기', btnTitle: '한강·테헤란 헬기 [4]', hudLabel: '한강·테헤란 헬기 (Helicopter)' }
    }
  };

  function updateVehicleLabelsForCity(cityId) {
    const labels = CITY_VEHICLE_LABELS[cityId] || CITY_VEHICLE_LABELS.sejong;
    modeButtons.forEach((btn) => {
      const m = btn.getAttribute('data-mode');
      const spec = labels[m];
      if (!spec) return;
      btn.title = spec.btnTitle;
      const span = btn.querySelector('.mode-label');
      if (span) span.textContent = spec.btnLabel;
    });
    const activeSpec = labels[controllerManager.activeMode];
    if (elMode) elMode.textContent = activeSpec ? activeSpec.hudLabel : controllerManager.getActiveEntity().label;
    placeModeIndicator();
  }

  function selectMode(mode) {
    controllerManager.setMode(mode);
    touchControls.setMode(controllerManager.activeMode);
    gamepadControls.reset();
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
    document.body.dataset.mode = mode;
    updateVehicleLabelsForCity(activeCity);
    renderControlHints(mode);

    // If currently on a static scenic camera, switch to 3rd-Person Chase so user sees their selected character/vehicle
    const currentCam = cameraSystem.getActivePreset();
    if (currentCam.category !== 'follow') {
      selectCamera('chase', false);
    }
  }

  function selectCamera(camId, snap = false) {
    cameraSystem.setCameraPreset(camId, snap);
    cameraButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-camera') === camId);
    });
    const preset = cameraSystem.getActivePreset();
    if (elCamera) elCamera.textContent = preset.name;
  }

  // Steps through follow cameras + scenic cameras of the active city
  function cycleCamera(step) {
    const allowed = CAMERA_PRESETS.filter((p) => p.city === 'all' || p.city === activeCity);
    const n = allowed.length || CAMERA_PRESETS.length;
    const pool = allowed.length ? allowed : CAMERA_PRESETS;
    const idx = pool.findIndex((p) => p.id === cameraSystem.activePresetId);
    const nextIdx = idx < 0 ? 0 : (idx + step + n) % n;
    selectCamera(pool[nextIdx].id, true);
  }

  function updateTrafficHud() {
    if (!elTrafficLabel || !trafficSystem?.getCongestionStats) return;
    const where = cameraSystem.getActivePreset().category === 'follow'
      ? controllerManager.getActiveEntity().position
      : cameraSystem.currentPos;
    const stats = trafficSystem.getCongestionStats(where, activeCity);
    elTrafficLabel.textContent = `${stats.segmentNameKo} · ${stats.levelLabel} (${stats.levelLabelKo}) · ${stats.segmentSpeedKmh}km/h`;
    if (elTrafficDot) {
      elTrafficDot.className = `traffic-dot ${stats.congestionLevel}`;
    }
    if (elTrafficInfo) {
      elTrafficInfo.dataset.trafficLevel = stats.congestionLevel;
      elTrafficInfo.dataset.trafficSegment = stats.segmentId;
      elTrafficInfo.title = `${stats.segmentNameKo} (${stats.segmentNameEn}) · ${stats.levelLabel} (${stats.levelLabelKo}) · ${stats.activeVehicles}대`;
    }
  }

  function selectCity(cityId, { teleport = true, syncMap = true } = {}) {
    const region = getCityRegion(cityId);
    activeCity = region.id;
    document.body.dataset.city = activeCity;
    applyWorldCityVisibility(activeCity);
    if (streetDetails.setCity) streetDetails.setCity(activeCity);

    cityButtons.forEach((btn) => {
      const isActive = btn.getAttribute('data-city') === activeCity;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
    if (elBrandBadge) elBrandBadge.textContent = region.badge;
    if (elBrandTitle) elBrandTitle.textContent = region.brandTitle;
    if (elBrandSubtitleCity) elBrandSubtitleCity.textContent = region.subtitle;
    if (elMinimapCard) {
      elMinimapCard.setAttribute('aria-label', `${region.name} 실시간 레이더 미니맵`);
      elMinimapCard.title = `${region.name} 전체 지도 열기 [M]`;
    }
    if (elTrafficInfo) {
      elTrafficInfo.title = `${region.trafficCorridor} 실시간 교통 밀도 및 정체 수준`;
    }
    if (tpSwitchCityBtn) {
      const nextRegion = getCityRegion(activeCity === 'sejong' ? 'seoul' : 'sejong');
      const nameEl = tpSwitchCityBtn.querySelector('.pop-name');
      const subEl = tpSwitchCityBtn.querySelector('.pop-sub');
      if (nameEl) nameEl.textContent = `${nextRegion.shortName} 랜드마크로 전환 →`;
      if (subEl) subEl.textContent = nextRegion.trafficCorridor;
    }

    updateVehicleLabelsForCity(activeCity);

    const activePreset = cameraSystem.getActivePreset();
    if (activePreset && activePreset.city && activePreset.city !== 'all' && activePreset.city !== activeCity) {
      selectCamera('chase', true);
    }

    if (syncMap) {
      mapSystem.setActiveCity(activeCity, teleport);
    }

    if (teleport) {
      const loc = TELEPORT_LOCATIONS[region.defaultTeleport];
      if (loc) {
        teleportTo(loc.x, loc.z, loc.heading);
      }
    }

    updateTrafficHud();
    locationText = '';
    const where = cameraSystem.getActivePreset().category === 'follow'
      ? controllerManager.getActiveEntity().position
      : cameraSystem.currentPos;
    renderLocation(getLocationLabel(where.x, where.z, activeCity));
    savePlayerState();
  }

  function selectWeather(weatherId) {
    weatherSystem.setWeather(weatherId);
    weatherButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-weather') === weatherId);
    });
  }

  function selectTime(timeId) {
    lightingSystem.applyPreset(timeId);
    if (colorGrade) colorGrade.applyPreset(lightingSystem.activePresetId);
    if (trafficSystem?.setTimeOfDay) {
      trafficSystem.setTimeOfDay(timeId);
    }
    if (weatherSystem) {
      weatherSystem.applyWeather(weatherSystem.getWeather(), timeId);
    }
    if (sejongLighting) {
      const sejongState = sejongLighting.setTimeOfDay(timeId);
      document.body.dataset.sejongLighting = sejongState.activeMode;
    }
    timeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-time') === timeId);
    });
    updateTrafficHud();
  }

  // Popovers (native [popover]: light dismiss & Esc for free) open against the control that toggles them: data-anchor
  // names the element they sit above / below, data-align the one whose right edge they line up with
  const popovers = document.querySelectorAll('.popover[popover]');
  const supportsPopover = typeof HTMLElement.prototype.togglePopover === 'function';
  function closePopovers() {
    if (!supportsPopover) return;
    popovers.forEach((pop) => {
      if (pop.matches(':popover-open')) pop.hidePopover();
    });
  }
  popovers.forEach((pop) => {
    const invoker = document.querySelector(`[popovertarget="${pop.id}"]`);
    pop.addEventListener('beforetoggle', (e) => {
      const open = e.newState === 'open';
      if (invoker) invoker.classList.toggle('is-open', open);
      if (!open) return;
      const anchor = document.getElementById(pop.dataset.anchor) || invoker;
      const align = document.getElementById(pop.dataset.align) || invoker;
      if (!anchor || !align) return;
      const r = anchor.getBoundingClientRect();
      const ar = align.getBoundingClientRect();
      if (pop.dataset.side === 'right') {
        const left = Math.min(window.innerWidth - 292, ar.right + 10);
        const top = Math.max(12, Math.min(window.innerHeight - 240, r.top));
        pop.style.right = 'auto';
        pop.style.bottom = 'auto';
        pop.style.left = `${Math.max(8, left)}px`;
        pop.style.top = `${top}px`;
        pop.style.maxHeight = `${Math.max(160, window.innerHeight - top - 16)}px`;
        return;
      }
      const spaceAbove = Math.max(0, r.top - 20);
      const spaceBelow = Math.max(0, window.innerHeight - r.bottom - 20);
      let above = pop.dataset.side === 'above';
      // The camera control moves to the top on touch screens; open toward the available space.
      if ((above ? spaceAbove : spaceBelow) < 160) above = spaceAbove > spaceBelow;
      pop.style.left = 'auto';
      pop.style.right = `${Math.max(8, window.innerWidth - ar.right)}px`;
      if (above) {
        pop.style.top = 'auto';
        pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
        pop.style.maxHeight = `${spaceAbove}px`;
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = `${r.bottom + 8}px`;
        pop.style.maxHeight = `${spaceBelow}px`;
      }
    });
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectMode(btn.getAttribute('data-mode'));
    });
  });

  cameraButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectCamera(btn.getAttribute('data-camera'), true);
      closePopovers();
    });
  });

  const camPrevBtn = document.getElementById('cam-prev');
  const camNextBtn = document.getElementById('cam-next');
  if (camPrevBtn) camPrevBtn.addEventListener('click', () => cycleCamera(-1));
  if (camNextBtn) camNextBtn.addEventListener('click', () => cycleCamera(1));

  timeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectTime(btn.getAttribute('data-time'));
    });
  });

  weatherButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectWeather(btn.getAttribute('data-weather'));
    });
  });

  // A mouse click mustn't leave the focus on a HUD button, or Space (jump / ascend) and Enter would press it again
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (btn && e.detail > 0) btn.blur();
  });

  // Where you are: the place's name over its street corner, drawn as a pair of city street-name signs
  const roadNames = new Set(ROADS.flatMap((r) => [r.name, r.sejongName, r.seoulName].filter(Boolean)));
  const placeNames = new Set(NYC_LANDMARKS.map((l) => l.name));
  let locationText = '';
  function renderLocation(label) {
    if (!elLocation || label === locationText) return;
    locationText = label;
    let place = '';
    let streets = label;
    let split = -1;
    for (let i = 0, depth = 0; i < label.length; i++) {
      const ch = label[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && label.startsWith(' · ', i)) {
        split = i;
        break;
      }
    }
    if (split >= 0) {
      place = label.slice(0, split);
      streets = label.slice(split + 3);
    } else if (placeNames.has(label) || (!label.includes(' & ') && !roadNames.has(label))) {
      place = label;
      streets = '';
    }
    const nodes = [];
    if (place) {
      const el = document.createElement('div');
      el.className = 'location-place';
      el.textContent = place;
      nodes.push(el);
    }
    if (streets) {
      const row = document.createElement('div');
      row.className = 'location-signs';
      if (streets.startsWith('near ')) {
        streets = streets.slice(5);
        const near = document.createElement('span');
        near.className = 'location-near';
        near.textContent = 'near';
        row.appendChild(near);
      }
      for (const name of streets.split(' & ')) {
        const sign = document.createElement('span');
        sign.className = 'street-sign';
        sign.textContent = name;
        row.appendChild(sign);
      }
      nodes.push(row);
    }
    elLocation.replaceChildren(...nodes);
  }

  function teleportTo(x, z, heading = Math.PI) {
    const cityScope = typeof activeCity === 'string' ? activeCity : undefined;
    const destination = controllerManager.teleportActiveTo(x, z, heading);
    touchControls.reset();
    gamepadControls.reset();
    cameraSystem.resetForTeleport();
    selectCamera('chase', true);
    mapSystem.waypoint = {
      x: destination.x,
      z: destination.z,
      name: getLocationLabel(destination.x, destination.z, cityScope)
    };
    if (typeof renderLocation === 'function') {
      renderLocation(getLocationLabel(destination.x, destination.z, cityScope));
    }
    if (typeof updateTrafficHud === 'function') {
      updateTrafficHud();
    }
    return destination;
  }

  const mapSystem = new NYCMapSystem({
    controllerManager,
    cameraSystem,
    allBlocks: cityBlocks.allBlocks,
    onToggle: (open) => {
      controllerManager.resetInput();
      touchControls.setEnabled(!open);
      gamepadControls.setEnabled(!open);
      const mapHint = document.getElementById('fullmap-hover-info');
      if (open && touchControls.available && mapHint) {
        mapHint.textContent = 'Tap to teleport · Drag to pan · Use + / − to zoom';
      }
    },
    onTeleport: teleportTo
  });

  teleportButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-teleport');
      if (typeof TELEPORT_CITY_MAP !== 'undefined' && typeof selectCity === 'function') {
        const targetCity = TELEPORT_CITY_MAP[key] || 'seoul';
        if (targetCity !== activeCity) {
          selectCity(targetCity, { teleport: false, syncMap: true });
        }
      }
      const loc = TELEPORT_LOCATIONS[key];
      if (loc) {
        teleportTo(loc.x, loc.z, loc.heading);
      }
      closePopovers();
    });
  });

  const openMapBtn = document.getElementById('btn-open-map');
  if (openMapBtn) openMapBtn.addEventListener('click', () => mapSystem.toggleFullMap(true));
  mapSystem.setActiveCity(activeCity, false);

  mapSystem.onCityChange = (cityId) => {
    selectCity(cityId, { teleport: true, syncMap: false });
  };

  cityButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectCity(btn.getAttribute('data-city'), { teleport: true, syncMap: true });
      closePopovers();
    });
  });

  if (tpSwitchCityBtn) {
    tpSwitchCityBtn.addEventListener('click', () => {
      const nextCity = activeCity === 'sejong' ? 'seoul' : 'sejong';
      selectCity(nextCity, { teleport: true, syncMap: true });
      closePopovers();
    });
  }

  if (hudToggleBtn) {
    hudToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('hud-minimized');
      const isMin = document.body.classList.contains('hud-minimized');
      hudToggleBtn.setAttribute('aria-pressed', String(isMin));
      hudToggleBtn.setAttribute('aria-label', isMin ? 'HUD 표시' : 'HUD 숨기기');
      hudToggleBtn.title = isMin ? 'HUD 표시 [H]' : '클린 뷰: HUD 숨기기 [H]';
      if (isMin) closePopovers();
    });
  }

  // Global keyboard shortcuts for modes (1-4), cameras (V / 5-0), and HUD (H)
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e)) return;
    switch (e.code) {
      case 'Digit1':
        selectMode('person');
        break;
      case 'Digit2':
        selectMode('car');
        break;
      case 'Digit3':
        selectMode('cyclist');
        break;
      case 'Digit4':
        selectMode('helicopter');
        break;
      case 'Digit5':
        selectCamera('chase', true);
        break;
      case 'Digit6':
        selectCamera('action', true);
        break;
      case 'Digit7':
        selectCamera('pov', true);
        break;
      case 'Digit8':
        selectCamera(activeCity === 'sejong' ? 'sejongComplex' : 'fifthAve', true);
        break;
      case 'Digit9':
        selectCamera(activeCity === 'sejong' ? 'centralPark' : 'timesSquare', true);
        break;
      case 'Digit0':
        selectCamera(activeCity === 'sejong' ? 'sejongGovTower' : 'chryslerGCT', true);
        break;
      case 'KeyV':
        cycleCamera(e.shiftKey ? -1 : 1);
        break;
      case 'KeyH':
        if (hudToggleBtn) hudToggleBtn.click();
        break;
      case 'KeyN':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) audioSystem.setEnabled(!audioSystem.enabled);
        break;
      case 'KeyB':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !mapSystem.isFullMapOpen) audioSystem.honk(controllerManager.getActiveEntity());
        break;
    }
  });

  const syncViewportSize = () => {
    cameraSystem.onResize(window.innerWidth, window.innerHeight);
    renderer.setSize(window.innerWidth, window.innerHeight);
    placeModeIndicator();
    if (mapSystem.isFullMapOpen) {
      mapSystem.resizeFullCanvas();
      mapSystem.renderFullMap();
    }
  };
  window.addEventListener('resize', syncViewportSize);
  syncViewportSize();

  // Initialize the UI, selected city region (Sejong by default on fresh visit), and chase camera.
  selectMode(controllerManager.activeMode);
  selectCamera('chase', true);
  selectCity(activeCity, { teleport: !savedPlayerState, syncMap: true });
  selectTime('golden');
  // the web fonts change the buttons' widths once they arrive
  if (document.fonts) document.fonts.ready.then(placeModeIndicator);
  markInit('ui');

  // Compile shaders behind the loading screen. Overlapping compileAsync() jobs keep compilation moving
  // while individual jobs yield to the browser.
  const COMPILE_POOL = 16;
  const nextTask = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));
  async function precompileShaders() {
    await showLoadingStage('Preparing reflections and bloom...', 'postFX');
    // An empty frame first: it sets up the post-processing chain, which configures the scene pass's render target
    // (MSAA samples, depth format), so the pipelines compiled below are the very ones the scene pass asks for
    scene.visible = false;
    renderFrame();
    scene.visible = true;
    markInit('postFX');
    if (isSoftwareGl) return;

    // Every visible object with frustum culling off (like the warm-up frame, see the loop). Plain meshes that share
    // a material share its shader, so one job compiles them in turn (the first build serves the rest); every
    // instanced mesh gets a build of its own unless its chunks share a pipeline
    const culled = [];
    const jobs = [];
    const jobByMaterial = new Map();
    const pipelines = new Set();
    scene.traverseVisible((o) => {
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
      if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
      // Use the first visible chunk: the original representative may be in an inactive tree cell. Shadow stand-ins
      // only draw in the shadow maps (the warm-up frame compiles those).
      if (o.userData.shadowProxy) return;
      const pipeline = o.userData.sharesPipelineWith || o;
      if (pipelines.has(pipeline)) return;
      pipelines.add(pipeline);
      if (o.isInstancedMesh || Array.isArray(o.material)) {
        jobs.push([o]);
        return;
      }
      let job = jobByMaterial.get(o.material);
      if (!job) {
        job = [];
        jobByMaterial.set(o.material, job);
        jobs.push(job);
      }
      job.push(o);
    });

    await showLoadingStage(`Compiling scene shaders... 0 / ${jobs.length} batches`, 'compile', false);
    if (scenePass && sceneMRT) {
      renderer.setRenderTarget(scenePass.renderTarget);
      renderer.setMRT(sceneMRT);
    }
    const compile = async (object) => {
      // Each compile starts in a task of its own: compileAsync() keeps one precompilation state on the renderer,
      // which must not be mid-step for two of them in the same microtask checkpoint
      await nextTask();
      try {
        await renderer.compileAsync(object, cameraSystem.camera, scene);
      } catch (e) {
        console.warn('[compile]', e); // the warm-up frame compiles it instead
      }
    };
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        for (const object of job) await compile(object);
        done++;
        if (loadingStatus) loadingStatus.textContent = `Compiling scene shaders... ${done} / ${jobs.length} batches`;
        setStageProgress(done / jobs.length);
      }
    };
    await Promise.all(Array.from({ length: COMPILE_POOL }, worker));
    if (scenePass && sceneMRT) {
      renderer.setMRT(null);
      renderer.setRenderTarget(null);
    }
    for (const o of culled) o.frustumCulled = true;
  }

  await precompileShaders();
  markInit('compile');
  await showLoadingStage('Preparing shadows and the first frame...', 'warmup');

  // 6. Animation Loop
  let lastTime = performance.now();
  let elapsed = 0;
  let frameCount = 0;
  let fpsTimer = 0;
  let nextPlayerSave = 0;
  let warmedUp = false; // see the first frame below

  if (elFps) elFps.textContent = '60';

  function afterSoftwareDraw(cb) {
    const gl = renderer.backend?.gl || renderer.domElement?.getContext('webgl2');
    if (!gl || typeof gl.fenceSync !== 'function' || typeof gl.clientWaitSync !== 'function') {
      setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) {
      setTimeout(cb, 80);
      return;
    }
    gl.flush();
    const deadline = performance.now() + 2000;
    const poll = () => {
      const status = gl.clientWaitSync(sync, gl.SYNC_FLUSH_COMMANDS_BIT, 0);
      if (status === gl.TIMEOUT_EXPIRED && performance.now() < deadline) {
        setTimeout(poll, 16);
      } else {
        gl.deleteSync(sync);
        setTimeout(cb, 80);
      }
    };
    setTimeout(poll, 16);
  }

  function tick(now) {
    const rawDt = (now - lastTime) * 0.001;
    lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    const wallDt = Math.min(Math.max(rawDt, 0.001), 0.75);
    elapsed += dt;

    // Update 3rd-person controllers, camera, signals, traffic & vehicle collisions, building LODs, and dynamic shadow focus
    gamepadControls.update(dt);
    controllerManager.update(dt, elapsed, cameraSystem.initialized ? cameraSystem.currentPos : null);
    cameraSystem.update(dt, elapsed);
    streetDetails.signalClock.value = elapsed;
    const changedTrafficSegments = trafficSystem.update(
      dt,
      elapsed,
      cameraSystem.currentPos,
      controllerManager.getActiveEntity(),
      controllerManager.activeMode,
      cameraSystem.camera,
      lightingSystem.activePresetId,
      wallDt
    );
    if (changedTrafficSegments && changedTrafficSegments.length > 0) {
      updateTrafficHud();
    }
    highwayTraffic.update(dt, cameraSystem.camera, controllerManager.getActiveEntity(), controllerManager.activeMode);
    if (!document.hidden && now >= nextPlayerSave) {
      savePlayerState();
      nextPlayerSave = now + 5000;
    }
    if (boroughs.update) boroughs.update(elapsed); // Roosevelt Island Tramway cabins
    cityBlocks.update(cameraSystem.currentPos.x, cameraSystem.currentPos.z);
    if (cityBlocks.updateLights) cityBlocks.updateLights(cameraSystem.camera);
    if (streetDetails.update) streetDetails.update(cameraSystem.camera);
    lightingSystem.update(cameraSystem.currentPos);
    if (sejongLighting) sejongLighting.update(dt, elapsed);
    weatherSystem.update(dt, elapsed, cameraSystem.camera, cameraSystem.currentPos, lightingSystem.activePresetId);
    mapSystem.update();
    audioSystem.update(dt, elapsed, cameraSystem.camera, lightingSystem.activePresetId === 'midnight');
    if (warmedUp) updateSceneCulling(cameraSystem.camera.position); // the warm-up frame draws every chunk
    // Traffic collisions can move the player after controller updates; finalize moving hierarchies here.
    for (const root of dynamicRoots) root.updateMatrixWorld();

    // Update camera matrix uniforms for screen-space depth/normal weather effects
    if (colorGrade) colorGrade.update(cameraSystem.camera);

    // Render frame via TSL RenderPipeline (SSR + Bloom)
    if (!warmedUp) {
      if (isSoftwareGl) {
        worldCitySplitReady = true;
        applyWorldCityVisibility(activeCity);
        updateSceneCulling(cameraSystem.camera.position);
        markInit('warmup');
        renderFrame();
      } else {
        // First frame = pipeline warm-up behind the loading screen, for what precompileShaders() can't reach (the shadow
        // map passes): with frustum culling off, every visible material's pipelines compile now instead of stalling the
        // first time the camera turns towards it (one chunk / shadow stand-in per shared pipeline is enough)
        const culled = [];
        const pipelines = new Set();
        scene.traverseVisible((o) => {
          const pipeline = o.userData.sharesPipelineWith || o;
          if (pipelines.has(pipeline)) return;
          pipelines.add(pipeline);
          if (o.frustumCulled) {
            culled.push(o);
            o.frustumCulled = false;
          }
        });
        renderFrame();
        for (const o of culled) o.frustumCulled = true;
        worldCitySplitReady = true;
        applyWorldCityVisibility(activeCity);
        markInit('warmup');
        renderFrame();
      }
    } else {
      renderFrame();
    }
    if (!warmedUp) {
      warmedUp = true;
      markInit('firstFrame');
      // The loading screen stays up until the GPU has got through the first frame (and the pipelines its warm-up
      // compiled), i.e. until the city is actually on screen
      const device = renderer.backend.device;
      beginLoadingStage('Waiting for graphics to finish the first frame...', 'gpu');
      Promise.resolve(device && device.queue.onSubmittedWorkDone()).catch(() => {}).then(() => {
        markInit('gpu');
        console.log(`[init] ${initTimings.join(', ')}`);
        initTimings = null;
        setLoadingProgress(1);
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        audioSystem.ready = true;
      });
    }

    // Telemetry uses wall time, not the clamped simulation step, so slow frames and high-refresh displays report
    // their actual frame rate (updates DOM every 250ms).
    frameCount++;
    fpsTimer += Math.max(0, rawDt);
    if (fpsTimer >= 0.25) {
      const currentFps = Math.round(frameCount / fpsTimer);
      frameCount = 0;
      fpsTimer = 0;

      const activeEnt = controllerManager.getActiveEntity();
      const mode = controllerManager.activeMode;
      const kmh = Math.round(Math.abs(activeEnt.speed) * 3.6);
      const altM = Math.max(0, Math.round(activeEnt.position.y));

      if (elFps) {
        elFps.textContent = String(currentFps);
        elFps.className = currentFps >= 50 ? 'fps-ok' : currentFps >= 30 ? 'fps-warn' : 'fps-bad';
      }
      if (elSpeed) elSpeed.textContent = String(kmh);
      if (elSpeedMeter) elSpeedMeter.style.transform = `scaleX(${Math.min(1, kmh / (topSpeedKmh[mode] || 130))})`;
      if (elAltitude) elAltitude.textContent = altM.toLocaleString('ko-KR');
      updateTrafficHud();
      // The street corner of the player on the follow cameras, of the camera itself on the scenic ones
      const where = cameraSystem.getActivePreset().category === 'follow' ? activeEnt.position : cameraSystem.currentPos;
      renderLocation(getLocationLabel(where.x, where.z, activeCity));
    }
  }

  if (isSoftwareGl) {
    const runSoftwareFrame = () => {
      tick(performance.now());
      afterSoftwareDraw(() => requestAnimationFrame(runSoftwareFrame));
    };
    requestAnimationFrame(runSoftwareFrame);
  } else {
    renderer.setAnimationLoop(tick);
  }
}

initApp();
