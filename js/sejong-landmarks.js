import * as THREE from 'three/webgpu';

// Architectural footprints & parameters for Sejong Special Self-Governing City's distinctive
// government & civic landmarks (tested against road clearance in tests/sejong-roads.test.cjs).
const SEJONG_BUILDING_LAYOUT = {
  // Government Complex Sejong — 4 low-rise horizontal blocks connected by elevated S-curve skybridges & rooftop gardens
  complexNW: { id: 'complex_nw', cx: 77.5, cz: -1250.5, w: 118, d: 52, h: 22.5, minX: 16, maxX: 139, minZ: -1278, maxZ: -1223 },
  complexSW: { id: 'complex_sw', cx: 77.5, cz: -1159.5, w: 118, d: 50, h: 21.0, minX: 16, maxX: 139, minZ: -1186, maxZ: -1133 },
  complexNW2: { id: 'complex_nw2', cx: 77.5, cz: -1330.5, w: 116, d: 50, h: 20.5, minX: 17, maxX: 138, minZ: -1357, maxZ: -1304 },
  complexNE: { id: 'complex_ne', cx: 228.5, cz: -1250.0, w: 108, d: 52, h: 22.0, minX: 172, maxX: 285, minZ: -1278, maxZ: -1222 },
  // Elevated skybridges crossing streets with >= 17.5m vertical clearance so buses/trucks pass underneath
  skybridges: [
    { id: 'bridge_dasom_ns', points: [[72, 20.5, -1224], [84, 21.8, -1204], [74, 20.2, -1184]], width: 9.5, deckY: 20.5 },
    { id: 'bridge_north_ns', points: [[82, 20.0, -1305], [72, 21.2, -1291], [80, 20.5, -1276]], width: 8.8, deckY: 20.2 },
    { id: 'bridge_east_ew', points: [[135, 20.8, -1253], [155, 22.6, -1246], [175, 20.8, -1252]], width: 9.2, deckY: 21.0 }
  ],
  // National Library of Sejong & Presidential Archives (Sejong Lake Park)
  library: { id: 'sejong_library', cx: -110, cz: -2430, w: 54, d: 36, h: 22 },
  archives: { id: 'sejong_archives', cx: -265, cz: -2465, w: 38, d: 38, h: 28 },
  // Prime Minister's Office & Central Administrative Tower (Boram/Jiphyeon corridor near tp sejong_pmo)
  pmo: { id: 'sejong_pmo', cx: 176, cz: 4538.5, w: 132, d: 52, h: 28, minX: 110, maxX: 242, minZ: 4512, maxZ: 4565 },
  // Sejong City Hall & Council (Boram-dong circular civic complex near tp sejong_cityhall)
  cityHall: { id: 'sejong_cityhall', cx: 572, cz: 4890, w: 136, d: 126, h: 26, minX: 500, maxX: 644, minZ: 4824, maxZ: 4956 },
  // Landmark signboard pylon
  monument: { id: 'sejong_monument', cx: -40, cz: -1430, w: 14, d: 6, h: 7 }
};

/**
 * Generates an extruded cross-section for the National Library of Sejong's iconic
 * "open book / hanok eaves" hyperbolic curved roof canopy.
 */
function createOpenBookRoofGeometry(spanWidth = 54, depth = 34, thickness = 1.45) {
  const halfW = spanWidth * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, 6.4);
  shape.quadraticCurveTo(-halfW * 0.45, 0.2, 0, 0);
  shape.quadraticCurveTo(halfW * 0.45, 0.2, halfW, 6.4);
  shape.lineTo(halfW - 0.6, 6.4 + thickness);
  shape.quadraticCurveTo(halfW * 0.45, 0.2 + thickness, 0, thickness);
  shape.quadraticCurveTo(-halfW * 0.45, 0.2 + thickness, -halfW + 0.6, 6.4 + thickness);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.28,
    bevelSize: 0.25,
    bevelSegments: 2,
    curveSegments: 20
  });
  geo.translate(0, 0, -depth * 0.5);
  return geo;
}

/**
 * Generates a curved C-ring civic council wing geometry ("Cheonwonjibang" circular motif)
 * for Sejong City Hall & Council.
 */
function createCivicArcGeometry(innerR, outerR, startAngle, endAngle, height) {
  const shape = new THREE.Shape();
  const segs = 28;
  for (let i = 0; i <= segs; i++) {
    const a = startAngle + (endAngle - startAngle) * (i / segs);
    const x = Math.cos(a) * outerR;
    const y = Math.sin(a) * outerR;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = segs; i >= 0; i--) {
    const a = startAngle + (endAngle - startAngle) * (i / segs);
    shape.lineTo(Math.cos(a) * innerR, Math.sin(a) * innerR);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 24
  });
  geo.rotateX(-Math.PI * 0.5);
  return geo;
}

function makeSejongSignTexture(title, subtitle, accent = '#38bdf8') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#072247';
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.strokeRect(6, 6, 500, 148);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 38px Pretendard, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 256, 60);
  ctx.fillStyle = '#bae6fd';
  ctx.font = '600 21px Pretendard, Inter, sans-serif';
  ctx.fillText(subtitle, 256, 114);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds all custom Sejong City government & civic architectural landmarks and appends
 * their ground footprints to `colliders` so generic procedural skyscrapers yield to them.
 */
function buildSejongLandmarks(group, colliders, mats) {
  const {
    limestoneTrimMat,
    stainlessSteelMat,
    darkBronzeFrameMat,
    warmFloodMat,
    landmarkSilverCurtainMat,
    landmarkBronzeCurtainMat
  } = mats;

  // Distinct Sejong architectural PBR material palette (high roughness contrast >= 0.25 between adjacent elements)
  const ceramicWhiteMat = new THREE.MeshStandardNodeMaterial({
    color: 0xeaf0f6,
    roughness: 0.42,
    metalness: 0.14
  });
  const warmWoodSoffitMat = new THREE.MeshStandardNodeMaterial({
    color: 0xa67449,
    roughness: 0.78,
    metalness: 0.04
  });
  const skyGardenTurfMat = new THREE.MeshStandardNodeMaterial({
    color: 0x3b7a47,
    roughness: 0.90,
    metalness: 0.02
  });
  const granitePlazaMat = new THREE.MeshStandardNodeMaterial({
    color: 0xc2c8ce,
    roughness: 0.74,
    metalness: 0.06
  });
  const goldVaultMat = new THREE.MeshStandardNodeMaterial({
    color: 0xdfa93e,
    roughness: 0.22,
    metalness: 0.90
  });
  const archivesGlassMat = new THREE.MeshPhysicalNodeMaterial({
    color: 0xbfe2f7,
    roughness: 0.08,
    metalness: 0.12,
    transparent: true,
    opacity: 0.34,
    depthWrite: false
  });
  const fountainWaterMat = new THREE.MeshStandardNodeMaterial({
    color: 0x1b6588,
    roughness: 0.08,
    metalness: 0.75
  });
  const warmGardenGlowMat = new THREE.MeshStandardNodeMaterial({
    color: 0xfff0cc,
    emissive: 0xffc66e,
    emissiveIntensity: 1.25,
    roughness: 0.3
  });

  const signComplexMat = new THREE.MeshBasicNodeMaterial({
    map: makeSejongSignTexture('정부세종청사 · 옥상정원', '다솜로 · 한누리대로 행정중심복합도시', '#facc15')
  });
  const signLibraryMat = new THREE.MeshBasicNodeMaterial({
    map: makeSejongSignTexture('국립세종도서관', '세종호수공원 · 정책정보 특화도서관', '#38bdf8')
  });
  const signArchivesMat = new THREE.MeshBasicNodeMaterial({
    map: makeSejongSignTexture('대통령기록관', '국새함 모티브 · 투명 유리 큐브', '#fbbf24')
  });
  const signPmoMat = new THREE.MeshBasicNodeMaterial({
    map: makeSejongSignTexture('국무총리실 · 정부청사 중앙동', '국무조정실 · 행정안전부', '#38bdf8')
  });
  const signCityHallMat = new THREE.MeshBasicNodeMaterial({
    map: makeSejongSignTexture('세종특별자치시청 · 시의회', '보람동 시청대로 행정타운', '#facc15')
  });

  const excludeFromBatch = new Set([
    stainlessSteelMat,
    archivesGlassMat,
    signComplexMat,
    signLibraryMat,
    signArchivesMat,
    signPmoMat,
    signCityHallMat
  ]);

  // =========================================================================
  // 1. 정부세종청사 (Government Complex Sejong — Dragon-shaped Low-Rise Pavilion + Continuous Rooftop Garden)
  // =========================================================================
  {
    const complexGroup = new THREE.Group();
    const wingDefs = [
      SEJONG_BUILDING_LAYOUT.complexNW,
      SEJONG_BUILDING_LAYOUT.complexSW,
      SEJONG_BUILDING_LAYOUT.complexNW2,
      SEJONG_BUILDING_LAYOUT.complexNE
    ];

    for (let idx = 0; idx < wingDefs.length; idx++) {
      const cfg = wingDefs[idx];
      const wing = new THREE.Group();
      wing.position.set(cfg.cx, 0, cfg.cz);

      // Granite civic plinth
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(cfg.w + 4, 1.0, cfg.d + 4), granitePlazaMat);
      plinth.position.y = 0.5;
      plinth.receiveShadow = true;
      wing.add(plinth);

      // Open 1st-floor recessed lobby + perimeter piloti colonnade (hallmark of Sejong buildings)
      const lobbyCore = new THREE.Mesh(new THREE.BoxGeometry(cfg.w - 14, 4.6, cfg.d - 14), warmFloodMat);
      lobbyCore.position.y = 3.3;
      wing.add(lobbyCore);

      const pilotiGeo = new THREE.CylinderGeometry(0.65, 0.72, 4.8, 12);
      const colStepX = 14;
      const colCountX = Math.floor((cfg.w - 8) / colStepX);
      for (let i = 0; i <= colCountX; i++) {
        const px = -cfg.w * 0.44 + (cfg.w * 0.88 * i) / colCountX;
        for (const pz of [-cfg.d * 0.44, cfg.d * 0.44]) {
          const col = new THREE.Mesh(pilotiGeo, ceramicWhiteMat);
          col.position.set(px, 3.4, pz);
          col.castShadow = true;
          wing.add(col);
        }
      }

      // Main 5-story horizontal office volume (set back at upper terrace level for stepped garden silhouette)
      const bodyH = cfg.h - 5.6;
      const mainBody = new THREE.Mesh(new THREE.BoxGeometry(cfg.w - 4, bodyH, cfg.d - 6), landmarkSilverCurtainMat);
      mainBody.position.y = 5.6 + bodyH * 0.5;
      mainBody.castShadow = true;
      mainBody.receiveShadow = true;
      wing.add(mainBody);

      // Stepped upper wing inset (asymmetric Sejong terrace profile)
      const upperOffset = (idx % 2 === 0 ? -1 : 1) * 8;
      const upperWing = new THREE.Mesh(new THREE.BoxGeometry(cfg.w * 0.58, 4.2, cfg.d - 14), landmarkBronzeCurtainMat);
      upperWing.position.set(upperOffset, cfg.h + 2.1, 0);
      upperWing.castShadow = true;
      wing.add(upperWing);

      // Modernized Hanok eaves horizontal sun-shading bands & warm wood soffit trim
      for (const bandY of [6.0, 11.2, 16.4, cfg.h - 0.3]) {
        const eave = new THREE.Mesh(new THREE.BoxGeometry(cfg.w + 1.2, 0.65, cfg.d - 1.2), ceramicWhiteMat);
        eave.position.y = bandY;
        eave.castShadow = true;
        wing.add(eave);

        const soffit = new THREE.Mesh(new THREE.BoxGeometry(cfg.w + 0.4, 0.24, cfg.d - 2.0), warmWoodSoffitMat);
        soffit.position.y = bandY - 0.38;
        wing.add(soffit);
      }

      // Vertical architectural stone/bronze pilaster blades breaking up horizontal span
      const finGeo = new THREE.BoxGeometry(0.9, bodyH + 0.6, cfg.d - 1.0);
      for (let f = -2; f <= 2; f++) {
        const fin = new THREE.Mesh(finGeo, ceramicWhiteMat);
        fin.position.set(f * (cfg.w * 0.2), 5.6 + bodyH * 0.5, 0);
        wing.add(fin);
      }

      // Continuous Green Rooftop Garden ("세계 최장 옥상정원") + wooden boardwalk + pergola ribs
      const gardenBase = new THREE.Mesh(new THREE.BoxGeometry(cfg.w - 5, 0.7, cfg.d - 7), skyGardenTurfMat);
      gardenBase.position.y = cfg.h + 0.35;
      gardenBase.receiveShadow = true;
      wing.add(gardenBase);

      const boardwalk = new THREE.Mesh(new THREE.BoxGeometry(cfg.w - 12, 0.25, 6.2), warmWoodSoffitMat);
      boardwalk.position.y = cfg.h + 0.8;
      wing.add(boardwalk);

      // Sculptural pergola arch ribs & warm path lights along rooftop garden
      for (let p = -3; p <= 3; p++) {
        const rx = p * ((cfg.w - 22) / 6);
        const rib = new THREE.Mesh(new THREE.BoxGeometry(1.1, 3.6, 10.2), ceramicWhiteMat);
        rib.position.set(rx, cfg.h + 2.4, 0);
        wing.add(rib);

        const lightStrip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 8.6), warmGardenGlowMat);
        lightStrip.position.set(rx, cfg.h + 3.95, 0);
        wing.add(lightStrip);
      }

      // Add signboard facing Dasom-ro on NW & SW main complex wings
      if (idx === 0 || idx === 1) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(19, 5.8), signComplexMat);
        sign.position.set(0, 8.4, idx === 0 ? cfg.d * 0.5 - 0.4 : -cfg.d * 0.5 + 0.4);
        if (idx === 1) sign.rotation.y = Math.PI;
        wing.add(sign);
      }

      complexGroup.add(wing);
      colliders.push({
        minX: cfg.minX,
        maxX: cfg.maxX,
        minZ: cfg.minZ,
        maxZ: cfg.maxZ,
        maxY: cfg.h + 5
      });
    }

    // Iconic S-Curve Elevated Skybridges connecting complex buildings over Dasom-ro & center avenue
    for (const br of SEJONG_BUILDING_LAYOUT.skybridges) {
      const curvePts = br.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
      const curve = new THREE.CatmullRomCurve3(curvePts);
      const samples = 14;
      for (let s = 0; s < samples; s++) {
        const t0 = s / samples;
        const t1 = (s + 1) / samples;
        const p0 = curve.getPoint(t0);
        const p1 = curve.getPoint(t1);
        const mid = p0.clone().add(p1).multiplyScalar(0.5);
        const dir = p1.clone().sub(p0);
        const segLen = dir.length() + 0.8;
        const yaw = Math.atan2(dir.x, dir.z);

        const seg = new THREE.Group();
        seg.position.copy(mid);
        seg.rotation.y = yaw;

        // Structural white belly girder (clear above traffic at y >= 18.2m)
        const girder = new THREE.Mesh(new THREE.BoxGeometry(br.width, 1.35, segLen), ceramicWhiteMat);
        girder.position.y = -1.6;
        girder.castShadow = true;
        seg.add(girder);

        // Glazed enclosed skywalk tunnel
        const tunnel = new THREE.Mesh(new THREE.BoxGeometry(br.width - 1.2, 3.2, segLen), landmarkSilverCurtainMat);
        tunnel.position.y = 0.65;
        tunnel.castShadow = true;
        seg.add(tunnel);

        // Continuous rooftop garden lawn atop skybridge
        const topLawn = new THREE.Mesh(new THREE.BoxGeometry(br.width - 0.4, 0.55, segLen), skyGardenTurfMat);
        topLawn.position.y = 2.55;
        seg.add(topLawn);

        // Parapet glass/white side rails + underside architectural glow strip
        for (const side of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.1, segLen), ceramicWhiteMat);
          rail.position.set(side * (br.width * 0.48), 3.1, 0);
          seg.add(rail);
        }
        const underGlow = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, segLen), warmGardenGlowMat);
        underGlow.position.y = -2.35;
        seg.add(underGlow);

        complexGroup.add(seg);
      }
    }

    group.add(complexGroup);
  }

  // =========================================================================
  // 2. 국립세종도서관 (National Library of Sejong — Extruded Parabolic "Open Book" Roof)
  // =========================================================================
  {
    const lib = SEJONG_BUILDING_LAYOUT.library;
    const libGroup = new THREE.Group();
    libGroup.position.set(lib.cx, 0, lib.cz);

    // 2-tier waterfront stone deck & steps facing Sejong Lake
    const plinthLower = new THREE.Mesh(new THREE.BoxGeometry(60, 0.8, 42), granitePlazaMat);
    plinthLower.position.y = 0.4;
    plinthLower.receiveShadow = true;
    libGroup.add(plinthLower);

    const plinthUpper = new THREE.Mesh(new THREE.BoxGeometry(52, 0.9, 34), limestoneTrimMat);
    plinthUpper.position.y = 1.25;
    plinthUpper.castShadow = true;
    plinthUpper.receiveShadow = true;
    libGroup.add(plinthUpper);

    // Recessed radiant ground lobby + curved glass core
    const libCore = new THREE.Mesh(new THREE.BoxGeometry(40, 12.2, 24), landmarkSilverCurtainMat);
    libCore.position.y = 7.8;
    libCore.castShadow = true;
    libCore.receiveShadow = true;
    libGroup.add(libCore);

    const libAtriumGlow = new THREE.Mesh(new THREE.BoxGeometry(34, 5.4, 24.4), warmFloodMat);
    libAtriumGlow.position.y = 4.6;
    libGroup.add(libAtriumGlow);

    // Vertical bronze louver screen around glass facade (Korean bookshelf motif)
    const finGeo = new THREE.BoxGeometry(0.35, 11.4, 25.0);
    for (let x = -18; x <= 18; x += 3.0) {
      const fin = new THREE.Mesh(finGeo, darkBronzeFrameMat);
      fin.position.set(x, 7.8, 0);
      libGroup.add(fin);
    }

    // Extruded hyperbolic "Open Book Pages" curved roof canopy & warm wood soffit underneath
    const bookRoofGeo = createOpenBookRoofGeometry(56, 33, 1.35);
    const bookRoofMesh = new THREE.Mesh(bookRoofGeo, stainlessSteelMat);
    bookRoofMesh.position.y = 13.8;
    bookRoofMesh.castShadow = true;
    bookRoofMesh.receiveShadow = true;
    libGroup.add(bookRoofMesh);

    const bookSoffitGeo = createOpenBookRoofGeometry(54.5, 31.8, 0.45);
    const bookSoffitMesh = new THREE.Mesh(bookSoffitGeo, warmWoodSoffitMat);
    bookSoffitMesh.position.y = 13.35;
    libGroup.add(bookSoffitMesh);

    // Signboard on south plaza side
    const libSign = new THREE.Mesh(new THREE.PlaneGeometry(16, 5.0), signLibraryMat);
    libSign.position.set(0, 8.6, 12.6);
    libGroup.add(libSign);

    group.add(libGroup);
    colliders.push({
      minX: lib.cx - 30,
      maxX: lib.cx + 30,
      minZ: lib.cz - 21,
      maxZ: lib.cz + 21,
      maxY: 23
    });
  }

  // =========================================================================
  // 3. 대통령기록관 (Presidential Archives — Translucent Glass Cube & Floating Gold Vault)
  // =========================================================================
  {
    const arch = SEJONG_BUILDING_LAYOUT.archives;
    const archGroup = new THREE.Group();
    archGroup.position.set(arch.cx, 0, arch.cz);

    const archBase = new THREE.Mesh(new THREE.BoxGeometry(38, 1.8, 38), granitePlazaMat);
    archBase.position.y = 0.9;
    archBase.receiveShadow = true;
    archGroup.add(archBase);

    const archUplight = new THREE.Mesh(new THREE.BoxGeometry(20, 0.4, 20), warmGardenGlowMat);
    archUplight.position.y = 2.0;
    archGroup.add(archUplight);

    // Inner metallic Golden Seal ("옥새함") core hovering inside the glass prism
    const archVault = new THREE.Mesh(new THREE.BoxGeometry(15.5, 16.5, 15.5), goldVaultMat);
    archVault.position.y = 13.2;
    archVault.castShadow = true;
    archGroup.add(archVault);

    const vaultPedestal = new THREE.Mesh(new THREE.BoxGeometry(9.5, 4.2, 9.5), darkBronzeFrameMat);
    vaultPedestal.position.y = 3.9;
    archGroup.add(vaultPedestal);

    // Outer translucent glass cube enclosure
    const archShell = new THREE.Mesh(new THREE.BoxGeometry(27, 24, 27), archivesGlassMat);
    archShell.position.y = 13.8;
    archGroup.add(archShell);

    // Perimeter X-diagrid steel frame & corner columns
    const cornerGeo = new THREE.BoxGeometry(1.2, 24.4, 1.2);
    for (const cx of [-13.4, 13.4]) {
      for (const cz of [-13.4, 13.4]) {
        const col = new THREE.Mesh(cornerGeo, darkBronzeFrameMat);
        col.position.set(cx, 14.0, cz);
        col.castShadow = true;
        archGroup.add(col);
      }
    }
    for (const faceZ of [-13.6, 13.6]) {
      for (const rot of [Math.PI * 0.25, -Math.PI * 0.25]) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(0.55, 34, 0.55), darkBronzeFrameMat);
        brace.position.set(0, 14.0, faceZ);
        brace.rotation.z = rot;
        archGroup.add(brace);
      }
    }
    for (const faceX of [-13.6, 13.6]) {
      for (const rot of [Math.PI * 0.25, -Math.PI * 0.25]) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(0.55, 34, 0.55), darkBronzeFrameMat);
        brace.position.set(faceX, 14.0, 0);
        brace.rotation.x = rot;
        archGroup.add(brace);
      }
    }

    const archRoof = new THREE.Mesh(new THREE.BoxGeometry(29, 1.6, 29), darkBronzeFrameMat);
    archRoof.position.y = 26.6;
    archGroup.add(archRoof);

    const archSign = new THREE.Mesh(new THREE.PlaneGeometry(14, 4.4), signArchivesMat);
    archSign.position.set(0, 5.2, 13.9);
    archGroup.add(archSign);

    group.add(archGroup);
    colliders.push({
      minX: arch.cx - 19,
      maxX: arch.cx + 19,
      minZ: arch.cz - 19,
      maxZ: arch.cz + 19,
      maxY: 28
    });
  }

  // =========================================================================
  // 4. 국무총리실 & 정부세종청사 중앙동 (Prime Minister's Office & Central Administrative Tower)
  // =========================================================================
  {
    const pmo = SEJONG_BUILDING_LAYOUT.pmo;
    const pmoGroup = new THREE.Group();
    pmoGroup.position.set(pmo.cx, 0, pmo.cz);

    const pmoPlaza = new THREE.Mesh(new THREE.BoxGeometry(pmo.w, 1.2, pmo.d), granitePlazaMat);
    pmoPlaza.position.y = 0.6;
    pmoPlaza.receiveShadow = true;
    pmoGroup.add(pmoPlaza);

    // 3-step terraced Sejong central ministry massing with green terrace decks
    const step1 = new THREE.Mesh(new THREE.BoxGeometry(118, 12, 42), landmarkSilverCurtainMat);
    step1.position.set(-6, 7.2, 0);
    step1.castShadow = true;
    step1.receiveShadow = true;
    pmoGroup.add(step1);

    const terrace1 = new THREE.Mesh(new THREE.BoxGeometry(116, 0.7, 40), skyGardenTurfMat);
    terrace1.position.set(-6, 13.55, 0);
    pmoGroup.add(terrace1);

    const step2 = new THREE.Mesh(new THREE.BoxGeometry(76, 10, 32), landmarkBronzeCurtainMat);
    step2.position.set(-14, 18.2, 0);
    step2.castShadow = true;
    pmoGroup.add(step2);

    const terrace2 = new THREE.Mesh(new THREE.BoxGeometry(74, 0.7, 30), skyGardenTurfMat);
    terrace2.position.set(-14, 23.55, 0);
    pmoGroup.add(terrace2);

    // Korean latticework ceramic sun-screen ribs along main facade
    const latticeGeo = new THREE.BoxGeometry(1.1, 13.2, 43.2);
    for (let x = -54; x <= 44; x += 7) {
      const blade = new THREE.Mesh(latticeGeo, ceramicWhiteMat);
      blade.position.set(x, 7.6, 0);
      pmoGroup.add(blade);
    }

    // Overhanging Hanok-eave ceremonial crown canopy
    const pmoCanopy = new THREE.Mesh(new THREE.BoxGeometry(82, 1.2, 36), ceramicWhiteMat);
    pmoCanopy.position.set(-14, 24.4, 0);
    pmoCanopy.castShadow = true;
    pmoGroup.add(pmoCanopy);

    // Ceremonial circular arch monument on the east plaza corner facing tp_sejong_pmo (258, 4581)
    const archMonument = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.85, 12, 32), stainlessSteelMat);
    archMonument.position.set(55, 8.2, 10);
    archMonument.rotation.y = Math.PI * 0.25;
    archMonument.castShadow = true;
    pmoGroup.add(archMonument);

    const monPlinth = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.2, 1.8, 24), granitePlazaMat);
    monPlinth.position.set(55, 1.5, 10);
    pmoGroup.add(monPlinth);

    const pmoSign = new THREE.Mesh(new THREE.PlaneGeometry(18, 5.4), signPmoMat);
    pmoSign.position.set(18, 9.2, 21.8);
    pmoGroup.add(pmoSign);

    group.add(pmoGroup);
    colliders.push({
      minX: pmo.minX,
      maxX: pmo.maxX,
      minZ: pmo.minZ,
      maxZ: pmo.maxZ,
      maxY: 30
    });
  }

  // =========================================================================
  // 5. 세종특별자치시청 & 세종시의회 (Sejong City Hall & Council — Circular "Cheonwonjibang" Complex)
  // =========================================================================
  {
    const ch = SEJONG_BUILDING_LAYOUT.cityHall;
    const chGroup = new THREE.Group();
    chGroup.position.set(ch.cx, 0, ch.cz);

    // Square citizen plaza stone base ("땅은 네모" motif)
    const plaza = new THREE.Mesh(new THREE.BoxGeometry(ch.w, 1.4, ch.d), granitePlazaMat);
    plaza.position.y = 0.7;
    plaza.receiveShadow = true;
    chGroup.add(plaza);

    // Sweeping Circular Council & Main Hall C-Ring ("하늘은 둥글다" motif)
    const ringGeo = createCivicArcGeometry(30, 52, Math.PI * 0.12, Math.PI * 1.48, 21);
    const ringMesh = new THREE.Mesh(ringGeo, landmarkSilverCurtainMat);
    ringMesh.position.y = 1.4;
    ringMesh.castShadow = true;
    ringMesh.receiveShadow = true;
    chGroup.add(ringMesh);

    // Cantilevered white eaves ring crown + wood soffit on the circular wing
    const roofRingGeo = createCivicArcGeometry(28.5, 54.2, Math.PI * 0.10, Math.PI * 1.50, 1.3);
    const roofRingMesh = new THREE.Mesh(roofRingGeo, ceramicWhiteMat);
    roofRingMesh.position.y = 22.4;
    roofRingMesh.castShadow = true;
    chGroup.add(roofRingMesh);

    const roofGardenRingGeo = createCivicArcGeometry(31.0, 51.0, Math.PI * 0.12, Math.PI * 1.48, 0.55);
    const roofGardenRingMesh = new THREE.Mesh(roofGardenRingGeo, skyGardenTurfMat);
    roofGardenRingMesh.position.y = 23.7;
    chGroup.add(roofGardenRingMesh);

    // Executive tower wing framing the northwest entrance toward tp_sejong_cityhall (469, 4799)
    const towerWing = new THREE.Mesh(new THREE.BoxGeometry(44, 24, 24), landmarkBronzeCurtainMat);
    towerWing.position.set(-22, 13.4, -36);
    towerWing.castShadow = true;
    towerWing.receiveShadow = true;
    chGroup.add(towerWing);

    const towerCrown = new THREE.Mesh(new THREE.BoxGeometry(47, 1.4, 27), ceramicWhiteMat);
    towerCrown.position.set(-22, 26.0, -36);
    chGroup.add(towerCrown);

    // Central circular reflecting pool & civic fountain
    const poolRim = new THREE.Mesh(new THREE.CylinderGeometry(18, 19, 0.7, 32), limestoneTrimMat);
    poolRim.position.y = 1.65;
    chGroup.add(poolRim);

    const poolWater = new THREE.Mesh(new THREE.CylinderGeometry(16.5, 16.5, 0.25, 32), fountainWaterMat);
    poolWater.position.y = 1.95;
    chGroup.add(poolWater);

    const cityHallSign = new THREE.Mesh(new THREE.PlaneGeometry(18, 5.4), signCityHallMat);
    cityHallSign.position.set(-22, 8.6, -48.3);
    cityHallSign.rotation.y = Math.PI;
    chGroup.add(cityHallSign);

    group.add(chGroup);
    colliders.push({
      minX: ch.minX,
      maxX: ch.maxX,
      minZ: ch.minZ,
      maxZ: ch.maxZ,
      maxY: 28
    });
  }

  // =========================================================================
  // 6. 정부세종청사 관공서 안내 모뉴먼트 (Sejong Civic Monument Pylon at -40, -1430)
  // =========================================================================
  {
    const mon = SEJONG_BUILDING_LAYOUT.monument;
    const monGroup = new THREE.Group();
    monGroup.position.set(mon.cx, 0, mon.cz);

    const monPlinth = new THREE.Mesh(new THREE.BoxGeometry(mon.w, 1.2, mon.d), limestoneTrimMat);
    monPlinth.position.y = 0.6;
    monGroup.add(monPlinth);

    const monSlab = new THREE.Mesh(new THREE.BoxGeometry(11.6, 5.4, 1.1), darkBronzeFrameMat);
    monSlab.position.y = 3.9;
    monSlab.castShadow = true;
    monGroup.add(monSlab);

    const monFront = new THREE.Mesh(new THREE.PlaneGeometry(11.0, 3.8), signComplexMat);
    monFront.position.set(0, 4.1, 0.58);
    monGroup.add(monFront);
    const monBack = new THREE.Mesh(new THREE.PlaneGeometry(11.0, 3.8), signComplexMat);
    monBack.rotation.y = Math.PI;
    monBack.position.set(0, 4.1, -0.58);
    monGroup.add(monBack);

    group.add(monGroup);
    colliders.push({
      minX: mon.cx - 7,
      maxX: mon.cx + 7,
      minZ: mon.cz - 3,
      maxZ: mon.cz + 3,
      maxY: mon.h
    });
  }

  return excludeFromBatch;
}

export {
  SEJONG_BUILDING_LAYOUT,
  createOpenBookRoofGeometry,
  createCivicArcGeometry,
  buildSejongLandmarks
};
