// The HUD: every number the player needs, and nothing else. Health and armour, ammo and
// money, the round timer and the score, the kill feed, the radio, the bomb, the buy menu,
// the minimap and the scoreboard. The game calls setters; this module owns the DOM.
import { BUY_ITEMS } from './match.js';

export function createHud(map) {
  const $ = (id) => document.getElementById(id);
  const els = {
    healthNum: $('health-num'),
    healthBar: $('health-bar'),
    armorNum: $('armor-num'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'),
    money: $('money'),
    timer: $('timer'),
    teamScore: $('team-score'),
    roundLabel: $('round-label'),
    bombStatus: $('bomb-status'),
    plan: $('plan'),
    killfeed: $('killfeed'),
    radio: $('radio'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    utilities: $('utilities'),
    buy: $('buy'),
    buyList: $('buy-list'),
    buyMoney: $('buy-money'),
    scoreboard: $('scoreboard'),
    scoreboardBody: $('scoreboard-body'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    play: $('play'),
    banner: $('banner'),
    minimap: $('minimap'),
    damage: $('damage'),
  };
  const minimapCtx = els.minimap.getContext('2d');
  let playCallback = null;
  let hitTimer = null;
  let bannerTimer = null;

  els.play.addEventListener('click', () => {
    if (playCallback) playCallback();
  });

  function setHealth(hp, armor) {
    els.healthNum.textContent = Math.max(0, Math.ceil(hp));
    els.healthBar.style.width = `${Math.max(0, Math.min(100, hp))}%`;
    els.healthBar.style.background = hp > 50 ? '#f0a830' : '#c0392b';
    els.armorNum.textContent = Math.ceil(armor);
  }

  function setAmmo(mag, reserve, weaponName) {
    els.ammoMag.textContent = mag;
    els.ammoReserve.textContent = `/ ${reserve}`;
    els.weaponName.textContent = weaponName;
    els.ammoMag.parentElement.classList.toggle('empty', mag === 0);
  }

  function setMoney(n) {
    els.money.textContent = `$${n}`;
    els.buyMoney.textContent = `$${n}`;
  }

  function setTimer(seconds, phase, bombPlanted) {
    const s = Math.max(0, Math.ceil(seconds));
    const mm = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    els.timer.textContent = `${mm}:${ss}`;
    els.timer.classList.toggle('danger', s <= 10 || bombPlanted);
    els.timer.classList.toggle('buy-phase', phase === 'buy');
  }

  function setScore(v, s) {
    els.teamScore.innerHTML = `VANGUARD <b>${v}</b> — <b>${s}</b> SENTINEL`;
  }

  function setRound(n) {
    els.roundLabel.textContent = `ROUND ${n}`;
  }

  function setPlan(text) {
    els.plan.textContent = text;
    els.plan.style.opacity = '1';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      els.plan.style.opacity = '0';
    }, 5000);
  }

  function killfeedAdd(entry) {
    const div = document.createElement('div');
    div.className = 'feed-row';
    const killer = entry.killer ? `<span class="${entry.killerTeam === 'Vanguard' ? 'team-v' : 'team-s'}">${entry.killer}</span>` : '<span>—</span>';
    const victim = `<span class="${entry.victimTeam === 'Vanguard' ? 'team-v' : 'team-s'}">${entry.victim}</span>`;
    div.innerHTML = `${killer} <span class="feed-weapon">${entry.headshot ? '◎ ' : ''}${entry.weapon || ''}</span> ${victim}`;
    els.killfeed.prepend(div);
    while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
    setTimeout(() => div.remove(), 5000);
  }

  function radioAdd(team, text) {
    const div = document.createElement('div');
    div.className = 'radio-row';
    div.innerHTML = `<span class="${team === 'Vanguard' ? 'team-v' : 'team-s'}">[${team}]</span> ${text}`;
    els.radio.appendChild(div);
    while (els.radio.children.length > 6) els.radio.firstChild.remove();
    setTimeout(() => div.remove(), 7000);
  }

  function setBomb(state, site, timer) {
    if (state === 'planted') {
      els.bombStatus.textContent = `BOMB PLANTED ${site} — ${Math.ceil(timer)}s`;
      els.bombStatus.className = 'bomb planted';
    } else if (state === 'carried') {
      els.bombStatus.textContent = 'BOMB NOT PLANTED';
      els.bombStatus.className = 'bomb';
    } else {
      els.bombStatus.textContent = '';
      els.bombStatus.className = 'bomb';
    }
  }

  function hitMarker(kill, holdMs = 90) {
    els.hitmarker.classList.add('on');
    els.hitmarker.classList.toggle('kill', !!kill);
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), holdMs);
  }

  function setCrosshair(gapPx) {
    els.crosshair.style.setProperty('--gap', `${gapPx}px`);
  }

  function flashDamage() {
    els.damage.style.opacity = '0.55';
    setTimeout(() => {
      els.damage.style.opacity = '0';
    }, 120);
  }

  function setUtilities(u) {
    els.utilities.textContent = `◉ ${u.frag} · ☁ ${u.smoke} · ✦ ${u.flare} · ✚ ${u.medkit}`;
  }

  function setBuyMenu(show, money) {
    els.buy.hidden = !show;
    if (!show) return;
    setMoney(money);
    els.buyList.innerHTML = '';
    for (const item of BUY_ITEMS) {
      const row = document.createElement('div');
      row.className = `buy-row${money >= item.price ? '' : ' poor'}`;
      row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-label">${item.label}</span><span class="buy-price">$${item.price}</span>`;
      els.buyList.appendChild(row);
    }
  }

  function setScoreboard(show, rows) {
    els.scoreboard.hidden = !show;
    if (!show) return;
    els.scoreboardBody.innerHTML = '';
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.className = row.team === 'Vanguard' ? 'team-v' : 'team-s';
      tr.innerHTML = `<td>${row.name}</td><td>${row.kills}</td><td>${row.deaths}</td><td>$${row.money}</td><td>${row.alive ? '' : '✕'}</td>`;
      els.scoreboardBody.appendChild(tr);
    }
  }

  function showOverlay(kind, data = {}) {
    els.overlay.hidden = false;
    if (kind === 'start') {
      els.overlayTitle.textContent = 'DUSTLINE';
      els.overlayCopy.textContent = 'Tactical 5v5. Plant the bomb at A or B, or eliminate Sentinel. First to 8 rounds. Click to play.';
      els.play.textContent = 'Click to play';
    } else if (kind === 'paused') {
      els.overlayTitle.textContent = 'Paused';
      els.overlayCopy.textContent = 'Click to resume. Buy with B during the buy phase; Tab shows the scoreboard.';
      els.play.textContent = 'Resume';
    } else if (kind === 'match') {
      els.overlayTitle.textContent = `${data.winner} wins the match`;
      els.overlayCopy.textContent = `${data.scores.Vanguard} — ${data.scores.Sentinel}. Click to play again.`;
      els.play.textContent = 'Play again';
    }
  }

  function hideOverlay() {
    els.overlay.hidden = true;
  }

  function showBanner(text) {
    els.banner.textContent = text;
    els.banner.style.opacity = '1';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      els.banner.style.opacity = '0';
    }, 3500);
  }

  // Minimap: top-down view. Walls from the map boxes, amber site pads, the bomb, every
  // teammate, and enemies only when a teammate sees them or a flare reveals them.
  function drawMinimap(player, actors, visibleEnemies, flares) {
    const ctx = minimapCtx;
    const W = els.minimap.width;
    const H = els.minimap.height;
    const scaleX = W / 58;
    const scaleZ = H / 42;
    const px = (x) => (x + 29) * scaleX;
    const pz = (z) => (z + 21) * scaleZ;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(25, 21, 18, 0.85)';
    ctx.fillRect(0, 0, W, H);
    for (const b of map.boxes) {
      if (b.h < 0.6) continue;
      ctx.fillStyle = '#4a3f2e';
      ctx.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * scaleX, b.d * scaleZ);
    }
    for (const site of [map.sites.A, map.sites.B]) {
      ctx.fillStyle = 'rgba(240, 168, 48, 0.5)';
      ctx.fillRect(px(site.x - site.w / 2), pz(site.z - site.d / 2), site.w * scaleX, site.d * scaleZ);
    }
    for (const actor of actors) {
      if (!actor.alive) continue;
      const x = px(actor.position.x);
      const z = pz(actor.position.z);
      if (actor.isPlayer) {
        ctx.fillStyle = '#f0e8d5';
        ctx.beginPath();
        ctx.arc(x, z, 4, 0, Math.PI * 2);
        ctx.fill();
        const fx = -Math.sin(actor.yaw);
        const fz = -Math.cos(actor.yaw);
        ctx.strokeStyle = '#f0e8d5';
        ctx.beginPath();
        ctx.moveTo(x, z);
        ctx.lineTo(x + fx * 9, z + fz * 9);
        ctx.stroke();
      } else if (actor.team === player.team) {
        ctx.fillStyle = '#f0a830';
        ctx.beginPath();
        ctx.arc(x, z, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (visibleEnemies.has(actor) || flares.some((f) => Math.hypot(actor.position.x - f.x, actor.position.z - f.z) < f.radius)) {
        ctx.fillStyle = '#c0392b';
        ctx.beginPath();
        ctx.arc(x, z, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  return {
    setHealth,
    setAmmo,
    setMoney,
    setTimer,
    setScore,
    setRound,
    setPlan,
    killfeedAdd,
    radioAdd,
    setBomb,
    hitMarker,
    setCrosshair,
    flashDamage,
    setUtilities,
    setBuyMenu,
    setScoreboard,
    showOverlay,
    hideOverlay,
    showBanner,
    drawMinimap,
    onPlay(callback) {
      playCallback = callback;
    },
  };
}
