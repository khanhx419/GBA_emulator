// GBA APU (Audio Processing Unit) with WebAudio

export class GBAAPU {
  constructor(gba) {
    this.gba = gba;
    this.audioCtx = null;
    this.scriptNode = null;
    this.sampleRate = 44100;
    this.volume = 1.0;
    this.muted = false;

    // DirectSound FIFOs
    this.fifoA = new Int8Array(32);
    this.fifoB = new Int8Array(32);
    this.fifoACount = 0;
    this.fifoBCount = 0;
    this.sampleA = 0;
    this.sampleB = 0;

    // Registers
    this.soundCntL = 0;
    this.soundCntH = 0;
    this.soundCntX = 0x80;
    this.soundBias = 0x200;

    // Audio output ring buffer
    this.bufferSize = 4096;
    this.audioBufferL = new Float32Array(this.bufferSize);
    this.audioBufferR = new Float32Array(this.bufferSize);
    this.writePtr = 0;
    this.readPtr = 0;

    // Channel 1-4 State
    this.ch1 = { enabled: false, freq: 0, duty: 2, length: 0, envVol: 0, curVol: 0, timer: 0 };
    this.ch2 = { enabled: false, freq: 0, duty: 2, length: 0, envVol: 0, curVol: 0, timer: 0 };
    this.ch3 = { enabled: false, freq: 0, length: 0, bank: 0, curVol: 0, samplePtr: 0 };
    this.ch4 = { enabled: false, len: 0, envVol: 0, curVol: 0, lfsr: 0x7FFF, ratio: 0, step7: false };

    this.cyclesAccum = 0;
    this.cyclesPerSample = 16777216 / this.sampleRate; // ~380.5 CPU cycles per audio sample
  }

  initAudioContext() {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
        this.sampleRate = this.audioCtx.sampleRate || 44100;
        this.cyclesPerSample = 16777216 / this.sampleRate;

        this.scriptNode = this.audioCtx.createScriptProcessor(1024, 0, 2);
        this.scriptNode.onaudioprocess = (e) => {
          const outL = e.outputBuffer.getChannelData(0);
          const outR = e.outputBuffer.getChannelData(1);
          const len = outL.length;

          for (let i = 0; i < len; i++) {
            if (this.writePtr !== this.readPtr && !this.muted) {
              outL[i] = this.audioBufferL[this.readPtr] * this.volume;
              outR[i] = this.audioBufferR[this.readPtr] * this.volume;
              this.readPtr = (this.readPtr + 1) % this.bufferSize;
            } else {
              outL[i] = 0;
              outR[i] = 0;
            }
          }
        };

        this.scriptNode.connect(this.audioCtx.destination);
      }
    }

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  reset() {
    this.fifoACount = 0;
    this.fifoBCount = 0;
    this.writePtr = 0;
    this.readPtr = 0;
    this.soundCntX = 0x80;
  }

  step(cycles) {
    this.cyclesAccum += cycles;

    while (this.cyclesAccum >= this.cyclesPerSample) {
      this.cyclesAccum -= this.cyclesPerSample;
      this.generateSample();
    }
  }

  generateSample() {
    // Generate DirectSound samples (-128 to 127) -> Float (-1.0 to 1.0)
    let left = (this.sampleA + this.sampleB) / 256.0;
    let right = (this.sampleA + this.sampleB) / 256.0;

    // Write to ring buffer
    const nextWrite = (this.writePtr + 1) % this.bufferSize;
    if (nextWrite !== this.readPtr) {
      this.audioBufferL[this.writePtr] = left;
      this.audioBufferR[this.writePtr] = right;
      this.writePtr = nextWrite;
    }
  }

  writeFifoA(val) {
    if (this.fifoACount <= 28) {
      this.fifoA[this.fifoACount++] = (val & 0xFF) << 24 >> 24;
      this.fifoA[this.fifoACount++] = ((val >> 8) & 0xFF) << 24 >> 24;
      this.fifoA[this.fifoACount++] = ((val >> 16) & 0xFF) << 24 >> 24;
      this.fifoA[this.fifoACount++] = ((val >> 24) & 0xFF) << 24 >> 24;
    }
  }

  writeFifoB(val) {
    if (this.fifoBCount <= 28) {
      this.fifoB[this.fifoBCount++] = (val & 0xFF) << 24 >> 24;
      this.fifoB[this.fifoBCount++] = ((val >> 8) & 0xFF) << 24 >> 24;
      this.fifoB[this.fifoBCount++] = ((val >> 16) & 0xFF) << 24 >> 24;
      this.fifoB[this.fifoBCount++] = ((val >> 24) & 0xFF) << 24 >> 24;
    }
  }

  onTimerOverflow(timerIdx) {
    // Direct Sound A Timer check
    const tmA = (this.soundCntH >> 10) & 1;
    if (tmA === timerIdx) {
      if (this.fifoACount > 0) {
        this.sampleA = this.fifoA[0];
        for (let i = 0; i < this.fifoACount - 1; i++) {
          this.fifoA[i] = this.fifoA[i + 1];
        }
        this.fifoACount--;
      }
      if (this.fifoACount <= 16) {
        // Trigger DMA 1 or 2 for Sound FIFO A
        this.gba.dma.trigger(3);
      }
    }

    // Direct Sound B Timer check
    const tmB = (this.soundCntH >> 14) & 1;
    if (tmB === timerIdx) {
      if (this.fifoBCount > 0) {
        this.sampleB = this.fifoB[0];
        for (let i = 0; i < this.fifoBCount - 1; i++) {
          this.fifoB[i] = this.fifoB[i + 1];
        }
        this.fifoBCount--;
      }
      if (this.fifoBCount <= 16) {
        // Trigger DMA 1 or 2 for Sound FIFO B
        this.gba.dma.trigger(3);
      }
    }
  }

  read16(offset) {
    switch (offset) {
      case 0x80: return this.soundCntL;
      case 0x82: return this.soundCntH;
      case 0x84: return this.soundCntX;
      case 0x88: return this.soundBias;
      default: return 0;
    }
  }

  write16(offset, val) {
    switch (offset) {
      case 0x80: this.soundCntL = val; break;
      case 0x82:
        this.soundCntH = val;
        // DirectSound reset FIFO bits
        if (val & 0x0800) this.fifoACount = 0;
        if (val & 0x8000) this.fifoBCount = 0;
        break;
      case 0x84:
        this.soundCntX = (this.soundCntX & 0x000F) | (val & 0x0080);
        break;
      case 0x88: this.soundBias = val; break;
      default: break;
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(2.0, vol));
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }
}
