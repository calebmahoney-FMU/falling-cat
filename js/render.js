// three.js scene: sky, ground, buildings, height pole, orbit camera, the cat's
// visual, and two effects (wind streaks while falling, a dust puff on landing).
// The cat visual is built from model.geometry(shape): a list of body segments
// (each with rotation R, centre, and legs) in the cat frame. Body segments are
// drawn at exactly the size the physics uses; only details (eyes, ears,
// whiskers, tail, fur texture) are decoration.
var FC = (globalThis.FC = globalThis.FC || {});

// Colours given as hex are sRGB; with this off, three.js converts them to linear
// for lighting and back for display (correct colour, with filmic tone mapping).
THREE.ColorManagement.legacyMode = false;

FC.Renderer = class {
  constructor(container) {
    this.container = container;
    // Phones and tablets: fewer pixels (≤1.5× instead of 2×) and cheaper shadows; if frames
    // still run slow, render() drops to 1× automatically (see adaptQuality).
    this.touch = matchMedia("(hover: none), (pointer: coarse)").matches;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }));
    this.pixelRatio = Math.min(window.devicePixelRatio, this.touch ? 1.5 : 2);
    renderer.setPixelRatio(this.pixelRatio);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = this.touch ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.slowFrames = 0;
    container.appendChild(renderer.domElement);

    const scene = (this.scene = new THREE.Scene());
    this.horizon = new THREE.Color(0xdbe8f2);
    scene.background = this.horizon.clone();
    scene.fog = new THREE.Fog(this.horizon, 14, 75); // distant buildings fade into haze

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.02, 600);
    this.orbit = { theta: 0.95, phi: 1.32, dist: 1.6, target: new THREE.Vector3(0, 1, 0) };

    // Sky fill (cool from above, green bounce from the grass) and a warm sun.
    scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x6a7d4f, 0.9));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.set(2, 6, 3);
    sun.castShadow = true;
    const sm = this.touch ? 512 : 1024;
    sun.shadow.mapSize.set(sm, sm);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.01;
    Object.assign(sun.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 0.5, far: 15 });
    this.sun = sun;
    scene.add(sun, sun.target);

    this.catPos = new THREE.Vector3();
    this.lastT = performance.now();
    this.buildSky();
    this.buildWorld();
    this.buildEffects();
    this.cat = null;
    this.bindOrbit();
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  // ---------- helpers ----------
  canvas(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding; // painted colours are sRGB
    t.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  // Small deterministic random numbers, so textures look the same every visit.
  rng(seed) { let a = seed >>> 0; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); }
  // Soft mottled fur: the coat colour with faint lighter and darker flecks.
  furTexture(base, seed = 1) {
    const r = this.rng(seed);
    return this.canvas(128, 128, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.08)";
        const x = r() * w, y = r() * h;
        g.fillRect(x, y, 1 + r() * 1.5, 2 + r() * 4); // short strands along the body
      }
    });
  }
  fur(color, seed) {
    this.furCache = this.furCache || {};
    const k = color + seed;
    return (this.furCache[k] ||= new THREE.MeshStandardMaterial({ map: this.furTexture(color, seed), roughness: 0.92, metalness: 0 }));
  }

  // ---------- sky ----------
  // A big dome around the camera, coloured by direction: deep blue overhead fading to a pale haze at
  // the horizon (the same colour as the fog, so distant things melt into it).
  buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x4f8fd3) }, horizon: { value: this.horizon }, below: { value: new THREE.Color(0xb9c9b0) } },
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 below; varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(min(1.0, h * 1.6), 0.65)) : mix(horizon, below, min(1.0, -h * 5.0));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  // ---------- world ----------
  buildWorld() {
    // Grass: speckled blades, tiled; a faint 25 cm grid near the drop zone for scale.
    const grassTex = this.canvas(256, 256, (g, w, h) => {
      const r = this.rng(7);
      g.fillStyle = "#6c9a48"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 5000; i++) {
        const t = r();
        g.fillStyle = t < 0.4 ? "rgba(40,70,20,0.18)" : t < 0.8 ? "rgba(150,190,90,0.16)" : "rgba(230,240,160,0.10)";
        g.fillRect(r() * w, r() * h, 1.2, 2 + r() * 4);
      }
    });
    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(70, 70);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(10, 40, 0xffffff, 0xffffff);
    grid.material.transparent = true; grid.material.opacity = 0.12; grid.material.depthWrite = false;
    grid.position.y = 0.001;
    this.scene.add(grid);

    // Landing mat under the drop point: a padded disc with target rings (decoration; the ground is y = 0).
    const matTex = this.canvas(256, 256, (g, w, h) => {
      const c = w / 2;
      for (let i = 0; i < 5; i++) {
        g.fillStyle = i % 2 ? "#6a8299" : "#55697f"; // muted slate: present, not shouting
        g.beginPath(); g.arc(c, c, c * (1 - i * 0.2), 0, 2 * Math.PI); g.fill();
      }
      g.fillStyle = "#f3efe6"; g.beginPath(); g.arc(c, c, c * 0.07, 0, 2 * Math.PI); g.fill();
    });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.47, 0.02, 48), [
      new THREE.MeshStandardMaterial({ color: 0x3e5670, roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: 0x3e5670, roughness: 0.9 })]);
    pad.position.y = -0.008; // top face just above the ground, so paws land on it
    pad.receiveShadow = true;
    this.scene.add(pad);
    this.pad = pad;

    // Height pole: a surveyor's rod, red and white every 0.5 m up to 6 m, then one band per 3 m floor.
    const pole = new THREE.Group();
    const bands = (n, a, b) => this.canvas(8, 16 * n, (g, w, h) => { for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(0, h - (i + 1) * 16, w, 16); } });
    const low = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 6, 12), new THREE.MeshStandardMaterial({ map: bands(12, "#d8423a", "#f4f1ea"), roughness: 0.6 }));
    low.position.y = 3;
    low.castShadow = true;
    pole.add(low);
    for (let h = 1; h <= 6; h += 1) pole.add(this.label(`${h} m`, 0.17, h));
    const high = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 84, 12), new THREE.MeshStandardMaterial({ map: bands(28, "#f4f1ea", "#d8423a"), roughness: 0.6 }));
    high.position.y = 6 + 42;
    pole.add(high);
    for (let f = 3; f <= 30; f++) pole.add(this.label(`floor ${f}`, 0.17, f * 3));
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.04, 16), new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.7 }));
    foot.position.y = 0.02;
    pole.add(foot);
    pole.position.set(-0.9, 0, -1.1);
    this.scene.add(pole);
    this.pole = pole;

    // The high-rise behind the drop zone: four floors per texture tile (3 m each), windows with frames,
    // sky reflections, some blinds and a few lit rooms; ledges between floors.
    const facade = this.canvas(512, 512, (g, w, h) => {
      const r = this.rng(11);
      g.fillStyle = "#d2cbbf"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2500; i++) { g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.05)"; g.fillRect(r() * w, r() * h, 2, 2); }
      for (let f = 0; f < 4; f++) {
        const y0 = f * 128;
        g.fillStyle = "#b8b0a3"; g.fillRect(0, y0 + 118, w, 10); // ledge
        g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(0, y0 + 128 - 1, w, 3);
        for (let k = 0; k < 4; k++) {
          const x = 22 + k * 124, y = y0 + 26, ww = 80, wh = 74;
          g.fillStyle = "#eeeae2"; g.fillRect(x - 5, y - 5, ww + 10, wh + 10); // frame
          const grad = g.createLinearGradient(0, y, 0, y + wh);
          const lit = r() < 0.08;
          grad.addColorStop(0, lit ? "#f1d9a6" : "#9db7cf"); grad.addColorStop(1, lit ? "#d9b878" : "#5f7f9e");
          g.fillStyle = grad; g.fillRect(x, y, ww, wh);
          if (!lit) { g.fillStyle = "rgba(255,255,255,0.18)"; g.beginPath(); g.moveTo(x + 10, y + wh); g.lineTo(x + 34, y); g.lineTo(x + 48, y); g.lineTo(x + 24, y + wh); g.fill(); }
          if (r() < 0.35) { const bh = wh * (0.2 + 0.5 * r()); g.fillStyle = "#e9e3d6"; g.fillRect(x, y, ww, bh); g.fillStyle = "rgba(0,0,0,0.08)"; for (let s = y + 4; s < y + bh; s += 5) g.fillRect(x, s, ww, 1); }
          g.fillStyle = "#eeeae2"; g.fillRect(x + ww / 2 - 2, y, 4, wh); // mullion
        }
      }
    });
    facade.wrapS = facade.wrapT = THREE.RepeatWrapping;
    facade.repeat.set(1, 7.5);
    const building = new THREE.Mesh(new THREE.BoxGeometry(8, 90, 6), new THREE.MeshStandardMaterial({ map: facade, roughness: 0.88 }));
    building.position.set(-1.5, 45, -5.2);
    building.receiveShadow = true;
    this.scene.add(building);
    // A skyline further off, fading into the haze.
    const far = [[14, -32, 10, 64, 10, 0xc6ccd4], [-20, -40, 12, 44, 12, 0xd6cfc4], [28, -12, 9, 36, 9, 0xcfd4cc], [-28, 6, 10, 30, 10, 0xd9d2c6], [4, -55, 14, 80, 12, 0xbfc7d2]];
    for (const [x, z, sx, sy, sz, tint] of far) {
      const t = facade.clone(); t.needsUpdate = true; t.repeat.set(1, sy / 12);
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ map: t, color: tint, roughness: 0.9 }));
      m.position.set(x, sy / 2, z);
      this.scene.add(m);
    }
  }

  // Height labels: white text with a dark outline, readable against sky or wall.
  label(text, x, y) {
    const tex = this.canvas(160, 64, (g) => {
      g.font = "bold 34px system-ui, sans-serif";
      g.lineWidth = 7; g.strokeStyle = "rgba(20,24,30,0.75)"; g.lineJoin = "round";
      g.strokeText(text, 6, 44);
      g.fillStyle = "#ffffff"; g.fillText(text, 6, 44);
    });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    sprite.scale.set(0.3, 0.12, 1);
    sprite.position.set(x + 0.09, y, 0);
    return sprite;
  }

  // ---------- effects ----------
  buildEffects() {
    // Wind streaks: short lines around the cat drifting upward past it as it falls.
    const N = 40, pos = new Float32Array(N * 6);
    this.wind = { N, pos, speed: 0, seeds: Array.from({ length: N }, (_, i) => {
      const r = this.rng(100 + i);
      const a = r() * Math.PI * 2, rad = 0.28 + r() * 0.6;
      return { x: Math.cos(a) * rad, z: Math.sin(a) * rad, y: -1.6 + r() * 3.2, k: 0.7 + r() * 0.6 };
    }) };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    // Blue-grey, not white: visible against the pale building as well as the sky and grass.
    this.wind.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x6f8aa6, transparent: true, opacity: 0, depthWrite: false }));
    this.wind.lines.frustumCulled = false;
    this.scene.add(this.wind.lines);
    // Dust puff on landing: an expanding ring plus a few specks thrown out and up.
    this.puff = { t: 9, ring: new THREE.Mesh(new THREE.RingGeometry(0.08, 0.16, 40),
      new THREE.MeshBasicMaterial({ color: 0xe2d6bd, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })) };
    this.puff.ring.rotation.x = -Math.PI / 2;
    this.scene.add(this.puff.ring);
    const P = 24, ppos = new Float32Array(P * 3);
    const pgeo = new THREE.BufferGeometry(); pgeo.setAttribute("position", new THREE.BufferAttribute(ppos, 3));
    this.puff.specks = new THREE.Points(pgeo, new THREE.PointsMaterial({ color: 0xd9ccb0, size: 0.025, transparent: true, opacity: 0, depthWrite: false }));
    this.puff.specks.frustumCulled = false;
    this.puff.v = Array.from({ length: P }, (_, i) => { const a = (i / P) * Math.PI * 2; return [Math.cos(a), 0.6 + 0.8 * ((i * 37) % 10) / 10, Math.sin(a)]; });
    this.scene.add(this.puff.specks);
  }
  setWind(speed) { this.wind.speed = Math.max(0, speed || 0); }
  // A puff at (x, z), bigger for a harder landing (impact in body weights).
  landingPuff(x, z, impact) {
    const s = Math.min(1, Math.max(0.25, Math.log10(Math.max(1, impact)) / 2.2));
    Object.assign(this.puff, { t: 0, x, z, s });
  }
  updateEffects(dt) {
    const w = this.wind, op = Math.min(0.75, Math.max(0, (w.speed - 1.5) / 8));
    w.lines.material.opacity = op;
    w.lines.visible = op > 0.01;
    if (w.lines.visible) {
      const len = Math.min(0.7, 0.04 + w.speed * 0.025);
      w.seeds.forEach((q, i) => {
        q.y += w.speed * dt * 0.35 * q.k; // air rushes up past the falling cat (slowed so it reads)
        if (q.y > 1.6) q.y -= 3.2;
        const j = i * 6, x = this.catPos.x + q.x, z = this.catPos.z + q.z, y = this.catPos.y + q.y;
        w.pos.set([x, y, z, x, y - len, z], j);
      });
      w.lines.geometry.attributes.position.needsUpdate = true;
    }
    const p = this.puff;
    p.t += dt;
    const k = Math.min(1, p.t / 0.8);
    p.ring.visible = p.specks.visible = k < 1;
    if (k < 1) {
      p.ring.position.set(p.x, 0.012, p.z);
      p.ring.scale.setScalar(1 + k * (3 + 6 * p.s));
      p.ring.material.opacity = 0.55 * p.s * (1 - k);
      const arr = p.specks.geometry.attributes.position.array, rr = 0.1 + k * (0.35 + 0.5 * p.s);
      p.v.forEach((q, i) => arr.set([p.x + q[0] * rr, Math.max(0.01, q[1] * p.s * (0.25 * k - 0.22 * k * k) * 3), p.z + q[2] * rr], i * 3));
      p.specks.geometry.attributes.position.needsUpdate = true;
      p.specks.material.opacity = 0.8 * (1 - k);
    }
  }

  // Zero-g cabin (the inside of a parabolic-flight aircraft) around the floating
  // cat: padded light walls and ceiling, a darker gridded floor so "down" is visible.
  setCabin(visible, centerY = 1.25) {
    if (!this.cabin) {
      const panel = (base, line, step) => {
        const t = this.canvas(128, 128, (g) => {
          g.fillStyle = base; g.fillRect(0, 0, 128, 128);
          g.strokeStyle = line; g.lineWidth = 3;
          for (let i = 0; i <= 128; i += step) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
        });
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(3, 3);
        return new THREE.MeshStandardMaterial({ map: t, side: THREE.BackSide, roughness: 0.9 });
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
    if (this.pad) this.pad.visible = !visible;
    this.cabin.position.set(0, centerY, 0);
  }

  // Tabby stripe texture (with the same soft fur flecks). Body halves: bands across the cylinder's
  // length (texture v); tail: rings along the tube (texture u).
  stripeTexture(coat, rings) {
    const r = this.rng(rings ? 5 : 3);
    return this.canvas(rings ? 256 : 64, rings ? 32 : 256, (g, cw, ch) => {
      g.fillStyle = coat.fur;
      g.fillRect(0, 0, cw, ch);
      g.fillStyle = coat.stripes;
      const len = rings ? cw : ch, across = rings ? ch : cw;
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
      for (let i = 0; i < 500; i++) { g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.08)"; g.fillRect(r() * cw, r() * ch, 1, 3); }
    });
  }

  // Build the cat visual for a model whose geometry() returns body segments.
  setModel(model) {
    if (this.cat) this.scene.remove(this.cat.root);
    const P = model.params;
    const coat = model.coat || { fur: "#e0883a", belly: "#f6f0e6", eyes: "#d9a21b" };
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
    const fur = this.fur(coat.fur, 1);
    const belly = this.fur(coat.belly, 2);
    const pink = std({ color: 0xe48a98, roughness: 0.7 });
    const black = std({ color: 0x111111, roughness: 0.3 });
    // Tabby coats: wavy darker bands around the back and rings on the tail.
    const backFur = coat.stripes ? std({ map: this.stripeTexture(coat, false) }) : fur;
    // Siamese-style "points": darker ears, face mask, tail, lower legs and paws.
    const points = coat.points ? this.fur(coat.points, 3) : null;
    const tailFur = coat.stripes ? std({ map: this.stripeTexture(coat, true) }) : points || fur;
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    const shadow = (m) => { m.castShadow = true; return m; };

    // A body segment in its own frame, starting at its spine joint (origin) and
    // running `len` along +x (fwd = 1) or -x (fwd = -1): back in fur, belly in the
    // belly colour, a ball at the joint and a rounded end at the rump/shoulders.
    // Radius and length are exactly the physics model's.
    const segment = (fwd, len, endCap) => {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const geomTop = new THREE.CylinderGeometry(P.radius, P.radius, len, 32, 1, true, -Math.PI / 2, Math.PI);
      const geomBot = new THREE.CylinderGeometry(P.radius, P.radius, len, 32, 1, true, Math.PI / 2, Math.PI);
      for (const [geom, mat] of [[geomTop, backFur], [geomBot, belly]]) {
        const m = shadow(new THREE.Mesh(geom, mat));
        m.rotation.z = -Math.PI / 2; // cylinder axis Y -> X; theta=0 lands on +Z (dorsal)
        m.position.x = (fwd * len) / 2;
        g.add(m);
      }
      g.add(shadow(new THREE.Mesh(new THREE.SphereGeometry(P.radius * 0.98, 24, 16), fur))); // spine joint
      if (endCap) {
        const cap = shadow(new THREE.Mesh(new THREE.SphereGeometry(P.radius, 24, 16), fur));
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

    // Head on the front segment (features laid out for a 5.5 cm head, then scaled).
    const head = new THREE.Group();
    head.position.set(P.headX, 0, 0.03);
    head.scale.setScalar(P.headR / 0.055);
    head.add(shadow(new THREE.Mesh(new THREE.SphereGeometry(0.055, 28, 20), fur)));
    const cheeks = new THREE.Mesh(new THREE.SphereGeometry(0.031, 20, 14), points || belly);
    cheeks.position.set(0.04, 0, -0.016); cheeks.scale.set(1, 1.25, 0.85);
    head.add(cheeks);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 12, 8), pink);
    nose.position.set(0.069, 0, -0.002); nose.scale.set(0.7, 1.2, 0.8);
    head.add(nose);
    const iris = std({ color: coat.eyes || "#d9a21b", roughness: 0.25 });
    const white = std({ color: 0xf4f1ea, roughness: 0.3 });
    for (const side of [1, -1]) {
      // Eye: white ball, coloured iris, vertical slit pupil, and a highlight.
      const eye = new THREE.Group();
      eye.position.set(0.044, side * 0.023, 0.016);
      eye.rotation.z = side * 0.42; // look forward and slightly out
      eye.add(new THREE.Mesh(new THREE.SphereGeometry(0.0108, 16, 12), white));
      // (iris front surface at x = 0.0042 + 0.0082 = 0.0124; pupil and glint must reach just past it)
      const ir = new THREE.Mesh(new THREE.SphereGeometry(0.0082, 16, 12), iris); ir.position.x = 0.0042; eye.add(ir);
      const pu = new THREE.Mesh(new THREE.SphereGeometry(0.0046, 12, 10), black); pu.position.x = 0.0086; pu.scale.set(0.9, 0.38, 1.25); eye.add(pu);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0019, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      glint.position.set(0.0122, side * -0.0025, 0.0032); eye.add(glint);
      head.add(eye);
      // Ears: outer cone in fur (or points), pink inside.
      const ear = new THREE.Group();
      ear.position.set(0.0, side * 0.03, 0.053);
      ear.rotation.x = -side * 0.35;
      ear.add(shadow(new THREE.Mesh(new THREE.ConeGeometry(0.021, 0.047, 12), points || fur)));
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 10), pink);
      inner.position.set(0.008, 0, -0.004); ear.add(inner);
      head.add(ear);
    }
    // Whiskers: three per side, fanning out from the muzzle.
    const wpos = [];
    for (const side of [1, -1]) for (let k = -1; k <= 1; k++)
      wpos.push(0.058, side * 0.016, -0.014 + k * 0.004, 0.07, side * 0.085, -0.02 + k * 0.014);
    const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(wpos, 3));
    head.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xf2f2f0, transparent: true, opacity: 0.75 })));
    front.add(head);

    // Tail on the back segment (visual only, massless in every model): thick at the base, tapering to the tip.
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-backLen - 0.03, 0, 0.02),
      new THREE.Vector3(-backLen - 0.12, 0, 0.06),
      new THREE.Vector3(-backLen - 0.2, 0, 0.14),
      new THREE.Vector3(-backLen - 0.22, 0, 0.24),
    ]);
    const TS = 32, RS = 10, tr = model.jointed ? 0.02 : 0.017;
    const tailGeom = new THREE.TubeGeometry(tailCurve, TS, tr, RS);
    const tp = tailGeom.attributes.position, c = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i <= TS; i++) {
      tailCurve.getPointAt(i / TS, c);
      const scale = 1 - 0.6 * (i / TS);
      for (let j = 0; j <= RS; j++) {
        const idx = i * (RS + 1) + j;
        q.fromBufferAttribute(tp, idx).sub(c).multiplyScalar(scale).add(c);
        tp.setXYZ(idx, q.x, q.y, q.z);
      }
    }
    tailGeom.computeVertexNormals();
    back.add(shadow(new THREE.Mesh(tailGeom, tailFur)));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(tr * 0.4, 10, 8), tailFur);
    tip.position.copy(tailCurve.getPointAt(1));
    back.add(tip);

    // Legs: one cylinder per leg segment, re-oriented each frame, with paws
    // and (jointed legs) a ball at each knee/elbow.
    const legs = [];
    const thick = model.jointed ? 1.25 : 1;
    const legGeom = new THREE.CylinderGeometry(0.017 * thick, 0.015 * thick, 1, 14);
    const pawGeom = new THREE.SphereGeometry(0.02 * thick, 14, 10);
    const kneeGeom = new THREE.SphereGeometry(0.017 * thick, 12, 10);
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
    this.catPos.set(pos[0], pos[1], pos[2]);

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
    el.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; try { el.setPointerCapture(e.pointerId); } catch {} });
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
    const now = performance.now(), dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    const { theta, phi, dist, target } = this.orbit;
    const camY = Math.max(0.05, target.y + dist * Math.cos(phi));
    this.camera.position.set(target.x + dist * Math.sin(phi) * Math.sin(theta), camY, target.z + dist * Math.sin(phi) * Math.cos(theta));
    this.camera.lookAt(target);
    this.sky.position.copy(this.camera.position); // the sky dome travels with the camera
    this.sun.position.set(target.x + 2, target.y + 6, target.z + 3);
    this.sun.target.position.copy(target);
    this.updateEffects(dt);
    this.renderer.render(this.scene, this.camera);
  }

  // Called each frame with the real frame time (s). If most of the last ~2 s ran
  // slower than ~40 fps, render fewer pixels (once): smooth beats sharp on a slow phone.
  adaptQuality(frameDt) {
    if (this.pixelRatio <= 1) return;
    this.slowFrames = Math.max(0, this.slowFrames + (frameDt > 0.025 ? 1 : -0.5));
    if (this.slowFrames > 90) {
      this.pixelRatio = 1;
      this.renderer.setPixelRatio(1);
      this.resize();
    }
  }
};
