import GameBoyAdvance from './engine/gba.js';
import { GBACheats } from './cheats.js';
import { saveStateManager } from './save-state-manager.js';
import { downloadFile } from './download-helper.js';

export class GBA {
  constructor(canvas) {
    this.canvas = canvas;
    this.core = new GameBoyAdvance();

    if (canvas) {
      this.core.setCanvasDirect(canvas);
    }

    // Subsystem bridges for Cheats & Memory Scanner
    this.cheats = new GBACheats(this);
    this.mmu = this.createMmuBridge();

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

    // Freeze list for memory scanner
    this.freezeList = [];

    this.rafId = null;
    this.lastFrameTime = performance.now();
    this.accumulator = 0;

    // Load BIOS stub if available
    this.loadBios();
  }

  async loadBios() {
    try {
      const resp = await fetch('/bios.bin');
      if (resp.ok) {
        const biosBuf = await resp.arrayBuffer();
        this.biosBuffer = biosBuf;
        this.core.setBios(biosBuf);
      }
    } catch (e) {
      console.warn('Using built-in BIOS emulator');
    }
  }

  createMmuBridge() {
    const core = this.core;
    return {
      get rom() { 
        if (core.rom && core.rom.memory) {
          return new Uint8Array(core.rom.memory.buffer || core.rom.memory);
        }
        return new Uint8Array(0);
      },
      get romSize() { 
        if (core.rom && core.rom.memory) {
          return core.rom.memory.byteLength || (core.rom.memory.buffer ? core.rom.memory.buffer.byteLength : 0);
        }
        return 0;
      },
      get ewram() {
        return core.mmu.memory[core.mmu.REGION_WORKING_RAM] 
          ? new Uint8Array(core.mmu.memory[core.mmu.REGION_WORKING_RAM].buffer) 
          : new Uint8Array(0x40000);
      },
      get iwram() {
        return core.mmu.memory[core.mmu.REGION_WORKING_IRAM]
          ? new Uint8Array(core.mmu.memory[core.mmu.REGION_WORKING_IRAM].buffer)
          : new Uint8Array(0x8000);
      },
      read8(addr) { return core.mmu.load8(addr); },
      read16(addr) { return core.mmu.load16(addr); },
      read32(addr) { return core.mmu.load32(addr); },
      write8(addr, val) { core.mmu.store8(addr, val); },
      write16(addr, val) { core.mmu.store16(addr, val); },
      write32(addr, val) { core.mmu.store32(addr, val); },
      get saveData() {
        if (core.mmu.save) {
          return new Uint8Array(core.mmu.save.buffer);
        }
        return new Uint8Array(0);
      }
    };
  }

  get apu() {
    const core = this.core;
    return {
      setVolume(v) {
        if (core.audio) core.audio.masterVolume = Math.max(0, Math.min(1, v));
      }
    };
  }

  loadRom(arrayBuffer, fileName = 'game.gba') {
    this.romName = fileName;
    
    // Convert ArrayBuffer to Uint8Array/Buffer for gbajs
    const success = this.core.setRom(arrayBuffer);
    if (!success) {
      console.error('Failed to load ROM in gbajs');
      return false;
    }

    // Re-apply BIOS after setRom->reset->clear reinitializes memory
    if (this.biosBuffer) {
      this.core.setBios(this.biosBuffer);
    }

    this.romTitle = (this.core.rom && this.core.rom.title) ? this.core.rom.title.trim() : this.romName.replace(/\.[^/.]+$/, '');
    this.romLoaded = true;

    this.cheats.loadFromStorage();
    this.loadFreezeList();
    this.start();
    return true;
  }

  getRomTitle() {
    return this.romTitle || this.romName.replace(/\.[^/.]+$/, '');
  }

  reset() {
    this.core.reset();
  }

  start() {
    if (!this.romLoaded) return;
    this.running = true;
    this.paused = false;
    this.lastFrameTime = performance.now();
    this.accumulator = 0;
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
      this.accumulator = 0;
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

    const targetSpeed = this.fastForward ? this.speedMultiplier : this.speed;
    const frameInterval = 1000 / 59.7275;
    const dt = Math.min(now - (this.lastFrameTime || now), 100);
    this.lastFrameTime = now;

    // Accumulator-based pacing: works correctly for all speeds and refresh rates
    this.accumulator += dt * targetSpeed;

    // Cap accumulator to prevent spiral of death (max ~5 frames behind)
    const maxAccumulator = frameInterval * 5;
    if (this.accumulator > maxAccumulator) {
      this.accumulator = maxAccumulator;
    }

    let framesRun = 0;
    const maxFramesPerTick = Math.max(2, Math.ceil(targetSpeed) + 1);

    while (this.accumulator >= frameInterval - 1.5 && framesRun < maxFramesPerTick) {
      // Intelligent Adaptive Frame-skip:
      // When lagging behind (accumulator >= frameInterval * 2) or running at high speed (>= 2x),
      // skip expensive Canvas putImageData and software scanline compositing on intermediate catch-up frames.
      // This prevents the "spiral of death" and maintains smooth 60 FPS pacing even on low-spec phones!
      const isCatchingUp = (this.accumulator >= frameInterval * 2) && (framesRun < maxFramesPerTick - 1);
      const shouldSkipDraw = (targetSpeed >= 2 && this.accumulator >= frameInterval * 2) || isCatchingUp;

      if (this.core && this.core.video) {
        this.core.video.skipDraw = shouldSkipDraw;
      }

      this.runFrame();
      this.accumulator -= frameInterval;
      this.framesCount++;
      framesRun++;
    }

    if (this.core && this.core.video) {
      this.core.video.skipDraw = false;
    }

    // Prevent negative drift
    if (this.accumulator < -frameInterval) {
      this.accumulator = 0;
    }

    // Update FPS counter every second
    if (now - this.lastFpsTime >= 1000) {
      this.fps = Math.round((this.framesCount * 1000) / (now - this.lastFpsTime));
      this.framesCount = 0;
      this.lastFpsTime = now;
      if (this.onFpsUpdate) this.onFpsUpdate(this.fps);
    }

    this.scheduleNextFrame();
  }

  runFrame() {
    // Apply Cheats every frame
    this.cheats.applyCheats();

    // Apply Freeze list every frame
    this.applyFreezes();

    // Advance 1 full frame with audio & video rendering
    this.core.advanceFrame();
  }

  // Key Input management
  setKeyDown(keyBit) {
    if (this.core && this.core.keypad) {
      this.core.keypad.keydown(keyBit);
    }
  }

  setKeyUp(keyBit) {
    if (this.core && this.core.keypad) {
      this.core.keypad.keyup(keyBit);
    }
  }

  // Freeze List (Memory Scanner)
  applyFreezes() {
    if (!this.freezeList || this.freezeList.length === 0) return;
    const mmu = this.mmu;
    if (!mmu) return;
    for (const f of this.freezeList) {
      if (f.dataType === 'u8') mmu.write8(f.address, f.value & 0xFF);
      else if (f.dataType === 'u16') mmu.write16(f.address, f.value & 0xFFFF);
      else if (f.dataType === 'u32') mmu.write32(f.address, f.value >>> 0);
    }
  }

  addFreeze(address, value, dataType) {
    this.freezeList = this.freezeList.filter(f => f.address !== address);
    this.freezeList.push({ address, value, dataType });
    this.saveFreezeList();
  }

  removeFreeze(address) {
    this.freezeList = this.freezeList.filter(f => f.address !== address);
    this.saveFreezeList();
  }

  saveFreezeList() {
    try {
      const key = 'myboy_freezes_' + (this.romTitle || 'default');
      localStorage.setItem(key, JSON.stringify(this.freezeList));
    } catch (e) {}
  }

  loadFreezeList() {
    try {
      const key = 'myboy_freezes_' + (this.romTitle || 'default');
      const data = localStorage.getItem(key);
      this.freezeList = data ? JSON.parse(data) : [];
    } catch (e) {
      this.freezeList = [];
    }
  }

  // Save State / Load State
  async saveState(slot = 1) {
    if (!this.romLoaded) return null;

    try {
      const stateData = this.core.mmu.save ? new Uint8Array(this.core.mmu.save.buffer) : new Uint8Array(0);
      const screenshot = this.canvas ? this.canvas.toDataURL('image/jpeg', 0.8) : null;
      return await saveStateManager.saveState(this.romTitle, slot, stateData, screenshot);
    } catch (e) {
      console.warn('Error saving state:', e);
      return null;
    }
  }

  async loadState(slot = 1) {
    if (!this.romLoaded) return false;

    try {
      const loaded = await saveStateManager.loadState(this.romTitle, slot);
      if (!loaded || !loaded.state) return false;

      if (this.core.mmu.save) {
        const u8 = loaded.state;
        const target = new Uint8Array(this.core.mmu.save.buffer);
        target.set(u8.subarray(0, target.length));
      }
      return true;
    } catch (e) {
      console.error('Error loading state:', e);
      return false;
    }
  }

  getStateInfo(slot = 1) {
    return saveStateManager.getStateInfo(this.romTitle, slot);
  }

  // Export Battery Save (.sav)
  exportSavFile() {
    if (!this.romLoaded || !this.core.mmu.save) {
      if (window.showAppToast) window.showAppToast('⚠️ Game chưa có dữ liệu lưu!');
      return false;
    }
    const buf = new Uint8Array(this.core.mmu.save.buffer);
    const fileName = `${this.romTitle || 'game'}.sav`;
    const ok = downloadFile(fileName, buf);
    if (ok && window.showAppToast) {
      window.showAppToast(`📤 Đã xuất file ${fileName} thành công!`);
    }
    return ok;
  }

  importSavFile(arrayBuffer) {
    if (!this.core.mmu.save) return;
    const data = new Uint8Array(arrayBuffer);
    const target = new Uint8Array(this.core.mmu.save.buffer);
    const len = Math.min(data.length, target.length);
    target.set(data.subarray(0, len));
  }
}
