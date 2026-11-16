// Dustline boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. This file owns the renderer, the shooting ray, the grenades, the tracers and the
// screenshot mode (?shot=start|play|end with &seed=N sets up a deterministic frame, renders
// it twice, then freezes it and sets window.__shotReady). The match owns rounds and money,
// actors.js owns bodies and bot brains, hud.js owns the DOM.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap } from './map.js';
import { createArsenal, WEAPONS, WEAPON_ORDER, UTILITY } from './weapons.js';
import { makeActor, buildActorMesh, resetActor, damageActor, moveBody, createBrain } from './actors.js';
import { createMatch, BUY_ITEMS, ROUND_TIME, PLANT_TIME, DEFUSE_TIME } from './match.js';
import { createHud } from './hud.js';
import { createSound } from './sound.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = shot ? mulberry32(seed) : mulberry32((Date.now() % 2147483647) || 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2e241a);
scene.fog = new THREE.Fog(new THREE.Color(0x2e241a), 30, 80);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createMap(scene);
const sound = createSound();
const hud = createHud(world);

// Teams: Vanguard attacks (player + 4 bots), Sentinel defends (5 bots).
const VANGUARD_NAMES = ['You', 'Sable', 'Dune', 'Rook', 'Fennec'];
const SENTINEL_NAMES = ['Viper', 'Jackal', 'Onyx', 'Cinder', 'Havoc'];
const actors = [];
VANGUARD_NAMES.forEach((name, i) => {
  actors.push(makeActor({ id: i, name, team: 'Vanguard', isPlayer: i === 0, spawn: world.vanguardSpawn[i], weaponId: i === 0 ? 'p250' : 'dustline' }));
});
SENTINEL_NAMES.forEach((name, i) => {
  actors.push(makeActor({ id: 5 + i, name, team: 'Sentinel', isPlayer: false, spawn: world.sentinelSpawn[i], weaponId: 'dustline' }));
});
const player = actors[0];
const bots = actors.slice(1);
for (const bot of bots) scene.add(buildActorMesh(bot));

const arsenal = createArsenal(camera);
const ownedWeapons = new Set(['p250']);
player.weapon = 'p250';
player.mag = WEAPONS.p250.mag;
player.reserve = WEAPONS.p250.reserve;

// Input: pointer lock turns the mouse into look; keys drive the body.
const keys = new Set();
let locked = false;
let lookX = 0;
let lookY = 0;
let firing = false;
let spectate = null;

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') event.preventDefault();
  if (event.repeat) return;
  keys.add(event.code);
  if (event.code === 'KeyM') {
    const muted = sound.toggleMute();
    hud.showBanner(muted ? 'Sound muted (M)' : 'Sound on (M)');
  }
  if (event.code === 'Tab') {
    event.preventDefault();
    hud.setScoreboard(true, match.scoreboard());
  }
});
window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
  if (event.code === 'Tab') hud.setScoreboard(false, []);
});
window.addEventListener('blur', () => keys.clear());
window.addEventListener('mousemove', (event) => {
  if (!locked) return;
  lookX += event.movementX;
  lookY += event.movementY;
});
window.addEventListener('mousedown', (event) => {
  if (locked && event.button === 0) firing = true;
});
window.addEventListener('mouseup', (event) => {
  if (event.button === 0) firing = false;
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked) {
    keys.clear();
    firing = false;
    if (!shot && match.state.phase !== 'over' && player.alive) hud.showOverlay('paused');
  } else if (!shot) {
    hud.hideOverlay();
  }
});

const raycaster = new THREE.Raycaster();
raycaster.far = 130;
const direction = new THREE.Vector3();
const shootables = world.shootables.slice();
for (const bot of bots) shootables.push(...bot.hitMeshes);

// Tracers: a small pool of fading lines, one per recent shot.
const tracers = [];
const tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9 });
function addTracer(from, to) {
  const geometry = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const line = new THREE.Line(geometry, tracerMat.clone());
  scene.add(line);
  tracers.push({ line, life: 0.09 });
}

// Grenades in flight and on the ground.
const projectiles = [];
const smokes = [];
const flares = [];
const smokeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), transparent: true, opacity: 0.75, roughness: 1 });
const flareMat = new THREE.MeshBasicMaterial({ color: 0xff3020 });

function throwProjectile(actor, kind) {
  const eye = new THREE.Vector3(actor.position.x, actor.position.y + actor.eye, actor.position.z);
  const dir = new THREE.Vector3(-Math.sin(actor.yaw) * Math.cos(actor.pitch), Math.sin(actor.pitch), -Math.cos(actor.yaw) * Math.cos(actor.pitch));
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), kind === 'flare' ? flareMat : smokeMat);
  mesh.position.copy(eye);
  scene.add(mesh);
  projectiles.push({
    kind,
    actor,
    mesh,
    vel: dir.multiplyScalar(13).add(new THREE.Vector3(0, 3.5, 0)),
    pos: eye,
    fuse: kind === 'frag' ? 1.4 : 0,
    landed: false,
    landTimer: 0,
  });
  sound.throwNade();
}

function explodeFrag(pos, owner) {
  sound.boom();
  const flash = new THREE.PointLight(new THREE.Color(0xffc266), 6, 12);
  flash.position.copy(pos);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 150);
  for (const target of actors) {
    if (!target.alive || target === owner) continue;
    const dist = Math.hypot(target.position.x - pos.x, target.position.z - pos.z);
    if (dist > 6) continue;
    if (!world.hasLOS(pos.x, pos.y + 0.5, pos.z, target.position.x, target.position.y + 1, target.position.z)) continue;
    const dealt = damageActor(target, Math.round(95 - dist * 12), 1);
    if (dealt > 0 && target === player) hud.flashDamage();
    if (!target.alive) {
      match.registerKill(owner, target, false);
      if (owner === player) {
        sound.kill();
        hud.hitMarker(true, 400);
      }
    }
  }
}

function landSmoke(pos) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(3.5, 16, 12), smokeMat.clone());
  mesh.position.set(pos.x, 1.6, pos.z);
  scene.add(mesh);
  const entry = { x: pos.x, y: 1.6, z: pos.z, r: 3.5, mesh, left: 12 };
  smokes.push(entry);
  world.smokeSpheres.push(entry);
}

function landFlare(pos) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), flareMat);
  mesh.position.set(pos.x, 0.3, pos.z);
  scene.add(mesh);
  const light = new THREE.PointLight(0xff3020, 5, 16);
  light.position.set(pos.x, 1.2, pos.z);
  scene.add(light);
  flares.push({ x: pos.x, z: pos.z, radius: UTILITY.flare.radius, mesh, light, left: UTILITY.flare.duration });
  sound.flare();
}

function stepProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const p = projectiles[i];
    p.vel.y -= 12 * dt;
    p.pos.addScaledVector(p.vel, dt);
    // Bounce off the floor, stop on a wall.
    const blocked = p.pos.y <= 0.1;
    if (blocked) {
      p.pos.y = 0.1;
      p.vel.multiplyScalar(0.35);
      p.vel.y = Math.abs(p.vel.y) * 0.3;
      p.landed = true;
    }
    p.mesh.position.copy(p.pos);
    if (p.kind === 'frag') {
      p.fuse -= dt;
      if (p.fuse <= 0 || (p.landed && (p.landTimer += dt) > 0.35)) {
        scene.remove(p.mesh);
        projectiles.splice(i, 1);
        explodeFrag(p.pos, p.actor);
      }
    } else if (p.landed) {
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
      if (p.kind === 'smoke') landSmoke(p.pos);
      else if (p.kind === 'flare') landFlare(p.pos);
    }
  }
  for (let i = smokes.length - 1; i >= 0; i -= 1) {
    const s = smokes[i];
    s.left -= dt;
    s.mesh.material.opacity = Math.max(0, Math.min(0.75, s.left * 0.2));
    if (s.left <= 0) {
      scene.remove(s.mesh);
      smokes.splice(i, 1);
      const idx = world.smokeSpheres.indexOf(s);
      if (idx !== -1) world.smokeSpheres.splice(idx, 1);
    }
  }
  for (let i = flares.length - 1; i >= 0; i -= 1) {
    const f = flares[i];
    f.left -= dt;
    f.light.intensity = Math.max(0, f.left * 0.6);
    if (f.left <= 0) {
      scene.remove(f.mesh);
      scene.remove(f.light);
      flares.splice(i, 1);
    }
  }
}

// Shooting: one ray, spread by movement, recoil on the pitch. Returns what it hit.
function resolveShot(shooter, origin, dir, spread) {
  const d = dir.clone();
  d.x += (rng() * 2 - 1) * spread;
  d.y += (rng() * 2 - 1) * spread;
  d.z += (rng() * 2 - 1) * spread;
  d.normalize();
  raycaster.set(origin, d);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  const end = hit ? hit.point : origin.clone().addScaledVector(d, WEAPONS[shooter.weapon].range);
  addTracer(origin, end);
  if (!hit) return null;
  const target = hit.object.userData.actor;
  if (!target || target === shooter || !target.alive) return { hit, target: null };
  const isHead = hit.object.userData.part === 'head';
  const dealt = damageActor(target, WEAPONS[shooter.weapon].damage, isHead ? WEAPONS[shooter.weapon].headMult : 1);
  if (dealt > 0) {
    if (shooter === player) {
      sound.hit();
      hud.hitMarker(isHead, 120);
      if (!target.alive) {
        sound.kill();
        hud.hitMarker(true, 400);
      }
    } else if (target === player) {
      sound.hurt();
      hud.flashDamage();
    }
    if (!target.alive) match.registerKill(shooter, target, isHead);
  }
  return { hit, target };
}

function playerShoot() {
  if (!arsenal.takeRound()) {
    sound.reload();
    return;
  }
  camera.getWorldDirection(direction);
  const origin = camera.position.clone();
  resolveShot(player, origin, direction, arsenal.spread(playerSpeed()));
  arsenal.pullTrigger();
  player.pitch = Math.min(1.45, player.pitch + WEAPONS[player.weapon].recoil * (0.8 + rng() * 0.4));
  player.yaw += (rng() * 2 - 1) * WEAPONS[player.weapon].recoil * 0.4;
  sound.shot(WEAPONS[player.weapon].kind);
  // Nearby bots hear the shot and turn toward it.
  for (const bot of bots) {
    if (!bot.alive) continue;
    const dist = Math.hypot(bot.position.x - player.position.x, bot.position.z - player.position.z);
    if (dist < 30) bot.brain.heard = { x: player.position.x, z: player.position.z };
  }
  syncHudAmmo();
}

function playerSpeed() {
  return Math.hypot(player.velocity.x, player.velocity.z);
}

function botShoot(bot, aimPoint) {
  if (bot.mag <= 0 || bot.cooldown > 0 || bot.reloadLeft > 0) return;
  bot.mag -= 1;
  bot.cooldown = WEAPONS[bot.weapon].gap;
  const origin = new THREE.Vector3(bot.position.x, bot.position.y + bot.eye, bot.position.z);
  const dir = new THREE.Vector3(aimPoint.x - origin.x, aimPoint.y - origin.y, aimPoint.z - origin.z).normalize();
  resolveShot(bot, origin, dir, 0.004);
  const dist = Math.hypot(bot.position.x - player.position.x, bot.position.z - player.position.z);
  if (dist < 40) sound.shot(WEAPONS[bot.weapon].kind);
}

const match = createMatch(actors, world, {
  rng,
  onResetActor(actor, spawn) {
    resetActor(actor, spawn);
    // Fresh magazines every round, for bots and the player alike.
    actor.mag = WEAPONS[actor.weapon].mag;
    actor.reserve = WEAPONS[actor.weapon].reserve;
    if (actor.isPlayer) {
      arsenal.refill();
      arsenal.switchTo(actor.weapon);
      player.mag = WEAPONS[actor.weapon].mag;
      player.reserve = WEAPONS[actor.weapon].reserve;
      ownedWeapons.add(actor.weapon);
      spectate = null;
    }
  },
  onRoundStart(round, plan) {
    hud.setRound(round);
    hud.setScore(match.state.scores.Vanguard, match.state.scores.Sentinel);
    hud.setPlan(`Round ${round} — ${plan}`);
    hud.setBuyMenu(true, player.money);
  },
  onLive() {
    hud.setBuyMenu(false, player.money);
    hud.showBanner('Go! Plant the bomb or eliminate Sentinel.');
  },
  onRoundEnd(winner, reason) {
    hud.setScore(match.state.scores.Vanguard, match.state.scores.Sentinel);
    hud.setBuyMenu(false, player.money);
    hud.showBanner(`${winner} wins the round — ${reason}`);
    if (winner === player.team) sound.win();
    else sound.lose();
  },
  onMatchEnd(winner) {
    hud.showOverlay('match', { winner, scores: match.state.scores });
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onKillfeed(entry) {
    hud.killfeedAdd(entry);
  },
  onRadio(team, text) {
    hud.radioAdd(team, text);
  },
  onBombPlanted(site) {
    sound.plant();
    hud.showBanner(`Bomb planted at ${site}!`);
  },
  onBombDefused() {
    hud.showBanner('Bomb defused — Sentinel wins the round');
  },
  onBombExploded() {
    sound.boom();
  },
  onBuy(actor, item) {
    if (actor.isPlayer) {
      sound.buy();
      if (WEAPONS[item.id]) ownedWeapons.add(item.id);
    }
  },
});

for (const bot of bots) {
  createBrain(bot, world, {
    rng,
    enemiesOf(actor) {
      return actors.filter((a) => a.team !== actor.team);
    },
    fire(botActor, aimPoint) {
      botShoot(botActor, aimPoint);
    },
    onSmoke(botActor) {
      throwProjectile(botActor, 'smoke');
    },
    onPlant(botActor, site) {
      match.plantBomb(botActor, site);
    },
    onDefuse(botActor) {
      match.defuseBomb(botActor);
    },
    isBombPlanted() {
      return match.isBombPlanted();
    },
    bombSite() {
      return match.bombSite();
    },
  });
}

function syncCamera() {
  const focus = !player.alive && spectate ? spectate : player;
  camera.position.set(focus.position.x, focus.position.y + focus.eye, focus.position.z);
  camera.rotation.set(focus.pitch, focus.yaw, 0, 'YXZ');
}

function syncHudAmmo() {
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, WEAPONS[player.weapon].name);
  player.mag = arsenal.state.mag;
  player.reserve = arsenal.state.reserve;
}

function visibleEnemies() {
  const seen = new Set();
  const eye = { x: player.position.x, y: player.position.y + player.eye, z: player.position.z };
  for (const enemy of actors) {
    if (enemy.team === player.team || !enemy.alive) continue;
    const foe = { x: enemy.position.x, y: enemy.position.y + enemy.eye, z: enemy.position.z };
    if (world.hasLOS(eye.x, eye.y, eye.z, foe.x, foe.y, foe.z)) seen.add(enemy);
  }
  return seen;
}

let channel = null; // { kind: 'plant'|'defuse', progress }
let bombBeepSecond = -1;
let minimapTimer = 0;
let elapsed = 0;

function stepSim(dt) {
  elapsed += dt;
  // Player movement and look.
  if (player.alive && (locked || shot)) {
    const look = { x: lookX, y: lookY };
    lookX = 0;
    lookY = 0;
    player.yaw -= look.x * 0.0022;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - look.y * 0.0022));
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const wx = (-sin * forward + cos * strafe) || 0;
    const wz = (-cos * forward - sin * strafe) || 0;
    const len = Math.hypot(wx, wz) || 1;
    moveBody(player, dt, wx / len, wz / len, keys.has('ControlLeft') || keys.has('ControlRight'), keys.has('Space'), world.colliders);
    if (firing && arsenal.ready() && match.state.phase === 'live') playerShoot();
    if (keys.has('KeyR') && arsenal.reload()) sound.reload();
  }
  for (const bot of bots) {
    if (bot.alive) bot.brain.step(dt);
  }
  match.update(dt);
  stepProjectiles(dt);
  // Bomb beep under ten seconds.
  if (match.state.bomb.state === 'planted') {
    const whole = Math.ceil(match.state.bomb.timer);
    if (match.state.bomb.timer <= 10 && whole !== bombBeepSecond) {
      bombBeepSecond = whole;
      sound.beep();
    }
  } else {
    bombBeepSecond = -1;
  }
  // Player death: spectate a living teammate.
  if (!player.alive && !spectate) {
    spectate = actors.find((a) => a.team === player.team && a.alive && !a.isPlayer) || null;
    if (document.pointerLockElement) document.exitPointerLock();
    hud.showBanner('You were eliminated — spectating a teammate.');
  }
  // Plant / defuse channel while E is held.
  if (keys.has('KeyE') && player.alive && match.state.phase === 'live') {
    if (!channel) {
      if (player.bombCarrier && (world.inSite('A', player.position.x, player.position.z) || world.inSite('B', player.position.x, player.position.z))) {
        channel = { kind: 'plant', progress: 0, site: world.inSite('A', player.position.x, player.position.z) ? 'A' : 'B' };
      } else if (match.isBombPlanted()) {
        const bomb = match.state.bomb;
        const dist = Math.hypot(player.position.x - bomb.x, player.position.z - bomb.z);
        if (dist <= 2.5) channel = { kind: 'defuse', progress: 0 };
      }
    }
    if (channel) {
      channel.progress += dt;
      const need = channel.kind === 'plant' ? PLANT_TIME : DEFUSE_TIME;
      hud.setBomb(match.state.bomb.state, match.state.bomb.site, match.state.bomb.timer);
      if (channel.progress >= need) {
        if (channel.kind === 'plant') match.plantBomb(player, channel.site);
        else match.defuseBomb(player);
        channel = null;
      }
    }
  } else {
    channel = null;
  }
  // HUD, throttled for the minimap.
  hud.setHealth(player.hp, player.armor);
  hud.setMoney(player.money);
  hud.setTimer(match.state.phase === 'buy' ? match.state.timer : match.state.bomb.state === 'planted' ? match.state.bomb.timer : match.state.timer, match.state.phase, match.state.bomb.state === 'planted');
  hud.setBomb(match.state.bomb.state, match.state.bomb.site, match.state.bomb.timer);
  hud.setUtilities({ frag: player.frags, smoke: player.smokes, flare: player.flares, medkit: player.medkits });
  hud.setCrosshair(6 + arsenal.spread(playerSpeed()) * 900);
  minimapTimer -= dt;
  if (minimapTimer <= 0) {
    minimapTimer = 0.25;
    hud.drawMinimap(player, actors, visibleEnemies(), flares);
  }
  for (let i = tracers.length - 1; i >= 0; i -= 1) {
    const t = tracers[i];
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
    if (t.life <= 0) {
      scene.remove(t.line);
      t.line.geometry.dispose();
      tracers.splice(i, 1);
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    if (match.state.phase !== 'over') {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        stepSim(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
    }
    arsenal.step(dt);
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) stepSim(FIXED_STEP);
  arsenal.step(FIXED_STEP * steps);
}

function aimAtNearestEnemy() {
  let best = null;
  let bestDist = Infinity;
  const eye = { x: player.position.x, y: player.position.y + player.eye, z: player.position.z };
  for (const enemy of actors) {
    if (enemy.team === player.team || !enemy.alive) continue;
    const dist = Math.hypot(enemy.position.x - player.position.x, enemy.position.z - player.position.z);
    if (dist >= bestDist) continue;
    const foe = { x: enemy.position.x, y: enemy.position.y + enemy.eye, z: enemy.position.z };
    if (!world.hasLOS(eye.x, eye.y, eye.z, foe.x, foe.y, foe.z)) continue;
    best = enemy;
    bestDist = dist;
  }
  if (!best) return false;
  const dx = best.position.x - player.position.x;
  const dy = best.position.y + 1.2 - (player.position.y + player.eye);
  const dz = best.position.z - player.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  return true;
}

function autoFight(shots) {
  let fired = 0;
  for (let i = 0; i < shots; i += 1) {
    if (!aimAtNearestEnemy()) return fired;
    if (arsenal.ready() && match.state.phase === 'live') {
      playerShoot();
      fired += 1;
    }
    settle(8);
  }
  return fired;
}

function runShot(name) {
  hud.hideOverlay();
  locked = true;
  if (name === 'start') {
    player.position.set(0, 0, 16);
    player.yaw = 0;
    player.pitch = 0;
    settle(20);
    const foe = actors.find((a) => a.team === 'Sentinel');
    player.yaw = Math.atan2(-(foe.position.x - player.position.x), -(foe.position.z - player.position.z));
    hud.showOverlay('start');
    hud.setScore(0, 0);
    hud.setRound(1);
    hud.setMoney(player.money);
    hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, WEAPONS[player.weapon].name);
  } else if (name === 'play') {
    match.state.phase = 'live';
    match.state.timer = ROUND_TIME;
    hud.setBuyMenu(false, player.money);
    player.position.set(0, 0, 6);
    player.yaw = 0;
    player.pitch = 0;
    settle(120);
    autoFight(3);
    settle(60);
    aimAtNearestEnemy();
    hud.setScore(match.state.scores.Vanguard, match.state.scores.Sentinel);
  } else {
    // end: fight the round out, then show the result.
    match.state.phase = 'live';
    match.state.timer = ROUND_TIME;
    hud.setBuyMenu(false, player.money);
    // The closing frame earns a rifle: the scripted player buys the Dustline AR.
    arsenal.buyWeapon('dustline');
    ownedWeapons.add('dustline');
    player.weapon = 'dustline';
    syncHudAmmo();
    player.position.set(0, 0, 6);
    player.yaw = 0;
    player.pitch = 0;
    settle(120);
    let guard = 0;
    while (match.state.phase === 'live' && guard < 200) {
      autoFight(2);
      settle(30);
      guard += 1;
      if (!player.alive) break;
    }
    settle(60);
    hud.setScore(match.state.scores.Vanguard, match.state.scores.Sentinel);
    hud.showBanner(match.state.winner ? `${match.state.winner} wins the round — ${match.state.reason}` : 'Round over');
  }
  syncCamera();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

let frozen = false;
let accumulator = 0;
let lastTime = performance.now();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

hud.onPlay(() => {
  if (shot) return;
  sound.ensureAudio();
  if (match.state.phase === 'over') {
    // Play again: fresh scores, fresh round.
    match.state.scores = { Vanguard: 0, Sentinel: 0 };
    match.state.round = 1;
    for (const a of actors) {
      a.money = 800;
      a.kills = 0;
      a.deaths = 0;
      a.weapon = a.isPlayer ? 'p250' : 'dustline';
      a.hasArmor = false;
    }
    ownedWeapons.clear();
    ownedWeapons.add('p250');
    match.startRound();
  }
  renderer.domElement.requestPointerLock();
});

// Buy and utility keys, handled on keydown so one press buys once.
window.addEventListener('keydown', (event) => {
  if (event.repeat || !player.alive) return;
  if (match.state.phase === 'buy') {
    const item = BUY_ITEMS.find((i) => i.key === event.code.replace('Digit', ''));
    if (item) {
      if (match.buy(player, item.id)) {
        syncHudAmmo();
        hud.setBuyMenu(true, player.money);
      }
      return;
    }
  }
  if (event.code === 'KeyB' && match.state.phase === 'buy') {
    hud.setBuyMenu(true, player.money);
  }
  if (event.code === 'Digit1' || event.code === 'Digit2' || event.code === 'Digit3' || event.code === 'Digit4') {
    const id = WEAPON_ORDER[Number(event.code.replace('Digit', '')) - 1];
    if (id && ownedWeapons.has(id) && arsenal.switchTo(id)) {
      player.weapon = id;
      syncHudAmmo();
    }
  }
  if (event.code === 'KeyG' && player.frags > 0 && match.state.phase === 'live') {
    player.frags -= 1;
    throwProjectile(player, 'frag');
  }
  if (event.code === 'KeyH' && player.smokes > 0 && match.state.phase === 'live') {
    player.smokes -= 1;
    throwProjectile(player, 'smoke');
  }
  if (event.code === 'KeyF' && player.flares > 0 && match.state.phase === 'live') {
    player.flares -= 1;
    throwProjectile(player, 'flare');
  }
  if (event.code === 'KeyQ' && player.medkits > 0 && player.hp < 100 && match.state.phase === 'live') {
    player.medkits -= 1;
    player.hp = Math.min(100, player.hp + UTILITY.medkit.heal);
    sound.heal();
  }
});

match.startRound();
hud.setHealth(player.hp, player.armor);
hud.setMoney(player.money);
hud.setScore(0, 0);
hud.setRound(1);
hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, WEAPONS[player.weapon].name);
hud.setUtilities({ frag: 0, smoke: 0, flare: 0, medkit: 0 });
hud.showOverlay('start');
syncCamera();

if (shot) runShot(shot);
else requestAnimationFrame(frame);
