import { polygonContains, polygonBoxOverlaps } from './building-collision.js';

function boxCorners(x, z, w, d, cs, sn) {
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) =>
    ({ x: x + u * cs + v * sn, z: z - u * sn + v * cs }));
}

// Corners alone miss concave notches and holes enclosed by the rectangle.
function containsBox(polygon, x, z, w, d, cs, sn) {
  if (!boxCorners(x, z, w, d, cs, sn).every((p) => polygonContains(polygon, p.x, p.z))) return false;
  const hx = w / 2, hz = d / 2;
  for (const ring of [polygon.outer, ...polygon.holes]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const ax = (a.x - x) * cs - (a.z - z) * sn, az = (a.x - x) * sn + (a.z - z) * cs;
      const bx = (b.x - x) * cs - (b.z - z) * sn, bz = (b.x - x) * sn + (b.z - z) * cs;
      if (Math.abs(ax) < hx && Math.abs(az) < hz) return false;
      for (const u of [-hx, hx]) {
        const t = (u - ax) / (bx - ax);
        if (t >= 0 && t <= 1 && Math.abs(az + (bz - az) * t) < hz) return false;
      }
      for (const v of [-hz, hz]) {
        const t = (v - az) / (bz - az);
        if (t >= 0 && t <= 1 && Math.abs(ax + (bx - ax) * t) < hx) return false;
      }
    }
  }
  return true;
}

// High-resolution photographic textures of actual Gangnam Teheran-ro storefronts and buildings
const GANGNAM_TEXTURES = {
  storefronts: '/textures/gangnam_storefronts.jpg',
  facades: '/textures/gangnam_facades.jpg'
};

const GANGNAM_STOREFRONT_ATLAS = [
  // 0: Starbucks Coffee (스타벅스 테헤란로점)
  { id: 'starbucks', name: '스타벅스 테헤란로점 · STARBUCKS', u0: 0.02, v0: 0.68, u1: 0.48, v1: 0.98, brandColor: 0x006241, lightColor: 0x78e590 },
  // 1: Olive Young (올리브영 강남타운점)
  { id: 'oliveyoung', name: '올리브영 강남타운점 · OLIVE YOUNG', u0: 0.52, v0: 0.68, u1: 0.98, v1: 0.98, brandColor: 0x589000, lightColor: 0x9fe024 },
  // 2: Paris Baguette (파리바게뜨 카페)
  { id: 'parisbaguette', name: '파리바게뜨 카페 · PARIS BAGUETTE', u0: 0.64, v0: 0.35, u1: 0.98, v1: 0.65, brandColor: 0x0b2341, lightColor: 0x60a5fa },
  // 3: A Twosome Place (투썸플레이스 테헤란점)
  { id: 'twosome', name: '투썸플레이스 · A TWOSOME PLACE', u0: 0.36, v0: 0.02, u1: 0.67, v1: 0.32, brandColor: 0xd62828, lightColor: 0xffd580 },
  // 4: GS25 24H (GS25 24시 편의점)
  { id: 'gs25', name: 'GS25 · 테헤란밸리 24H 편의점', u0: 0.69, v0: 0.02, u1: 0.98, v1: 0.32, brandColor: 0x002f6c, lightColor: 0x38b6ff }
];

let _cachedStorefrontTexture = null;
let _cachedFacadeTexture = null;

function getGangnamStorefrontTexture() {
  const THREE = globalThis.THREE;
  if (!THREE) return null;
  if (!_cachedStorefrontTexture) {
    const loader = new THREE.TextureLoader();
    _cachedStorefrontTexture = loader.load(GANGNAM_TEXTURES.storefronts);
    _cachedStorefrontTexture.colorSpace = THREE.SRGBColorSpace;
    _cachedStorefrontTexture.anisotropy = 16;
  }
  return _cachedStorefrontTexture;
}

function getGangnamFacadeTexture() {
  const THREE = globalThis.THREE;
  if (!THREE) return null;
  if (!_cachedFacadeTexture) {
    const loader = new THREE.TextureLoader();
    _cachedFacadeTexture = loader.load(GANGNAM_TEXTURES.facades);
    _cachedFacadeTexture.colorSpace = THREE.SRGBColorSpace;
    _cachedFacadeTexture.wrapS = THREE.RepeatWrapping;
    _cachedFacadeTexture.wrapT = THREE.RepeatWrapping;
    _cachedFacadeTexture.anisotropy = 16;
  }
  return _cachedFacadeTexture;
}

function createGangnamStorefrontPhotoMaterials() {
  const THREE = globalThis.THREE;
  if (!THREE) return [];
  const baseTex = getGangnamStorefrontTexture();
  if (!baseTex) return [];

  const MatClass = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return GANGNAM_STOREFRONT_ATLAS.map((theme) => {
    const tex = baseTex.clone();
    tex.offset.set(theme.u0, theme.v0);
    tex.repeat.set(theme.u1 - theme.u0, theme.v1 - theme.v0);
    tex.needsUpdate = true;
    return new MatClass({
      map: tex,
      roughness: 0.28,
      metalness: 0.35,
      emissive: new THREE.Color(theme.lightColor),
      emissiveIntensity: 0.12
    });
  });
}

function createGangnamPhotoFacadeMaterial() {
  const THREE = globalThis.THREE;
  if (!THREE) return null;
  const tex = getGangnamFacadeTexture();
  if (!tex) return null;
  const MatClass = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new MatClass({
    map: tex,
    roughness: 0.22,
    metalness: 0.55
  });
}

function addBuildingDetails(b, detail, { masonry, rand, neighbours }) {
  const roofY = b.height + 0.22;
  const streetReserves = [];
  const edges = b.polygons.flatMap((polygon) => polygon.outer.map((a, i, ring) => {
    const c = ring[(i + 1) % ring.length], dx = c.x - a.x, dz = c.z - a.z;
    const length = Math.hypot(dx, dz);
    return { x: (a.x + c.x) / 2, z: (a.z + c.z) / 2, nx: dz / length, nz: -dx / length, length, polygon };
  })).filter((edge) => edge.length >= 4).sort((a, b) => b.length - a.length);
  if (!edges.length || b.height < 6) return streetReserves;

  function blocked(x, z, w, d, cs, sn, roof = false) {
    return neighbours.some((r) => (!roof || (r.polygons !== b.polygons && (r.height ?? Infinity) > roofY - 0.1))
      && r.polygons.some((p) => polygonBoxOverlaps(p, x, z, w / 2, d / 2, cs, sn)));
  }

  if (masonry) {
    for (const e of edges.slice(0, 16)) {
      const x = e.x - e.nx * 0.1, z = e.z - e.nz * 0.1;
      const cs = -e.nz, sn = -e.nx;
      if (blocked(x, z, e.length - 0.1, 0.65, cs, sn, true)) continue;
      detail.cornices.push({ x, y: roofY, z, w: e.length - 0.1, h: 0.55, d: 0.65, ry: Math.atan2(sn, cs) });
    }
  }

  const ringArea = (ring) => Math.abs(ring.reduce((n, a, i) => {
    const c = ring[(i + 1) % ring.length];
    return n + a.x * c.z - c.x * a.z;
  }, 0));
  const area = (p) => ringArea(p.outer) - p.holes.reduce((n, ring) => n + ringArea(ring), 0);
  const polygon = b.polygons.reduce((a, c) => area(a) > area(c) ? a : c);
  const edge = edges.find((e) => e.polygon === polygon);
  if (edge) {
    const cs = -edge.nz, sn = -edge.nx, ry = Math.atan2(sn, cs);
    const us = polygon.outer.map((p) => (p.x - b.cx) * cs - (p.z - b.cz) * sn);
    const vs = polygon.outer.map((p) => (p.x - b.cx) * sn + (p.z - b.cz) * cs);
    const minU = Math.min(...us), maxU = Math.max(...us), minV = Math.min(...vs), maxV = Math.max(...vs);
    const occupied = [];
    function roofSpot(w, d) {
      if (maxU - minU < w + 1 || maxV - minV < d + 1) return null;
      for (let i = 0; i < 8; i++) {
        const u = minU + w / 2 + 0.5 + rand() * (maxU - minU - w - 1);
        const v = minV + d / 2 + 0.5 + rand() * (maxV - minV - d - 1);
        const x = b.cx + u * cs + v * sn, z = b.cz - u * sn + v * cs;
        if (!containsBox(polygon, x, z, w + 0.6, d + 0.6, cs, sn) || blocked(x, z, w, d, cs, sn, true)
          || occupied.some((p) => polygonBoxOverlaps(p, x, z, w / 2 + 0.3, d / 2 + 0.3, cs, sn))) continue;
        occupied.push({ outer: boxCorners(x, z, w, d, cs, sn), holes: [] });
        return { x, y: roofY, z, ry };
      }
      return null;
    }
    if (masonry && b.height >= 14 && rand() < 0.25) {
      const spot = roofSpot(4, 4);
      if (spot) detail.waterTowers.push(spot);
    }
    if (rand() < 0.35) {
      const w = 2.4 + rand() * 2.6, d = 2.4 + rand() * 2.6, spot = roofSpot(w, d);
      if (spot) detail.hvacUnits.push({ ...spot, w, d, h: masonry ? 2.4 : 3.4 });
    }
  }

  let count = 0;
  for (const e of edges) {
    const segments = Math.floor(e.length / 10);
    for (let i = 0; i < segments && count < 4; i++) {
      if (rand() > 0.22) continue;
      const u = ((i + 0.5) / segments - 0.5) * e.length, d = Math.min(8.5, e.length / segments - 1.6);
      const x = e.x - e.nz * u, z = e.z + e.nx * u, cs = e.nx, sn = -e.nz;
      // Keep storefronts out of courtyards and away from neighbouring walls or fire escapes.
      if (blocked(x + e.nx * 2.65, z + e.nz * 2.65, 5.2, d + 0.4, cs, sn)) continue;
      const ry = Math.atan2(sn, cs);
      let item;
      if (!detail.scaffoldSheds.length && rand() < 0.06) {
        item = { x: x + e.nx * 2, y: 0.22, z: z + e.nz * 2, w: 3.8, d, ry };
        detail.scaffoldSheds.push(item);
      } else {
        if (!b.storefronts) continue;
        const colorIdx = Math.floor(rand() * 5);
        const atlasEntry = GANGNAM_STOREFRONT_ATLAS[colorIdx % GANGNAM_STOREFRONT_ATLAS.length];
        item = {
          x: x + e.nx,
          y: 3.8,
          z: z + e.nz,
          w: 1.8,
          d,
          colorIdx,
          ry,
          photoThemeIdx: colorIdx,
          brandId: atlasEntry.id,
          brandName: atlasEntry.name
        };
        detail.awnings.push(item);
        if (detail.photoStorefronts) {
          detail.photoStorefronts.push({
            x: x + e.nx * 0.08,
            y: 1.9,
            z: z + e.nz * 0.08,
            w: 0.15,
            h: 3.8,
            d: d * 0.95,
            ry,
            themeIdx: colorIdx,
            brandId: atlasEntry.id
          });
        }
      }
      const outer = boxCorners(item.x, item.z, item.w, item.d, cs, sn);
      const xs = outer.map((p) => p.x), zs = outer.map((p) => p.z);
      const reserve = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs),
        height: 0, polygons: [{ outer, holes: [] }] };
      streetReserves.push(reserve);
      neighbours.push(reserve);
      count++;
    }
    if (count === 4) break;
  }
  return streetReserves;
}

export {
  addBuildingDetails,
  GANGNAM_TEXTURES,
  GANGNAM_STOREFRONT_ATLAS,
  getGangnamStorefrontTexture,
  getGangnamFacadeTexture,
  createGangnamStorefrontPhotoMaterials,
  createGangnamPhotoFacadeMaterial
};
