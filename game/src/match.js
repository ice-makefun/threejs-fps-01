// The match: rounds, money, the bomb and the radio. One place owns the score, the timer
// and the phase, so the HUD, the bots and the shooting code all read the same truth.
// First to 8 rounds wins (15 rounds at most); a round ends on elimination, on the bomb
// going off or being defused, or on the clock running out.
import { WEAPONS, UTILITY } from './weapons.js';

export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const BOMB_TIME = 40;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const WIN_ROUNDS = 8;
export const MAX_ROUNDS = 15;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;

export const BUY_ITEMS = [
  { key: '1', id: 'p250', label: 'P250 pistol', price: 300 },
  { key: '2', id: 'vandal', label: 'Vandal SMG', price: 1500 },
  { key: '3', id: 'dustline', label: 'Dustline AR', price: 2700 },
  { key: '4', id: 'longbow', label: 'Longbow .50', price: 4750 },
  { key: '5', id: 'frag', label: 'Frag grenade', price: 300 },
  { key: '6', id: 'smoke', label: 'Smoke grenade', price: 300 },
  { key: '7', id: 'armor', label: 'Kevlar armor', price: 650 },
  { key: '8', id: 'flare', label: 'Flare', price: 200 },
  { key: '9', id: 'medkit', label: 'Medkit', price: 400 },
];

const PLANS = ['RUSH A', 'RUSH B', 'SPLIT'];

export function createMatch(actors, world, hooks) {
  const state = {
    phase: 'buy',
    round: 1,
    scores: { Vanguard: 0, Sentinel: 0 },
    timer: BUY_TIME,
    plan: PLANS[0],
    bomb: { state: 'carried', site: null, x: 0, z: 0, timer: BOMB_TIME },
    lossStreak: { Vanguard: 0, Sentinel: 0 },
    killfeed: [],
    radio: [],
    winner: null,
    reason: '',
  };

  function radio(team, text) {
    state.radio.push({ team, text, at: state.timer });
    if (state.radio.length > 6) state.radio.shift();
    hooks.onRadio(team, text);
  }

  function feed(entry) {
    state.killfeed.push(entry);
    if (state.killfeed.length > 5) state.killfeed.shift();
    hooks.onKillfeed(entry);
  }

  function aliveOf(team) {
    return actors.filter((a) => a.team === team && a.alive);
  }

  function botBuy(bot) {
    if (bot.money >= WEAPONS.dustline.price && bot.weapon !== 'dustline') {
      buy(bot, 'dustline');
    } else if (bot.money >= WEAPONS.vandal.price && bot.weapon === 'p250') {
      buy(bot, 'vandal');
    }
    if (bot.money >= UTILITY.armor.price && !bot.hasArmor) buy(bot, 'armor');
    if (bot.money >= UTILITY.frag.price && bot.frags < 1) buy(bot, 'frag');
    if (bot.money >= UTILITY.smoke.price && bot.smokes < 1) buy(bot, 'smoke');
  }

  function buy(actor, itemId) {
    const item = BUY_ITEMS.find((i) => i.id === itemId);
    if (!item || state.phase !== 'buy') return false;
    if (actor.money < item.price) return false;
    if (WEAPONS[itemId]) {
      actor.money -= item.price;
      actor.weapon = itemId;
      actor.mag = WEAPONS[itemId].mag;
      actor.reserve = WEAPONS[itemId].reserve;
      hooks.onBuy(actor, item);
      return true;
    }
    if (itemId === 'armor') {
      if (actor.hasArmor) return false;
      actor.money -= item.price;
      actor.hasArmor = true;
      actor.armor = 100;
      hooks.onBuy(actor, item);
      return true;
    }
    if (itemId === 'frag' && actor.frags < UTILITY.frag.max) {
      actor.money -= item.price;
      actor.frags += 1;
    } else if (itemId === 'smoke' && actor.smokes < UTILITY.smoke.max) {
      actor.money -= item.price;
      actor.smokes += 1;
    } else if (itemId === 'flare' && actor.flares < UTILITY.flare.max) {
      actor.money -= item.price;
      actor.flares += 1;
    } else if (itemId === 'medkit' && actor.medkits < UTILITY.medkit.max) {
      actor.money -= item.price;
      actor.medkits += 1;
    } else {
      return false;
    }
    hooks.onBuy(actor, item);
    return true;
  }

  function startRound() {
    const vanguard = actors.filter((a) => a.team === 'Vanguard');
    const sentinel = actors.filter((a) => a.team === 'Sentinel');
    vanguard.forEach((a, i) => {
      const spawn = world.vanguardSpawn[i % world.vanguardSpawn.length];
      hooks.onResetActor(a, spawn);
    });
    sentinel.forEach((a, i) => {
      const spawn = world.sentinelSpawn[i % world.sentinelSpawn.length];
      hooks.onResetActor(a, spawn);
    });
    state.bomb = { state: 'carried', site: null, x: 0, z: 0, timer: BOMB_TIME };
    state.phase = 'buy';
    state.timer = BUY_TIME;
    state.plan = PLANS[(state.round - 1) % PLANS.length];
    // The bomb goes to a Vanguard at random; the player carries it about one round in five.
    const carrier = vanguard[Math.floor(hooks.rng() * vanguard.length)];
    for (const a of vanguard) a.bombCarrier = false;
    carrier.bombCarrier = true;
    for (const bot of actors.filter((a) => !a.isPlayer)) botBuy(bot);
    radio('Vanguard', `Plan: ${state.plan} — ${carrier.isPlayer ? 'you carry' : `${carrier.name} carries`} the bomb.`);
    hooks.onRoundStart(state.round, state.plan);
  }

  function endRound(winner, reason) {
    state.scores[winner] += 1;
    state.phase = 'end';
    state.timer = 4;
    state.winner = winner;
    state.reason = reason;
    const loser = winner === 'Vanguard' ? 'Sentinel' : 'Vanguard';
    state.lossStreak[loser] += 1;
    state.lossStreak[winner] = 0;
    const lossBonus = Math.min(LOSS_REWARD + (state.lossStreak[loser] - 1) * 500, 3400);
    for (const a of actors) {
      if (a.team === winner) a.money += WIN_REWARD;
      else a.money += lossBonus;
    }
    hooks.onRoundEnd(winner, reason);
    if (state.scores[winner] >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.phase = 'over';
      hooks.onMatchEnd(winner);
    }
  }

  function checkEnd() {
    if (state.phase !== 'live') return;
    const vanguardAlive = aliveOf('Vanguard').length;
    const sentinelAlive = aliveOf('Sentinel').length;
    if (vanguardAlive === 0 && state.bomb.state !== 'planted') {
      endRound('Sentinel', 'Vanguard eliminated');
    } else if (sentinelAlive === 0) {
      endRound('Vanguard', 'Sentinel eliminated');
    } else if (vanguardAlive === 0 && state.bomb.state === 'planted') {
      // The bomb still decides it: the round plays on until it blows or is defused.
    }
  }

  function update(dt) {
    if (state.phase === 'over') return;
    state.timer -= dt;
    if (state.phase === 'buy' && state.timer <= 0) {
      state.phase = 'live';
      state.timer = ROUND_TIME;
      hooks.onLive();
    } else if (state.phase === 'live') {
      if (state.bomb.state === 'planted') {
        state.bomb.timer -= dt;
        if (state.bomb.timer <= 0) {
          state.bomb.state = 'exploded';
          endRound('Vanguard', 'Bomb detonated');
          hooks.onBombExploded();
          return;
        }
      } else if (state.timer <= 0) {
        endRound('Sentinel', 'Time expired');
        return;
      }
      checkEnd();
    } else if (state.phase === 'end' && state.timer <= 0) {
      if (state.scores.Vanguard >= WIN_ROUNDS || state.scores.Sentinel >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
        state.phase = 'over';
        return;
      }
      state.round += 1;
      startRound();
    }
  }

  function registerKill(killer, victim, headshot) {
    if (killer) {
      killer.kills += 1;
      killer.money += KILL_REWARD;
    }
    victim.deaths += 1;
    feed({ killer: killer ? killer.name : null, killerTeam: killer ? killer.team : null, victim: victim.name, victimTeam: victim.team, weapon: killer ? killer.weapon : null, headshot });
    checkEnd();
  }

  function plantBomb(actor, site) {
    if (state.phase !== 'live' || !actor.bombCarrier || state.bomb.state !== 'carried') return false;
    if (!world.inSite(site, actor.position.x, actor.position.z)) return false;
    state.bomb = { state: 'planted', site, x: actor.position.x, z: actor.position.z, timer: BOMB_TIME };
    actor.bombCarrier = false;
    radio('Vanguard', `Bomb planted at ${site}!`);
    radio('Sentinel', `Bomb planted at ${site} — defuse it!`);
    hooks.onBombPlanted(site);
    return true;
  }

  function defuseBomb(actor) {
    if (state.phase !== 'live' || state.bomb.state !== 'planted') return false;
    const dist = Math.hypot(actor.position.x - state.bomb.x, actor.position.z - state.bomb.z);
    if (dist > 2.5) return false;
    state.bomb.state = 'defused';
    endRound('Sentinel', 'Bomb defused');
    hooks.onBombDefused();
    return true;
  }

  return {
    state,
    update,
    buy,
    startRound,
    registerKill,
    plantBomb,
    defuseBomb,
    radio,
    aliveOf,
    bombSite() {
      if (state.bomb.state !== 'planted') return null;
      const s = world.sites[state.bomb.site];
      return { name: state.bomb.site, x: s.x, z: s.z };
    },
    isBombPlanted() {
      return state.bomb.state === 'planted';
    },
    scoreboard() {
      return actors.map((a) => ({ name: a.name, team: a.team, kills: a.kills, deaths: a.deaths, money: a.money, alive: a.alive }));
    },
  };
}
