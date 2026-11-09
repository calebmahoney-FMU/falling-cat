// three.js scene: room, ground, height pole, orbit camera and the cat's visual.
// The cat visual is built from model.geometry(shape): a list of body segments
// (each with rotation R, centre, and legs) in the cat frame.
var FC = (globalThis.FC = globalThis.FC || {});

FC.Renderer = class {
  constructor(container) {
    this.container = container;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x9fc4e4);
    scene.fog = new THREE.Fog(0x9fc4e4, 8, 22);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.02, 100);
    this.orbit = { theta: 0.95, phi: 1.32, dist: 1.6, target: new THREE.Vector3(0, 1, 0) };

    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7a5a, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75);
    sun.position.set(2, 6, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 0.5, far: 15 });
    this.sun = sun;
    scene.add(sun, sun.target);

    this.buildWorld();
    this.cat = null;
    this.bindOrbit();
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  buildWorld() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(30, 64),
      new THREE.MeshLambertMaterial({ color: 0x7fa65c })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(10, 40, 0x5d8442, 0x6d9450);
    grid.position.y = 0.001;
    this.scene.add(grid);

    // Height pole with a tick every 0.5 m, so the fall has a sense of scale.
    const pole = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    const red = new THREE.MeshLambertMaterial({ color: 0xd9534f });
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 6, 8), mat);
    stick.position.y = 3;
    pole.add(stick);
    for (let h = 0.5; h <= 6; h += 0.5) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(h % 1 === 0 ? 0.12 : 0.07, 0.012, 0.012), red);
      tick.position.set(0.03, h, 0);
      pole.add(tick);
      if (h % 1 === 0) pole.add(this.label(`${h} m`, 0.17, h));
    }
    // Above 6 m the pole carries on as floor marks (3 m per floor) up to 30 floors.
    const tall = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 84, 8), mat);
    tall.position.y = 6 + 42;
    pole.add(tall);
    for (let f = 3; f <= 30; f++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.012), red);
      tick.position.set(0.03, f * 3, 0);
      pole.add(tick, this.label(`floor ${f}`, 0.17, f * 3));
    }
    pole.position.set(-0.9, 0, -1.1);
    this.scene.add(pole);
    this.pole = pole;

    // A high-rise behind the drop zone, with a row of windows per 3 m floor.
    const c = document.createElement("canvas");
    c.width = 256; c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "#c9c2b8"; g.fillRect(0, 0, 256, 64);
    g.fillStyle = "#5b7896";
    for (let i = 0; i < 4; i++) g.fillRect(14 + i * 62, 14, 36, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 30);
    const building = new THREE.Mesh(new THREE.BoxGeometry(8, 90, 6), new THREE.MeshLambertMaterial({ map: tex }));
    building.position.set(-1.5, 45, -5.2);
    this.scene.add(building);
  }

  label(text, x, y) {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.font = "bold 36px system-ui, sans-serif";
    g.fillText(text, 4, 44);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }));
    sprite.scale.set(0.24, 0.12, 1);
    sprite.position.set(x + 0.06, y, 0);
    return sprite;
  }

  // Zero-g cabin (the inside of a parabolic-flight aircraft) around the floating
  // cat: padded light walls and ceiling, a darker gridded floor so "down" is visible.
  setCabin(visible, centerY = 1.25) {
    if (!this.cabin) {
      const panel = (base, line, step) => {
        const c = document.createElement("canvas");
        c.width = c.height = 128;
        const g = c.getContext("2d");
        g.fillStyle = base; g.fillRect(0, 0, 128, 128);
        g.strokeStyle = line; g.lineWidth = 3;
        for (let i = 0; i <= 128; i += step) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(3, 3);
        return new THREE.MeshLambertMaterial({ map: t, side: THREE.BackSide });
      };
      const wall = panel("#d9dde4", "#c3c9d3", 64), floor = panel("#46556b", "#6b7c95", 32), ceiling = panel("#eef0f4", "#dde1e8", 64);
      // BoxGeometry face order: +x, -x, +y (ceiling), -y (floor), +z, -z.
      const box = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 2.4), [wall, wall, ceiling, floor, wall, wall]);
      box.receiveShadow = true;
      this.cabin = box;
      this.scene.add(box);
    }
    this.cabin.visible = visible;
    if (this.pole) this.pole.visible = !visible; // the outdoor height pole would stand inside the cabin
    this.cabin.position.set(0, centerY, 0);
  }

  // Tabby stripe texture. Body halves: bands across the cylinder's length (texture v);
  // tail: rings along the tube (texture u).
  stripeTexture(coat, rings) {
    const c = document.createElement("canvas");
    c.width = rings ? 256 : 64;
    c.height = rings ? 32 : 256;
    const g = c.getContext("2d");
    g.fillStyle = coat.fur;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = coat.stripes;
    const len = rings ? c.width : c.height, across = rings ? c.height : c.width;
    for (let s = 14; s < len; s += 36) {
      g.beginPath();
      for (let a = 0; a <= across; a += 4) {
        const w = s + 5 * Math.sin((a / across) * Math.PI * 2); // a little wobble
        rings ? g.lineTo(w, a) : g.lineTo(a, w);
      }
      for (let a = across; a >= 0; a -= 4) {
        const w = s + 13 + 4 * Math.sin((a / across) * Math.PI * 2 + 1);
        rings ? g.lineTo(w, a) : g.lineTo(a, w);
      }
      g.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  // Build the cat visual for a model whose geometry() returns body segments.
  setModel(model) {
    if (this.cat) this.scene.remove(this.cat.root);
    const P = model.params;
    const coat = model.coat || { fur: "#e0883a", belly: "#f6f0e6", eyes: "#222222" };
    const fur = new THREE.MeshLambertMaterial({ color: coat.fur });
    const belly = new THREE.MeshLambertMaterial({ color: coat.belly });
    const dark = new THREE.MeshLambertMaterial({ color: coat.eyes });
    const pink = new THREE.MeshLambertMaterial({ color: 0xe88a9a });
    // Tabby coats: wavy darker bands around the back and rings on the tail.
    const backFur = coat.stripes ? new THREE.MeshLambertMaterial({ map: this.stripeTexture(coat, false) }) : fur;
    // Siamese-style "points": darker ears, face mask, tail, lower legs and paws.
    const points = coat.points ? new THREE.MeshLambertMaterial({ color: coat.points }) : null;
    const tailFur = coat.stripes ? new THREE.MeshLambertMaterial({ map: this.stripeTexture(coat, true) }) : points || fur;
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    const shadow = (m) => { m.castShadow = true; return m; };

    // A body segment in its own frame, starting at its spine joint (origin) and
    // running `len` along +x (fwd = 1) or -x (fwd = -1): back in fur, belly in the
    // belly color, a ball at the joint and a rounded end at the rump/shoulders.
    const segment = (fwd, len, endCap) => {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const geomTop = new THREE.CylinderGeometry(P.radius, P.radius, len, 24, 1, true, -Math.PI / 2, Math.PI);
      const geomBot = new THREE.CylinderGeometry(P.radius, P.radius, len, 24, 1, true, Math.PI / 2, Math.PI);
      for (const [geom, mat] of [[geomTop, backFur], [geomBot, belly]]) {
        const m = shadow(new THREE.Mesh(geom, mat));
        m.rotation.z = -Math.PI / 2; // cylinder axis Y -> X; theta=0 lands on +Z (dorsal)
        m.position.x = (fwd * len) / 2;
        g.add(m);
      }
      g.add(shadow(new THREE.Mesh(new THREE.SphereGeometry(P.radius * 0.98, 20, 14), fur))); // spine joint
      if (endCap) {
        const cap = shadow(new THREE.Mesh(new THREE.SphereGeometry(P.radius, 20, 14), fur));
        cap.position.x = fwd * len;
        g.add(cap);
      }
      return g;
    };

    const geo0 = model.geometry(FC.sim.neutral(model));
    const segs = geo0.map((sg) => segment(sg.fwd, sg.len, sg.head || sg.tail));
    const front = segs[geo0.findIndex((sg) => sg.head)];
    const back = segs[geo0.findIndex((sg) => sg.tail)];
    const backLen = geo0.find((sg) => sg.tail).len;

    // Head on the front segment.
    const head = new THREE.Group();
    head.position.set(P.headX, 0, 0.03);
    head.scale.setScalar(P.headR / 0.055); // features below are laid out for a 5.5 cm head
    head.add(shadow(new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 14), fur)));
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 10), points || belly);
    muzzle.position.set(0.045, 0, -0.015);
    head.add(muzzle);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), pink);
    nose.position.set(0.07, 0, -0.004);
    head.add(nose);
    for (const side of [1, -1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), dark);
      eye.position.set(0.046, side * 0.022, 0.016);
      head.add(eye);
      const ear = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.045, 10), points || fur));
      ear.position.set(0.0, side * 0.03, 0.055);
      ear.rotation.x = -side * 0.35;
      head.add(ear);
    }
    front.add(head);

    // Tail on the back segment (visual only, massless in every model).
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-backLen - 0.03, 0, 0.02),
      new THREE.Vector3(-backLen - 0.12, 0, 0.06),
      new THREE.Vector3(-backLen - 0.2, 0, 0.14),
      new THREE.Vector3(-backLen - 0.22, 0, 0.24),
    ]);
    back.add(shadow(new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 20, model.jointed ? 0.017 : 0.014, 8), tailFur)));

    // Legs: one cylinder per leg segment, re-oriented each frame, with white paws
    // and (jointed legs) a ball at each knee/elbow.
    const legs = [];
    const thick = model.jointed ? 1.25 : 1;
    const legGeom = new THREE.CylinderGeometry(0.017 * thick, 0.015 * thick, 1, 10);
    const pawGeom = new THREE.SphereGeometry(0.02 * thick, 10, 8);
    const kneeGeom = new THREE.SphereGeometry(0.017 * thick, 10, 8);
    for (let i = 0; i < 4; i++) {
      const parts = [shadow(new THREE.Mesh(legGeom, fur))];
      if (model.jointed) parts.push(shadow(new THREE.Mesh(legGeom, points || fur))); // lower leg
      const knee = model.jointed ? shadow(new THREE.Mesh(kneeGeom, fur)) : null;
      const paw = shadow(new THREE.Mesh(pawGeom, points || belly));
      root.add(...parts, paw);
      if (knee) root.add(knee);
      legs.push({ parts, knee, paw });
    }

    root.add(...segs);
    this.scene.add(root);
    this.cat = { root, segs, legs, model };
  }

  // Place the cat: R = cat-frame -> world rotation, pos = world COM position.
  updateCat(shape, R, pos) {
    const { root, segs, legs, model } = this.cat;
    const conf = FC.physics.configuration(model, shape);
    const com = conf.com;
    root.matrix.set(R[0], R[1], R[2], pos[0], R[3], R[4], R[5], pos[1], R[6], R[7], R[8], pos[2], 0, 0, 0, 1);
    root.matrixWorldNeedsUpdate = true;

    const geo = model.geometry(shape);
    const up = new THREE.Vector3(0, 1, 0);
    let li = 0;
    geo.forEach((seg, i) => {
      const S = seg.R, o = [seg.origin[0] - com[0], seg.origin[1] - com[1], seg.origin[2] - com[2]];
      segs[i].matrix.set(S[0], S[1], S[2], o[0], S[3], S[4], S[5], o[1], S[6], S[7], S[8], o[2], 0, 0, 0, 1);
      segs[i].matrixWorldNeedsUpdate = true;
      const toV = (p) => new THREE.Vector3(p[0] - com[0], p[1] - com[1], p[2] - com[2]);
      for (const l of seg.legs) {
        const { parts, knee, paw } = legs[li++];
        const pts = l.knee ? [toV(l.attach), toV(l.knee), toV(l.foot)] : [toV(l.attach), toV(l.foot)];
        parts.forEach((part, k) => {
          const d = pts[k + 1].clone().sub(pts[k]);
          part.position.copy(pts[k]).addScaledVector(d, 0.5);
          part.scale.set(1, d.length(), 1);
          part.quaternion.setFromUnitVectors(up, d.normalize());
        });
        if (knee) knee.position.copy(pts[1]);
        paw.position.copy(pts[pts.length - 1]);
      }
    });
  }

  setTargetY(y, smooth) {
    const t = this.orbit.target;
    t.y = smooth ? t.y + (y - t.y) * 0.15 : y;
  }

  // The default three-quarter view, clear of the building.
  resetView(dist = 1.6) {
    Object.assign(this.orbit, { theta: 0.95, phi: 1.32, dist });
  }

  setView(name) {
    const views = { front: [0.25, 1.4], side: [Math.PI / 2, 1.45], top: [0.6, 2.75] };
    [this.orbit.theta, this.orbit.phi] = views[name];
  }

  bindOrbit() {
    const el = this.renderer.domElement;
    let drag = null;
    el.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      this.orbit.theta -= (e.clientX - drag.x) * 0.008;
      this.orbit.phi = Math.min(3.0, Math.max(0.15, this.orbit.phi - (e.clientY - drag.y) * 0.008));
      drag = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener("pointerup", () => (drag = null));
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.orbit.dist = Math.min(6, Math.max(0.6, this.orbit.dist * Math.exp(e.deltaY * 0.001)));
    }, { passive: false });
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  render() {
    const { theta, phi, dist, target } = this.orbit;
    const camY = Math.max(0.05, target.y + dist * Math.cos(phi));
    this.camera.position.set(target.x + dist * Math.sin(phi) * Math.sin(theta), camY, target.z + dist * Math.sin(phi) * Math.cos(theta));
    this.camera.lookAt(target);
    this.sun.position.set(target.x + 2, target.y + 6, target.z + 3);
    this.sun.target.position.copy(target);
    this.renderer.render(this.scene, this.camera);
  }
};
