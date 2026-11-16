// Actors: one body for the player and for every bot. Movement is the same box-against-
// boxes physics for all of them (acceleration, friction, gravity, crouch, jump), so a bot
// can never walk through a wall the player cannot. Bots think in states — advance along
// the waypoint graph, engage what they can see, hold a lane, take cover when hurt, plant
// or defuse the bomb — and they shoot back with bursts, aim error and strafing.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS } from './weapons.js';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const BOT_SPEED = 4.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

const TEAM_COLOR = {
  Vanguard: PALETTE.accent,
  Sentinel: PALETTE.ink,
};

export function makeActor({ id, name, team, isPlayer, spawn, weaponId }) {
  const actor = {
    id,
    name,
    team,
    isPlayer: !!isPlayer,
    position: new THREE.Vector3(spawn[0], 0, spawn[1]),
    velocity: new THREE.Vector3(),
    yaw: team === 'Vanguard' ? 0 : Math.PI,
    pitch: 0,
    eye: STAND_EYE,
    height: STAND_HEIGHT,
    crouching: false,
    onGround: true,
    hp: 100,
    armor: 0,
    alive: true,
    weapon: weaponId || 'dustline',
    mag: WEAPONS[weaponId || 'dustline'].mag,
    reserve: WEAPONS[weaponId || 'dustline'].reserve,
    cooldown: 0,
    reloadLeft: 0,
    money: 800,
    kills: 0,
    deaths: 0,
    frags: 0,
    smokes: 0,
    flares: 0,
    medkits: 0,
    hasArmor: false,
    bombCarrier: false,
    mesh: null,
    // Bot brain, unused for the player.
    brain: null,
  };
  return actor;
}

export function buildActorMesh(actor) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(TEAM_COLOR[actor.team]), roughness: 0.8, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), bodyMat);
  torso.position.y = 0.95;
  torso.castShadow = true;
  torso.userData.actor = actor;
  torso.userData.part = 'body';
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), darkMat);
  head.position.y = 1.5;
  head.castShadow = true;
  head.userData.actor = actor;
  head.userData.part = 'head';
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.05), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.7 }));
  visor.position.set(0, 1.52, -0.18);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), darkMat);
  legs.position.y = 0.3;
  legs.castShadow = true;
  legs.userData.actor = actor;
  legs.userData.part = 'body';
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.7), darkMat);
  gun.position.set(0.2, 1.05, -0.35);
  gun.userData.actor = actor;
  gun.userData.part = 'body';
  group.add(torso, head, visor, legs, gun);
  group.position.copy(actor.position);
  actor.mesh = group;
  actor.hitMeshes = [torso, head, legs, gun];
  return group;
}

export function resetActor(actor, spawn, weaponId) {
  actor.position.set(spawn[0], 0, spawn[1]);
  actor.velocity.set(0, 0, 0);
  actor.yaw = actor.team === 'Vanguard' ? 0 : Math.PI;
  actor.pitch = 0;
  actor.hp = 100;
  actor.armor = actor.hasArmor ? 100 : 0;
  actor.alive = true;
  actor.cooldown = 0;
  actor.reloadLeft = 0;
  actor.crouching = false;
  actor.height = STAND_HEIGHT;
  actor.eye = STAND_EYE;
  actor.bombCarrier = false;
  if (weaponId) {
    actor.weapon = weaponId;
    actor.mag = WEAPONS[weaponId].mag;
    actor.reserve = WEAPONS[weaponId].reserve;
  }
  if (actor.mesh) {
    actor.mesh.position.copy(actor.position);
    actor.mesh.visible = true;
  }
  if (actor.brain) resetBrain(actor);
}

// Damage: armour soaks half of every hit until it breaks. Headshots pay the multiplier.
export function damageActor(actor, amount, headMult) {
  if (!actor.alive) return 0;
  let dealt = amount * (headMult || 1);
  if (actor.armor > 0) {
    const soaked = Math.min(actor.armor, dealt * 0.5);
    actor.armor -= soaked;
    dealt -= soaked;
  }
  actor.hp -= dealt;
  if (actor.hp <= 0) {
    actor.hp = 0;
    actor.alive = false;
    if (actor.mesh) actor.mesh.visible = false;
  }
  return dealt;
}

// One movement step for any actor. wishX/wishZ are world-space wish directions.
export function moveBody(actor, dt, wishX, wishZ, crouch, jump, colliders) {
  const probe = new THREE.Box3();
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }
  if (crouch && !actor.crouching) {
    actor.crouching = true;
    actor.height = CROUCH_HEIGHT;
  } else if (!crouch && actor.crouching && !overlaps(actor.position.x, actor.position.y, actor.position.z, STAND_HEIGHT, 0.02)) {
    actor.crouching = false;
    actor.height = STAND_HEIGHT;
  }
  const eyeTarget = actor.crouching ? CROUCH_EYE : STAND_EYE;
  actor.eye += (eyeTarget - actor.eye) * Math.min(1, dt * 12);

  const speed = actor.isPlayer ? (actor.crouching ? CROUCH_SPEED : WALK_SPEED) : BOT_SPEED;
  const blend = Math.min(1, (actor.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
  actor.velocity.x += (wishX * speed - actor.velocity.x) * blend;
  actor.velocity.z += (wishZ * speed - actor.velocity.z) * blend;
  if (actor.onGround && wishX === 0 && wishZ === 0) {
    const damp = Math.max(0, 1 - FRICTION * dt);
    actor.velocity.x *= damp;
    actor.velocity.z *= damp;
  }
  if (jump && actor.onGround) {
    actor.velocity.y = JUMP_SPEED;
    actor.onGround = false;
  }
  actor.velocity.y -= GRAVITY * dt;

  const nextX = actor.position.x + actor.velocity.x * dt;
  if (!overlaps(nextX, actor.position.y, actor.position.z, actor.height, 0.04)) actor.position.x = nextX;
  else actor.velocity.x = 0;
  const nextZ = actor.position.z + actor.velocity.z * dt;
  if (!overlaps(actor.position.x, actor.position.y, nextZ, actor.height, 0.04)) actor.position.z = nextZ;
  else actor.velocity.z = 0;

  actor.position.y += actor.velocity.y * dt;
  actor.onGround = false;
  const hit = overlaps(actor.position.x, actor.position.y, actor.position.z, actor.height, 0);
  if (hit && actor.velocity.y <= 0) {
    actor.position.y = hit.max.y;
    actor.velocity.y = 0;
    actor.onGround = true;
  } else if (hit) {
    actor.position.y = hit.min.y - actor.height;
    actor.velocity.y = 0;
  }
  if (actor.position.y < 0) {
    actor.position.y = 0;
    actor.velocity.y = 0;
    actor.onGround = true;
  }
  actor.velocity.y = Math.max(-30, actor.velocity.y);
  if (actor.mesh) {
    actor.mesh.position.copy(actor.position);
    actor.mesh.rotation.y = actor.yaw;
  }
}

function resetBrain(actor) {
  const b = actor.brain;
  b.state = 'advance';
  b.path = [];
  b.pathIndex = 0;
  b.target = null;
  b.burstLeft = 0;
  b.burstCooldown = 0;
  b.strafeDir = 1;
  b.strafeTimer = 0;
  b.perceiveTimer = 0;
  b.holdTimer = 0;
  b.channelTimer = 0;
  b.heard = null;
  b.targetNode = -1;
}

// The bot brain. hooks: { fire(actor, aimPoint), onHeard(actor, pos), onSmoke(actor),
// onPlant(actor), onDefuse(actor), isBombPlanted(), bombSite(), enemiesOf(actor), rng }.
export function createBrain(actor, world, hooks) {
  const brain = {
    state: 'advance',
    path: [],
    pathIndex: 0,
    target: null,
    burstLeft: 0,
    burstCooldown: 0,
    strafeDir: 1,
    strafeTimer: 0,
    perceiveTimer: 0,
    holdTimer: 0,
    channelTimer: 0,
    heard: null,
    targetNode: -1,
    assignedSite: actor.team === 'Vanguard' ? (actor.id % 2 === 0 ? 'A' : 'B') : null,
  };
  actor.brain = brain;
  resetBrain(actor);
  brain.assignedSite = actor.team === 'Vanguard' ? (actor.id % 2 === 0 ? 'A' : 'B') : null;

  function eyePos(other) {
    return { x: other.position.x, y: other.position.y + other.eye, z: other.position.z };
  }

  function perceive() {
    const eye = eyePos(actor);
    let best = null;
    let bestDist = Infinity;
    for (const enemy of hooks.enemiesOf(actor)) {
      if (!enemy.alive) continue;
      const dx = enemy.position.x - actor.position.x;
      const dz = enemy.position.z - actor.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 55 || dist >= bestDist) continue;
      const foe = eyePos(enemy);
      if (!world.hasLOS(eye.x, eye.y, eye.z, foe.x, foe.y, foe.z)) continue;
      // Bots see ahead of them; a close enemy behind still gets heard, not seen.
      const forwardX = -Math.sin(actor.yaw);
      const forwardZ = -Math.cos(actor.yaw);
      const dot = (dx * forwardX + dz * forwardZ) / (dist || 1);
      if (dist > 6 && dot < 0.2) continue;
      best = enemy;
      bestDist = dist;
    }
    brain.target = best;
    return best;
  }

  function goToNode(nodeIndex) {
    if (brain.targetNode === nodeIndex && brain.path.length) return;
    const from = world.nearestNode(actor.position.x, actor.position.z);
    brain.path = world.findPath(from, nodeIndex);
    brain.pathIndex = 0;
    brain.targetNode = nodeIndex;
  }

  function followPath(dt) {
    if (!brain.path.length || brain.pathIndex >= brain.path.length) return { x: 0, z: 0 };
    const node = world.nodes[brain.path[brain.pathIndex]];
    const dx = node.x - actor.position.x;
    const dz = node.z - actor.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.9) {
      brain.pathIndex += 1;
      return { x: 0, z: 0 };
    }
    // Face where we walk.
    const wantYaw = Math.atan2(-dx, -dz);
    let diff = wantYaw - actor.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    actor.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
    return { x: dx / dist, z: dz / dist };
  }

  function aimAt(target, error) {
    const rng = hooks.rng;
    const head = rng() < 0.22;
    const tx = target.position.x + (rng() * 2 - 1) * error;
    const ty = target.position.y + (head ? 1.5 : 1.0) + (rng() * 2 - 1) * error * 0.6;
    const tz = target.position.z + (rng() * 2 - 1) * error;
    return { x: tx, y: ty, z: tz };
  }

  function step(dt) {
    if (!actor.alive) return;
    actor.cooldown = Math.max(0, actor.cooldown - dt);
    actor.reloadLeft = Math.max(0, actor.reloadLeft - dt);
    brain.perceiveTimer -= dt;
    if (brain.perceiveTimer <= 0) {
      perceive();
      brain.perceiveTimer = 0.15;
    }
    const def = WEAPONS[actor.weapon];
    const rng = hooks.rng;

    // Reload when the magazine runs dry.
    if (actor.mag === 0 && actor.reloadLeft === 0 && actor.reserve > 0) {
      actor.reloadLeft = def.reload;
      const take = Math.min(def.mag, actor.reserve);
      actor.mag = 0;
      actor._pendingReload = take;
    }
    if (actor._pendingReload !== undefined && actor.reloadLeft === 0) {
      actor.mag = actor._pendingReload;
      actor.reserve -= actor._pendingReload;
      delete actor._pendingReload;
    }

    // Take cover when hurt: fall back along the graph, away from the enemy.
    if (actor.hp < 35 && brain.state !== 'cover' && brain.target) {
      brain.state = 'cover';
      brain.holdTimer = 2.5;
      const away = world.nearestNode(actor.position.x - (brain.target.position.x - actor.position.x) * 0.4, actor.position.z - (brain.target.position.z - actor.position.z) * 0.4);
      goToNode(away);
    }

    let wish = { x: 0, z: 0 };
    if (brain.target && brain.target.alive) {
      const target = brain.target;
      const dx = target.position.x - actor.position.x;
      const dz = target.position.z - actor.position.z;
      const dist = Math.hypot(dx, dz);
      const eye = eyePos(actor);
      const foe = eyePos(target);
      const visible = world.hasLOS(eye.x, eye.y, eye.z, foe.x, foe.y, foe.z);
      if (visible) {
        brain.state = 'engage';
        // Face the target, strafe to be hard to hit.
        const wantYaw = Math.atan2(-dx, -dz);
        let diff = wantYaw - actor.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        actor.yaw += Math.max(-5 * dt, Math.min(5 * dt, diff));
        brain.strafeTimer -= dt;
        if (brain.strafeTimer <= 0) {
          brain.strafeDir = rng() < 0.5 ? -1 : 1;
          brain.strafeTimer = 0.7 + rng() * 0.9;
        }
        const strafeX = Math.cos(actor.yaw) * brain.strafeDir;
        const strafeZ = -Math.sin(actor.yaw) * brain.strafeDir;
        wish = { x: strafeX * 0.7, z: strafeZ * 0.7 };
        if (dist > 14) {
          wish.x += (-Math.sin(actor.yaw)) * 0.5;
          wish.z += (-Math.cos(actor.yaw)) * 0.5;
        } else if (dist < 5) {
          wish.x -= (-Math.sin(actor.yaw)) * 0.5;
          wish.z -= (-Math.cos(actor.yaw)) * 0.5;
        }
        // Burst fire: 3-5 rounds, then a pause. Aim error grows with range and speed.
        brain.burstCooldown -= dt;
        if (brain.burstLeft <= 0 && brain.burstCooldown <= 0 && actor.mag > 0 && actor.reloadLeft === 0) {
          brain.burstLeft = 3 + Math.floor(rng() * 3);
          brain.burstCooldown = 0.55 + rng() * 0.6;
        }
        if (brain.burstLeft > 0 && actor.cooldown === 0 && actor.mag > 0 && actor.reloadLeft === 0) {
          const targetSpeed = Math.hypot(target.velocity.x, target.velocity.z);
          const error = 0.25 + dist * 0.016 + targetSpeed * 0.05 + (Math.hypot(actor.velocity.x, actor.velocity.z) * 0.03);
          hooks.fire(actor, aimAt(target, error));
          brain.burstLeft -= 1;
        }
        // A bot that is winning the fight sometimes smokes the lane.
        if (actor.smokes > 0 && rng() < 0.002) {
          actor.smokes -= 1;
          hooks.onSmoke(actor);
        }
      } else {
        brain.target = null;
      }
    }

    if (!brain.target) {
      if (brain.state === 'cover') {
        wish = followPath(dt);
        brain.holdTimer -= dt;
        if (brain.holdTimer <= 0) brain.state = 'advance';
      } else if (hooks.isBombPlanted()) {
        // Defenders converge on the planted site; attackers hold it.
        const site = hooks.bombSite();
        if (actor.team === 'Sentinel') {
          const node = world.nearestNode(site.x, site.z);
          goToNode(node);
          wish = followPath(dt);
          if (world.inSite(site.name, actor.position.x, actor.position.z)) {
            brain.state = 'defuse';
            brain.channelTimer += dt;
            if (brain.channelTimer >= 5) {
              brain.channelTimer = 0;
              hooks.onDefuse(actor);
            }
          } else {
            brain.channelTimer = 0;
          }
        } else {
          // Attackers hold near the bomb.
          if (brain.holdTimer <= 0) {
            const node = world.nearestNode(site.x + (rng() * 6 - 3), site.z + (rng() * 6 - 3));
            goToNode(node);
            brain.holdTimer = 4 + rng() * 3;
          }
          wish = followPath(dt);
          brain.holdTimer -= dt;
        }
      } else if (actor.team === 'Vanguard') {
        // Attackers push their assigned site; the carrier plants on arrival.
        const site = brain.assignedSite;
        const s = world.sites[site];
        if (world.inSite(site, actor.position.x, actor.position.z)) {
          if (actor.bombCarrier) {
            brain.state = 'plant';
            brain.channelTimer += dt;
            if (brain.channelTimer >= 3) {
              brain.channelTimer = 0;
              hooks.onPlant(actor, site);
            }
          } else {
            wish = followPath(dt);
            if (brain.holdTimer <= 0) {
              const node = world.nearestNode(s.x + (rng() * 8 - 4), s.z + (rng() * 8 - 4));
              goToNode(node);
              brain.holdTimer = 3 + rng() * 3;
            }
            brain.holdTimer -= dt;
          }
        } else {
          const node = world.nearestNode(s.x, s.z);
          goToNode(node);
          wish = followPath(dt);
        }
      } else {
        // Defenders hold a lane near their site, rotating between two posts.
        if (brain.holdTimer <= 0) {
          const s = world.sites[actor.id % 2 === 0 ? 'A' : 'B'];
          const node = world.nearestNode(s.x + (rng() * 10 - 5), s.z + 6 + rng() * 4);
          goToNode(node);
          brain.holdTimer = 5 + rng() * 4;
        }
        wish = followPath(dt);
        brain.holdTimer -= dt;
      }
    }

    // React to heard shots: turn toward the sound.
    if (brain.heard) {
      const dx = brain.heard.x - actor.position.x;
      const dz = brain.heard.z - actor.position.z;
      const wantYaw = Math.atan2(-dx, -dz);
      let diff = wantYaw - actor.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      actor.yaw += Math.max(-4 * dt, Math.min(4 * dt, diff));
      brain.heard = null;
    }

    const len = Math.hypot(wish.x, wish.z) || 1;
    moveBody(actor, dt, wish.x / len, wish.z / len, false, false, world.colliders);
  }

  brain.step = step;
  return { brain, step };
}
