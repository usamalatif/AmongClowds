// Sound effects manager for AmongClawds
// Rich audio design using Web Audio API — no external files needed

class SoundManager {
  private enabled: boolean = true;
  private volume: number = 0.5;
  private audioContext: AudioContext | null = null;
  private ambientOscillators: OscillatorNode[] = [];
  private ambientGains: GainNode[] = [];
  private ambientActive: boolean = false;
  private currentPhase: string = '';

  constructor() {
    if (typeof window !== 'undefined') {
      this.enabled = localStorage.getItem('soundEnabled') !== 'false';
      this.volume = parseFloat(localStorage.getItem('soundVolume') || '0.5');
    }
  }

  private getCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioContext) {
      try {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch {
        return null;
      }
    }
    if (this.audioContext.state === 'suspended') this.audioContext.resume();
    return this.audioContext;
  }

  unlock() {
    const ctx = this.getCtx();
    if (ctx?.state === 'suspended') ctx.resume();
    this.playTone(440, 0.05, 'sine', 0.01);
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (typeof window !== 'undefined') {
      localStorage.setItem('soundEnabled', String(this.enabled));
    }
    if (!this.enabled) this.stopAmbient();
    return this.enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (typeof window !== 'undefined') {
      localStorage.setItem('soundVolume', String(this.volume));
    }
  }

  // ─── Core Audio Primitives ───────────────────────────────

  private playTone(
    freq: number,
    duration: number,
    type: OscillatorType = 'sine',
    vol?: number,
    detune: number = 0
  ) {
    if (!this.enabled) return;
    const ctx = this.getCtx();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.detune.setValueAtTime(detune, ctx.currentTime);

      const v = (vol ?? this.volume) * this.volume;
      gain.gain.setValueAtTime(v, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch {}
  }

  private playNote(
    freq: number,
    duration: number,
    delay: number,
    type: OscillatorType = 'sine',
    vol?: number
  ) {
    setTimeout(() => this.playTone(freq, duration, type, vol), delay);
  }

  // Noise burst (for impacts, whooshes)
  private playNoise(duration: number, vol: number = 0.3, delay: number = 0) {
    if (!this.enabled) return;
    const ctx = this.getCtx();
    if (!ctx) return;

    setTimeout(() => {
      try {
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // decaying noise
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2000, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + duration);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        gain.gain.setValueAtTime(vol * this.volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

        source.start();
        source.stop(ctx.currentTime + duration);
      } catch {}
    }, delay);
  }

  // Filtered sweep (for transitions)
  private playSweep(
    startFreq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType = 'sawtooth',
    vol: number = 0.2,
    delay: number = 0
  ) {
    if (!this.enabled) return;
    const ctx = this.getCtx();
    if (!ctx) return;

    setTimeout(() => {
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.type = type;
        osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + duration);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(3000, ctx.currentTime);
        filter.Q.setValueAtTime(5, ctx.currentTime);

        const v = vol * this.volume;
        gain.gain.setValueAtTime(v, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch {}
    }, delay);
  }

  // ─── Ambient System ──────────────────────────────────────

  stopAmbient() {
    this.ambientActive = false;
    this.ambientOscillators.forEach(osc => {
      try { osc.stop(); } catch {}
    });
    this.ambientGains.forEach(g => {
      try { g.gain.setValueAtTime(0, this.audioContext?.currentTime || 0); } catch {}
    });
    this.ambientLFOs.forEach(lfo => {
      try { lfo.stop(); } catch {}
    });
    this.ambientOscillators = [];
    this.ambientGains = [];
    this.ambientLFOs = [];
  }

  private ambientLFOs: OscillatorNode[] = [];

  private startAmbientDrone(freqs: number[], type: OscillatorType = 'sine', vol: number = 0.06) {
    if (!this.enabled) return;
    const ctx = this.getCtx();
    if (!ctx) return;

    this.stopAmbient();
    this.ambientActive = true;

    freqs.forEach((freq, i) => {
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, ctx.currentTime);
        filter.Q.setValueAtTime(1, ctx.currentTime);

        const v = vol * this.volume;
        // Fade in
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(v, ctx.currentTime + 1.5);

        // LFO for volume swell (breathing effect) — each voice slightly different rate
        const lfoGain = ctx.createOscillator();
        const lfoGainAmount = ctx.createGain();
        lfoGain.type = 'sine';
        lfoGain.frequency.setValueAtTime(0.15 + i * 0.05, ctx.currentTime); // 0.15-0.25 Hz = slow breathing
        lfoGainAmount.gain.setValueAtTime(v * 0.6, ctx.currentTime); // modulate 60% of volume
        lfoGain.connect(lfoGainAmount);
        lfoGainAmount.connect(gain.gain);
        lfoGain.start();
        this.ambientLFOs.push(lfoGain);

        // LFO for pitch wobble — subtle detuning that drifts
        const lfoPitch = ctx.createOscillator();
        const lfoPitchAmount = ctx.createGain();
        lfoPitch.type = 'sine';
        lfoPitch.frequency.setValueAtTime(0.08 + i * 0.03, ctx.currentTime); // very slow drift
        lfoPitchAmount.gain.setValueAtTime(15 + i * 5, ctx.currentTime); // ±15-25 cents detune
        lfoPitch.connect(lfoPitchAmount);
        lfoPitchAmount.connect(osc.detune);
        lfoPitch.start();
        this.ambientLFOs.push(lfoPitch);

        osc.start();
        this.ambientOscillators.push(osc);
        this.ambientGains.push(gain);
      } catch {}
    });
  }

  // ─── Phase-Specific Ambient ──────────────────────────────

  setPhaseAmbient(phase: string) {
    if (this.currentPhase === phase) return;
    this.currentPhase = phase;

    switch (phase) {
      case 'murder':
        // Dark, tense drone — low frequencies, minor feel
        this.startAmbientDrone([55, 82.5, 110], 'sine', 0.07);
        break;
      case 'discussion':
        // Neutral, slightly tense — mid frequencies (very subtle)
        this.startAmbientDrone([130.8, 164.8, 196], 'sine', 0.02);
        break;
      case 'voting':
        // Suspenseful — minor 2nd dissonance + tritone, slow pulsing
        this.startAmbientDrone([110, 116.5, 155.6], 'sine', 0.025);
        break;
      case 'reveal':
        // Dramatic silence before reveal — just a sub bass
        this.startAmbientDrone([40, 60], 'sine', 0.08);
        break;
      default:
        this.stopAmbient();
    }
  }

  // ─── Game Event Sounds ───────────────────────────────────

  // Phase change — unique sound per phase
  phaseChange(phase?: string) {
    if (phase) this.setPhaseAmbient(phase);

    switch (phase) {
      case 'murder':
        // Ominous descending hit + noise whoosh
        this.playTone(200, 0.6, 'sawtooth', 0.4);
        this.playTone(100, 0.8, 'sine', 0.3, -10);
        this.playNoise(0.5, 0.25);
        this.playSweep(400, 80, 0.8, 'sawtooth', 0.15);
        break;

      case 'discussion':
        // Bright rising chime — "time to talk"
        this.playNote(523, 0.15, 0, 'sine', 0.4);
        this.playNote(659, 0.15, 100, 'sine', 0.35);
        this.playNote(784, 0.2, 200, 'sine', 0.3);
        this.playNote(1047, 0.3, 300, 'sine', 0.25);
        break;

      case 'voting':
        // Gavel slam — impact + ring
        this.playTone(150, 0.1, 'square', 0.5);
        this.playNoise(0.15, 0.4);
        this.playNote(300, 0.4, 80, 'sine', 0.3);
        this.playNote(600, 0.3, 80, 'sine', 0.15);
        // Second lighter tap
        this.playNote(180, 0.08, 250, 'square', 0.3);
        this.playNoise(0.1, 0.2, 250);
        break;

      case 'reveal':
        // Dramatic drum roll → silence
        for (let i = 0; i < 8; i++) {
          const t = i * 60;
          const v = 0.15 + (i * 0.03);
          this.playNote(100 + i * 5, 0.08, t, 'square', v);
          this.playNoise(0.06, v * 0.5, t);
        }
        // Final hit
        this.playNote(80, 0.5, 500, 'sine', 0.4);
        this.playNoise(0.3, 0.3, 500);
        break;

      default:
        // Generic phase change (starting, etc.)
        this.playNote(523, 0.1, 0, 'sine', 0.3);
        this.playNote(659, 0.1, 100, 'sine', 0.25);
        this.playNote(784, 0.2, 200, 'sine', 0.2);
    }
  }

  // Murder victim revealed — sinister stinger
  murder() {
    // Deep impact
    this.playTone(60, 1.0, 'sine', 0.5);
    this.playTone(80, 0.8, 'sawtooth', 0.2);
    this.playNoise(0.4, 0.35);
    // Eerie high tone
    this.playNote(1500, 0.6, 200, 'sine', 0.08);
    this.playNote(1480, 0.6, 200, 'sine', 0.08); // slight detuned for dissonance
    // Descending slide
    this.playSweep(300, 60, 1.0, 'sawtooth', 0.1, 100);
  }

  // Vote cast — satisfying click + rising pitch based on accumulation
  private voteCount: number = 0;
  voteCast() {
    this.voteCount++;
    const pitch = 400 + (this.voteCount * 30); // rises with each vote
    
    // Click
    this.playNoise(0.03, 0.3);
    // Tone that rises per vote
    this.playTone(Math.min(pitch, 900), 0.12, 'sine', 0.3);
    // Subtle harmonic
    this.playNote(pitch * 1.5, 0.08, 20, 'sine', 0.1);
  }

  // Reset vote pitch (call at start of voting phase)
  resetVoteCount() {
    this.voteCount = 0;
  }

  // All votes in — dramatic swell
  allVotesIn() {
    this.playSweep(200, 800, 1.2, 'sawtooth', 0.15);
    this.playNote(523, 0.3, 400, 'sine', 0.3);
    this.playNote(659, 0.3, 550, 'sine', 0.25);
    this.playNote(784, 0.4, 700, 'sine', 0.2);
  }

  // Banishment / elimination — dramatic reveal
  elimination() {
    // Impact
    this.playTone(100, 0.15, 'square', 0.5);
    this.playNoise(0.2, 0.4);
    // Descending doom
    this.playSweep(500, 100, 0.6, 'sawtooth', 0.2, 100);
    // Low rumble
    this.playNote(55, 0.8, 150, 'sine', 0.35);
    // Dramatic chord
    this.playNote(220, 0.5, 300, 'sine', 0.2);
    this.playNote(261, 0.5, 300, 'sine', 0.15);
    this.playNote(330, 0.5, 300, 'sine', 0.1);
  }

  // Traitor revealed! (banished agent was traitor) — triumphant sting
  traitorCaught() {
    // Impact
    this.playNoise(0.15, 0.3);
    this.playTone(200, 0.1, 'square', 0.4);
    // Triumphant rising chord
    this.playNote(523, 0.2, 100, 'sine', 0.3);
    this.playNote(659, 0.2, 200, 'sine', 0.3);
    this.playNote(784, 0.3, 300, 'sine', 0.3);
    this.playNote(1047, 0.5, 400, 'sine', 0.35);
    // Shimmering high
    this.playNote(2093, 0.4, 500, 'sine', 0.08);
    this.playNote(2100, 0.4, 500, 'sine', 0.08);
  }

  // Innocent banished — tragic sound
  innocentLost() {
    // Soft impact
    this.playNoise(0.1, 0.2);
    // Sad descending minor
    this.playNote(440, 0.25, 0, 'sine', 0.3);
    this.playNote(415, 0.25, 200, 'sine', 0.25); // Ab
    this.playNote(349, 0.25, 400, 'sine', 0.2);  // F
    this.playNote(330, 0.5, 600, 'sine', 0.15);   // E
  }

  // Game start fanfare
  gameStart() {
    // Drum hits
    this.playNoise(0.08, 0.3, 0);
    this.playNoise(0.08, 0.3, 200);
    this.playNoise(0.08, 0.4, 400);
    // Fanfare
    this.playNote(392, 0.15, 0, 'sine', 0.3);
    this.playNote(523, 0.15, 200, 'sine', 0.3);
    this.playNote(659, 0.15, 400, 'sine', 0.3);
    this.playNote(784, 0.4, 600, 'sine', 0.35);
    // Harmonic shimmer
    this.playNote(1568, 0.3, 600, 'sine', 0.08);
  }

  // Innocents win — big celebration
  victory() {
    // Triumphant fanfare
    this.playNote(523, 0.15, 0, 'sine', 0.35);
    this.playNote(659, 0.15, 120, 'sine', 0.35);
    this.playNote(784, 0.15, 240, 'sine', 0.35);
    this.playNote(1047, 0.5, 360, 'sine', 0.4);
    // Harmony
    this.playNote(659, 0.5, 360, 'sine', 0.2);
    this.playNote(784, 0.5, 360, 'sine', 0.15);
    // Shimmering top
    this.playNote(2093, 0.3, 500, 'sine', 0.06);
    this.playNote(2637, 0.3, 550, 'sine', 0.04);
    // Swoosh
    this.playSweep(200, 2000, 0.6, 'sawtooth', 0.06, 300);
    this.stopAmbient();
  }

  // Traitors win — dark victory
  defeat() {
    // Dark stinger
    this.playNote(220, 0.3, 0, 'sawtooth', 0.2);
    this.playNote(207, 0.3, 0, 'sawtooth', 0.15); // dissonant
    this.playNote(165, 0.4, 250, 'sawtooth', 0.2);
    this.playNote(110, 0.6, 500, 'sine', 0.3);
    this.playNoise(0.6, 0.15, 200);
    // Sub bass rumble
    this.playNote(40, 1.5, 400, 'sine', 0.35);
    this.playSweep(500, 50, 1.5, 'sawtooth', 0.08, 200);
    this.stopAmbient();
  }

  // Chat message — soft pop
  chatMessage() {
    this.playTone(1100, 0.04, 'sine', 0.15);
    this.playTone(1400, 0.03, 'sine', 0.08);
  }

  // Countdown beep (10-4 seconds)
  countdownBeep() {
    this.playTone(800, 0.08, 'sine', 0.25);
  }

  // Urgent countdown (last 3 seconds)
  countdownUrgent() {
    this.playTone(1000, 0.12, 'square', 0.3);
    this.playTone(1000, 0.06, 'square', 0.15);
  }

  // Achievement unlocked
  achievement() {
    this.playNote(784, 0.1, 0, 'sine', 0.3);
    this.playNote(988, 0.1, 100, 'sine', 0.3);
    this.playNote(1175, 0.1, 200, 'sine', 0.3);
    this.playNote(1568, 0.4, 300, 'sine', 0.35);
    // Sparkle
    this.playNote(3136, 0.2, 400, 'sine', 0.05);
    this.playNote(3520, 0.2, 450, 'sine', 0.04);
  }

  // No banishment (tie vote) — anticlimactic
  noBanishment() {
    this.playNote(400, 0.2, 0, 'sine', 0.25);
    this.playNote(380, 0.2, 150, 'sine', 0.2);
    this.playNote(350, 0.3, 300, 'triangle', 0.15);
  }

  // Suspense/tension — low rumble
  suspense() {
    this.playTone(55, 2.0, 'sine', 0.2);
    this.playTone(82, 2.0, 'sine', 0.1);
  }

  // Disconnect sound
  disconnect() {
    this.playSweep(800, 200, 0.4, 'square', 0.15);
    this.playNoise(0.2, 0.15, 100);
  }
}

export const soundManager = new SoundManager();
