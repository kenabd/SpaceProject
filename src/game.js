(() => {
  const gameRoot = document.getElementById("game-root");
  const fpsEl = document.getElementById("fps");
  const speedEl = document.getElementById("speed");
  const nearestEl = document.getElementById("nearest");
  const distanceEl = document.getElementById("distance");
  const earthClockEl = document.getElementById("earth-clock");
  const shipClockEl = document.getElementById("ship-clock");
  const timeDeltaEl = document.getElementById("time-delta");
  const overlayEl = document.getElementById("overlay");
  const overlayTitleEl = document.getElementById("overlay-title");
  const overlayTextEl = document.getElementById("overlay-text");
  const actionBtnEl = document.getElementById("action-btn");
  const returnOrbitBtn = document.getElementById("return-orbit-btn");
  const musicToggleBtnEl = document.getElementById("music-toggle-btn");
  const bgMusicEl = document.getElementById("bg-music");
  const visitButtons = document.querySelectorAll("button[data-planet]");
  const teleportButtons = document.querySelectorAll("button[data-teleport]");

  if (
    !gameRoot ||
    !fpsEl ||
    !speedEl ||
    !nearestEl ||
    !distanceEl ||
    !overlayEl ||
    !overlayTitleEl ||
    !overlayTextEl ||
    !actionBtnEl ||
    !returnOrbitBtn
  ) {
    throw new Error("Missing required DOM nodes.");
  }

  const THREE = window.THREE;
  const GLTFLoader = THREE?.GLTFLoader;
  const RGBELoader = THREE?.RGBELoader;
  const EffectComposer = THREE?.EffectComposer;
  const RenderPass = THREE?.RenderPass;
  const UnrealBloomPass = THREE?.UnrealBloomPass;
  const ShaderPass = THREE?.ShaderPass;
  const SkeletonUtils = THREE?.SkeletonUtils || window.SkeletonUtils || null;
  const BLACK_HOLE_NAME = "Black Hole";

  if (!THREE || !GLTFLoader || !RGBELoader || !EffectComposer || !RenderPass || !UnrealBloomPass) {
    overlayTitleEl.textContent = "Script Load Error";
    overlayTextEl.textContent = "Required Three.js scripts failed to load.";
    actionBtnEl.disabled = true;
    throw new Error("Missing required Three.js globals.");
  }

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    logarithmicDepthBuffer: true
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.2));
  if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else if ("outputEncoding" in renderer && THREE.sRGBEncoding) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.68;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  gameRoot.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const ORBIT_FOV = 58;
  const SURFACE_FOV = 40;
  const camera = new THREE.PerspectiveCamera(ORBIT_FOV, window.innerWidth / window.innerHeight, 0.2, 25000000);
  camera.position.set(0, 14, 130);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.02, 0.36, 0.9);
  composer.addPass(bloom);
  const blackHoleLensing = { pass: null };

  const keyState = new Map();
  const clock = new THREE.Clock();
  const tmpV1 = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpV3 = new THREE.Vector3();
  const tmpV4 = new THREE.Vector3();
  const tmpEuler = new THREE.Euler();
  const tmpQuat = new THREE.Quaternion();
  const tmpQuat2 = new THREE.Quaternion();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const cameraLook = new THREE.Vector3();
  const C_KM_S = 299792.458;
  const G_KM3_KG_S2 = 6.6743e-20;
  const UNIVERSE_RADIUS = 18000000;
  const UNIVERSE_BOUNDARY_RADIUS = UNIVERSE_RADIUS * 0.92;

  const mouse = {
    pointerLocked: false,
    dragging: false,
    lastX: 0,
    lastY: 0,
    yawDelta: 0,
    pitchDelta: 0,
    sensitivity: 0.00225
  };

  const state = {
    running: false,
    mode: "orbit",
    elapsed: 0,
    hudTimer: 0,
    currentSurfacePlanet: "Earth",
    shipInSolarFrame: true,
    earthElapsedSeconds: 0,
    shipElapsedSeconds: 0,
    timeRate: 1,
    earthEpochMs: Date.now()
  };

  const music = {
    available: Boolean(bgMusicEl),
    enabled: true,
    failed: false
  };

  if (bgMusicEl) {
    bgMusicEl.volume = 0.32;
    bgMusicEl.muted = false;
    bgMusicEl.addEventListener("error", () => {
      music.failed = true;
      updateMusicUi();
    });
  }

  function updateMusicUi() {
    if (!musicToggleBtnEl) {
      return;
    }
    if (!music.available) {
      musicToggleBtnEl.textContent = "Music: Unavailable";
      musicToggleBtnEl.disabled = true;
      musicToggleBtnEl.classList.add("off");
      return;
    }
    if (music.failed) {
      musicToggleBtnEl.textContent = "Music: Add File";
      musicToggleBtnEl.disabled = true;
      musicToggleBtnEl.classList.add("off");
      return;
    }
    musicToggleBtnEl.disabled = false;
    musicToggleBtnEl.textContent = music.enabled ? "Music: On" : "Music: Off";
    musicToggleBtnEl.classList.toggle("off", !music.enabled);
  }

  function startMusic() {
    if (!music.available || !bgMusicEl || music.failed || !music.enabled) {
      return;
    }
    const playPromise = bgMusicEl.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((err) => {
        if (err && err.name === "NotAllowedError") {
          return;
        }
        music.failed = true;
        updateMusicUi();
      });
    }
  }

  function setMusicEnabled(enabled) {
    music.enabled = enabled;
    if (!music.available || !bgMusicEl || music.failed) {
      updateMusicUi();
      return;
    }
    if (music.enabled) {
      startMusic();
    } else {
      bgMusicEl.pause();
    }
    updateMusicUi();
  }

  const SCALE = {
    orbitKmPerUnit: 1000,
    orbitUnitsPerAU: 149_597_870 / 1000,
    kmPerAU: 149_597_870,
    localMetersPerUnit: 10
  };

  const ORBIT_SPEED = {
    accelKm: 30000,
    boostAccelKm: 10000000,
    maxKm: 1000000,
    boostMaxKm: 100000000,
    rotationRate: 0.55,
    damping: 0.994,
    boostDamping: 0.99998
  };

  const ORBIT_CAMERA = {
    backUnits: 2.6,
    upUnits: 1.05,
    lookAheadUnits: 8.2,
    maxBackUnitsClose: 2.6,
    maxLookAheadUnitsClose: 8.2,
    maxLagDistanceClose: 3.4
  };
  const SURFACE_CAMERA = {
    followDistanceUnits: 1.3,
    lookHeightUnits: 1.4,
    heightOffsetUnits: 2.8,
    clearanceUnits: 1.4
  };

  const REAL_DAYS_PER_YEAR = 365.256;
  const MOON_ORBIT_DAYS = 27.321661;
  // Lower value = slower orbital simulation while keeping real-world relative orbital periods.
  const EARTH_ORBIT_RAD_PER_SECOND = 0.00012;
  const RELATIVITY = {
    // Keep non-black-hole gravity subtle.
    maxGravityPotential: 0.2,
    // Prevent huge gameplay speeds from forcing near-zero clock rate.
    maxEffectiveSpeedForTimeKmS: 25000,
    // Shapes how strongly black-hole gravity slows local ship time near the core.
    blackHoleExponent: 50,
    // Earlier onset (in Rs) for the smoothing ramp.
    blackHoleRampStartRs: 1400,
    // Strong-effect distance (in Rs) where the exponent is near full strength.
    blackHoleRampEndRs: 6,
    // Avoid singular zero-rate behavior exactly at/below the horizon.
    blackHoleHorizonBuffer: 0.01,
    // Hard floor: finite max dilation (prevents singular/infinite UI behavior).
    minOrbitRate: 1e-10
  };
  const BODY_MASS_KG = {
    Sun: 1.98847e30,
    Mercury: 3.3011e23,
    Venus: 4.8675e24,
    Earth: 5.97237e24,
    Moon: 7.342e22,
    Mars: 6.4171e23,
    Jupiter: 1.8982e27,
    Saturn: 5.6834e26,
    Uranus: 8.681e25,
    Neptune: 1.02413e26
  };

  function schwarzschildRadiusKm(massKg) {
    return (2 * G_KM3_KG_S2 * massKg) / (C_KM_S * C_KM_S);
  }

  const textureLoader = new THREE.TextureLoader();
  textureLoader.crossOrigin = "anonymous";
  const gltfLoader = new GLTFLoader();
  const rgbeLoader = new RGBELoader();
  const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

  function loadTexture(url, srgb = true) {
    const t = textureLoader.load(url);
    t.anisotropy = maxAnisotropy;
    if (srgb) {
      if ("colorSpace" in t && THREE.SRGBColorSpace) {
        t.colorSpace = THREE.SRGBColorSpace;
      } else if ("encoding" in t && THREE.sRGBEncoding) {
        t.encoding = THREE.sRGBEncoding;
      }
    }
    return t;
  }

  const PLANET_TEX_BASE = "https://raw.githubusercontent.com/jeromeetienne/threex.planets/master/images/";
  const THREE_TEX_BASE = "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/";
  const ASTRONAUT_MODEL_URLS = [
    "https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/model/astronaut/Astronaut.glb",
    "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Astronaut/glTF-Binary/Astronaut.glb",
    "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb"
  ];

  rgbeLoader.load(`${THREE_TEX_BASE}equirectangular/moonless_golf_1k.hdr`, (hdr) => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(hdr).texture;
    scene.environment = env;
    hdr.dispose();
    pmrem.dispose();
  });

  const textures = {
    galaxy: loadTexture(`${PLANET_TEX_BASE}galaxy_starfield.png`),
    sun: loadTexture(`${PLANET_TEX_BASE}sunmap.jpg`),
    mercury: loadTexture(`${PLANET_TEX_BASE}mercurymap.jpg`),
    venus: loadTexture(`${PLANET_TEX_BASE}venusmap.jpg`),
    earth: loadTexture(`${THREE_TEX_BASE}planets/earth_day_4096.jpg`),
    moon: loadTexture(`${THREE_TEX_BASE}planets/moon_1024.jpg`),
    mars: loadTexture(`${PLANET_TEX_BASE}marsmap1k.jpg`),
    jupiter: loadTexture(`${PLANET_TEX_BASE}jupitermap.jpg`),
    saturn: loadTexture(`${PLANET_TEX_BASE}saturnmap.jpg`),
    saturnRing: loadTexture(`${PLANET_TEX_BASE}saturnringcolor.jpg`),
    saturnRingAlpha: loadTexture(`${PLANET_TEX_BASE}saturnringpattern.gif`, false),
    uranus: loadTexture(`${PLANET_TEX_BASE}uranusmap.jpg`),
    uranusRing: loadTexture(`${PLANET_TEX_BASE}uranusringcolour.jpg`),
    uranusRingAlpha: loadTexture(`${PLANET_TEX_BASE}uranusringtrans.gif`, false),
    neptune: loadTexture(`${PLANET_TEX_BASE}neptunemap.jpg`)
  };

  const starShell = new THREE.Mesh(
    new THREE.SphereGeometry(UNIVERSE_RADIUS, 64, 64),
    new THREE.MeshBasicMaterial({
      map: textures.galaxy,
      side: THREE.BackSide,
      toneMapped: false,
      depthWrite: false,
      depthTest: false
    })
  );
  starShell.renderOrder = -20;
  scene.add(starShell);

  const orbitRoot = new THREE.Group();
  scene.add(orbitRoot);
  const solarSystem = new THREE.Group();
  orbitRoot.add(solarSystem);
  const surfaceRoot = new THREE.Group();
  scene.add(surfaceRoot);
  surfaceRoot.visible = false;

  const orbitSun = new THREE.PointLight(0xfff1ca, 8.5, 0, 2);
  const surfaceSun = new THREE.DirectionalLight(0xffefd4, 6.8);
  surfaceSun.position.set(220, 300, 140);
  surfaceSun.castShadow = true;
  surfaceSun.shadow.mapSize.set(2048, 2048);
  surfaceSun.shadow.camera.near = 20;
  surfaceSun.shadow.camera.far = 800;
  surfaceSun.shadow.camera.left = -160;
  surfaceSun.shadow.camera.right = 160;
  surfaceSun.shadow.camera.top = 160;
  surfaceSun.shadow.camera.bottom = -160;
  surfaceRoot.add(surfaceSun);
  const surfaceSunTarget = new THREE.Object3D();
  surfaceRoot.add(surfaceSunTarget);
  surfaceSun.target = surfaceSunTarget;
  surfaceRoot.add(new THREE.HemisphereLight(0x9ec1f7, 0x49392d, 0.26));
  surfaceRoot.add(new THREE.AmbientLight(0xb7caea, 0.08));

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(696_340 / SCALE.orbitKmPerUnit, 100, 100),
    new THREE.MeshBasicMaterial({ map: textures.sun, toneMapped: false })
  );
  solarSystem.add(sun);
  // Keep the only orbit light source physically tied to the Sun.
  sun.add(orbitSun);
  orbitSun.position.set(0, 0, 0);

  const planets = new Map();
  const orbitOrder = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Moon"];
  const teleportOrder = ["Mercury", "Venus", "Earth", "Moon", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];
  const teleportMap = new Map();
  teleportOrder.forEach((name, idx) => {
    teleportMap.set(`Digit${idx + 1}`, name);
    teleportMap.set(`Numpad${idx + 1}`, name);
  });
  teleportMap.set("Digit0", BLACK_HOLE_NAME);
  teleportMap.set("Numpad0", BLACK_HOLE_NAME);
  teleportMap.set("Equal", "Sun");
  teleportMap.set("NumpadAdd", "Sun");
  teleportMap.set("Minus", "Sun");
  teleportMap.set("NumpadSubtract", "Sun");
  const orbitLines = new THREE.Group();
  solarSystem.add(orbitLines);
  const planetData = {
    Mercury: { radiusKm: 2439.7, au: 0.387, years: 0.2408, dayHours: 1407.6, map: textures.mercury },
    Venus: { radiusKm: 6051.8, au: 0.723, years: 0.6152, dayHours: -5832.5, map: textures.venus },
    Earth: { radiusKm: 6371, au: 1, years: 1, dayHours: 24, map: textures.earth },
    Mars: { radiusKm: 3389.5, au: 1.524, years: 1.8808, dayHours: 24.6, map: textures.mars },
    Jupiter: { radiusKm: 69911, au: 5.204, years: 11.86, dayHours: 9.9, map: textures.jupiter },
    Saturn: { radiusKm: 58232, au: 9.58, years: 29.45, dayHours: 10.7, map: textures.saturn, ring: true },
    Uranus: { radiusKm: 25362, au: 19.2, years: 84, dayHours: -17.2, map: textures.uranus, ring: "u" },
    Neptune: { radiusKm: 24622, au: 30.05, years: 164.8, dayHours: 16.1, map: textures.neptune },
    Moon: { radiusKm: 1737.4, au: 1, years: 1, dayHours: 708, map: textures.moon }
  };
  const OUTERMOST_PLANET_AU = Math.max(
    ...Object.entries(planetData)
      .filter(([name]) => name !== "Moon")
      .map(([, body]) => body.au)
  );
  const SOLAR_FRAME = {
    captureRadius: orbitDistance(OUTERMOST_PLANET_AU * 1.45),
    releaseRadius: orbitDistance(OUTERMOST_PLANET_AU * 1.9)
  };
  const orbitInitialPhase = {
    Mercury: 0.68,
    Venus: 1.82,
    Earth: 0,
    Mars: 2.75,
    Jupiter: 0.28,
    Saturn: 1.17,
    Uranus: 2.04,
    Neptune: 2.86
  };

  function orbitDistance(au) {
    return (au * SCALE.kmPerAU) / SCALE.orbitKmPerUnit;
  }
  function orbitRadius(km) {
    return km / SCALE.orbitKmPerUnit;
  }
  function updateShipCameraProfile() {
    const box = new THREE.Box3().setFromObject(ship.visual);
    const size = box.getSize(new THREE.Vector3());
    const hullLength = Math.max(0.4, size.z);
    ORBIT_CAMERA.backUnits = THREE.MathUtils.clamp(hullLength * 1.8, 2.2, ORBIT_CAMERA.maxBackUnitsClose);
    ORBIT_CAMERA.upUnits = THREE.MathUtils.clamp(hullLength * 0.46, 0.75, 1.8);
    ORBIT_CAMERA.lookAheadUnits = THREE.MathUtils.clamp(hullLength * 4.4, 6, ORBIT_CAMERA.maxLookAheadUnitsClose);
  }
  function fitObjectHeight(object, targetHeight) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const h = size.y || Math.max(size.x, size.z) || 1;
    const scale = targetHeight / h;
    object.scale.multiplyScalar(scale);
  }
  function createCapsuleGeometry(radius, length, capSegments = 8, radialSegments = 10) {
    if (THREE.CapsuleGeometry) {
      return new THREE.CapsuleGeometry(radius, length, capSegments, radialSegments);
    }
    return new THREE.CylinderGeometry(radius, radius, length + radius * 2, radialSegments);
  }
  function orbitalSpeedFromYears(years) {
    return EARTH_ORBIT_RAD_PER_SECOND / Math.max(0.01, years);
  }
  function orbitalSpeedFromDays(days) {
    return EARTH_ORBIT_RAD_PER_SECOND * (REAL_DAYS_PER_YEAR / Math.max(0.01, days));
  }
  function spinSpeed(hours) {
    const sign = hours < 0 ? -1 : 1;
    return sign * 5.6 / Math.max(6, Math.abs(hours));
  }
  const sunAroundBlackHoleOrbit = {
    // Keep Sun's black-hole orbit outside the outermost planetary orbit.
    radius: orbitDistance(OUTERMOST_PLANET_AU * 1.18),
    speed: EARTH_ORBIT_RAD_PER_SECOND * 0.12,
    angle: 0.9
  };
  const SHOW_SUN_BLACK_HOLE_ORBIT_LINE = false;
  const solarOrbitDelta = new THREE.Vector3();
  const solarOrbitPrev = new THREE.Vector3();
  function setSolarSystemOrbitPose() {
    solarSystem.position.set(
      blackHole.group.position.x + Math.cos(sunAroundBlackHoleOrbit.angle) * sunAroundBlackHoleOrbit.radius,
      0,
      blackHole.group.position.z - Math.sin(sunAroundBlackHoleOrbit.angle) * sunAroundBlackHoleOrbit.radius
    );
  }
  function addSunAroundBlackHoleOrbitLine() {
    const points = [];
    const segments = 420;
    for (let i = 0; i < segments; i += 1) {
      const t = (i / segments) * Math.PI * 2;
      points.push(
        new THREE.Vector3(
          blackHole.group.position.x + Math.cos(t) * sunAroundBlackHoleOrbit.radius,
          0,
          blackHole.group.position.z - Math.sin(t) * sunAroundBlackHoleOrbit.radius
        )
      );
    }
    orbitRoot.add(
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: 0xd68a4c,
          transparent: true,
          opacity: 0.34
        })
      )
    );
  }

  function addOrbitLine(distance) {
    const points = [];
    const segments = 360;
    for (let i = 0; i < segments; i += 1) {
      const t = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(t) * distance, 0, Math.sin(t) * distance));
    }
    orbitLines.add(
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: 0x3f6aa7,
          transparent: true,
          opacity: 0.18
        })
      )
    );
  }

  for (const name of orbitOrder.filter((n) => n !== "Moon")) {
    const d = planetData[name];
    const pivot = new THREE.Group();
    solarSystem.add(pivot);
    pivot.rotation.y = orbitInitialPhase[name] ?? 0;
    const spin = new THREE.Group();
    pivot.add(spin);
    const distance = orbitDistance(d.au);
    spin.position.x = distance;
    const radius = orbitRadius(d.radiusKm);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 82, 82),
      new THREE.MeshStandardMaterial({
        map: d.map,
        color: 0xc8d1dc,
        roughness: 0.86,
        metalness: 0.03,
        emissive: 0x000000,
        emissiveIntensity: 0,
        envMapIntensity: 0
      })
    );
    spin.add(mesh);

    if (name === "Earth" || name === "Venus" || name === "Neptune") {
      const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.035, 56, 56),
        new THREE.MeshLambertMaterial({
          color: name === "Venus" ? 0xffd2a4 : 0x6fb8ff,
          transparent: true,
          opacity: 0.14,
          side: THREE.FrontSide,
          depthWrite: false
        })
      );
      spin.add(atmosphere);
    }

    if (d.ring) {
      const ringColor = d.ring === "u" ? textures.uranusRing : textures.saturnRing;
      const ringAlpha = d.ring === "u" ? textures.uranusRingAlpha : textures.saturnRingAlpha;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 1.45, radius * (d.ring === "u" ? 1.95 : 2.55), 180),
        new THREE.MeshStandardMaterial({
          map: ringColor,
          alphaMap: ringAlpha,
          transparent: true,
          alphaTest: 0.08,
          side: THREE.DoubleSide,
          envMapIntensity: 0
        })
      );
      ring.rotation.x = Math.PI / 2;
      spin.add(ring);
    }

    planets.set(name, {
      name,
      mesh,
      pivot,
      spin,
      orbitSpeed: orbitalSpeedFromYears(d.years),
      spinSpeed: spinSpeed(d.dayHours)
    });

    addOrbitLine(distance);
  }

  const earth = planets.get("Earth");
  const moonPivot = new THREE.Group();
  earth.mesh.add(moonPivot);
  const moonSpin = new THREE.Group();
  moonPivot.add(moonSpin);
  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(orbitRadius(planetData.Moon.radiusKm), 56, 56),
    new THREE.MeshStandardMaterial({
      map: textures.moon,
      color: 0xbcc4ce,
      roughness: 0.95,
      metalness: 0.0,
      emissive: 0x000000,
      emissiveIntensity: 0,
      envMapIntensity: 0
    })
  );
  moonMesh.position.x = 384_400 / SCALE.orbitKmPerUnit;
  moonSpin.add(moonMesh);
  planets.set("Moon", {
    name: "Moon",
    mesh: moonMesh,
    pivot: moonPivot,
    spin: moonSpin,
    orbitSpeed: orbitalSpeedFromDays(MOON_ORBIT_DAYS),
    spinSpeed: 0.04
  });

  const BLACK_HOLE_RADIUS_KM = 7_000_000;
  const blackHole = createBlackHole(orbitDistance(4.1), orbitRadius(BLACK_HOLE_RADIUS_KM));
  orbitRoot.add(blackHole.group);
  initBlackHoleLensingPass();
  setSolarSystemOrbitPose();
  solarOrbitPrev.copy(solarSystem.position);
  if (SHOW_SUN_BLACK_HOLE_ORBIT_LINE) {
    addSunAroundBlackHoleOrbitLine();
  }
  const BLACK_HOLE_RS_KM = blackHole.eventHorizon * SCALE.orbitKmPerUnit;
  const BODY_RS_KM = {
    Sun: schwarzschildRadiusKm(BODY_MASS_KG.Sun),
    Mercury: schwarzschildRadiusKm(BODY_MASS_KG.Mercury),
    Venus: schwarzschildRadiusKm(BODY_MASS_KG.Venus),
    Earth: schwarzschildRadiusKm(BODY_MASS_KG.Earth),
    Moon: schwarzschildRadiusKm(BODY_MASS_KG.Moon),
    Mars: schwarzschildRadiusKm(BODY_MASS_KG.Mars),
    Jupiter: schwarzschildRadiusKm(BODY_MASS_KG.Jupiter),
    Saturn: schwarzschildRadiusKm(BODY_MASS_KG.Saturn),
    Uranus: schwarzschildRadiusKm(BODY_MASS_KG.Uranus),
    Neptune: schwarzschildRadiusKm(BODY_MASS_KG.Neptune),
    [BLACK_HOLE_NAME]: BLACK_HOLE_RS_KM
  };

  const SHUTTLE_HEIGHT_KM = 0.037;
  const SHUTTLE_HEIGHT_UNITS = 0.42;
  const SHUTTLE_HEIGHT_SURFACE_UNITS = 37 / SCALE.localMetersPerUnit;
  const SHUTTLE_SURFACE_SCALE = SHUTTLE_HEIGHT_SURFACE_UNITS / SHUTTLE_HEIGHT_UNITS;

  const ship = createShipFallback();
  orbitRoot.add(ship.rig);
  const earthStartPos = earth.mesh.getWorldPosition(new THREE.Vector3());
  setOrbitPositionNearTarget(earthStartPos, 28);
  orientShipToward(earthStartPos);
  fitObjectHeight(ship.visual, SHUTTLE_HEIGHT_UNITS);
  updateShipCameraProfile();
  const fallbackSurfaceShuttle = ship.visual.clone(true);

  const assets = { shuttle: fallbackSurfaceShuttle.clone(true), astronaut: null, astronautClips: [] };

  const ASTRONAUT_HEIGHT_UNITS = 1.78 / SCALE.localMetersPerUnit;
  loadFirstWorkingModel(ASTRONAUT_MODEL_URLS, ASTRONAUT_HEIGHT_UNITS)
    .then((m) => {
      assets.astronaut = m.scene;
      assets.astronautClips = m.animations;
      if (state.mode === "surface") {
        setSurfaceAstronaut();
      }
    })
    .catch(() => {
      overlayTextEl.textContent = "Remote astronaut models unavailable. Using local astronaut fallback.";
    });

  const surface = {
    terrain: null,
    profile: null,
    sampleHeight: (x, z) => 0,
    shuttle: null,
    astronautRig: new THREE.Group(),
    astronautNode: null,
    astronautMixer: null,
    astronautActions: null,
    walkPhase: 0,
    camYaw: 0.5,
    camPitch: -0.2,
    heading: 0,
    speed: 0,
    groundOffset: 0
  };
  surfaceRoot.add(surface.astronautRig);

  const surfaceSky = createSurfaceSkyDome();
  surfaceRoot.add(surfaceSky);

  function createShipFallback() {
    const rig = new THREE.Group();
    const visual = new THREE.Group();
    rig.add(visual);

    const hull = new THREE.MeshPhysicalMaterial({
      color: 0x98a8bc,
      roughness: 0.82,
      metalness: 0.08,
      clearcoat: 0.02,
      clearcoatRoughness: 0.85
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a3547, roughness: 0.72, metalness: 0.2 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x66b1cc, emissive: 0x2a8fb3, emissiveIntensity: 0.22 });

    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.84, 6.4, 20), hull);
    fuselage.rotation.x = Math.PI / 2;
    visual.add(fuselage);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.62, 2.1, 20), hull);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -4.2;
    visual.add(nose);

    const cockpit = new THREE.Mesh(
      new THREE.SphereGeometry(0.52, 22, 16),
      new THREE.MeshPhysicalMaterial({
        color: 0xb2d2ff,
        roughness: 0.28,
        metalness: 0.06,
        transmission: 0.34,
        thickness: 0.2,
        transparent: true,
        opacity: 0.62
      })
    );
    cockpit.position.set(0, 0.42, -2.86);
    cockpit.scale.set(1.08, 0.58, 1.12);
    visual.add(cockpit);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.15, 2.1), hull);
    wing.position.set(0, -0.06, -0.22);
    visual.add(wing);

    const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.36, 1.2), dark);
    tailFin.position.set(0, 0.8, 1.58);
    visual.add(tailFin);

    const engineMount = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.32, 1.25), dark);
    engineMount.position.set(0, -0.12, 2.75);
    visual.add(engineMount);

    const thruster = new THREE.Mesh(new THREE.ConeGeometry(0.29, 1.35, 18), glow);
    thruster.rotation.x = Math.PI / 2;
    thruster.position.set(0, 0, 3.95);
    visual.add(thruster);

    const thrusterL = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.9, 14), glow);
    thrusterL.rotation.x = Math.PI / 2;
    thrusterL.position.set(-0.42, -0.07, 3.55);
    visual.add(thrusterL);

    const thrusterR = thrusterL.clone();
    thrusterR.position.x = 0.42;
    visual.add(thrusterR);

    const engineLight = new THREE.PointLight(0x7ce0ff, 0.7, 10, 2);
    engineLight.position.set(0, 0, 4.3);
    visual.add(engineLight);

    return { rig, visual, thruster, glow, engineLight, velocity: new THREE.Vector3() };
  }

  function createBlackHole(distance, radius) {
    const group = new THREE.Group();
    group.position.set(-distance, 0, distance * 0.08);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 56, 56),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        toneMapped: false
      })
    );
    group.add(core);

    // Inner edge at the event-horizon radius scale requested.
    const diskInnerFactor = 1.0;
    // Original width was (4.8 - 1.7) => 3.1; make it 60% smaller, then 15% smaller again.
    const diskOuterFactor = diskInnerFactor + (4.8 - 1.7) * 0.4 * 0.85;
    const diskInnerNorm = diskInnerFactor / diskOuterFactor;
    const disk = new THREE.Mesh(
      new THREE.RingGeometry(radius * diskInnerFactor, radius * diskOuterFactor, 512),
      new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          innerNorm: { value: diskInnerNorm }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float time;
          uniform float innerNorm;
          varying vec2 vUv;
          void main() {
            vec2 p = vUv - 0.5;
            float r = length(p) * 2.0;
            float ang = atan(p.y, p.x);
            // Clamp shading strictly to the ring area so it never bleeds into the core.
            // Softer mask avoids minification dropouts at long distance.
            float ringMask = smoothstep(innerNorm, innerNorm + 0.06, r) * (1.0 - smoothstep(1.0, 1.08, r));
            float ringT = clamp((r - innerNorm) / max(0.0001, 1.0 - innerNorm), 0.0, 1.0);
            float innerBand = exp(-pow((ringT - 0.16) * 8.0, 2.0));
            float midBand = exp(-pow((ringT - 0.48) * 4.8, 2.0));
            float outerBand = exp(-pow((ringT - 0.8) * 3.7, 2.0));
            // Use seam-safe integer angular harmonics to avoid a visible ring seam at atan wrap.
            float swirl =
              0.74 +
              0.18 * sin(ang * 2.0 - time * 1.4 + ringT * 5.0) +
              0.08 * cos(ang * 4.0 + time * 0.8 - ringT * 3.0);
            float intensity = ((innerBand * 1.18 + midBand * 0.84 + outerBand * 0.58) * swirl + 0.24) * ringMask;
            vec3 hot = vec3(1.0, 0.9, 0.72);
            vec3 warm = vec3(0.98, 0.56, 0.22);
            vec3 cool = vec3(0.58, 0.24, 0.08);
            vec3 color = mix(cool, warm, clamp(innerBand + midBand * 0.5, 0.0, 1.0));
            color = mix(color, hot, clamp(innerBand * 1.3, 0.0, 1.0)) * intensity;
            float alpha = clamp(max(0.18 * ringMask, intensity * 0.7), 0.0, 0.86);
            gl_FragColor = vec4(color, alpha);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false
      })
    );
    disk.rotation.x = Math.PI / 2 + 0.22;
    disk.frustumCulled = false;

    group.add(disk);

    return {
      name: BLACK_HOLE_NAME,
      group,
      core,
      disk,
      halo: null,
      northJet: null,
      southJet: null,
      radius,
      diskOuterRadius: radius * diskOuterFactor,
      influenceRadius: radius * 110,
      gravityStrength: radius * 10.5,
      eventHorizon: radius * 1.06
    };
  }

  function initBlackHoleLensingPass() {
    if (!ShaderPass) {
      return;
    }
    const lensingShader = {
      uniforms: {
        tDiffuse: { value: null },
        center: { value: new THREE.Vector2(0.5, 0.5) },
        radius: { value: 0.12 },
        strength: { value: 0.0058 },
        aspect: { value: camera.aspect },
        ringStrength: { value: 0.34 },
        visible: { value: 0.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 center;
        uniform float radius;
        uniform float strength;
        uniform float aspect;
        uniform float ringStrength;
        uniform float visible;
        varying vec2 vUv;
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          if (visible < 0.001) {
            gl_FragColor = base;
            return;
          }
          vec2 d = vUv - center;
          vec2 dA = vec2(d.x * aspect, d.y);
          float r = length(dA);
          float rSafe = max(radius, 0.0001);
          vec2 dir = dA / max(r, 0.00001);

          // Smooth, boundary-free falloff prevents the large artificial outer ring.
          float bendBand = exp(-pow((r - rSafe * 1.03) / max(0.0001, rSafe * 0.22), 2.0));
          float bend = strength * bendBand;
          vec2 oA = dir * bend;
          vec2 o = vec2(oA.x / aspect, oA.y);
          vec4 warped = texture2D(tDiffuse, vUv + o);

          float photon = exp(-pow((r - rSafe * 1.018) / (rSafe * 0.115), 2.0));
          float halo = exp(-pow((r - rSafe * 1.11) / (rSafe * 0.18), 2.0));
          vec3 ringColor = vec3(1.0, 0.86, 0.62) * photon * ringStrength * 1.05;
          vec3 haloColor = vec3(0.95, 0.56, 0.24) * halo * ringStrength * 0.22;
          warped.rgb += ringColor + haloColor;

          // Never apply post lensing inside the hole silhouette; let scene depth decide occlusion.
          float outerOnly = smoothstep(rSafe * 1.0, rSafe * 1.04, r);
          float blendMask = clamp(max(bendBand, photon * 1.2) * outerOnly, 0.0, 1.0);
          gl_FragColor = mix(base, warped, clamp(blendMask * visible, 0.0, 1.0));
        }
      `
    };
    blackHoleLensing.pass = new ShaderPass(lensingShader);
    composer.addPass(blackHoleLensing.pass);
  }

  function updateBlackHoleLensing() {
    const pass = blackHoleLensing.pass;
    if (!pass) {
      return;
    }
    const uniforms = pass.material.uniforms;
    uniforms.aspect.value = camera.aspect;
    uniforms.visible.value = 0.0;

    const cameraForward = tmpV1;
    camera.getWorldDirection(cameraForward);
    const toHole = tmpV2.copy(blackHole.group.position).sub(camera.position);
    if (cameraForward.dot(toHole) <= 0) {
      return;
    }

    const distance = Math.max(0.001, toHole.length());
    const projected = tmpV3.copy(blackHole.group.position).project(camera);
    if (projected.z < -1 || projected.z > 1) {
      return;
    }

    uniforms.center.value.set(projected.x * 0.5 + 0.5, projected.y * 0.5 + 0.5);

    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const angularRadius = Math.atan2(blackHole.radius * 1.04, distance);
    const ndcRadius = Math.tan(angularRadius) / Math.tan(fovRad * 0.5);
    const uvRadius = THREE.MathUtils.clamp(ndcRadius * 0.5, 0.01, 0.46);
    // Keep lensing until ship is essentially at/beyond disk-crossing distance.
    const diskCrossDistance = blackHole.diskOuterRadius * 0.98;
    if (distance < diskCrossDistance) {
      return;
    }
    uniforms.radius.value = uvRadius;

    const nearFactor = THREE.MathUtils.clamp(1 - distance / (blackHole.influenceRadius * 1.3), 0, 1);
    const sizeFade = 1 - THREE.MathUtils.smoothstep(uvRadius, 0.36, 0.44);
    uniforms.strength.value = THREE.MathUtils.lerp(0.0024, 0.011, nearFactor) * sizeFade;
    uniforms.ringStrength.value = THREE.MathUtils.lerp(0.12, 0.58, nearFactor) * sizeFade;
    uniforms.visible.value = sizeFade;
  }

  function createFallbackAstronaut() {
    const g = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, roughness: 0.38, metalness: 0.12 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x23334f, roughness: 0.46, metalness: 0.4 });
    const visorMat = new THREE.MeshPhysicalMaterial({
      color: 0x9fd9ff,
      transparent: true,
      opacity: 0.55,
      roughness: 0.05,
      metalness: 0.2,
      transmission: 0.6,
      thickness: 0.2
    });

    const boots = [];
    const torso = new THREE.Mesh(createCapsuleGeometry(0.2, 0.62, 10, 14), suit);
    torso.position.y = 1;
    g.add(torso);

    const chestPack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.14), trim);
    chestPack.position.set(0, 1.08, 0.21);
    g.add(chestPack);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), suit);
    head.position.y = 1.46;
    g.add(head);

    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), visorMat);
    visor.position.set(0, 1.46, 0.1);
    visor.scale.set(1, 0.9, 0.65);
    g.add(visor);

    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.27, 1.21, 0);
    const leftArm = new THREE.Mesh(createCapsuleGeometry(0.07, 0.42, 8, 10), suit);
    leftArm.position.y = -0.24;
    leftArmPivot.add(leftArm);
    g.add(leftArmPivot);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.27, 1.21, 0);
    const rightArm = leftArm.clone();
    rightArmPivot.add(rightArm);
    g.add(rightArmPivot);

    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.11, 0.79, 0);
    const leftLeg = new THREE.Mesh(createCapsuleGeometry(0.08, 0.46, 8, 10), suit);
    leftLeg.position.y = -0.3;
    leftLegPivot.add(leftLeg);
    const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.28), trim);
    leftBoot.position.set(0, -0.56, 0.08);
    leftLegPivot.add(leftBoot);
    boots.push(leftBoot);
    g.add(leftLegPivot);

    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.11, 0.79, 0);
    const rightLeg = leftLeg.clone();
    rightLegPivot.add(rightLeg);
    const rightBoot = leftBoot.clone();
    rightLegPivot.add(rightBoot);
    boots.push(rightBoot);
    g.add(rightLegPivot);

    g.userData.proceduralRig = {
      leftArmPivot,
      rightArmPivot,
      leftLegPivot,
      rightLegPivot,
      head,
      torso,
      boots
    };
    return g;
  }

  function loadModel(url, targetSize, options = {}) {
    const { fitMode = "height", anchorMode = "ground" } = options;
    return new Promise((resolve, reject) => {
      gltfLoader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const refSize =
            fitMode === "max" ? Math.max(size.x, size.y, size.z) || 1 : size.y || Math.max(size.x, size.z) || 1;
          model.scale.setScalar(targetSize / refSize);
          box.setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          model.position.sub(center);
          if (anchorMode === "ground") {
            model.position.y -= box.min.y;
          }
          resolve({
            scene: model,
            animations: gltf.animations || []
          });
        },
        undefined,
        reject
      );
    });
  }

  async function loadFirstWorkingModel(urls, targetSize, options = {}) {
    let lastError = null;
    for (const url of urls) {
      try {
        return await loadModel(url, targetSize, options);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("No astronaut model URL resolved.");
  }

  function createSurfaceSkyDome() {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x121a2b) },
        bottomColor: { value: new THREE.Color(0x202734) },
        horizonColor: { value: new THREE.Color(0x3a4459) },
        hazeStrength: { value: 0.2 }
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldPos = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform vec3 horizonColor;
        uniform float hazeStrength;
        varying vec3 vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
          float horizon = smoothstep(0.34, 0.72, h);
          vec3 color = mix(bottomColor, topColor, horizon);
          float hazeBand = exp(-pow((h - 0.5) * 7.0, 2.0));
          color = mix(color, horizonColor, hazeBand * hazeStrength);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4900, 52, 30), material);
    dome.frustumCulled = false;
    return dome;
  }

  function setShadowState(node, cast, receive) {
    node.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = cast;
        child.receiveShadow = receive;
      }
    });
  }

  const surfaceProfiles = {
    Mercury: {
      gas: false,
      size: 2500,
      seg: 252,
      amp: 42,
      ridgeAmp: 16,
      microAmp: 7,
      noiseScale: 0.0045,
      craterCount: 130,
      craterMin: 28,
      craterMax: 150,
      craterDepth: 15,
      roughness: 0.95,
      metalness: 0.03,
      slopeTint: 0.48,
      colorLow: 0x3c3f46,
      colorMid: 0x6c7078,
      colorHigh: 0xb6b9be,
      accentColor: 0xd7d8da,
      groundOffset: 0,
      fogColor: 0x1b1f2a,
      fogDensity: 0.00052,
      skyTop: 0x0e1119,
      skyBottom: 0x1e212c,
      skyHorizon: 0x50535d,
      skyHaze: 0.14,
      sunColor: 0xfff0d0,
      sunIntensity: 7.1,
      sunDir: [0.32, 1, 0.22]
    },
    Venus: {
      gas: false,
      size: 2400,
      seg: 236,
      amp: 24,
      ridgeAmp: 7,
      microAmp: 4,
      noiseScale: 0.0036,
      craterCount: 24,
      craterMin: 40,
      craterMax: 100,
      craterDepth: 6,
      roughness: 0.93,
      metalness: 0.02,
      slopeTint: 0.35,
      colorLow: 0x5d4e38,
      colorMid: 0x927553,
      colorHigh: 0xcfaf85,
      accentColor: 0xe7ca9f,
      groundOffset: 0,
      fogColor: 0x8f6e4a,
      fogDensity: 0.00125,
      skyTop: 0x6a5038,
      skyBottom: 0x8f6e4a,
      skyHorizon: 0xd3a56f,
      skyHaze: 0.48,
      sunColor: 0xffdfb0,
      sunIntensity: 5.2,
      sunDir: [0.22, 1, 0.1]
    },
    Earth: {
      gas: false,
      size: 2700,
      seg: 280,
      amp: 56,
      ridgeAmp: 21,
      microAmp: 9,
      noiseScale: 0.0034,
      craterCount: 16,
      craterMin: 35,
      craterMax: 120,
      craterDepth: 5,
      roughness: 0.84,
      metalness: 0.02,
      slopeTint: 0.45,
      colorLow: 0x35513a,
      colorMid: 0x68846a,
      colorHigh: 0xd8d7d1,
      accentColor: 0xeff1f0,
      groundOffset: 0,
      fogColor: 0x6c92bb,
      fogDensity: 0.00064,
      skyTop: 0x2f629f,
      skyBottom: 0x8cb5de,
      skyHorizon: 0xd8ecff,
      skyHaze: 0.58,
      sunColor: 0xfff2d8,
      sunIntensity: 6.3,
      sunDir: [0.36, 1, 0.15]
    },
    Moon: {
      gas: false,
      size: 2550,
      seg: 276,
      amp: 39,
      ridgeAmp: 14,
      microAmp: 5,
      noiseScale: 0.0041,
      craterCount: 170,
      craterMin: 20,
      craterMax: 180,
      craterDepth: 18,
      roughness: 0.97,
      metalness: 0.02,
      slopeTint: 0.56,
      colorLow: 0x424650,
      colorMid: 0x727680,
      colorHigh: 0xc6cad0,
      accentColor: 0xecf0f2,
      groundOffset: 0,
      fogColor: 0x0e1118,
      fogDensity: 0.00043,
      skyTop: 0x060810,
      skyBottom: 0x141824,
      skyHorizon: 0x343d50,
      skyHaze: 0.18,
      sunColor: 0xfff3dd,
      sunIntensity: 6.9,
      sunDir: [0.28, 1, 0.26]
    },
    Mars: {
      gas: false,
      size: 2620,
      seg: 266,
      amp: 47,
      ridgeAmp: 19,
      microAmp: 8,
      noiseScale: 0.0039,
      craterCount: 85,
      craterMin: 28,
      craterMax: 140,
      craterDepth: 11,
      roughness: 0.92,
      metalness: 0.03,
      slopeTint: 0.5,
      colorLow: 0x4c2f24,
      colorMid: 0x8a5341,
      colorHigh: 0xd49b7c,
      accentColor: 0xf0c2a2,
      groundOffset: 0,
      fogColor: 0x7a4635,
      fogDensity: 0.00082,
      skyTop: 0x422a24,
      skyBottom: 0x7a4635,
      skyHorizon: 0xbd775c,
      skyHaze: 0.42,
      sunColor: 0xffdfc1,
      sunIntensity: 6.1,
      sunDir: [0.3, 1, 0.1]
    },
    Jupiter: {
      gas: true,
      size: 2800,
      seg: 220,
      amp: 12,
      ridgeAmp: 5,
      microAmp: 3,
      noiseScale: 0.0026,
      craterCount: 0,
      craterMin: 0,
      craterMax: 0,
      craterDepth: 0,
      roughness: 0.86,
      metalness: 0.06,
      slopeTint: 0.28,
      colorLow: 0x655443,
      colorMid: 0xa98d6d,
      colorHigh: 0xe0c7a0,
      accentColor: 0xf3dfbd,
      groundOffset: 9,
      fogColor: 0x5d5142,
      fogDensity: 0.00105,
      skyTop: 0x5f4e3d,
      skyBottom: 0x907353,
      skyHorizon: 0xc39b72,
      skyHaze: 0.52,
      sunColor: 0xffddb0,
      sunIntensity: 4.9,
      sunDir: [0.24, 1, 0.12]
    },
    Saturn: {
      gas: true,
      size: 2800,
      seg: 220,
      amp: 10,
      ridgeAmp: 4,
      microAmp: 2.4,
      noiseScale: 0.0027,
      craterCount: 0,
      craterMin: 0,
      craterMax: 0,
      craterDepth: 0,
      roughness: 0.84,
      metalness: 0.05,
      slopeTint: 0.26,
      colorLow: 0x68573f,
      colorMid: 0xac946e,
      colorHigh: 0xebd9b2,
      accentColor: 0xf8e9c8,
      groundOffset: 9,
      fogColor: 0x66563f,
      fogDensity: 0.00102,
      skyTop: 0x6f6048,
      skyBottom: 0x9d8561,
      skyHorizon: 0xd6b88f,
      skyHaze: 0.5,
      sunColor: 0xffdfbe,
      sunIntensity: 4.8,
      sunDir: [0.24, 1, 0.14]
    },
    Uranus: {
      gas: true,
      size: 2800,
      seg: 220,
      amp: 8,
      ridgeAmp: 3,
      microAmp: 2.1,
      noiseScale: 0.0028,
      craterCount: 0,
      craterMin: 0,
      craterMax: 0,
      craterDepth: 0,
      roughness: 0.82,
      metalness: 0.06,
      slopeTint: 0.23,
      colorLow: 0x4b6b73,
      colorMid: 0x77a1aa,
      colorHigh: 0xc6edf3,
      accentColor: 0xe5fbff,
      groundOffset: 9,
      fogColor: 0x5b7f87,
      fogDensity: 0.00093,
      skyTop: 0x557784,
      skyBottom: 0x79a6b1,
      skyHorizon: 0xbbe8f3,
      skyHaze: 0.54,
      sunColor: 0xdbf6ff,
      sunIntensity: 4.4,
      sunDir: [0.2, 1, 0.2]
    },
    Neptune: {
      gas: true,
      size: 2800,
      seg: 220,
      amp: 8,
      ridgeAmp: 3,
      microAmp: 2.2,
      noiseScale: 0.0028,
      craterCount: 0,
      craterMin: 0,
      craterMax: 0,
      craterDepth: 0,
      roughness: 0.84,
      metalness: 0.06,
      slopeTint: 0.24,
      colorLow: 0x335283,
      colorMid: 0x4e79bf,
      colorHigh: 0x8ac4ff,
      accentColor: 0xc2ebff,
      groundOffset: 9,
      fogColor: 0x2d4f7f,
      fogDensity: 0.00092,
      skyTop: 0x254377,
      skyBottom: 0x3f679f,
      skyHorizon: 0x7db5f2,
      skyHaze: 0.5,
      sunColor: 0xd8ecff,
      sunIntensity: 4.5,
      sunDir: [0.18, 1, 0.24]
    }
  };

  function hashString(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function smoothCurve(t) {
    return t * t * (3 - 2 * t);
  }

  function valueNoise2D(x, z, seed) {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const x1 = x0 + 1;
    const z1 = z0 + 1;
    const tx = smoothCurve(x - x0);
    const tz = smoothCurve(z - z0);
    const rand = (ix, iz) => {
      const s = Math.sin(ix * 127.1 + iz * 311.7 + seed * 0.017) * 43758.5453;
      return s - Math.floor(s);
    };
    const v00 = rand(x0, z0);
    const v10 = rand(x1, z0);
    const v01 = rand(x0, z1);
    const v11 = rand(x1, z1);
    const a = THREE.MathUtils.lerp(v00, v10, tx);
    const b = THREE.MathUtils.lerp(v01, v11, tx);
    return THREE.MathUtils.lerp(a, b, tz) * 2 - 1;
  }

  function fbmNoise2D(x, z, seed, octaves = 5, lacunarity = 2.02, gain = 0.52) {
    let amp = 0.5;
    let freq = 1;
    let total = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
      total += valueNoise2D(x * freq, z * freq, seed + i * 11.3) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return total / Math.max(0.0001, norm);
  }

  function ridgeNoise2D(x, z, seed, octaves = 4, lacunarity = 2.0, gain = 0.52) {
    let amp = 0.6;
    let freq = 1;
    let total = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
      const n = 1 - Math.abs(valueNoise2D(x * freq, z * freq, seed + i * 17.1));
      total += n * n * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return total / Math.max(0.0001, norm);
  }

  function createCraterField(seed, count, spread, minRadius, maxRadius, depthScale) {
    let stateSeed = seed >>> 0;
    const next = () => {
      stateSeed = (Math.imul(stateSeed, 1664525) + 1013904223) >>> 0;
      return stateSeed / 4294967296;
    };
    const craters = [];
    for (let i = 0; i < count; i += 1) {
      const r = THREE.MathUtils.lerp(minRadius, maxRadius, next());
      craters.push({
        x: (next() * 2 - 1) * spread,
        z: (next() * 2 - 1) * spread,
        radius: r,
        depth: depthScale * THREE.MathUtils.lerp(0.5, 1.3, next())
      });
    }
    return craters;
  }

  function setSurfaceAstronaut() {
    if (surface.astronautNode) {
      surface.astronautRig.remove(surface.astronautNode);
    }
    if (surface.astronautMixer) {
      surface.astronautMixer.stopAllAction();
      surface.astronautMixer = null;
    }
    surface.astronautActions = null;

    surface.astronautNode = assets.astronaut
      ? SkeletonUtils?.clone
        ? SkeletonUtils.clone(assets.astronaut)
        : assets.astronaut.clone(true)
      : createFallbackAstronaut();

    surface.astronautNode.scale.multiplyScalar(4.0);
    setShadowState(surface.astronautNode, true, true);
    surface.astronautRig.add(surface.astronautNode);

    if (assets.astronautClips.length > 0) {
      const clips = assets.astronautClips;
      const mixer = new THREE.AnimationMixer(surface.astronautNode);
      const pickClip = (terms) => clips.find((clip) => terms.some((t) => clip.name.toLowerCase().includes(t)));
      const idleClip = pickClip(["idle", "stand", "breath"]) || clips[0];
      const walkClip = pickClip(["walk", "jog", "run"]);
      const idle = idleClip ? mixer.clipAction(idleClip) : null;
      const walk = walkClip ? mixer.clipAction(walkClip) : null;

      if (idle) {
        idle.enabled = true;
        idle.play();
        idle.setEffectiveWeight(1);
        idle.setEffectiveTimeScale(1);
      }
      if (walk) {
        walk.enabled = true;
        walk.play();
        walk.setEffectiveWeight(0);
        walk.setEffectiveTimeScale(1);
      }

      surface.astronautMixer = mixer;
      surface.astronautActions = { idle, walk };
    }
  }

  function buildSurface(planetName) {
    const p = planetData[planetName] || planetData.Moon;
    const profile = surfaceProfiles[planetName] || surfaceProfiles.Moon;
    const seed = hashString(planetName);
    const radiusUnits = (p.radiusKm * 1000) / SCALE.localMetersPerUnit;
    const size = profile.size;
    const seg = profile.seg;

    if (surface.terrain) {
      surfaceRoot.remove(surface.terrain);
      surface.terrain.geometry.dispose();
      surface.terrain.material.dispose();
    }
    if (surface.shuttle) {
      surfaceRoot.remove(surface.shuttle);
    }

    const skyMaterial = surfaceSky.material;
    skyMaterial.uniforms.topColor.value.setHex(profile.skyTop);
    skyMaterial.uniforms.bottomColor.value.setHex(profile.skyBottom);
    skyMaterial.uniforms.horizonColor.value.setHex(profile.skyHorizon);
    skyMaterial.uniforms.hazeStrength.value = profile.skyHaze;

    surfaceSun.color.setHex(profile.sunColor);
    surfaceSun.intensity = profile.sunIntensity * 0.76;
    surfaceSun.position
      .set(profile.sunDir[0], profile.sunDir[1], profile.sunDir[2])
      .normalize()
      .multiplyScalar(340);
    surfaceSunTarget.position.set(0, 0, 0);
    surfaceSunTarget.updateMatrixWorld();
    surfaceSun.shadow.needsUpdate = true;

    const craterField = profile.gas
      ? []
      : createCraterField(seed, profile.craterCount, size * 0.46, profile.craterMin, profile.craterMax, profile.craterDepth);

    const sampleHeight = (x, z) => {
      const nx = x * profile.noiseScale;
      const nz = z * profile.noiseScale;

      let h =
        fbmNoise2D(nx, nz, seed, 5, 2.02, 0.52) * profile.amp +
        ridgeNoise2D(nx * 1.9 + 12.3, nz * 1.9 - 8.7, seed + 71, 4, 2.03, 0.5) * profile.ridgeAmp +
        fbmNoise2D(nx * 5.2 - 32.1, nz * 5.2 + 21.5, seed + 145, 2, 2.01, 0.56) * profile.microAmp;

      if (!profile.gas && craterField.length > 0) {
        for (const crater of craterField) {
          const dx = x - crater.x;
          const dz = z - crater.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist >= crater.radius) continue;
          const t = dist / crater.radius;
          const bowl = -Math.pow(1 - t * t, 2);
          const rim = Math.exp(-Math.pow((t - 0.94) / 0.1, 2)) * 0.36;
          h += (bowl + rim) * crater.depth;
        }
      } else {
        h += 9;
      }

      const curvature = -(x * x + z * z) / (2 * radiusUnits);
      return h + curvature;
    };

    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const heights = new Float32Array(pos.count);
    let minH = Infinity;
    let maxH = -Infinity;
    for (let i = 0; i < pos.count; i += 1) {
      const y = sampleHeight(pos.getX(i), pos.getZ(i));
      heights[i] = y;
      if (y < minH) minH = y;
      if (y > maxH) maxH = y;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const nrm = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(profile.colorLow);
    const mid = new THREE.Color(profile.colorMid);
    const high = new THREE.Color(profile.colorHigh);
    const accent = new THREE.Color(profile.accentColor);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i += 1) {
      const hNorm = (heights[i] - minH) / Math.max(0.0001, maxH - minH);
      const slope = 1 - Math.max(0, nrm.getY(i));
      const tint = fbmNoise2D(pos.getX(i) * 0.012 + 8.1, pos.getZ(i) * 0.012 - 3.4, seed + 233, 2, 2, 0.5) * 0.08;
      const mixVal = THREE.MathUtils.clamp(hNorm * 0.8 + slope * profile.slopeTint + tint, 0, 1);
      if (mixVal < 0.55) {
        c.lerpColors(low, mid, mixVal / 0.55);
      } else {
        c.lerpColors(mid, high, (mixVal - 0.55) / 0.45);
      }
      const accentWeight = THREE.MathUtils.clamp((slope - 0.58) * 1.45, 0, 0.56);
      c.lerp(accent, accentWeight);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    surface.terrain = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: profile.roughness,
        metalness: profile.metalness,
        envMapIntensity: profile.gas ? 0.48 : 0.26
      })
    );
    surface.terrain.receiveShadow = true;
    surface.terrain.userData.sampleHeight = sampleHeight;
    surfaceRoot.add(surface.terrain);
    surface.sampleHeight = sampleHeight;
    surface.profile = profile;
    surface.groundOffset = profile.groundOffset;

    surface.shuttle = assets.shuttle ? assets.shuttle.clone(true) : fallbackSurfaceShuttle.clone(true);
    surface.shuttle.scale.multiplyScalar(SHUTTLE_SURFACE_SCALE);
    surface.shuttle.position.set(15, sampleHeight(15, -24) + surface.groundOffset, -24);
    surface.shuttle.rotation.y = Math.PI * 0.6;
    setShadowState(surface.shuttle, true, true);
    surfaceRoot.add(surface.shuttle);

    setSurfaceAstronaut();
    surface.astronautRig.position.set(0, sampleHeight(0, 0) + surface.groundOffset, 0);
    surface.heading = 0;
    surface.speed = 0;
    surface.walkPhase = 0;
    surface.camYaw = 0.5;
    surface.camPitch = 0.05;

    scene.fog = new THREE.FogExp2(profile.fogColor, profile.fogDensity);
  }

  function applyOrbitCameraPose() {
    const backDistance = Math.min(ORBIT_CAMERA.backUnits, ORBIT_CAMERA.maxBackUnitsClose);
    const lookDistance = Math.min(ORBIT_CAMERA.lookAheadUnits, ORBIT_CAMERA.maxLookAheadUnitsClose);

    // Keep ship matrix current to avoid one-frame camera lag at extreme speeds.
    ship.rig.updateMatrixWorld(true);
    // Use ship-local offsets so camera distance is constant regardless velocity.
    camera.position.copy(ship.rig.localToWorld(tmpV3.set(0, ORBIT_CAMERA.upUnits, backDistance)));
    cameraLook.copy(ship.rig.localToWorld(tmpV4.set(0, 0, -lookDistance)));
    camera.lookAt(cameraLook);
  }

  function snapOrbitCamera() {
    applyOrbitCameraPose();
  }

  function orientShipToward(target) {
    // Explicitly align gameplay forward axis (-Z) to the target direction.
    tmpV1.copy(target).sub(ship.rig.position);
    if (tmpV1.lengthSq() < 1e-8) {
      return;
    }
    tmpV1.normalize();
    tmpQuat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), tmpV1);
    ship.rig.quaternion.copy(tmpQuat);
    ship.rig.quaternion.normalize();
  }

  function setOrbitPositionNearTarget(target, standOff) {
    tmpV2.copy(target);
    if (tmpV2.lengthSq() < 1e-8) {
      tmpV2.set(1, 0, 0);
    }
    tmpV2.normalize();
    ship.rig.position.copy(target).addScaledVector(tmpV2, standOff);
    ship.rig.position.y += Math.max(2, standOff * 0.14);
  }

  function enterSurface(name) {
    state.mode = "surface";
    state.currentSurfacePlanet = name;
    buildSurface(name);
    camera.fov = SURFACE_FOV;
    camera.updateProjectionMatrix();
    snapSurfaceCamera();
    orbitRoot.visible = false;
    surfaceRoot.visible = true;
    returnOrbitBtn.style.display = "block";
    overlayEl.classList.remove("visible");
  }

  function enterOrbit() {
    state.mode = "orbit";
    camera.fov = ORBIT_FOV;
    camera.updateProjectionMatrix();
    orbitRoot.visible = true;
    surfaceRoot.visible = false;
    scene.fog = null;
    returnOrbitBtn.style.display = "none";
    const targetPlanet = planets.get(state.currentSurfacePlanet) || planets.get("Earth");
    const target = targetPlanet.mesh.getWorldPosition(tmpV1);
    const radius = targetPlanet.mesh.geometry?.parameters?.radius || 1;
    const standOff = THREE.MathUtils.clamp(radius * 2.6 + 10, 18, 180);
    setOrbitPositionNearTarget(target, standOff);
    orientShipToward(target);
    ship.velocity.set(0, 0, 0);
    state.shipInSolarFrame = true;
    snapOrbitCamera();
  }

  function snapSurfaceCamera() {
    const lookHeightUnits = SURFACE_CAMERA.lookHeightUnits;
    const followRadiusUnits = SURFACE_CAMERA.followDistanceUnits;
    const heightOffsetUnits = SURFACE_CAMERA.heightOffsetUnits;
    const cameraClearance = SURFACE_CAMERA.clearanceUnits;
    const target = tmpV1.copy(surface.astronautRig.position).add(new THREE.Vector3(0, lookHeightUnits, 0));
    const h = Math.cos(surface.camPitch) * followRadiusUnits;
    const camPos = tmpV2
      .set(
        Math.sin(surface.camYaw) * h,
        Math.sin(surface.camPitch) * followRadiusUnits + heightOffsetUnits,
        Math.cos(surface.camYaw) * h
      )
      .add(target);
    const desiredGroundY = surface.sampleHeight(camPos.x, camPos.z) + surface.groundOffset + cameraClearance;
    if (camPos.y < desiredGroundY) {
      camPos.y = desiredGroundY;
    }
    camera.position.copy(camPos);
    cameraLook.copy(target);
    camera.lookAt(cameraLook);
  }

  function teleportToPlanet(planetName) {
    if (planetName === "Sun") {
      state.mode = "orbit";
      state.running = true;
      orbitRoot.visible = true;
      surfaceRoot.visible = false;
      scene.fog = null;
      returnOrbitBtn.style.display = "none";
      overlayEl.classList.remove("visible");

      const target = sun.getWorldPosition(tmpV1);
      const radius = sun.geometry?.parameters?.radius || orbitRadius(696_340);
      const standOff = THREE.MathUtils.clamp(radius * 2.8 + 120, 700, 12000);
      setOrbitPositionNearTarget(target, standOff);
      orientShipToward(target);
      ship.velocity.set(0, 0, 0);
      state.shipInSolarFrame = true;
      snapOrbitCamera();
      return;
    }

    if (planetName === BLACK_HOLE_NAME) {
      state.mode = "orbit";
      state.running = true;
      orbitRoot.visible = true;
      surfaceRoot.visible = false;
      scene.fog = null;
      returnOrbitBtn.style.display = "none";
      overlayEl.classList.remove("visible");

      const standOff = THREE.MathUtils.clamp(blackHole.eventHorizon * 3.2 + 140, 1200, 120000);
      const target = blackHole.group.position;
      setOrbitPositionNearTarget(target, standOff);
      orientShipToward(target);
      ship.velocity.set(0, 0, 0);
      state.shipInSolarFrame = false;
      snapOrbitCamera();
      return;
    }

    const targetPlanet = planets.get(planetName);
    if (!targetPlanet) {
      return;
    }

    state.currentSurfacePlanet = planetName;
    state.mode = "orbit";
    state.running = true;
    orbitRoot.visible = true;
    surfaceRoot.visible = false;
    scene.fog = null;
    returnOrbitBtn.style.display = "none";
    overlayEl.classList.remove("visible");

    const target = targetPlanet.mesh.getWorldPosition(tmpV1);
    const radius = targetPlanet.mesh.geometry?.parameters?.radius || 1;
    const standOff = THREE.MathUtils.clamp(radius * 2.6 + 10, 18, 180);
    setOrbitPositionNearTarget(target, standOff);
    orientShipToward(target);
    ship.velocity.set(0, 0, 0);
    state.shipInSolarFrame = true;
    snapOrbitCamera();
  }

  function setupInput() {
    const canvas = renderer.domElement;
    returnOrbitBtn.style.display = "none";
    updateMusicUi();

    window.addEventListener("keydown", (e) => {
      keyState.set(e.code, true);
      const jumpTarget = teleportMap.get(e.code);
      if (jumpTarget) {
        e.preventDefault();
        teleportToPlanet(jumpTarget);
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        ship.velocity.set(0, 0, 0);
        return;
      }
      if (e.code === "KeyM") {
        e.preventDefault();
        setMusicEnabled(!music.enabled);
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => keyState.set(e.code, false));

    canvas.addEventListener("click", () => {
      if (state.running && document.pointerLockElement !== canvas && canvas.requestPointerLock) {
        canvas.requestPointerLock();
      }
    });
    document.addEventListener("pointerlockchange", () => {
      mouse.pointerLocked = document.pointerLockElement === canvas;
    });
    document.addEventListener("mousemove", (e) => {
      if (mouse.pointerLocked) {
        mouse.yawDelta += -e.movementX * mouse.sensitivity;
        mouse.pitchDelta += -e.movementY * mouse.sensitivity;
      } else if (mouse.dragging) {
        const dx = e.clientX - mouse.lastX;
        const dy = e.clientY - mouse.lastY;
        mouse.lastX = e.clientX;
        mouse.lastY = e.clientY;
        mouse.yawDelta += -dx * mouse.sensitivity;
        mouse.pitchDelta += -dy * mouse.sensitivity;
      }
    });
    canvas.addEventListener("mousedown", (e) => {
      if (!mouse.pointerLocked) {
        mouse.dragging = true;
        mouse.lastX = e.clientX;
        mouse.lastY = e.clientY;
      }
    });
    window.addEventListener("mouseup", () => (mouse.dragging = false));

    actionBtnEl.addEventListener("click", () => {
      const wasRunning = state.running;
      if (state.mode !== "orbit") {
        enterOrbit();
      }
      if (!wasRunning) {
        const launchTarget = planets.has(state.currentSurfacePlanet) ? state.currentSurfacePlanet : "Earth";
        teleportToPlanet(launchTarget);
      } else {
        ship.velocity.set(0, 0, 0);
      }
      orbitRoot.visible = true;
      surfaceRoot.visible = false;
      scene.fog = null;
      state.running = true;
      overlayEl.classList.remove("visible");
      snapOrbitCamera();
      startMusic();
    });
    if (musicToggleBtnEl) {
      musicToggleBtnEl.addEventListener("click", () => {
        setMusicEnabled(!music.enabled);
      });
    }
    returnOrbitBtn.addEventListener("click", () => enterOrbit());
    visitButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const planet = button.getAttribute("data-planet");
        if (planet) {
          enterSurface(planet);
        }
      });
    });
    teleportButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const planet = button.getAttribute("data-teleport");
        if (planet) {
          teleportToPlanet(planet);
        }
      });
    });

    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
      updateBlackHoleLensing();
    });
  }

  function updateOrbit(delta) {
    const fwd = (keyState.get("KeyW") ? 1 : 0) - (keyState.get("KeyS") ? 1 : 0);
    const strafe = (keyState.get("KeyD") ? 1 : 0) - (keyState.get("KeyA") ? 1 : 0);
    const vertical = (keyState.get("KeyR") ? 1 : 0) - (keyState.get("KeyF") ? 1 : 0);
    const boost = keyState.get("ShiftLeft") || keyState.get("ShiftRight");

    tmpV1.set(strafe, vertical, -fwd);
    if (tmpV1.lengthSq() > 1) {
      tmpV1.normalize();
    } else if (boost && tmpV1.lengthSq() < 0.0001) {
      // Shift alone triggers forward warp thrust.
      tmpV1.set(0, 0, -1);
    }
    const accel = (boost ? ORBIT_SPEED.boostAccelKm : ORBIT_SPEED.accelKm) / SCALE.orbitKmPerUnit;
    tmpV2.copy(tmpV1).multiplyScalar(accel * delta).applyQuaternion(ship.rig.quaternion);
    ship.velocity.add(tmpV2);
    const max = (boost ? ORBIT_SPEED.boostMaxKm : ORBIT_SPEED.maxKm) / SCALE.orbitKmPerUnit;
    if (ship.velocity.length() > max) ship.velocity.setLength(max);

    const toHole = tmpV3.copy(blackHole.group.position).sub(ship.rig.position);
    const distSq = Math.max(0.0001, toHole.lengthSq());
    const influenceSq = blackHole.influenceRadius * blackHole.influenceRadius;
    if (distSq < influenceSq) {
      const pull = (1 - distSq / influenceSq) * blackHole.gravityStrength / distSq;
      ship.velocity.addScaledVector(toHole.normalize(), pull * delta);
    }

    const damping = boost ? ORBIT_SPEED.boostDamping : ORBIT_SPEED.damping;
    ship.velocity.multiplyScalar(Math.pow(damping, delta * 60));
    ship.rig.position.addScaledVector(ship.velocity, delta);

    const solarDistance = ship.rig.position.distanceTo(solarSystem.position);
    if (state.shipInSolarFrame) {
      if (solarDistance > SOLAR_FRAME.releaseRadius) {
        state.shipInSolarFrame = false;
      }
    } else if (solarDistance < SOLAR_FRAME.captureRadius) {
      state.shipInSolarFrame = true;
    }
    if (state.shipInSolarFrame) {
      ship.rig.position.add(solarOrbitDelta);
    }

    const holeDist = ship.rig.position.distanceTo(blackHole.group.position);
    if (holeDist < blackHole.eventHorizon) {
      teleportToPlanet("Earth");
      overlayEl.classList.add("visible");
      overlayTitleEl.textContent = "Singularity Escape";
      overlayTextEl.textContent = "You crossed the event horizon. Ship emergency-jumped to Earth orbit.";
      actionBtnEl.textContent = "Resume Mission";
      return;
    }

    const distFromOrigin = ship.rig.position.length();
    if (distFromOrigin > UNIVERSE_BOUNDARY_RADIUS) {
      ship.rig.position.setLength(UNIVERSE_BOUNDARY_RADIUS);
      ship.velocity.multiplyScalar(0.25);
    }

    const yaw =
      ((keyState.get("ArrowRight") ? 1 : 0) - (keyState.get("ArrowLeft") ? 1 : 0)) *
        ORBIT_SPEED.rotationRate *
        delta +
      THREE.MathUtils.clamp(mouse.yawDelta, -0.16, 0.16);
    const pitch =
      ((keyState.get("ArrowUp") ? 1 : 0) - (keyState.get("ArrowDown") ? 1 : 0)) *
        ORBIT_SPEED.rotationRate *
        delta +
      THREE.MathUtils.clamp(mouse.pitchDelta, -0.16, 0.16);
    const roll =
      ((keyState.get("KeyE") ? 1 : 0) - (keyState.get("KeyQ") ? 1 : 0)) *
      ORBIT_SPEED.rotationRate *
      delta;
    mouse.yawDelta *= 0.35;
    mouse.pitchDelta *= 0.35;
    tmpEuler.set(pitch, yaw, roll, "XYZ");
    tmpQuat.setFromEuler(tmpEuler);
    ship.rig.quaternion.multiply(tmpQuat);

    applyOrbitCameraPose();

    const thrust = tmpV1.length();
    ship.thruster.scale.setScalar(0.82 + thrust * 0.3);
    ship.glow.emissiveIntensity = 0.18 + thrust * 0.22;
    if (ship.engineLight) {
      ship.engineLight.intensity = 0.7 + thrust * 1.2;
    }
  }

  function updateAstronautAnimation(delta, moving, run) {
    const moveBlend = THREE.MathUtils.clamp(surface.speed / 4.5, 0, 1);
    if (surface.astronautMixer) {
      if (surface.astronautActions?.idle) {
        surface.astronautActions.idle.setEffectiveWeight(1 - moveBlend);
        surface.astronautActions.idle.setEffectiveTimeScale(1);
      }
      if (surface.astronautActions?.walk) {
        surface.astronautActions.walk.setEffectiveWeight(moveBlend);
        surface.astronautActions.walk.setEffectiveTimeScale(run ? 1.3 : 1);
      }
      surface.astronautMixer.update(delta);
      return;
    }

    const rig = surface.astronautNode?.userData?.proceduralRig;
    if (!rig) return;

    surface.walkPhase += delta * (moving ? (run ? 11.8 : 8.2) : 2.4);
    const stride = moving ? (run ? 0.8 : 0.55) : 0.08;
    const armSwing = stride * 0.85;
    const bob = moving ? Math.sin(surface.walkPhase * 2) * 0.07 : Math.sin(state.elapsed * 1.8) * 0.02;

    rig.leftLegPivot.rotation.x = Math.sin(surface.walkPhase) * stride;
    rig.rightLegPivot.rotation.x = Math.sin(surface.walkPhase + Math.PI) * stride;
    rig.leftArmPivot.rotation.x = Math.sin(surface.walkPhase + Math.PI) * armSwing;
    rig.rightArmPivot.rotation.x = Math.sin(surface.walkPhase) * armSwing;
    rig.torso.rotation.z = moving ? Math.sin(surface.walkPhase * 2) * 0.04 : 0;
    rig.head.rotation.y = moving ? Math.sin(surface.walkPhase) * 0.06 : Math.sin(state.elapsed) * 0.02;
    surface.astronautNode.position.y = bob;
  }

  function updateSurface(delta) {
    const fwd = (keyState.get("KeyW") ? 1 : 0) - (keyState.get("KeyS") ? 1 : 0);
    const strafe = (keyState.get("KeyD") ? 1 : 0) - (keyState.get("KeyA") ? 1 : 0);
    const run = keyState.get("ShiftLeft") || keyState.get("ShiftRight");
    const speed = run ? 4.5 : 2.5;
    const moving = fwd !== 0 || strafe !== 0;
    surface.speed = Math.hypot(fwd, strafe) * speed;

    surface.camYaw += THREE.MathUtils.clamp(mouse.yawDelta, -0.16, 0.16);
    surface.camPitch = THREE.MathUtils.clamp(surface.camPitch + THREE.MathUtils.clamp(mouse.pitchDelta, -0.12, 0.12), -1.1, 0.3);
    mouse.yawDelta *= 0.35;
    mouse.pitchDelta *= 0.35;

    if (moving) {
      tmpV1.set(strafe, 0, -fwd).normalize();
      const sin = Math.sin(surface.camYaw);
      const cos = Math.cos(surface.camYaw);
      const wx = tmpV1.x * cos - tmpV1.z * sin;
      const wz = tmpV1.x * sin + tmpV1.z * cos;
      surface.heading = Math.atan2(wx, wz);
      surface.astronautRig.position.x += wx * speed * delta;
      surface.astronautRig.position.z += wz * speed * delta;
    }

    const b = 1100;
    surface.astronautRig.position.x = THREE.MathUtils.clamp(surface.astronautRig.position.x, -b, b);
    surface.astronautRig.position.z = THREE.MathUtils.clamp(surface.astronautRig.position.z, -b, b);

    const x = surface.astronautRig.position.x;
    const z = surface.astronautRig.position.z;
    const y = surface.sampleHeight(x, z) + surface.groundOffset;
    surface.astronautRig.position.y = y;

    const gradientStep = 2.5;
    const slopeX = surface.sampleHeight(x + gradientStep, z) - surface.sampleHeight(x - gradientStep, z);
    const slopeZ = surface.sampleHeight(x, z + gradientStep) - surface.sampleHeight(x, z - gradientStep);
    tmpV1.set(-slopeX, gradientStep * 2, -slopeZ).normalize();
    tmpQuat.setFromUnitVectors(worldUp, tmpV1);
    tmpQuat2.setFromAxisAngle(worldUp, surface.heading);
    surface.astronautRig.quaternion.copy(tmpQuat2).premultiply(tmpQuat);

    updateAstronautAnimation(delta, moving, run);

    const lookHeightUnits = SURFACE_CAMERA.lookHeightUnits;
    const followRadiusUnits = SURFACE_CAMERA.followDistanceUnits;
    const heightOffsetUnits = SURFACE_CAMERA.heightOffsetUnits;
    const cameraClearance = SURFACE_CAMERA.clearanceUnits;

    const target = tmpV1.copy(surface.astronautRig.position).add(new THREE.Vector3(0, lookHeightUnits, 0));
    const h = Math.cos(surface.camPitch) * followRadiusUnits;
    const camPos = tmpV2
      .set(
        Math.sin(surface.camYaw) * h,
        Math.sin(surface.camPitch) * followRadiusUnits + heightOffsetUnits,
        Math.cos(surface.camYaw) * h
      )
      .add(target);

    const desiredGroundY = surface.sampleHeight(camPos.x, camPos.z) + surface.groundOffset + cameraClearance;
    if (camPos.y < desiredGroundY) {
      camPos.y = desiredGroundY;
    }

    camera.position.lerp(camPos, 1 - Math.exp(-delta * 10));
    const currentGroundY = surface.sampleHeight(camera.position.x, camera.position.z) + surface.groundOffset + cameraClearance;
    if (camera.position.y < currentGroundY) {
      camera.position.y = currentGroundY;
    }
    cameraLook.lerp(target, 1 - Math.exp(-delta * 14));
    camera.lookAt(cameraLook);
  }

  function updatePlanets(delta) {
    solarOrbitPrev.copy(solarSystem.position);
    sunAroundBlackHoleOrbit.angle += sunAroundBlackHoleOrbit.speed * delta;
    setSolarSystemOrbitPose();
    solarOrbitDelta.copy(solarSystem.position).sub(solarOrbitPrev);

    for (const [name, p] of planets) {
      if (name === "Moon") continue;
      p.pivot.rotation.y += p.orbitSpeed * delta;
      p.mesh.rotation.y += p.spinSpeed * delta;
    }
    planets.get("Moon").pivot.rotation.y += planets.get("Moon").orbitSpeed * delta;
    sun.rotation.y += 0.014 * delta;
    starShell.rotation.y -= 0.0007 * delta;

    blackHole.disk.rotation.z += delta * 0.32;
    if (blackHole.disk.material?.uniforms?.time) {
      blackHole.disk.material.uniforms.time.value = state.elapsed;
    }
    if (blackHole.halo) {
      blackHole.halo.scale.setScalar(1 + Math.sin(state.elapsed * 1.7) * 0.03);
    }
    if (blackHole.northJet) {
      blackHole.northJet.scale.y = 1 + Math.sin(state.elapsed * 2.1) * 0.08;
    }
    if (blackHole.southJet) {
      blackHole.southJet.scale.y = 1 + Math.cos(state.elapsed * 2.1) * 0.08;
    }
  }

  function formatClockUtc(ms) {
    const iso = new Date(ms).toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
  }

  function formatDriftPerSecond(driftSecondsPerSecond) {
    const sign = driftSecondsPerSecond >= 0 ? "+" : "-";
    const abs = Math.abs(driftSecondsPerSecond);
    if (abs < 3600) {
      return `${sign}${abs.toFixed(1)}s/s`;
    }
    if (abs < 86400) {
      return `${sign}${(abs / 3600).toFixed(2)}h/s`;
    }
    if (abs < 31557600) {
      return `${sign}${(abs / 86400).toFixed(2)}d/s`;
    }
    return `${sign}${(abs / 31557600).toFixed(3)}y/s`;
  }

  function computeOrbitTimeRate() {
    const shipPos = ship.rig.position;
    const speedKm = ship.velocity.length() * SCALE.orbitKmPerUnit;
    const effectiveSpeedKm = Math.min(speedKm, RELATIVITY.maxEffectiveSpeedForTimeKmS);
    const beta = Math.min(0.999999, effectiveSpeedKm / C_KM_S);
    const velocityFactor = Math.sqrt(Math.max(0.000001, 1 - beta * beta));

    let potentialTerm = 0;
    const sunDistKm = Math.max(696_340, shipPos.length() * SCALE.orbitKmPerUnit);
    potentialTerm += BODY_RS_KM.Sun / sunDistKm;

    for (const [name, p] of planets) {
      const bodyPos = p.mesh.getWorldPosition(tmpV1);
      const distKm = shipPos.distanceTo(bodyPos) * SCALE.orbitKmPerUnit;
      const radiusKm = planetData[name]?.radiusKm || 1;
      const safeDistKm = Math.max(radiusKm, distKm);
      potentialTerm += (BODY_RS_KM[name] || 0) / safeDistKm;
    }

    const holeDistKm = Math.max(
      blackHole.radius * SCALE.orbitKmPerUnit,
      shipPos.distanceTo(blackHole.group.position) * SCALE.orbitKmPerUnit
    );
    const gravityFactor = Math.sqrt(Math.max(0.000001, 1 - Math.min(RELATIVITY.maxGravityPotential, potentialTerm)));

    const rsKm = BODY_RS_KM[BLACK_HOLE_NAME];
    const safeHoleDistKm = Math.max(holeDistKm, rsKm * (1 + RELATIVITY.blackHoleHorizonBuffer));
    // Base Schwarzschild factor (continuous at all distances outside the horizon).
    const baseBhFactor = Math.sqrt(Math.max(1e-12, 1 - rsKm / safeHoleDistKm));
    // Smoothly increase exponent from 1 (far) to blackHoleExponent (near),
    // avoiding abrupt threshold behavior.
    const distInRs = safeHoleDistKm / rsKm;
    const rampT = THREE.MathUtils.smoothstep(
      distInRs,
      RELATIVITY.blackHoleRampEndRs,
      RELATIVITY.blackHoleRampStartRs
    );
    const effectiveExponent = THREE.MathUtils.lerp(RELATIVITY.blackHoleExponent, 1, rampT);
    const blackHoleFactor = Math.pow(baseBhFactor, effectiveExponent);

    const rawRate = THREE.MathUtils.clamp(gravityFactor * velocityFactor * blackHoleFactor, RELATIVITY.minOrbitRate, 1.0);
    return rawRate;
  }

  function computeSurfaceTimeRate() {
    const planetName = state.currentSurfacePlanet;
    const radiusKm = planetData[planetName]?.radiusKm || 6371;
    const x = surface.astronautRig.position.x;
    const z = surface.astronautRig.position.z;
    const groundY = surface.sampleHeight(x, z);
    const altitudeMeters = Math.max(0, (surface.astronautRig.position.y - groundY) * SCALE.localMetersPerUnit);
    const radiusFromCenterKm = radiusKm + altitudeMeters / 1000;
    const rsKm = BODY_RS_KM[planetName] || BODY_RS_KM.Earth;
    const gravityFactor = Math.sqrt(Math.max(0.000001, 1 - Math.min(0.999999, rsKm / radiusFromCenterKm)));

    const speedKmS = (surface.speed * SCALE.localMetersPerUnit) / 1000;
    const beta = Math.min(0.999999, speedKmS / C_KM_S);
    const velocityFactor = Math.sqrt(Math.max(0.000001, 1 - beta * beta));
    return THREE.MathUtils.clamp(gravityFactor * velocityFactor, 0.0001, 1.0);
  }

  function updateTimeClocks(delta) {
    if (!state.running) {
      return;
    }
    const rate = state.mode === "orbit" ? computeOrbitTimeRate() : computeSurfaceTimeRate();
    state.timeRate = rate;
    // Simulate from the ship frame: 1 rendered second is 1 ship-second.
    // Near strong gravity, Earth coordinate time advances faster by ~1/rate.
    const earthSecondsPerShipSecond = 1 / Math.max(rate, RELATIVITY.minOrbitRate);
    state.shipElapsedSeconds += delta;
    state.earthElapsedSeconds += delta * earthSecondsPerShipSecond;
  }

  function updateHud(delta) {
    state.hudTimer += delta;
    if (state.hudTimer < 0.1) return;
    state.hudTimer = 0;

    if (state.mode === "orbit") {
      const speedKm = ship.velocity.length() * SCALE.orbitKmPerUnit;
      speedEl.textContent = `${speedKm.toFixed(1)} km/s`;
      let nearest = "Sun";
      let minDist = Math.max(0, ship.rig.position.length() - 18);
      for (const [name, p] of planets) {
        const d = Math.max(0, ship.rig.position.distanceTo(p.mesh.getWorldPosition(tmpV1)) - (p.mesh.geometry.parameters.radius || 1));
        if (d < minDist) {
          minDist = d;
          nearest = name;
        }
      }
      const holeDist = Math.max(0, ship.rig.position.distanceTo(blackHole.group.position) - blackHole.radius);
      if (holeDist < minDist) {
        minDist = holeDist;
        nearest = BLACK_HOLE_NAME;
      }
      nearestEl.textContent = nearest;
      const au = minDist / SCALE.orbitUnitsPerAU;
      distanceEl.textContent = au < 0.003 ? `${Math.round(au * SCALE.kmPerAU).toLocaleString()} km` : `${au.toFixed(3)} AU`;
    } else {
      nearestEl.textContent = state.currentSurfacePlanet;
      speedEl.textContent = `${(surface.speed * SCALE.localMetersPerUnit).toFixed(1)} m/s`;
      const alt = surface.astronautRig.position.y - surface.sampleHeight(surface.astronautRig.position.x, surface.astronautRig.position.z);
      distanceEl.textContent = `${Math.max(0, alt * SCALE.localMetersPerUnit).toFixed(1)} m alt`;
    }

    if (earthClockEl && shipClockEl && timeDeltaEl) {
      const earthMs = state.earthEpochMs + state.earthElapsedSeconds * 1000;
      const shipMs = state.earthEpochMs + state.shipElapsedSeconds * 1000;
      const earthSecondsPerShipSecond = 1 / Math.max(state.timeRate, RELATIVITY.minOrbitRate);
      const driftPerShipSecond = 1 - earthSecondsPerShipSecond;
      earthClockEl.textContent = formatClockUtc(earthMs);
      shipClockEl.textContent = formatClockUtc(shipMs);
      timeDeltaEl.textContent = formatDriftPerSecond(driftPerShipSecond);
    }
  }

  function adaptQuality(delta) {
    state.fpsFrames = (state.fpsFrames || 0) + 1;
    state.fpsTime = (state.fpsTime || 0) + delta;
    if (state.fpsTime < 1.4) return;
    const fps = state.fpsFrames / state.fpsTime;
    fpsEl.textContent = String(Math.round(fps));
    state.fpsFrames = 0;
    state.fpsTime = 0;
  }

  function loop() {
    requestAnimationFrame(loop);
    const delta = Math.min(clock.getDelta(), 0.05);
    state.elapsed += delta;

    if (!state.running) {
      snapOrbitCamera();
    }

    updatePlanets(delta);
    if (state.running) {
      if (state.mode === "orbit") updateOrbit(delta);
      else updateSurface(delta);
    }
    updateTimeClocks(delta);
    updateHud(delta);
    adaptQuality(delta);
    updateBlackHoleLensing();
    composer.render();
  }

  setupInput();
  snapOrbitCamera();
  overlayTitleEl.textContent = "Solar Surface Explorer";
  overlayTextEl.textContent =
    "Launch into orbit, teleport with 1-9 (0 = black hole), and use Visit Planet for surface exploration.";
  returnOrbitBtn.disabled = false;
  actionBtnEl.disabled = false;
  loop();
})();
