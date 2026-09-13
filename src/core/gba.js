import { SCREEN, KEYS } from './gba-constants.js';
import { ARM7TDMI } from './arm7tdmi.js';
import { GBAMMU } from './mmu.js';
import { GBAPPU } from './ppu.js';
import { GBAAPU } from './apu.js';
import { GBADMA } from './dma.js';
import { GBATimers } from './timers.js';
import { GBAInterrupts } from './interrupts.js';
import { GBABios } from './bios.js';
import { GBACheats } from './cheats.js';

export class GBA {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
    this.imageData = this.ctx ? this.ctx.createImageData(SCREEN.WIDTH, SCREEN.HEIGHT) : null;

    // Subsystems
    this.interrupts = new GBAInterrupts(this);
    this.mmu = new GBAMMU(this);
    this.cpu = new ARM7TDMI(this);
    this.ppu = new GBAPPU(this);
    this.apu = new GBAAPU(this);
    this.dma = new GBADMA(this);
    this.timers = new GBATimers(this);
    this.bios = new GBABios(this);
    this.cheats = new GBACheats(this);

    // Run state
    this.running = false;
    this.paused = false;
    this.romLoaded = false;
    this.romName = 'No ROM Loaded';
    this.romTitle = '';

    // Speed / Fast Forward
    this.speed = 1.0;
    this.fastForward = false;
    this.speedMultiplier = 2.0;

    // Performance / FPS
    this.fps = 0;
    this.framesCount = 0;
    this.lastFpsTime = performance.now();
    this.onFpsUpdate = null;

    // Rewind buffer (last 300 frames ~ 5 seconds)
    this.rewindHistory = [];
    this.maxRewindFrames = 300;

    this.rafId = null;
    this.lastFrameTime = performance.now();

    // Callbacks
    this.onFrameCallback = null;
  }

  loadRom(arrayBuffer, fileName = 'game.gba') {
    this.romName = fileName;
    this.mmu.loadRom(arrayBuffer);
    this.romTitle = this.extractRomTitle();
    this.romLoaded = true;

    this.cheats.loadFromStorage();
    this.reset();
    this.start();
  }

  extractRomTitle() {
    if (this.mmu.rom.length >= 0xB0) {
      let title = '';
      for (let i = 0xA0; i < 0xAC; i++) {
        const charCode = this.mmu.rom[i];
        if (charCode >= 32 && charCode <= 126) {
          title += String.fromCharCode(charCode);
        }
      }
      return title.trim() || this.romName.replace(/\.[^/.]+$/, '');
    }
    return this.romName.replace(/\.[^/.]+$/, '');
  }

  getRomTitle() {
    return this.romTitle;
  }

  reset() {
    this.interrupts.reset();
    this.mmu.reset();
    this.cpu.reset();
    this.ppu.reset();
    this.apu.reset();
    this.dma.reset();
    this.timers.reset();
    this.rewindHistory = [];
  }

  start() {
    if (!this.romLoaded) return;
    this.running = true;
    this.paused = false;
    this.apu.initAudioContext();
    this.lastFrameTime = performance.now();
    this.scheduleNextFrame();
  }

  pause() {
    this.paused = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resume() {
    if (this.romLoaded && this.paused) {
      this.paused = false;
      this.lastFrameTime = performance.now();
      this.scheduleNextFrame();
    }
  }

  scheduleNextFrame() {
    if (!this.running || this.paused) return;

    this.rafId = requestAnimationFrame((now) => {
      this.loop(now);
    });
  }

  loop(now) {
    if (!this.running || this.paused) return;

    const targetFps = SCREEN.REFRESH_RATE * (this.fastForward ? this.speedMultiplier : this.speed);
    const frameInterval = 1000 / targetFps;
    const elapsed = now - this.lastFrameTime;

    if (elapsed >= frameInterval * 0.9 || this.fastForward) {
      this.lastFrameTime = now;
      this.runFrame();
      this.framesCount++;

      // Update FPS counter every second
      if (now - this.lastFpsTime >= 1000) {
        this.fps = Math.round((this.framesCount * 1000) / (now - this.lastFpsTime));
        this.framesCount = 0;
        this.lastFpsTime = now;
        if (this.onFpsUpdate) this.onFpsUpdate(this.fps);
      }
    }

    this.scheduleNextFrame();
  }

  runFrame() {
    // 280,896 CPU cycles per frame
    let cyclesRemaining = SCREEN.CYCLES_PER_FRAME;

    // Apply Cheats every frame
    this.cheats.applyCheats();

    while (cyclesRemaining > 0) {
      const stepCycles = this.cpu.step();
      cyclesRemaining -= stepCycles;

      this.ppu.step(stepCycles);
      this.timers.step(stepCycles);
      this.apu.step(stepCycles);
    }
  }

  onFrameComplete(framebuffer) {
    if (this.ctx && this.imageData) {
      // Put 32-bit pixel data directly into Canvas ImageData
      const data32 = new Uint32Array(this.imageData.data.buffer);
      data32.set(framebuffer);
      this.ctx.putImageData(this.imageData, 0, 0);
    }

    if (this.onFrameCallback) {
      this.onFrameCallback(framebuffer);
    }
  }

  // Key Input management
  setKeyDown(keyBit) {
    this.mmu.keyState &= ~(1 << keyBit);
  }

  setKeyUp(keyBit) {
    this.mmu.keyState |= (1 << keyBit);
  }

  // Save State
  saveState(slot = 1) {
    if (!this.romLoaded) return null;

    const stateObj = {
      version: 1,
      romTitle: this.romTitle,
      timestamp: Date.now(),
      cpsr: this.cpu.cpsr,
      gpr: Array.from(this.cpu.gpr),
      r13_bank: Array.from(this.cpu.r13_bank),
      r14_bank: Array.from(this.cpu.r14_bank),
      spsr_bank: Array.from(this.cpu.spsr_bank),
      ewram: Array.from(this.mmu.ewram),
      iwram: Array.from(this.mmu.iwram),
      io: Array.from(this.mmu.io),
      palette: Array.from(this.mmu.palette),
      vram: Array.from(this.mmu.vram),
      oam: Array.from(this.mmu.oam),
      saveData: Array.from(this.mmu.saveData),
      saveType: this.mmu.saveType,
      screenshot: this.canvas ? this.canvas.toDataURL('image/jpeg', 0.8) : null
    };

    try {
      localStorage.setItem(`myboy_savestate_${this.romTitle}_slot${slot}`, JSON.stringify(stateObj));
    } catch (e) {
      console.warn('LocalStorage full, state only kept in memory');
    }

    return stateObj;
  }

  loadState(slot = 1) {
    if (!this.romLoaded) return false;

    try {
      const json = localStorage.getItem(`myboy_savestate_${this.romTitle}_slot${slot}`);
      if (!json) return false;

      const stateObj = JSON.parse(json);
      this.cpu.cpsr = stateObj.cpsr;
      this.cpu.gpr.set(stateObj.gpr);
      this.cpu.r13_bank.set(stateObj.r13_bank);
      this.cpu.r14_bank.set(stateObj.r14_bank);
      this.cpu.spsr_bank.set(stateObj.spsr_bank);
      this.mmu.ewram.set(stateObj.ewram);
      this.mmu.iwram.set(stateObj.iwram);
      this.mmu.io.set(stateObj.io);
      this.mmu.palette.set(stateObj.palette);
      this.mmu.vram.set(stateObj.vram);
      this.mmu.oam.set(stateObj.oam);
      this.mmu.saveData.set(stateObj.saveData);
      return true;
    } catch (e) {
      console.error('Error loading state:', e);
      return false;
    }
  }

  getStateInfo(slot = 1) {
    try {
      const json = localStorage.getItem(`myboy_savestate_${this.romTitle}_slot${slot}`);
      if (!json) return null;
      const data = JSON.parse(json);
      return {
        timestamp: data.timestamp,
        screenshot: data.screenshot
      };
    } catch (e) {
      return null;
    }
  }

  // Export Battery Save (.sav)
  exportSavFile() {
    if (!this.romLoaded) return;
    const blob = new Blob([this.mmu.saveData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.romTitle || 'game'}.sav`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importSavFile(arrayBuffer) {
    const data = new Uint8Array(arrayBuffer);
    const len = Math.min(data.length, this.mmu.saveData.length);
    this.mmu.saveData.set(data.subarray(0, len));
    this.mmu.saveDirty = true;
  }
}
