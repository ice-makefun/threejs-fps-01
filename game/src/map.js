// Dustline: an original desert-industrial map, 56 x 40 m, built from boxes. Two bombsites
// (A west, B east) at the north end, three lanes south to north (A long, mid, B), and a
// raised platform at mid. Every box is a collider and a bullet stop. The waypoint graph
// is built from line-of-sight between nodes, so bots walk real routes, not straight lines
// through walls. No network, no textures: plain geometry in the six palette colours.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_H = 5;
const SITE_A = { x: -20, z: -14, w: 11, d: 9 };
const SITE_B = { x: 20, z: -14, w: 11, d: 9 };

// [width, height, depth, x, y, z, material]
const BOXES = [
  // Floor and perimeter.
  [56.4, 0.4, 40.4, 0, -0.2, 0, 'surface'],
  [0.4, WALL_H, 40.4, -28.2, 2.5, 0, 'surface'],
  [0.4, WALL_H, 40.4, 28.2, 2.5, 0, 'surface'],
  [56.4, WALL_H, 0.4, 0, 2.5, -20.2, 'surface'],
  [56.4, WALL_H, 0.4, 0, 2.5, 20.2, 'surface'],
  // Mid plaza: two pillars and a low wall that splits the sightline.
  [1.4, 4.2, 1.4, -3, 2.1, 0, 'hairline'],
  [1.4, 4.2, 1.4, 3, 2.1, 0, 'hairline'],
  [4.4, 1.1, 1.0, 0, 0.55, -4.5, 'hairline'],
  [1.6, 0.8, 1.6, -8, 0.4, 2.5, 'hairline'],
  [1.6, 0.8, 1.6, 8, 0.4, 2.5, 'hairline'],
  // Raised platform at mid-north, overlooking both lanes.
  [8, 0.5, 4, 0, 0.25, -8, 'surface'],
  [0.5, 1.0, 4, -4, 0.5, -8, 'hairline'],
  // A long (west lane): staggered cover, a container to crouch behind.
  [1.2, 1.1, 3.4, -20, 0.55, 8, 'hairline'],
  [1.2, 2.6, 1.2, -24, 1.3, 2, 'hairline'],
  [3.4, 1.1, 1.2, -22, 0.55, -4, 'hairline'],
  [2.2, 2.2, 2.2, -25, 1.1, -10, 'surface'],
  [1.6, 0.9, 1.6, -16, 0.45, -11, 'hairline'],
  // B (east lane): containers and a crate stack.
  [1.2, 1.1, 3.4, 20, 0.55, 8, 'hairline'],
  [1.2, 2.6, 1.2, 24, 1.3, 2, 'hairline'],
  [3.4, 1.1, 1.2, 22, 0.55, -4, 'hairline'],
  [2.2, 2.2, 2.2, 25, 1.1, -10, 'surface'],
  [1.6, 0.9, 1.6, 16, 0.45, -11, 'hairline'],
  [1.2, 1.1, 1.2, 18, 0.55, -6, 'hairline'],
  // South spawn cover for both teams.
  [2.4, 1.0, 1.2, -10, 0.5, 14, 'hairline'],
  [2.4, 1.0, 1.2, 10, 0.5, 14, 'hairline'],
  [2.4, 1.0, 1.2, -10, 0.5, -16.5, 'hairline'],
  [2.4, 1.0, 1.2, 10, 0.5, -16.5, 'hairline'],
  // Site A: crates and a corner wall for plant cover.
  [1.6, 1.2, 1.6, -23, 0.6, -16, 'hairline'],
  [1.2, 1.1, 2.4, -16.5, 0.55, -17, 'hairline'],
  [2.0, 2.4, 0.6, -24.5, 1.2, -11.5, 'surface'],
  // Site B: crates and a corner wall for plant cover.
  [1.6, 1.2, 1.6, 23, 0.6, -16, 'hairline'],
  [1.2, 1.1, 2.4, 16.5, 0.55, -17, 'hairline'],
  [2.0, 2.4, 0.6, 24.5, 1.2, -11.5, 'surface'],
];

const WAYPOINTS = [
  [-6, 16], [0, 16], [6, 16],
  [-12, 12], [0, 10], [12, 12],
  [-16, 10], [-22, 6], [16, 10], [22, 6],
  [-6, 6], [0, 6], [6, 6],
  [-12, 0], [12, 0], [-22, -2], [22, -2],
  [-6, -2], [0, -3], [6, -2],
  [-14, -8], [14, -8], [-20, -8], [20, -8],
  [-16, -14], [-22, -14], [16, -14], [22, -14],
  [-8, -16], [0, -16], [8, -16],
];

const VANGUARD_SPAWN = [[-6, 16], [0, 16], [6, 16], [-12, 17], [12, 17]];
const SENTINEL_SPAWN = [[-8, -16], [0, -16], [8, -16], [-14, -17], [14, -17]];

function pointBlocked(x, y, z, colliders, margin) {
  for (const box of colliders) {
    if (
      x > box.min.x - margin && x < box.max.x + margin &&
      y > box.min.y - margin && y < box.max.y + margin &&
      z > box.min.z - margin && z < box.max.z + margin
    ) return true;
  }
  return false;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  const siteMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent), roughness: 0.7, metalness: 0.1,
    transparent: true, opacity: 0.35, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.25,
  });

  const colliders = [];
  const shootables = [];
  const boxes = [];

  function box(w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const bounds = new THREE.Box3().setFromObject(mesh);
    colliders.push(bounds);
    shootables.push(mesh);
    boxes.push({ x, z, w, d, h, y });
    return mesh;
  }
  for (const [w, h, d, x, y, z, material] of BOXES) box(w, h, d, x, y, z, material);

  // Bombsite pads: flat amber slabs on the floor, readable at a glance.
  for (const site of [SITE_A, SITE_B]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(site.w, 0.08, site.d), siteMat);
    pad.position.set(site.x, 0.04, site.z);
    pad.receiveShadow = true;
    group.add(pad);
  }

  // Light: a low desert sun from the south-west, a cool sky fill, warm bounce.
  const sky = new THREE.HemisphereLight(new THREE.Color(0xf5e3c0), new THREE.Color(PALETTE.canvas), 1.5);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(0xffe0b0), 2.4);
  key.position.set(-14, 18, 12);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -32;
  key.shadow.camera.right = 32;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.7);
  fill.position.set(12, 10, -14);
  scene.add(fill);

  // Smoke spheres block sight too; the match registers them here.
  const smokeSpheres = [];
  function segmentClear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const length = Math.hypot(dx, dy, dz) || 1;
    const steps = Math.ceil(length / 0.4);
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const x = ax + dx * t;
      const y = ay + dy * t;
      const z = az + dz * t;
      if (pointBlocked(x, y, z, colliders, 0.05)) return false;
      for (const s of smokeSpheres) {
        const sx = x - s.x;
        const sy = y - s.y;
        const sz = z - s.z;
        if (sx * sx + sy * sy + sz * sz < s.r * s.r) return false;
      }
    }
    return true;
  }

  // Waypoint graph: link nodes closer than 11 m with a clear walk at eye height.
  const nodes = WAYPOINTS.map(([x, z], index) => ({ index, x, z, links: [] }));
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist > 11) continue;
      if (!segmentClear(a.x, 1.2, a.z, b.x, 1.2, b.z)) continue;
      a.links.push(j);
      b.links.push(i);
    }
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (const node of nodes) {
      const d = (node.x - x) * (node.x - x) + (node.z - z) * (node.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = node.index;
      }
    }
    return best;
  }

  function findPath(fromIndex, toIndex) {
    if (fromIndex === toIndex) return [toIndex];
    const prev = new Array(nodes.length).fill(-1);
    const queue = [fromIndex];
    prev[fromIndex] = fromIndex;
    while (queue.length) {
      const current = queue.shift();
      for (const next of nodes[current].links) {
        if (prev[next] !== -1) continue;
        prev[next] = current;
        if (next === toIndex) {
          const path = [toIndex];
          let step = toIndex;
          while (step !== fromIndex) {
            step = prev[step];
            path.unshift(step);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [toIndex];
  }

  return {
    colliders,
    shootables,
    boxes,
    group,
    nodes,
    sites: { A: SITE_A, B: SITE_B },
    vanguardSpawn: VANGUARD_SPAWN,
    sentinelSpawn: SENTINEL_SPAWN,
    smokeSpheres,
    hasLOS(ax, ay, az, bx, by, bz) {
      return segmentClear(ax, ay, az, bx, by, bz);
    },
    nearestNode,
    findPath,
    inSite(site, x, z) {
      const s = site === 'A' ? SITE_A : SITE_B;
      return Math.abs(x - s.x) <= s.w / 2 && Math.abs(z - s.z) <= s.d / 2;
    },
  };
}
