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

  // Build the textured model group from a spec. The first texture is the base;
  // any others are overlaid (emissive layers). Returns a THREE.Group.
  async function buildTexturedRoot(spec) {
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
    return root;
  }

  // spec: { model: geoJson, textures: [Uint8Array, ...], yaw?, pitch? }
  async function render(spec) {
    ensure();
    const THREE = global.THREE;

    const root = await buildTexturedRoot(spec);

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

  // Live, interactive 3D viewer: auto-spins, drag to rotate, gentle idle bob.
  // Uses its own renderer/canvas so it never fights the shared sprite baker.
  // Returns { canvas, dispose } — call dispose() to free the WebGL context.
  const BASE_YAW = Math.PI;   // front toward +Z (camera side)
  const BASE_PITCH = 0.12;

  async function createViewer(spec, opts) {
    const THREE = global.THREE;
    opts = opts || {};
    const px = opts.size || 220;

    const root = await buildTexturedRoot(spec);

    // Centre the model at the origin so spins rotate about its middle.
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    root.position.sub(center);

    const spin = new THREE.Group();
    spin.rotation.order = 'YXZ';
    spin.add(root);

    const vScene = new THREE.Scene();
    vScene.add(spin);

    // Fit an orthographic camera to the bounding sphere so nothing clips at any
    // rotation. A small bob amplitude is added to the framing headroom.
    const radius = 0.5 * Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z) || 16;
    const bob = size.y * 0.03;
    const half = radius * 1.02 + bob;
    const vCam = new THREE.OrthographicCamera(-half, half, half, -half, -1000, 1000);
    vCam.position.set(0, 0, 200);
    vCam.lookAt(0, 0, 0);

    const vRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    vRenderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    vRenderer.setSize(px, px);
    vRenderer.setClearColor(0x000000, 0);
    const canvas = vRenderer.domElement;

    let yaw = 0.35, pitch = 0, tick = 0;
    let dragging = false, lastX = 0, lastY = 0, moved = false, idleAfterDrag = 0;
    let raf = 0, disposed = false;

    function onDown(e) {
      dragging = true; moved = false;
      lastX = e.clientX; lastY = e.clientY;
      if (canvas.setPointerCapture && e.pointerId != null) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      }
    }
    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      yaw += dx * 0.012;
      pitch += dy * 0.012;
      pitch = Math.max(-1.1, Math.min(1.1, pitch));
      lastX = e.clientX; lastY = e.clientY;
      e.preventDefault();
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      idleAfterDrag = moved ? 45 : 0; // pause auto-spin briefly after a drag
    }

    // Pointer events cover mouse, touch and pen; `touch-action: none` (CSS) keeps
    // touch drags from scrolling the drawer.
    canvas.addEventListener('pointerdown', onDown);
    global.addEventListener('pointermove', onMove);
    global.addEventListener('pointerup', onUp);

    function draw() {
      spin.rotation.y = BASE_YAW + yaw;
      spin.rotation.x = BASE_PITCH + pitch;
      spin.position.y = Math.sin(tick * 0.045) * bob;
      vRenderer.render(vScene, vCam);
    }
    function frame() {
      if (disposed) return;
      tick++;
      if (!dragging) {
        if (idleAfterDrag > 0) idleAfterDrag--;
        else yaw += 0.006; // gentle auto-spin
      }
      draw();
      raf = global.requestAnimationFrame(frame);
    }
    draw(); // paint once immediately, before the rAF loop takes over
    raf = global.requestAnimationFrame(frame);

    function dispose() {
      if (disposed) return;
      disposed = true;
      global.cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      global.removeEventListener('pointermove', onMove);
      global.removeEventListener('pointerup', onUp);
      disposeGroup(root);
      vRenderer.dispose();
      const ext = vRenderer.getContext().getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }

    return { canvas: canvas, dispose: dispose };
  }

  global.Sprite = { render: render, createViewer: createViewer, SIZE: SIZE };
})(window);
