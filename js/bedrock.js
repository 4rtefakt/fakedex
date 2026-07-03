/*
 * bedrock.js — parse a Minecraft Bedrock geometry file (Cobblemon .geo.json,
 * format_version 1.12) into a THREE.Group so it can be rendered to a sprite.
 *
 * Handles: bone hierarchy + pivots + rotations, cubes with box-UV or per-face
 * UV, inflate, and mirror. Coordinates are kept in "pixels" (16 px = 1 block);
 * the caller frames with the camera. Depends on a global `THREE`.
 */
(function (global) {
  'use strict';

  const DEG = Math.PI / 180;

  // Build one cube as a BufferGeometry with correct box/per-face UVs.
  // origin/size in pixels; uv is [u,v] (box) or a per-face object.
  function cubeGeometry(THREE, cube, pivot, texW, texH) {
    const inflate = cube.inflate || 0;
    const ox = cube.origin[0] - inflate;
    const oy = cube.origin[1] - inflate;
    const oz = cube.origin[2] - inflate;
    const w = cube.size[0] + inflate * 2;
    const h = cube.size[1] + inflate * 2;
    const d = cube.size[2] + inflate * 2;

    // Cube corners relative to the bone pivot.
    const x0 = ox - pivot[0], x1 = ox + w - pivot[0];
    const y0 = oy - pivot[1], y1 = oy + h - pivot[1];
    const z0 = oz - pivot[2], z1 = oz + d - pivot[2];

    // UV rectangles [uStart, vStart, uSize, vSize] in pixels (v from top).
    let rects;
    if (Array.isArray(cube.uv)) {
      const U = cube.uv[0], V = cube.uv[1];
      rects = {
        east:  [U,             V + d,     d, h],
        north: [U + d,         V + d,     w, h],
        west:  [U + d + w,     V + d,     d, h],
        south: [U + d + w + d, V + d,     w, h],
        up:    [U + d,         V,         w, d],
        down:  [U + d + w,     V,         w, d],
      };
    } else {
      // Per-face UV: { north:{uv:[u,v],uv_size:[w,h]}, ... }
      const pf = cube.uv || {};
      const r = function (f) {
        const e = pf[f];
        if (!e) return [0, 0, 0, 0];
        return [e.uv[0], e.uv[1], e.uv_size ? e.uv_size[0] : 0, e.uv_size ? e.uv_size[1] : 0];
      };
      rects = { east: r('east'), west: r('west'), up: r('up'), down: r('down'), south: r('south'), north: r('north') };
    }

    // Each face defined by its texture top-left corner (tl) in 3D plus the edge
    // vectors toward texture-right (ue) and texture-down (ve). This keeps the
    // per-vertex UV assignment consistent regardless of face — the bug before
    // was a fixed UV winding applied to inconsistently-ordered vertices.
    const faces = {
      up:    { n: [0, 1, 0],  tl: [x0, y1, z0], ue: [x1 - x0, 0, 0], ve: [0, 0, z1 - z0] },
      down:  { n: [0, -1, 0], tl: [x0, y0, z1], ue: [x1 - x0, 0, 0], ve: [0, 0, z0 - z1] },
      north: { n: [0, 0, -1], tl: [x1, y1, z0], ue: [x0 - x1, 0, 0], ve: [0, y0 - y1, 0] },
      south: { n: [0, 0, 1],  tl: [x0, y1, z1], ue: [x1 - x0, 0, 0], ve: [0, y0 - y1, 0] },
      east:  { n: [1, 0, 0],  tl: [x1, y1, z1], ue: [0, 0, z0 - z1], ve: [0, y0 - y1, 0] },
      west:  { n: [-1, 0, 0], tl: [x0, y1, z0], ue: [0, 0, z1 - z0], ve: [0, y0 - y1, 0] },
    };

    const mirror = !!cube.mirror;
    const positions = [];
    const uvs = [];
    const normals = [];
    const indices = [];

    let vi = 0;
    for (const fname in faces) {
      const f = faces[fname];
      const rect = rects[fname];
      const uS = rect[0], vS = rect[1], uW = rect[2], vH = rect[3];
      let uL = uS / texW, uR = (uS + uW) / texW;
      const vTop = 1 - vS / texH, vBot = 1 - (vS + vH) / texH;
      if (mirror) { const t = uL; uL = uR; uR = t; }
      const tl = f.tl, ue = f.ue, ve = f.ve;
      // Corners: TL, TR (tl+ue), BR (tl+ue+ve), BL (tl+ve).
      const corners = [
        [tl[0], tl[1], tl[2], uL, vTop],
        [tl[0] + ue[0], tl[1] + ue[1], tl[2] + ue[2], uR, vTop],
        [tl[0] + ue[0] + ve[0], tl[1] + ue[1] + ve[1], tl[2] + ue[2] + ve[2], uR, vBot],
        [tl[0] + ve[0], tl[1] + ve[1], tl[2] + ve[2], uL, vBot],
      ];
      for (let k = 0; k < 4; k++) {
        positions.push(corners[k][0], corners[k][1], corners[k][2]);
        uvs.push(corners[k][3], corners[k][4]);
        normals.push(f.n[0], f.n[1], f.n[2]);
      }
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setIndex(indices);
    return g;
  }

  // Build a THREE.Group from geometry JSON. makeMesh(geometry) -> THREE.Mesh.
  function buildModel(geoJson, makeMesh) {
    const THREE = global.THREE;
    const list = geoJson['minecraft:geometry'];
    if (!list || !list.length) throw new Error('No geometry in model.');
    const geo = list[0];
    const desc = geo.description || {};
    const texW = desc.texture_width || 64;
    const texH = desc.texture_height || 32;

    const nodes = {};
    (geo.bones || []).forEach(function (bone) {
      nodes[bone.name] = { def: bone, obj: new THREE.Group() };
    });

    const root = new THREE.Group();
    for (const name in nodes) {
      const def = nodes[name].def;
      const obj = nodes[name].obj;
      const pivot = def.pivot || [0, 0, 0];
      const parent = def.parent && nodes[def.parent] ? nodes[def.parent] : null;
      const pPivot = parent ? (parent.def.pivot || [0, 0, 0]) : [0, 0, 0];
      obj.position.set(pivot[0] - pPivot[0], pivot[1] - pPivot[1], pivot[2] - pPivot[2]);
      if (def.rotation) {
        obj.rotation.set(-def.rotation[0] * DEG, -def.rotation[1] * DEG, def.rotation[2] * DEG, 'ZYX');
      }
      (def.cubes || []).forEach(function (cube) {
        obj.add(makeMesh(cubeGeometry(THREE, cube, pivot, texW, texH)));
      });
      (parent ? parent.obj : root).add(obj);
    }
    root.userData.texture = { width: texW, height: texH };
    return root;
  }

  global.Bedrock = { buildModel: buildModel };
})(window);
