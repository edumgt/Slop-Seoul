import * as THREE from 'three/webgpu';
import {
  MUSEUM_ORIGIN,
  MUSEUM_HALL,
  MUSEUM_EXHIBITS,
  MUSEUM_COLLIDERS,
  COLONNADE_ZS,
  getMuseumLightingMood
} from './museum-config.js';
import { PersonCrowd, PersonRig } from './pedestrians.js';

// =========================================================================
// NATIONAL MUSEUM OF KOREA (국립중앙박물관) 3D INTERIOR ARCHITECTURE
// =========================================================================
// Procedural Three.js WebGPU indoor sanctuary featuring:
//   - Path of History (역사의 길) grand granite hall & colonnade
//   - Ten-Story Stone Pagoda of Gyeongcheonsa (경천사지 십층석탑, 13.5m)
//   - Room of Quiet Contemplation (사유의 방) with twin Pensive Bodhisattvas
//   - Illuminated vitrines displaying Silla Gold Crown, Baekje Incense Burner,
//     Goryeo Inlaid Celadon Maebyeong, Joseon Moon Jar, and National Treasures
//   - Calm strolling museum visitors (PersonCrowd / PersonRig)

function createGraniteFloorTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');

  // Warm honed Korean Po-cheon granite base
  ctx.fillStyle = '#c8c1b6';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle multi-tile stone tonal variation (4x4 slab grid)
  const tile = 128;
  for (let gx = 0; gx < 4; gx++) {
    for (let gy = 0; gy < 4; gy++) {
      const shade = ((gx * 7 + gy * 13) % 5) * 4 - 8;
      const r = 198 + shade;
      const g = 191 + shade;
      const b = 180 + shade;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(gx * tile + 2, gy * tile + 2, tile - 4, tile - 4);
    }
  }

  // Fine granite mineral speckles
  let seed = 104729;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < 4200; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const v = rand() > 0.5 ? 235 : 138;
    ctx.fillStyle = `rgba(${v},${v - 4},${v - 8},${0.12 + rand() * 0.14})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  // Crisp architectural mortar joints
  ctx.strokeStyle = 'rgba(72, 66, 58, 0.38)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = i * tile;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(512, p);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 34);
  tex.anisotropy = 8;
  return tex;
}

function createLimestoneWallTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d5ccbe';
  ctx.fillRect(0, 0, 512, 512);

  // Horizontal coursed limestone ashlar blocks (iconic National Museum of Korea stone cladding)
  const rows = 8;
  const rh = 512 / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * 64;
    for (let col = -1; col < 5; col++) {
      const shade = ((r * 11 + col * 7 + 20) % 5) * 3 - 6;
      ctx.fillStyle = `rgb(${213 + shade}, ${204 + shade}, ${190 + shade})`;
      ctx.fillRect(col * 128 + offset + 1, r * rh + 1, 126, rh - 2);
    }
    ctx.fillStyle = 'rgba(88, 80, 68, 0.25)';
    ctx.fillRect(0, r * rh, 512, 1.5);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 3);
  tex.anisotropy = 8;
  return tex;
}

function createSignCanvasTexture(titleKo, subtitleEn, { bg = '#1c1916', fg = '#f4efe6', accent = '#d4a853', w = 512, h = 192 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  ctx.fillStyle = accent;
  ctx.fillRect(28, 34, 68, 4);

  ctx.fillStyle = fg;
  ctx.font = '700 34px Pretendard, Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(titleKo, 28, h * 0.44);

  ctx.fillStyle = 'rgba(244, 239, 230, 0.72)';
  ctx.font = '500 20px Inter, sans-serif';
  ctx.fillText(subtitleEn, 28, h * 0.74);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function createBannerTexture(titleKo, subtitleKo, accentColor) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#1e1b18';
  ctx.fillRect(0, 0, 256, 512);

  // Subtle geometric lattice inspired by traditional Korean Changhoji (window lattice)
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  for (let y = 32; y < 512; y += 48) {
    ctx.beginPath();
    ctx.moveTo(16, y);
    ctx.lineTo(240, y);
    ctx.stroke();
  }

  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 0, 256, 16);
  ctx.fillRect(0, 496, 256, 16);

  ctx.fillStyle = '#f6f1e8';
  ctx.font = '700 32px Pretendard, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(titleKo, 128, 220);

  ctx.fillStyle = accentColor;
  ctx.fillRect(78, 256, 100, 3);

  ctx.fillStyle = 'rgba(246, 241, 232, 0.76)';
  ctx.font = '500 20px Pretendard, sans-serif';
  ctx.fillText(subtitleKo, 128, 298);

  ctx.fillStyle = 'rgba(246, 241, 232, 0.45)';
  ctx.font = '600 14px Inter, sans-serif';
  ctx.fillText('NATIONAL MUSEUM OF KOREA', 128, 444);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// =========================================================================
// HERO SCULPTURES & ARTIFACT BUILDERS (Multi-part Composite Groups)
// =========================================================================

// 1. Ten-Story Stone Pagoda of Gyeongcheonsa (경천사지 십층석탑, 13.5m marble monument)
function buildGyeongcheonsaPagoda(marbleMat, darkTrimMat, glassMat) {
  const group = new THREE.Group();
  group.name = 'GyeongcheonsaTenStoryPagoda';

  // Protective plinth & glass rail enclosure
  const baseFloor = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.22, 8.2), darkTrimMat);
  baseFloor.position.y = 0.11;
  group.add(baseFloor);

  // Low glass safety balustrade around the pagoda
  const railHeight = 0.92;
  const railOffset = 4.05;
  const railPanelH = new THREE.BoxGeometry(8.0, railHeight, 0.06);
  const railPanelV = new THREE.BoxGeometry(0.06, railHeight, 8.0);
  for (const s of [-1, 1]) {
    const pZ = new THREE.Mesh(railPanelH, glassMat);
    pZ.position.set(0, 0.22 + railHeight * 0.5, s * railOffset);
    group.add(pZ);
    const pX = new THREE.Mesh(railPanelV, glassMat);
    pX.position.set(s * railOffset, 0.22 + railHeight * 0.5, 0);
    group.add(pX);
  }

  // Three-tier cruciform carved marble podium (기단부)
  const podiumSpecs = [
    { w: 5.4, h: 0.72, y: 0.58 },
    { w: 4.5, h: 0.96, y: 1.42 },
    { w: 3.7, h: 0.88, y: 2.34 }
  ];
  for (const p of podiumSpecs) {
    // Cruciform silhouette (main square + cross projections)
    const core = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.w), marbleMat);
    core.position.y = p.y;
    group.add(core);
    const crossA = new THREE.Mesh(new THREE.BoxGeometry(p.w * 1.12, p.h * 0.86, p.w * 0.56), marbleMat);
    crossA.position.y = p.y;
    group.add(crossA);
    const crossB = new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.56, p.h * 0.86, p.w * 1.12), marbleMat);
    crossB.position.y = p.y;
    group.add(crossB);
    // Cornice ledge
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(p.w * 1.16, 0.14, p.w * 1.16), marbleMat);
    cornice.position.y = p.y + p.h * 0.5 + 0.05;
    group.add(cornice);
  }

  // Ten carved pagoda stories (탑신 + 옥개석 eaves) tapering gracefully up to ~13.5m
  let curY = 2.86;
  for (let story = 0; story < 10; story++) {
    const t = story / 9;
    const bodyW = 2.55 - t * 1.32;
    const bodyH = 0.66 - t * 0.18;
    const eaveW = bodyW * 1.34;
    const eaveH = 0.24 - t * 0.05;

    // Lower 3 stories retain cruciform projection like the real Gyeongcheonsa Pagoda
    const body = new THREE.Mesh(new THREE.BoxGeometry(bodyW, bodyH, bodyW), marbleMat);
    body.position.y = curY + bodyH * 0.5;
    group.add(body);
    if (story < 3) {
      const wingA = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 1.16, bodyH * 0.9, bodyW * 0.55), marbleMat);
      wingA.position.y = curY + bodyH * 0.5;
      group.add(wingA);
      const wingB = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.55, bodyH * 0.9, bodyW * 1.16), marbleMat);
      wingB.position.y = curY + bodyH * 0.5;
      group.add(wingB);
    }

    // Carved eave underside bracket + sloped roof tier (옥개석)
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 1.12, 0.1, bodyW * 1.12), marbleMat);
    bracket.position.y = curY + bodyH + 0.05;
    group.add(bracket);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(eaveW * 0.78, eaveH * 1.9, 4), marbleMat);
    roof.rotation.y = Math.PI * 0.25;
    roof.position.y = curY + bodyH + 0.09 + eaveH * 0.82;
    group.add(roof);

    curY += bodyH + eaveH * 1.38;
  }

  // Finial lotus pedestal (노반 & 복발)
  const finialBase = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.28, 0.82), marbleMat);
  finialBase.position.y = curY + 0.14;
  group.add(finialBase);
  const finialBowl = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), marbleMat);
  finialBowl.position.y = curY + 0.28;
  group.add(finialBowl);
  const finialSpire = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.72, 8), marbleMat);
  finialSpire.position.y = curY + 0.82;
  group.add(finialSpire);

  return group;
}

// 2. Gilt-Bronze Pensive Bodhisattva (국보 금동미륵보살반가사유상)
function buildPensiveBodhisattva(giltBronzeMat, darkBaseMat, variant = 78) {
  const group = new THREE.Group();

  // Low contemplative dark basalt pedestal
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.04, 0.72, 24), darkBaseMat);
  plinth.position.y = 0.36;
  group.add(plinth);
  const topLip = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.82, 0.12, 24), darkBaseMat);
  topLip.position.y = 0.78;
  group.add(topLip);

  // Draped lotus stool (대좌)
  const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.52, 18), giltBronzeMat);
  stool.position.y = 1.1;
  group.add(stool);

  // Lower draped robe & crossed right leg resting on left knee
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, 0.42, 16), giltBronzeMat);
  robe.position.set(0, 1.38, 0.04);
  group.add(robe);

  const crossedLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.34, 6, 12), giltBronzeMat);
  crossedLeg.rotation.z = Math.PI * 0.44;
  crossedLeg.position.set(-0.04, 1.44, 0.19);
  group.add(crossedLeg);

  const hangingFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.38, 10), giltBronzeMat);
  hangingFoot.position.set(-0.14, 1.06, 0.24);
  group.add(hangingFoot);

  // Slender torso inclined gently forward in contemplation
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.21, 0.48, 16), giltBronzeMat);
  torso.position.set(0, 1.72, 0.01);
  torso.rotation.x = 0.1;
  group.add(torso);

  // Shoulders
  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.26, 6, 12), giltBronzeMat);
  shoulders.rotation.z = Math.PI * 0.5;
  shoulders.position.set(0, 1.91, 0.02);
  group.add(shoulders);

  // Raised pensive right arm touching cheek
  const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.22, 6, 10), giltBronzeMat);
  upperArm.position.set(0.17, 1.78, 0.12);
  upperArm.rotation.set(-0.4, 0, -0.3);
  group.add(upperArm);

  const foreArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.24, 6, 10), giltBronzeMat);
  foreArm.position.set(0.13, 1.97, 0.16);
  foreArm.rotation.set(0.15, 0, 0.38);
  group.add(foreArm);

  // Left arm resting gently on ankle
  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.32, 6, 10), giltBronzeMat);
  leftArm.position.set(-0.18, 1.68, 0.11);
  leftArm.rotation.set(-0.35, 0, 0.25);
  group.add(leftArm);

  // Serene head tilted slightly downward
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 16), giltBronzeMat);
  head.scale.set(0.92, 1.12, 0.96);
  head.position.set(0, 2.13, 0.05);
  head.rotation.x = 0.16;
  group.add(head);

  // Iconic crown: Three-Mountain Crown (삼산관, NT 83) vs Sun-Moon Crown (일월식 보관, NT 78)
  if (variant === 83) {
    const crownBand = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.125, 0.09, 18), giltBronzeMat);
    crownBand.position.set(0, 2.27, 0.04);
    group.add(crownBand);
    for (const dx of [-0.075, 0, 0.075]) {
      const peak = new THREE.Mesh(new THREE.SphereGeometry(dx === 0 ? 0.068 : 0.052, 12, 10), giltBronzeMat);
      peak.scale.set(1, 1.35, 0.7);
      peak.position.set(dx, 2.33, 0.06);
      group.add(peak);
    }
  } else {
    const diadem = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.125, 0.18, 18), giltBronzeMat);
    diadem.position.set(0, 2.3, 0.04);
    group.add(diadem);
    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 12), giltBronzeMat);
    sunDisc.position.set(0, 2.43, 0.07);
    group.add(sunDisc);
  }

  return group;
}

// 3. Vitrine artifacts (Silla Gold Crown, Baekje Incense Burner, Celadon Maebyeong, Moon Jar, etc.)
function buildVitrineArtifact(kind, materials) {
  const g = new THREE.Group();
  const { goldMat, celadonMat, porcelainMat, bluePorcelainMat, jadeMat, giltBronzeMat } = materials;

  if (kind === 'crown') {
    // Silla Gold Crown (신라 금관)
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.25, 0.09, 24, 1, true), goldMat);
    band.position.y = 0.12;
    g.add(band);
    for (let i = 0; i < 5; i++) {
      const a = -0.95 + i * 0.475;
      const stemH = i % 2 === 0 ? 0.34 : 0.26;
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.032, stemH, 0.012), goldMat);
      stem.position.set(Math.sin(a) * 0.24, 0.16 + stemH * 0.5, Math.cos(a) * 0.24);
      stem.rotation.y = a;
      g.add(stem);
      // Cross branches
      for (const bh of [0.24, 0.34]) {
        const branch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.022, 0.01), goldMat);
        branch.position.set(Math.sin(a) * 0.24, bh, Math.cos(a) * 0.24);
        branch.rotation.y = a;
        g.add(branch);
      }
      // Curved jade gogok (곡옥) accent
      const jade = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 8), jadeMat);
      jade.scale.set(0.8, 1.35, 0.7);
      jade.position.set(Math.sin(a) * 0.26, 0.22 + (i % 2) * 0.06, Math.cos(a) * 0.26);
      g.add(jade);
    }
  } else if (kind === 'celadon') {
    // Goryeo Inlaid Celadon Maebyeong (청자 상감운학문 매병)
    const pts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.11, 0.0),
      new THREE.Vector2(0.14, 0.16),
      new THREE.Vector2(0.21, 0.36),
      new THREE.Vector2(0.24, 0.52),
      new THREE.Vector2(0.19, 0.62),
      new THREE.Vector2(0.075, 0.68),
      new THREE.Vector2(0.095, 0.73),
      new THREE.Vector2(0.065, 0.74)
    ];
    const vase = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), celadonMat);
    g.add(vase);
  } else if (kind === 'moonjar') {
    // Joseon White Porcelain Moon Jar (백자 달항아리)
    const pts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.15, 0.0),
      new THREE.Vector2(0.27, 0.14),
      new THREE.Vector2(0.32, 0.31),
      new THREE.Vector2(0.29, 0.49),
      new THREE.Vector2(0.19, 0.60),
      new THREE.Vector2(0.14, 0.65),
      new THREE.Vector2(0.155, 0.69)
    ];
    const jar = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), porcelainMat);
    g.add(jar);
  } else if (kind === 'bluejar') {
    // Joseon Blue-and-White Porcelain Jar (백자 청화매죽문 항아리)
    const pts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.14, 0.0),
      new THREE.Vector2(0.23, 0.18),
      new THREE.Vector2(0.27, 0.38),
      new THREE.Vector2(0.22, 0.54),
      new THREE.Vector2(0.13, 0.62),
      new THREE.Vector2(0.15, 0.68)
    ];
    const jar = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), bluePorcelainMat);
    g.add(jar);
  } else if (kind === 'incense') {
    // Baekje Gilt-Bronze Incense Burner (백제 금동대향로)
    const pts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.16, 0.0),
      new THREE.Vector2(0.08, 0.08),
      new THREE.Vector2(0.055, 0.18),
      new THREE.Vector2(0.19, 0.32),
      new THREE.Vector2(0.21, 0.44),
      new THREE.Vector2(0.14, 0.58),
      new THREE.Vector2(0.05, 0.68),
      new THREE.Vector2(0.0, 0.72)
    ];
    const burner = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), giltBronzeMat);
    g.add(burner);
    // Perched Phoenix finial at crown
    const phoenixBody = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), goldMat);
    phoenixBody.scale.set(0.8, 1.3, 1.1);
    phoenixBody.position.y = 0.77;
    g.add(phoenixBody);
    const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.015), goldMat);
    wingL.position.set(-0.07, 0.80, -0.01);
    wingL.rotation.z = 0.45;
    g.add(wingL);
    const wingR = wingL.clone();
    wingR.position.x = 0.07;
    wingR.rotation.z = -0.45;
    g.add(wingR);
  } else {
    // Gilt-Bronze Standing Buddha (연가7년명 금동여래입상)
    const lotus = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.12, 16), giltBronzeMat);
    lotus.position.y = 0.06;
    g.add(lotus);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 0.48, 16), giltBronzeMat);
    body.position.y = 0.36;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 12), giltBronzeMat);
    head.position.y = 0.66;
    g.add(head);
    // Mandorla flame halo (광배)
    const halo = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.025, 18), goldMat);
    halo.rotation.x = Math.PI * 0.5;
    halo.scale.set(0.95, 1, 1.65);
    halo.position.set(0, 0.45, -0.08);
    g.add(halo);
  }

  return g;
}

function buildDisplayVitrine(exhibit, sharedMats) {
  const group = new THREE.Group();
  const { basaltMat, bronzeMat, glassMat, interiorGlowMat } = sharedMats;

  // Dark museum basalt plinth
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.96, 2.15), basaltMat);
  base.position.y = 0.48;
  group.add(base);

  // Warm museum display deck top
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.06, 1.94), sharedMats.velvetMat);
  deck.position.y = 0.99;
  group.add(deck);

  // Artifact centered inside vitrine
  const artifact = buildVitrineArtifact(exhibit.kind, sharedMats);
  artifact.position.y = 1.02;
  group.add(artifact);

  // Tempered museum glass enclosure
  const glassBox = new THREE.Mesh(new THREE.BoxGeometry(2.04, 1.98, 2.04), glassMat);
  glassBox.position.y = 1.98;
  group.add(glassBox);

  // Top light canopy & warm luminous ceiling panel inside vitrine
  const cap = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.16, 2.18), bronzeMat);
  cap.position.y = 3.04;
  group.add(cap);
  const lightPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.76, 1.76), interiorGlowMat);
  lightPanel.rotation.x = Math.PI * 0.5;
  lightPanel.position.y = 2.95;
  group.add(lightPanel);

  // Angled museum placard facing the central Path of History aisle
  const placardTex = createSignCanvasTexture(
    exhibit.nameKo,
    `${exhibit.treasureNo} · ${exhibit.era}`,
    { bg: '#161412', fg: '#f6f0e4', accent: '#d8ad56', w: 512, h: 160 }
  );
  const placardMat = new THREE.MeshBasicNodeMaterial({ map: placardTex });
  const placard = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.37), placardMat);
  const facesEast = exhibit.lx < 0;
  placard.position.set(facesEast ? 1.12 : -1.12, 0.72, 0);
  placard.rotation.y = facesEast ? Math.PI * 0.5 : -Math.PI * 0.5;
  placard.rotation.x = -0.35;
  group.add(placard);

  group.position.set(exhibit.lx, 0, exhibit.lz);
  return group;
}

// =========================================================================
// MAIN NATIONAL MUSEUM OF KOREA INTERIOR BUILDER
// =========================================================================

function buildNationalMuseumInterior(scene, { isSoftwareGl = false } = {}) {
  const root = new THREE.Group();
  root.name = 'NationalMuseumInterior';
  root.position.set(MUSEUM_ORIGIN.x, MUSEUM_ORIGIN.y, MUSEUM_ORIGIN.z);
  root.visible = false; // Hidden while exploring Sejong or Seoul

  const W = MUSEUM_HALL.halfWidth * 2;   // 46m
  const L = MUSEUM_HALL.halfLength * 2;  // 136m
  const H = MUSEUM_HALL.ceilingY;        // 17.5m
  const MEZ_Y = MUSEUM_HALL.mezzanineY;  // 7.4m

  // Procedural PBR materials
  const graniteFloorTex = createGraniteFloorTexture();
  const limestoneWallTex = createLimestoneWallTexture();

  const floorMat = new THREE.MeshStandardNodeMaterial({
    map: graniteFloorTex,
    roughness: 0.28,
    metalness: 0.08
  });

  const wallMat = new THREE.MeshStandardNodeMaterial({
    map: limestoneWallTex,
    roughness: 0.78,
    metalness: 0.04
  });

  const columnMat = new THREE.MeshStandardNodeMaterial({
    color: 0xd6cec0,
    roughness: 0.68,
    metalness: 0.05
  });

  const darkStoneMat = new THREE.MeshStandardNodeMaterial({
    color: 0x262422,
    roughness: 0.55,
    metalness: 0.14
  });

  const woodTimberMat = new THREE.MeshStandardNodeMaterial({
    color: 0x70533c,
    roughness: 0.62,
    metalness: 0.05
  });

  const bronzeMat = new THREE.MeshStandardNodeMaterial({
    color: 0x3a3228,
    roughness: 0.36,
    metalness: 0.78
  });

  const marbleMat = new THREE.MeshStandardNodeMaterial({
    color: 0xe6dfd3,
    roughness: 0.52,
    metalness: 0.04
  });

  const contemplationWallMat = new THREE.MeshStandardNodeMaterial({
    color: 0x201d1c,
    roughness: 0.94,
    metalness: 0.02
  });

  const glassMat = new THREE.MeshPhysicalNodeMaterial({
    color: 0xdbe9f2,
    roughness: 0.08,
    metalness: 0.05,
    transparent: true,
    opacity: 0.22,
    depthWrite: false
  });

  const skylightMat = new THREE.MeshBasicNodeMaterial({
    color: 0xfff5e4
  });

  const interiorGlowMat = new THREE.MeshBasicNodeMaterial({
    color: 0xfff0d2
  });

  const sharedArtifactMats = {
    basaltMat: darkStoneMat,
    bronzeMat,
    glassMat,
    interiorGlowMat,
    velvetMat: new THREE.MeshStandardNodeMaterial({ color: 0x2a241f, roughness: 0.92, metalness: 0.0 }),
    goldMat: new THREE.MeshStandardNodeMaterial({ color: 0xe8bd52, roughness: 0.22, metalness: 0.92 }),
    giltBronzeMat: new THREE.MeshStandardNodeMaterial({ color: 0xcfa047, roughness: 0.26, metalness: 0.88 }),
    celadonMat: new THREE.MeshStandardNodeMaterial({ color: 0x7ea296, roughness: 0.16, metalness: 0.08 }),
    porcelainMat: new THREE.MeshStandardNodeMaterial({ color: 0xf4f1ea, roughness: 0.18, metalness: 0.04 }),
    bluePorcelainMat: new THREE.MeshStandardNodeMaterial({ color: 0xdce4ee, roughness: 0.18, metalness: 0.06 }),
    jadeMat: new THREE.MeshStandardNodeMaterial({ color: 0x4ca87b, roughness: 0.2, metalness: 0.05 })
  };

  // -----------------------------------------------------------------------
  // 1. ARCHITECTURAL SHELL (Floor, Perimeter Walls, Ceiling & Skylight Atrium)
  // -----------------------------------------------------------------------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, L), floorMat);
  floor.rotation.x = -Math.PI * 0.5;
  floor.receiveShadow = true;
  root.add(floor);

  // Subtle dark granite runner border framing the central Path of History nave
  const runnerGeo = new THREE.PlaneGeometry(0.45, L - 12);
  for (const sx of [-9.0, 9.0]) {
    const strip = new THREE.Mesh(runnerGeo, darkStoneMat);
    strip.rotation.x = -Math.PI * 0.5;
    strip.position.set(sx, 0.008, 0);
    root.add(strip);
  }

  // Outer perimeter stone walls (West, East, North behind Pagoda, South entrance facade)
  const sideWallGeo = new THREE.BoxGeometry(0.8, H, L);
  const westWall = new THREE.Mesh(sideWallGeo, wallMat);
  westWall.position.set(-MUSEUM_HALL.halfWidth - 0.4, H * 0.5, 0);
  root.add(westWall);

  const eastWall = new THREE.Mesh(sideWallGeo, wallMat);
  eastWall.position.set(MUSEUM_HALL.halfWidth + 0.4, H * 0.5, 0);
  root.add(eastWall);

  const northWall = new THREE.Mesh(new THREE.BoxGeometry(W + 1.6, H, 1.0), wallMat);
  northWall.position.set(0, H * 0.5, -MUSEUM_HALL.halfLength - 0.5);
  root.add(northWall);

  // South glazed curtain wall & stone portal piers
  const southGlass = new THREE.Mesh(new THREE.PlaneGeometry(W - 4, H - 2), skylightMat);
  southGlass.rotation.y = Math.PI;
  southGlass.position.set(0, H * 0.5, MUSEUM_HALL.halfLength - 0.1);
  root.add(southGlass);
  // Curtain wall mullions
  for (let mx = -18; mx <= 18; mx += 4.5) {
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.28, H, 0.36), bronzeMat);
    mullion.position.set(mx, H * 0.5, MUSEUM_HALL.halfLength - 0.25);
    root.add(mullion);
  }
  for (const my of [4.2, 8.8, 13.4]) {
    const transom = new THREE.Mesh(new THREE.BoxGeometry(W, 0.26, 0.36), bronzeMat);
    transom.position.set(0, my, MUSEUM_HALL.halfLength - 0.25);
    root.add(transom);
  }

  // Solid ceiling soffits over the East & West wings + central luminous skylight coffer
  const wingCeilingGeo = new THREE.BoxGeometry(13.5, 0.6, L);
  for (const side of [-1, 1]) {
    const wingCeil = new THREE.Mesh(wingCeilingGeo, darkStoneMat);
    wingCeil.position.set(side * 16.5, H, 0);
    root.add(wingCeil);
  }

  // Central skylight glass ceiling + architectural timber acoustic louvers
  const skylightRoof = new THREE.Mesh(new THREE.PlaneGeometry(20.0, L - 4), skylightMat);
  skylightRoof.rotation.x = Math.PI * 0.5;
  skylightRoof.position.set(0, H + 0.1, 0);
  root.add(skylightRoof);

  const louverGeo = new THREE.BoxGeometry(20.2, 0.55, 0.42);
  for (let lz = -62; lz <= 62; lz += 4.0) {
    const louver = new THREE.Mesh(louverGeo, woodTimberMat);
    louver.position.set(0, H - 0.35, lz);
    root.add(louver);
  }

  // -----------------------------------------------------------------------
  // 2. MONUMENTAL COLONNADE & 2ND FLOOR MEZZANINE BALCONIES
  // -----------------------------------------------------------------------
  const pillarGeo = new THREE.BoxGeometry(1.42, H, 1.42);
  const plinthGeo = new THREE.BoxGeometry(1.72, 0.46, 1.72);
  for (const lz of COLONNADE_ZS) {
    for (const side of [-1, 1]) {
      // Leave clear entry bay into the Room of Quiet Contemplation on east side
      if (side === 1 && (lz === -4 || lz === 12)) continue;
      const col = new THREE.Mesh(pillarGeo, columnMat);
      col.position.set(side * 10.2, H * 0.5, lz);
      root.add(col);
      const base = new THREE.Mesh(plinthGeo, darkStoneMat);
      base.position.set(side * 10.2, 0.23, lz);
      root.add(base);
    }
  }

  // 2nd Floor Mezzanine slabs & glass balustrades along East and West galleries
  const mezSlabGeo = new THREE.BoxGeometry(12.6, 0.55, L - 16);
  const mezRailGeo = new THREE.BoxGeometry(0.08, 1.12, L - 16);
  const mezTopRailGeo = new THREE.BoxGeometry(0.14, 0.08, L - 16);
  for (const side of [-1, 1]) {
    const slab = new THREE.Mesh(mezSlabGeo, columnMat);
    slab.position.set(side * 16.7, MEZ_Y, -4);
    root.add(slab);

    const rail = new THREE.Mesh(mezRailGeo, glassMat);
    rail.position.set(side * 10.45, MEZ_Y + 0.84, -4);
    root.add(rail);

    const handRail = new THREE.Mesh(mezTopRailGeo, bronzeMat);
    handRail.position.set(side * 10.45, MEZ_Y + 1.42, -4);
    root.add(handRail);
  }

  // Overhead skybridge gallery connecting West & East 2nd-floor wings at South Great Hall
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(21.0, 0.55, 5.2), columnMat);
  bridge.position.set(0, MEZ_Y, 55);
  root.add(bridge);
  const bridgeRailN = new THREE.Mesh(new THREE.BoxGeometry(21.0, 1.1, 0.08), glassMat);
  bridgeRailN.position.set(0, MEZ_Y + 0.82, 52.45);
  root.add(bridgeRailN);

  // Welcome sign mounted on the South skybridge fascia facing visitors walking north
  const heroSignTex = createSignCanvasTexture(
    '국립중앙박물관 · 역사의 길',
    'NATIONAL MUSEUM OF KOREA · PATH OF HISTORY',
    { bg: '#181512', fg: '#f6f1e7', accent: '#d8ad56', w: 1024, h: 192 }
  );
  const heroSign = new THREE.Mesh(
    new THREE.PlaneGeometry(11.2, 2.1),
    new THREE.MeshBasicNodeMaterial({ map: heroSignTex })
  );
  heroSign.position.set(0, MEZ_Y + 0.1, 52.35);
  heroSign.rotation.y = Math.PI;
  root.add(heroSign);

  // North monument title banner above the Ten-Story Pagoda
  const northSignTex = createSignCanvasTexture(
    '경천사지 십층석탑 (국보)',
    'TEN-STORY STONE PAGODA OF GYEONGCHEONSA TEMPLE · GORYEO 1348',
    { bg: '#1b1815', fg: '#f7f2e8', accent: '#d8ad56', w: 1024, h: 192 }
  );
  const northSign = new THREE.Mesh(
    new THREE.PlaneGeometry(11.6, 2.1),
    new THREE.MeshBasicNodeMaterial({ map: northSignTex })
  );
  northSign.position.set(0, 14.5, -MUSEUM_HALL.halfLength + 0.25);
  root.add(northSign);

  // Hanging vertical exhibition banners suspended from the mezzanine colonnade
  const bannerDefs = [
    { lx: -9.5, lz: 34, title: '선사·고대관', sub: '신라 금관 · 백제', color: '#d4a853' },
    { lx: -9.5, lz: -14, title: '조각·공예관', sub: '고려 청자 · 달항아리', color: '#6ba898' },
    { lx: 9.5, lz: 34, title: '중·근세관', sub: '고려 · 조선 왕실', color: '#c97b5d' },
    { lx: 9.5, lz: 0, title: '사유의 방', sub: '국보 반가사유상', color: '#d8ad56' }
  ];
  for (const b of bannerDefs) {
    const tex = createBannerTexture(b.title, b.sub, b.color);
    const mat = new THREE.MeshBasicNodeMaterial({ map: tex, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 3.6), mat);
    mesh.position.set(b.lx, 11.4, b.lz);
    mesh.rotation.y = b.lx < 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
    root.add(mesh);
  }

  // -----------------------------------------------------------------------
  // 3. GREAT HALL LOBBY FURNITURE (Info Desk & Museum Benches)
  // -----------------------------------------------------------------------
  const infoDesk = new THREE.Mesh(new THREE.BoxGeometry(5.8, 1.04, 1.8), woodTimberMat);
  infoDesk.position.set(6.8, 0.52, 56);
  root.add(infoDesk);
  const infoTop = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.08, 2.0), marbleMat);
  infoTop.position.set(6.8, 1.08, 56);
  root.add(infoTop);
  const deskSignTex = createSignCanvasTexture('관람 안내 · 도보 전용', 'INFORMATION · WALK-ONLY GALLERY', {
    bg: '#1c1814', fg: '#f4eee2', accent: '#d8ad56', w: 512, h: 128
  });
  const deskSign = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 0.72),
    new THREE.MeshBasicNodeMaterial({ map: deskSignTex })
  );
  deskSign.position.set(6.8, 0.55, 55.06);
  deskSign.rotation.y = Math.PI;
  root.add(deskSign);

  // Wooden museum benches with bronze supports
  const benchSeatGeo = new THREE.BoxGeometry(0.86, 0.1, 3.4);
  const benchLegGeo = new THREE.BoxGeometry(0.66, 0.42, 0.12);
  for (const lz of [22, -14]) {
    for (const lx of [-6.2, 6.2]) {
      const seat = new THREE.Mesh(benchSeatGeo, woodTimberMat);
      seat.position.set(lx, 0.46, lz);
      root.add(seat);
      for (const dz of [-1.2, 1.2]) {
        const leg = new THREE.Mesh(benchLegGeo, bronzeMat);
        leg.position.set(lx, 0.21, lz + dz);
        root.add(leg);
      }
    }
  }

  // -----------------------------------------------------------------------
  // 4. TEN-STORY STONE PAGODA OF GYEONGCHEONSA (경천사지 십층석탑)
  // -----------------------------------------------------------------------
  const pagoda = buildGyeongcheonsaPagoda(marbleMat, darkStoneMat, glassMat);
  pagoda.position.set(0, 0, -40);
  root.add(pagoda);

  // -----------------------------------------------------------------------
  // 5. ROOM OF QUIET CONTEMPLATION (사유의 방 · East Sanctuary)
  // -----------------------------------------------------------------------
  const chamberFloor = new THREE.Mesh(new THREE.PlaneGeometry(12.0, 26.4), contemplationWallMat);
  chamberFloor.rotation.x = -Math.PI * 0.5;
  chamberFloor.position.set(17.1, 0.015, 0);
  root.add(chamberFloor);

  // North, South, and West partition walls with wide central archway (z = -3.4..+3.4)
  const chamberWallN = new THREE.Mesh(new THREE.BoxGeometry(12.2, MEZ_Y - 0.2, 0.65), contemplationWallMat);
  chamberWallN.position.set(17.0, (MEZ_Y - 0.2) * 0.5, -13.2);
  root.add(chamberWallN);

  const chamberWallS = chamberWallN.clone();
  chamberWallS.position.z = 13.2;
  root.add(chamberWallS);

  const chamberWallWN = new THREE.Mesh(new THREE.BoxGeometry(0.65, MEZ_Y - 0.2, 9.6), contemplationWallMat);
  chamberWallWN.position.set(11.1, (MEZ_Y - 0.2) * 0.5, -8.4);
  root.add(chamberWallWN);

  const chamberWallWS = chamberWallWN.clone();
  chamberWallWS.position.z = 8.4;
  root.add(chamberWallWS);

  // Dark archway lintel & bronze portal frame
  const portalLintel = new THREE.Mesh(new THREE.BoxGeometry(0.75, 2.2, 7.2), contemplationWallMat);
  portalLintel.position.set(11.1, MEZ_Y - 1.3, 0);
  root.add(portalLintel);

  const chamberTitleTex = createSignCanvasTexture('사유의 방', 'ROOM OF QUIET CONTEMPLATION', {
    bg: '#141211', fg: '#f4ece0', accent: '#d8ad56', w: 512, h: 140
  });
  const chamberTitle = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 0.92),
    new THREE.MeshBasicNodeMaterial({ map: chamberTitleTex })
  );
  chamberTitle.position.set(10.68, 5.9, 0);
  chamberTitle.rotation.y = -Math.PI * 0.5;
  root.add(chamberTitle);

  // Darkened east backdrop wall inside the Room of Quiet Contemplation
  const chamberBackdrop = new THREE.Mesh(new THREE.BoxGeometry(0.4, MEZ_Y - 0.2, 26.2), contemplationWallMat);
  chamberBackdrop.position.set(22.75, (MEZ_Y - 0.2) * 0.5, 0);
  root.add(chamberBackdrop);

  // Starry contemplative pin-light ceiling grid (24 recessed warm light dots)
  const pinMat = new THREE.MeshBasicNodeMaterial({ color: 0xffe4b3 });
  const pinGeo = new THREE.CircleGeometry(0.06, 8);
  for (let ix = 0; ix < 4; ix++) {
    for (let iz = 0; iz < 6; iz++) {
      const pin = new THREE.Mesh(pinGeo, pinMat);
      pin.rotation.x = Math.PI * 0.5;
      pin.position.set(13.2 + ix * 2.5, MEZ_Y - 0.32, -9.5 + iz * 3.8);
      root.add(pin);
    }
  }

  // Twin National Treasure Pensive Bodhisattvas (facing west toward incoming visitors)
  const bodhisattva78 = buildPensiveBodhisattva(sharedArtifactMats.giltBronzeMat, darkStoneMat, 78);
  bodhisattva78.position.set(18.2, 0, -3.2);
  bodhisattva78.rotation.y = -Math.PI * 0.5;
  root.add(bodhisattva78);

  const bodhisattva83 = buildPensiveBodhisattva(sharedArtifactMats.giltBronzeMat, darkStoneMat, 83);
  bodhisattva83.position.set(18.2, 0, 3.2);
  bodhisattva83.rotation.y = -Math.PI * 0.5;
  root.add(bodhisattva83);

  // -----------------------------------------------------------------------
  // 6. ILLUMINATED DISPLAY VITRINES (West & East Arcades)
  // -----------------------------------------------------------------------
  for (const exhibit of MUSEUM_EXHIBITS) {
    if (exhibit.kind === 'pagoda' || exhibit.kind === 'bodhisattva') continue;
    root.add(buildDisplayVitrine(exhibit, sharedArtifactMats));
  }

  // -----------------------------------------------------------------------
  // 7. INDOOR MUSEUM LIGHTING RIG (Atrium Skylight + Gallery Spotlights)
  // -----------------------------------------------------------------------
  const indoorAmbient = new THREE.HemisphereLight(0xf2e7d8, 0x453d35, 0.9);
  root.add(indoorAmbient);

  const atriumKeyLight = new THREE.DirectionalLight(0xfff4e0, 1.7);
  atriumKeyLight.position.set(12, 26, 22);
  atriumKeyLight.target.position.set(0, 0, -18);
  root.add(atriumKeyLight);
  root.add(atriumKeyLight.target);

  const galleryLights = [];
  const addGalleryPoint = (lx, ly, lz, color, intensity, distance) => {
    const pt = new THREE.PointLight(color, intensity, distance, 1.5);
    pt.position.set(lx, ly, lz);
    root.add(pt);
    galleryLights.push({ light: pt, baseIntensity: intensity });
    return pt;
  };

  // Warm architectural spotlights illuminating the Ten-Story Pagoda
  addGalleryPoint(-4.5, 9.5, -35.5, 0xffe4b8, 28, 34);
  addGalleryPoint(4.5, 9.5, -44.5, 0xffe4b8, 28, 34);
  addGalleryPoint(0, 14.2, -37.0, 0xfff0d4, 34, 38);

  // Path of History warm gallery wash along the nave
  addGalleryPoint(0, 12.5, 34, 0xffeacc, 24, 38);
  addGalleryPoint(0, 12.5, 8, 0xffeacc, 24, 38);
  addGalleryPoint(0, 12.5, -16, 0xffeacc, 24, 38);

  // Dedicated intimate gold spotlights inside the Room of Quiet Contemplation
  addGalleryPoint(17.2, 5.4, -3.2, 0xffd58a, 18, 16);
  addGalleryPoint(17.2, 5.4, 3.2, 0xffd58a, 18, 16);

  // West & East vitrine arcade accent wash
  addGalleryPoint(-14.5, 5.2, 18, 0xffe8c2, 16, 24);
  addGalleryPoint(-14.5, 5.2, -14, 0xffe8c2, 16, 24);
  addGalleryPoint(14.5, 5.2, 24, 0xffe8c2, 14, 22);
  addGalleryPoint(14.5, 5.2, -22, 0xffe8c2, 14, 22);

  // -----------------------------------------------------------------------
  // 8. CALM INDOOR MUSEUM VISITORS (PersonCrowd + PersonRig walking loops)
  // -----------------------------------------------------------------------
  const visitorSpecs = [
    { waypoints: [[-3.2, 38], [-3.2, -24], [3.2, -24], [3.2, 38]], speed: 1.05, seed: 101, female: true },
    { waypoints: [[4.1, 24], [4.1, -30], [-4.1, -30], [-4.1, 24]], speed: 0.92, seed: 205, female: false },
    { waypoints: [[-12.2, 32], [-12.2, -28], [-12.2, 32]], speed: 0.85, seed: 309, female: true },
    { waypoints: [[7.8, 36], [7.8, 16], [13.2, 4], [13.2, -4], [7.8, -16], [7.8, 36]], speed: 0.82, seed: 412, female: false },
    { waypoints: [[-2.0, -28], [5.8, -32], [5.8, -48], [-5.8, -48], [-5.8, -32]], speed: 0.78, seed: 518, female: true },
    { waypoints: [[14.0, -6.5], [14.0, 6.5]], speed: 0.56, seed: 623, female: false }
  ];

  const visitorCrowd = new PersonCrowd(visitorSpecs.length, { farDistance: 95 });
  // Keep visitorCrowd in world coordinates because PersonRig writes world coords
  const visitorWorldGroup = new THREE.Group();
  visitorWorldGroup.name = 'MuseumVisitors';
  visitorWorldGroup.visible = false;
  visitorCrowd.meshes.forEach((m) => {
    m.castShadow = !isSoftwareGl;
    visitorWorldGroup.add(m);
  });
  scene.add(visitorWorldGroup);

  const flatGround = () => MUSEUM_HALL.floorY;
  const visitors = visitorSpecs.map((spec, idx) => {
    const start = spec.waypoints[0];
    const next = spec.waypoints[1 % spec.waypoints.length];
    const wx = MUSEUM_ORIGIN.x + start[0];
    const wz = MUSEUM_ORIGIN.z + start[1];
    const heading = Math.atan2(next[0] - start[0], next[1] - start[1]);
    const rig = new PersonRig({
      seed: spec.seed,
      scale: 0.96 + (idx % 3) * 0.03,
      female: spec.female,
      girth: 0.96 + (idx % 2) * 0.08
    });
    rig.reset(wx, wz, heading, flatGround, null);
    return {
      rig,
      waypoints: spec.waypoints,
      segIdx: 0,
      wx,
      wz,
      heading,
      speed: spec.speed,
      pauseTimer: (idx % 3) * 1.1
    };
  });

  scene.add(root);

  let active = false;
  let activeTimeId = 'midday';
  let activeMood = getMuseumLightingMood(activeTimeId);

  function applyLightingMood(timeId) {
    activeTimeId = timeId || activeTimeId;
    activeMood = getMuseumLightingMood(activeTimeId);

    indoorAmbient.color.setHex(activeMood.ambientColor);
    indoorAmbient.intensity = activeMood.ambientIntensity;
    atriumKeyLight.color.setHex(activeMood.skylightColor);
    atriumKeyLight.intensity = activeMood.skylightIntensity;

    const sk = new THREE.Color(activeMood.skylightColor).multiplyScalar(activeMood.skylightGlow);
    skylightMat.color.copy(sk);

    const spotScale = activeMood.spotIntensity / 3.0;
    for (const g of galleryLights) {
      g.light.intensity = g.baseIntensity * spotScale;
    }

    if (active) {
      scene.background = new THREE.Color(activeMood.backgroundHex);
      if (scene.fog) {
        scene.fog.color.setHex(activeMood.fogHex);
        if ('density' in scene.fog) scene.fog.density = activeMood.fogDensity;
      }
    }
  }

  function setActive(isActive, timeId = activeTimeId) {
    active = !!isActive;
    root.visible = active;
    visitorWorldGroup.visible = active;
    if (active) {
      applyLightingMood(timeId);
      root.updateMatrixWorld(true);
      visitorWorldGroup.updateMatrixWorld(true);
    }
  }

  function update(dt) {
    if (!active) return;
    visitorCrowd.begin();
    for (let i = 0; i < visitors.length; i++) {
      const v = visitors[i];
      if (v.pauseTimer > 0) {
        v.pauseTimer = Math.max(0, v.pauseTimer - dt);
      } else {
        const target = v.waypoints[(v.segIdx + 1) % v.waypoints.length];
        const tx = MUSEUM_ORIGIN.x + target[0];
        const tz = MUSEUM_ORIGIN.z + target[1];
        const dx = tx - v.wx;
        const dz = tz - v.wz;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.35) {
          v.segIdx = (v.segIdx + 1) % v.waypoints.length;
          v.pauseTimer = 1.6 + (i % 3) * 0.9;
        } else {
          const step = Math.min(dist, v.speed * dt);
          v.wx += (dx / dist) * step;
          v.wz += (dz / dist) * step;
          const desiredHeading = Math.atan2(dx, dz);
          let diff = desiredHeading - v.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          v.heading += diff * Math.min(1, dt * 4.5);
        }
      }
      v.rig.update(dt, v.wx, v.wz, v.heading, flatGround, null, 0, true, -1);
      visitorCrowd.add(v.rig, 0);
    }
    visitorCrowd.end();
  }

  applyLightingMood(activeTimeId);

  return {
    group: root,
    visitorGroup: visitorWorldGroup,
    colliders: MUSEUM_COLLIDERS,
    setActive,
    setTimeOfDay: applyLightingMood,
    update,
    getActiveMood: () => activeMood
  };
}

export { buildNationalMuseumInterior };
