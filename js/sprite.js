/*
 * sprite.js — render a Cobblemon bedrock model to a PNG data URL.
 *
 * One shared WebGL renderer is reused for every sprite: build the model, frame
 * it with an orthographic camera fitted to its bounds, snapshot, dispose. Depends
 * on global THREE + Bedrock (js/bedrock.js).
 */
(function (global) {
  'use strict';

  const SIZE = 256; // render resolution; displayed smaller in the grid.
  let renderer = null;
  let scene = null;
  let camera = null;

  function ensure() {
    const THREE = global.THREE;
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  }

  // Uint8Array (PNG) -> THREE.Texture (nearest-filtered, pixel-art crisp).
  function textureFromBytes(bytes) {
    const THREE = global.THREE;
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      const img = new Image();
      img.onload = function () {
        const t = new THREE.Texture(img);
        t.magFilter = THREE.NearestFilter;
        t.minFilter = THREE.NearestFilter;
        t.generateMipmaps = false;
        t.needsUpdate = true;
        URL.revokeObjectURL(url);
        resolve(t);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('texture decode failed')); };
      img.src = url;
    });
  }

  function disposeGroup(group) {
    group.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }

  // spec: { model: geoJson, textures: [Uint8Array, ...], yaw?, pitch? }
  // The first texture is the base; any others are overlaid (emissive layers).
  async function render(spec) {
    ensure();
    const THREE = global.THREE;

    const texes = [];
    for (const bytes of spec.textures) {
      try { texes.push(await textureFromBytes(bytes)); }
      catch (e) { texes.push(null); }
    }
    if (!texes[0]) throw new Error('No base texture.');

    const root = new THREE.Group();
    // Base + each emissive layer is a full copy of the mesh sharing the geometry
    // shape; layers get a small polygon offset so they sit just in front.
    texes.forEach(function (tex, i) {
      if (!tex) return;
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, alphaTest: 0.01, side: THREE.DoubleSide,
      });
      if (i > 0) { mat.polygonOffset = true; mat.polygonOffsetFactor = -i; mat.polygonOffsetUnits = -i; mat.depthWrite = false; }
      const layer = global.Bedrock.buildModel(spec.model, function (g) { return new THREE.Mesh(g, mat); }, spec.pose);
      root.add(layer);
    });

    // Face the camera: models are built facing -Z, so yaw 180° brings the front
    // toward +Z where the camera sits. A small extra yaw/pitch gives a 3/4 view.
    const yaw = spec.yaw != null ? spec.yaw : Math.PI + 0.32;
    const pitch = spec.pitch != null ? spec.pitch : 0.08;
    root.rotation.order = 'YXZ';
    root.rotation.y = yaw;
    root.rotation.x = pitch;

    scene.add(root);

    // Frame with an orthographic camera fitted to the rotated bounds.
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const half = Math.max(size.x, size.y) * 0.5 * 1.12 || 16;
    camera.left = -half; camera.right = half; camera.top = half; camera.bottom = -half;
    camera.position.set(center.x, center.y, center.z + 100);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');

    scene.remove(root);
    disposeGroup(root);
    return url;
  }

  global.Sprite = { render: render, SIZE: SIZE };
})(window);
