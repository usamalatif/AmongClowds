// Sound effects manager for AmongClowds

class SoundManager {
  private enabled: boolean = true;
  private volume: number = 0.8;
  private audioContext: AudioContext | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.enabled = localStorage.getItem('soundEnabled') !== 'false';
      this.volume = parseFloat(localStorage.getItem('soundVolume') || '0.5');
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    
    if (!this.audioContext) {
      try {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (e) {
        console.warn('Failed to create AudioContext:', e);
        return null;
      }
    }
    
    // Resume if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    
    return this.audioContext;
  }

  // Call this on first user interaction to unlock audio
  unlock() {
    const ctx = this.getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume();
    }
    // Play a short tone to unlock
    this.playTone(440, 0.1, 'sine', false);
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (typeof window !== 'undefined') {
      localStorage.setItem('soundEnabled', String(this.enabled));
    }
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

  // Generate tones using Web Audio API (no external files needed)
  private playTone(frequency: number, duration: number, type: OscillatorType = 'sine', decay: boolean = true) {
    if (!this.enabled || typeof window === 'undefined') return;

    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

      gainNode.gain.setValueAtTime(this.volume, ctx.currentTime);
      if (decay) {
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
      }

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + duration);
    } catch (e) {
      console.warn('Sound playback failed:', e);
    }
  }

  // Play a sequence of tones
  private playSequence(notes: Array<{ freq: number; dur: number; delay: number }>, type: OscillatorType = 'sine') {
    notes.forEach(note => {
      setTimeout(() => this.playTone(note.freq, note.dur, type), note.delay);
    });
  }

  // === Game Sounds ===

  // Dramatic elimination sound
  elimination() {
    this.playSequence([
      { freq: 400, dur: 0.15, delay: 0 },
      { freq: 300, dur: 0.15, delay: 100 },
      { freq: 200, dur: 0.4, delay: 200 },
    ], 'sawtooth');
  }

  // Murder sound (more sinister)
  murder() {
    this.playSequence([
      { freq: 150, dur: 0.3, delay: 0 },
      { freq: 100, dur: 0.5, delay: 200 },
    ], 'sawtooth');
  }

  // Voting countdown beep
  countdownBeep() {
    this.playTone(800, 0.1, 'square');
  }

  // Final countdown beep (last 3 seconds)
  countdownUrgent() {
    this.playTone(1000, 0.15, 'square');
  }

  // Phase change sound
  phaseChange() {
    this.playSequence([
      { freq: 523, dur: 0.1, delay: 0 },
      { freq: 659, dur: 0.1, delay: 100 },
      { freq: 784, dur: 0.2, delay: 200 },
    ], 'sine');
  }

  // Game start fanfare
  gameStart() {
    this.playSequence([
      { freq: 392, dur: 0.15, delay: 0 },
      { freq: 523, dur: 0.15, delay: 150 },
      { freq: 659, dur: 0.15, delay: 300 },
      { freq: 784, dur: 0.3, delay: 450 },
    ], 'sine');
  }

  // Victory sound
  victory() {
    this.playSequence([
      { freq: 523, dur: 0.15, delay: 0 },
      { freq: 659, dur: 0.15, delay: 150 },
      { freq: 784, dur: 0.15, delay: 300 },
      { freq: 1047, dur: 0.4, delay: 450 },
    ], 'sine');
  }

  // Defeat sound
  defeat() {
    this.playSequence([
      { freq: 400, dur: 0.2, delay: 0 },
      { freq: 350, dur: 0.2, delay: 200 },
      { freq: 300, dur: 0.2, delay: 400 },
      { freq: 200, dur: 0.5, delay: 600 },
    ], 'sawtooth');
  }

  // Vote cast sound
  voteCast() {
    this.playTone(600, 0.1, 'sine');
  }

  // Chat message sound
  chatMessage() {
    this.playTone(1200, 0.05, 'sine');
  }

  // Suspense/tension sound
  suspense() {
    this.playTone(150, 1.5, 'sine', true);
  }
}

// Singleton instance
export const soundManager = new SoundManager();
