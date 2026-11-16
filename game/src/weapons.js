// The armoury: every weapon and utility in one table, so the buy menu, the HUD and the
// shooting code never disagree about a price, a damage number or a magazine size.
// Accuracy counts more than speed: spread grows hard with movement, recoil kicks the
// pitch up, and the head pays three times the body.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p250: {
    id: 'p250', name: 'P250', kind: 'pistol', price: 300,
    damage: 28, headMult: 3, gap: 0.16, mag: 13, reserve: 52, reload: 1.6,
    spreadStill: 0.004, spreadMove: 0.03, recoil: 0.011, auto: false, range: 60,
    length: 0.34, barrel: 0.2,
  },
  vandal: {
    id: 'vandal', name: 'Vandal SMG', kind: 'smg', price: 1500,
    damage: 24, headMult: 3, gap: 0.075, mag: 32, reserve: 128, reload: 2.0,
    spreadStill: 0.006, spreadMove: 0.034, recoil: 0.008, auto: true, range: 55,
    length: 0.5, barrel: 0.3,
  },
  dustline: {
    id: 'dustline', name: 'Dustline AR', kind: 'rifle', price: 2700,
    damage: 34, headMult: 3, gap: 0.096, mag: 30, reserve: 90, reload: 1.9,
    spreadStill: 0.0022, spreadMove: 0.028, recoil: 0.009, auto: true, range: 80,
    length: 0.62, barrel: 0.42,
  },
  longbow: {
    id: 'longbow', name: 'Longbow .50', kind: 'sniper', price: 4750,
    damage: 95, headMult: 2, gap: 1.1, mag: 5, reserve: 20, reload: 3.2,
    spreadStill: 0.0005, spreadMove: 0.05, recoil: 0.03, auto: false, range: 120,
    length: 0.86, barrel: 0.6,
  },
};

export const UTILITY = {
  frag: { id: 'frag', name: 'Frag grenade', price: 300, max: 2 },
  smoke: { id: 'smoke', name: 'Smoke grenade', price: 300, max: 2 },
  flare: { id: 'flare', name: 'Flare', price: 200, max: 2, radius: 14, duration: 8 },
  medkit: { id: 'medkit', name: 'Medkit', price: 400, max: 2, heal: 50 },
  armor: { id: 'armor', name: 'Kevlar armor', price: 650, max: 1 },
};

export const WEAPON_ORDER = ['p250', 'vandal', 'dustline', 'longbow'];

// The player's arsenal: current weapon, its ammo, its view model and its muzzle flash.
// Bots carry only the numbers (see actors.js); only the player gets a view model.
export function createArsenal(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.35 });

  const model = new THREE.Group();
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(0xffc266), 0, 6);
  camera.add(flashLight);

  const state = {
    weapon: 'dustline',
    mag: 30,
    reserve: 90,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    reloadTime: 1.9,
  };
  const ammo = {};
  for (const id of WEAPON_ORDER) {
    ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  }

  function rebuildModel() {
    while (model.children.length) model.remove(model.children[0]);
    const def = WEAPONS[state.weapon];
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, def.length * 0.62), metal);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.barrel), grip);
    barrel.position.set(0, 0.025, -def.length * 0.42);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.2), dark);
    stock.position.set(0, -0.02, def.length * 0.32);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.08), dark);
    sight.position.set(0, 0.08, -0.05);
    model.add(receiver, barrel, stock, sight);
    model.position.set(0.32, -0.27, -0.5);
    flash.position.set(0.32, -0.22, -0.5 - def.length * 0.62);
    flashLight.position.set(0.32, -0.22, -0.9);
  }

  function def() {
    return WEAPONS[state.weapon];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.5 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 3 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (state.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const d = def();
        const need = d.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
        ammo[state.weapon] = { mag: state.mag, reserve: state.reserve };
      }
    }
  }

  rebuildModel();

  return {
    state,
    def,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || state.mag === d.mag || state.reserve === 0) return false;
      state.reloadLeft = d.reload;
      state.reloadTime = d.reload;
      return true;
    },
    spread(speed) {
      const d = def();
      return d.spreadStill + Math.min(1, speed / 5.2) * d.spreadMove;
    },
    switchTo(id) {
      if (!WEAPONS[id] || id === state.weapon) return false;
      ammo[state.weapon] = { mag: state.mag, reserve: state.reserve };
      state.weapon = id;
      state.mag = ammo[id].mag;
      state.reserve = ammo[id].reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      rebuildModel();
      return true;
    },
    buyWeapon(id) {
      if (!WEAPONS[id]) return false;
      ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      return this.switchTo(id);
    },
    refill() {
      for (const id of WEAPON_ORDER) ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      state.mag = ammo[state.weapon].mag;
      state.reserve = ammo[state.weapon].reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}
