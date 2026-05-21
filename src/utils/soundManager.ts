// Sound manager for alarm notifications
// Uses Web Audio API to generate simple beep sounds as fallback for missing MP3 files

class SoundManager {
  private audioContext: AudioContext | null = null;
  private soundCache: Map<string, AudioBuffer> = new Map();
  private isEnabled: boolean = true;

  constructor() {
    // Initialize audio context on first user interaction
    this.initializeAudioContext();
  }

  private initializeAudioContext() {
    if (typeof window === 'undefined') return;
    
    const initAudio = () => {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
    };

    // Initialize on first user interaction
    const events = ['click', 'touch', 'keydown'];
    const handler = () => {
      initAudio();
      events.forEach(event => document.removeEventListener(event, handler));
    };
    events.forEach(event => document.addEventListener(event, handler));
  }

  private async loadSound(url: string): Promise<AudioBuffer | null> {
    if (!this.audioContext) return null;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to load sound');
      
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.soundCache.set(url, audioBuffer);
      return audioBuffer;
    } catch (error) {
      console.warn(`[SoundManager] Failed to load sound: ${url}`, error);
      return null;
    }
  }

  private generateBeep(frequency: number, duration: number = 0.3): AudioBuffer | null {
    if (!this.audioContext) return null;

    const sampleRate = this.audioContext.sampleRate;
    const length = sampleRate * duration;
    const buffer = this.audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      // Simple sine wave with fade out
      const fadeOut = Math.max(0, 1 - (t / duration) * 2);
      data[i] = Math.sin(2 * Math.PI * frequency * t) * 0.3 * fadeOut;
    }

    return buffer;
  }

  private async playBuffer(buffer: AudioBuffer) {
    if (!this.audioContext || !buffer) return;

    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();
    
    source.buffer = buffer;
    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    
    // Set volume
    gainNode.gain.value = 0.5;
    
    source.start();
  }

  async playAlarmSound(type: 'high' | 'low' | 'normal') {
    if (!this.isEnabled) return;

    const soundUrls = {
      high: '/sounds/alarm-high.mp3',
      low: '/sounds/alarm-low.mp3',
      normal: '/sounds/alarm-normal.mp3'
    };

    const frequencies = {
      high: 800, // Higher pitch for high threshold
      low: 400,  // Lower pitch for low threshold  
      normal: 600 // Medium pitch for normal recovery
    };

    let buffer = this.soundCache.get(soundUrls[type]);
    
    if (!buffer) {
      // Try to load MP3 file first
      buffer = await this.loadSound(soundUrls[type]);
    }

    if (!buffer) {
      // Fallback to generated beep
      buffer = this.generateBeep(frequencies[type]);
    }

    if (buffer) {
      await this.playBuffer(buffer);
    }
  }

  setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    localStorage.setItem('hase-sound-enabled', enabled.toString());
  }

  isAudioEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('hase-sound-enabled');
    return stored !== 'false'; // Default to enabled
  }
}

export const soundManager = new SoundManager();
