// Sound, synthesised with WebAudio: no audio files, nothing over the network. Every
// effect is a short oscillator or filtered-noise envelope, built lazily on the first user
// gesture (a browser only lets audio start after one). M mutes the master bus.
export function createSound() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;

  function ensureAudio() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const length = ctx.sampleRate * 0.5;
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
    return !!ctx;
  }

  function tone(freq, duration, type, volume, slideTo) {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function noise(duration, volume, filterFreq, type = 'lowpass') {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  const SHOT_TONE = { pistol: 420, smg: 520, rifle: 300, sniper: 180 };

  return {
    ensureAudio,
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    isMuted() {
      return muted;
    },
    shot(kind) {
      noise(0.09, 0.5, 1800, 'highpass');
      tone(SHOT_TONE[kind] || 300, 0.09, 'square', 0.22, 90);
    },
    reload() {
      tone(700, 0.06, 'square', 0.12);
      setTimeout(() => tone(500, 0.06, 'square', 0.12), 180);
    },
    hit() {
      tone(1200, 0.05, 'sine', 0.2);
    },
    kill() {
      tone(880, 0.07, 'sine', 0.22);
      setTimeout(() => tone(1320, 0.1, 'sine', 0.22), 70);
    },
    hurt() {
      tone(160, 0.18, 'sawtooth', 0.25, 70);
    },
    step() {
      noise(0.05, 0.07, 300);
    },
    plant() {
      tone(440, 0.12, 'square', 0.15);
      setTimeout(() => tone(660, 0.12, 'square', 0.15), 130);
    },
    beep() {
      tone(1500, 0.09, 'square', 0.16);
    },
    boom() {
      noise(0.9, 0.7, 220);
      tone(70, 0.8, 'sine', 0.5, 30);
    },
    win() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'triangle', 0.22), i * 120));
    },
    lose() {
      [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.2), i * 130));
    },
    buy() {
      tone(990, 0.06, 'sine', 0.18);
      setTimeout(() => tone(1240, 0.08, 'sine', 0.18), 60);
    },
    throwNade() {
      noise(0.15, 0.2, 900, 'bandpass');
    },
    heal() {
      tone(520, 0.1, 'sine', 0.16, 780);
      setTimeout(() => tone(780, 0.14, 'sine', 0.16), 100);
    },
    flare() {
      tone(1800, 0.2, 'sine', 0.12, 900);
    },
  };
}
