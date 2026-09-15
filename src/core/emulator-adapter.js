import { GBA } from './gba.js';

/**
 * EmulatorAdapter — Dual-engine Bridge layer for GBA_K.
 * 
 * Primary: EmulatorJS WASM core (mGBA) — executes at 60 FPS near-native speed.
 * Fallback: Native JavaScript engine (GBA class) — active when offline, when
 *           WASM fails to load, or when explicitly chosen in Settings.
 * 
 * Exposes the exact same interface as GBA class so UI code in main.js
 * requires zero special branches.
 */

export class EmulatorAdapter {
  constructor(canvas) {
    this.canvas = canvas;
    this.ejsReady = false;
    this.ejsPlayer = null;
    this.useFallback = false;
    this.fallbackGba = null;

    // Check user preference in localStorage
    const pref = localStorage.getItem('gba_k_engine') || 'wasm';
    if (pref === 'js') {
      this._initFallbackDirect();
      return;
    }

    // State flags
    this._running = false;
    this._paused = false;
    this._romLoaded = false;
    this.romName = 'No ROM Loaded';
    this.romTitle = '';

    // Speed / Fast Forward
    this.speed = 1.0;
    this._fastForward = false;
    this._speedMultiplier = 2.0;

    // Performance / FPS
    this.fps = 0;
    this._onFpsUpdate = null;

    // Freeze list & Cheats (for WASM compatibility)
    this.freezeList = [];
    this._cheats = [];

    // Pending ROM queue
    this._pendingRom = null;
    this._pendingRomName = null;

    // Initialize EmulatorJS WASM
    this._initEmulatorJS();

    // Safety timeout: if WASM doesn't initialize in 4.5s (offline or CDN blocked), fallback to JS
    this._fallbackTimer = setTimeout(() => {
      if (!this.ejsReady && !this.useFallback) {
        console.warn('[GBA_K] EmulatorJS WASM timed out. Falling back to JavaScript engine.');
        this._triggerFallback();
      }
    }, 4500);
  }

  _initFallbackDirect() {
    console.log('[GBA_K] Using JavaScript Engine by user preference.');
    this.useFallback = true;
    this.fallbackGba = new GBA(this.canvas);
  }

  _triggerFallback() {
    if (this.useFallback || this.ejsReady) return;
    this.useFallback = true;
    this.fallbackGba = new GBA(this.canvas);
    if (this._onFpsUpdate) {
      this.fallbackGba.onFpsUpdate = this._onFpsUpdate;
    }
    if (this._fastForward) {
      this.fallbackGba.fastForward = this._fastForward;
    }
    this.fallbackGba.speedMultiplier = this._speedMultiplier;

    if (this._pendingRom) {
      const rom = this._pendingRom;
      const name = this._pendingRomName;
      this._pendingRom = null;
      this._pendingRomName = null;
      this.fallbackGba.loadRom(rom, name);
    }
  }

  // --- Properties with fallback forwarding ---

  get running() {
    return this.useFallback ? this.fallbackGba.running : this._running;
  }
  set running(v) {
    if (this.useFallback) this.fallbackGba.running = v;
    else this._running = v;
  }

  get paused() {
    return this.useFallback ? this.fallbackGba.paused : this._paused;
  }
  set paused(v) {
    if (this.useFallback) this.fallbackGba.paused = v;
    else this._paused = v;
  }

  get romLoaded() {
    return this.useFallback ? this.fallbackGba.romLoaded : this._romLoaded;
  }
  set romLoaded(v) {
    if (this.useFallback) this.fallbackGba.romLoaded = v;
    else this._romLoaded = v;
  }

  get speedMultiplier() {
    return this.useFallback ? this.fallbackGba.speedMultiplier : this._speedMultiplier;
  }
  set speedMultiplier(val) {
    this._speedMultiplier = val;
    if (this.useFallback) {
      this.fallbackGba.speedMultiplier = val;
    } else {
      this._applySpeed();
    }
  }

  get fastForward() {
    return this.useFallback ? this.fallbackGba.fastForward : this._fastForward;
  }
  set fastForward(val) {
    this._fastForward = val;
    if (this.useFallback) {
      this.fallbackGba.fastForward = val;
    } else {
      this._applySpeed();
    }
  }

  get onFpsUpdate() {
    return this.useFallback ? this.fallbackGba.onFpsUpdate : this._onFpsUpdate;
  }
  set onFpsUpdate(cb) {
    this._onFpsUpdate = cb;
    if (this.useFallback && this.fallbackGba) {
      this.fallbackGba.onFpsUpdate = cb;
    }
  }

  // --- EmulatorJS Init & Lifecycle ---

  _initEmulatorJS() {
    this._ejsContainer = document.createElement('div');
    this._ejsContainer.id = 'ejs-container';
    this._ejsContainer.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1;';
    document.body.appendChild(this._ejsContainer);

    window.EJS_player = '#ejs-container';
    window.EJS_core = 'gba';
    window.EJS_gameName = 'GBA_K';
    window.EJS_color = '#1a1a2e';
    window.EJS_startOnLoaded = false;
    window.EJS_threads = false; // Single thread mode for Android WebView
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
    window.EJS_DEBUG_XX = false;

    window.EJS_Buttons = {
      playPause: false, restart: false, mute: false, settings: false,
      fullscreen: false, saveState: false, loadState: false,
      screenRecord: false, gamepad: false, cheat: false, volume: false,
      saveSavFiles: false, loadSavFiles: false, quickSave: false, quickLoad: false,
      screenshot: false, cacheManager: false
    };
    window.EJS_VirtualGamepadSettings = { type: 'none' };

    const dummyRom = this._createMinimalGbaRom();
    const blob = new Blob([dummyRom], { type: 'application/octet-stream' });
    window.EJS_gameUrl = URL.createObjectURL(blob);

    this._loadEJSScript();
  }

  _createMinimalGbaRom() {
    const rom = new Uint8Array(256);
    rom[0] = 0x2E; rom[1] = 0x00; rom[2] = 0x00; rom[3] = 0xEA;
    const title = 'GBA_K       ';
    for (let i = 0; i < 12; i++) rom[0xA0 + i] = title.charCodeAt(i);
    rom[0xAC] = 0x41; rom[0xAD] = 0x47; rom[0xAE] = 0x42; rom[0xAF] = 0x4B;
    let chk = 0;
    for (let i = 0xA0; i < 0xBD; i++) chk -= rom[i];
    rom[0xBD] = (chk - 0x19) & 0xFF;
    return rom;
  }

  _loadEJSScript() {
    const script = document.createElement('script');
    script.src = window.EJS_pathtodata + 'loader.js';
    script.async = true;
    script.onload = () => {
      console.log('[GBA_K] EmulatorJS loader loaded');
      this._waitForEJS();
    };
    script.onerror = () => {
      console.warn('[GBA_K] Failed to load EmulatorJS CDN script. Falling back to JS engine.');
      this._triggerFallback();
    };
    document.head.appendChild(script);
  }

  _waitForEJS() {
    let attempts = 0;
    const check = () => {
      if (this.useFallback) return;
      if (window.EJS_emulator) {
        this._onEJSReady(window.EJS_emulator);
      } else if (attempts++ < 60) {
        setTimeout(check, 100);
      } else {
        this._triggerFallback();
      }
    };
    check();
  }

  _onEJSReady(emulator) {
    if (this._fallbackTimer) clearTimeout(this._fallbackTimer);
    this.ejsPlayer = emulator;
    this.ejsReady = true;
    console.log('[GBA_K] EmulatorJS mGBA WASM core is ready!');

    this._hookVideoOutput();
    this._startFpsCounter();

    if (this._pendingRom) {
      this._loadRomIntoEJS(this._pendingRom, this._pendingRomName);
      this._pendingRom = null;
      this._pendingRomName = null;
    }
  }

  _hookVideoOutput() {
    if (!this.ejsPlayer) return;
    const ejsCanvas = this._ejsContainer.querySelector('canvas');
    if (!ejsCanvas) return;

    const ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    const copyFrame = () => {
      if (this._running && !this._paused && ejsCanvas.width > 0 && ejsCanvas.height > 0) {
        try {
          ctx.drawImage(ejsCanvas, 0, 0, this.canvas.width, this.canvas.height);
        } catch (e) {}
      }
      this._videoRafId = requestAnimationFrame(copyFrame);
    };
    copyFrame();
  }

  _startFpsCounter() {
    let lastTime = performance.now();
    let frames = 0;
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        this.fps = frames;
        frames = 0;
        lastTime = now;
        if (this._onFpsUpdate) this._onFpsUpdate(this.fps);
      }
      this._fpsRafId = requestAnimationFrame(tick);
    };
    tick();
  }

  // --- Public Emulation Controls ---

  loadRom(arrayBuffer, fileName = 'game.gba') {
    if (this.useFallback) {
      return this.fallbackGba.loadRom(arrayBuffer, fileName);
    }

    this.romName = fileName;
    this.romTitle = fileName.replace(/\.[^/.]+$/, '');

    if (!this.ejsReady) {
      this._pendingRom = arrayBuffer;
      this._pendingRomName = fileName;
      console.log('[GBA_K] ROM queued while waiting for WASM core');
      return true;
    }

    return this._loadRomIntoEJS(arrayBuffer, fileName);
  }

  _loadRomIntoEJS(arrayBuffer, fileName) {
    try {
      const data = new Uint8Array(arrayBuffer);
      let title = '';
      for (let i = 0xA0; i < 0xAC; i++) {
        const ch = data[i];
        if (ch === 0) break;
        title += String.fromCharCode(ch);
      }
      this.romTitle = title.trim() || fileName.replace(/\.[^/.]+$/, '');

      if (this.ejsPlayer && this.ejsPlayer.gameManager) {
        const gm = this.ejsPlayer.gameManager;
        const romPath = '/' + fileName;
        if (gm.FS) {
          try { gm.FS.unlink(romPath); } catch (e) {}
          gm.FS.writeFile(romPath, data);
          if (gm.loadState) gm.loadState(romPath);
        }
      }

      this._romLoaded = true;
      this._running = true;
      this._paused = false;

      if (this.ejsPlayer && this.ejsPlayer.play) {
        this.ejsPlayer.play();
      }

      this._loadCheatsFromStorage();
      return true;
    } catch (e) {
      console.error('[GBA_K] Error loading ROM into WASM:', e);
      this._triggerFallback();
      return this.fallbackGba.loadRom(arrayBuffer, fileName);
    }
  }

  getRomTitle() {
    if (this.useFallback) return this.fallbackGba.getRomTitle();
    return this.romTitle || this.romName.replace(/\.[^/.]+$/, '');
  }

  reset() {
    if (this.useFallback) return this.fallbackGba.reset();
    if (this.ejsPlayer && this.ejsPlayer.gameManager && this.ejsPlayer.gameManager.restart) {
      this.ejsPlayer.gameManager.restart();
    }
  }

  start() {
    if (this.useFallback) return this.fallbackGba.start();
    if (!this._romLoaded) return;
    this._running = true;
    this._paused = false;
    if (this.ejsPlayer && this.ejsPlayer.play) this.ejsPlayer.play();
  }

  pause() {
    if (this.useFallback) return this.fallbackGba.pause();
    this._paused = true;
    if (this.ejsPlayer && this.ejsPlayer.pause) this.ejsPlayer.pause();
  }

  resume() {
    if (this.useFallback) return this.fallbackGba.resume();
    if (this._romLoaded && this._paused) {
      this._paused = false;
      if (this.ejsPlayer && this.ejsPlayer.play) this.ejsPlayer.play();
    }
  }

  // --- Key Input ---

  setKeyDown(keyBit) {
    if (this.useFallback) return this.fallbackGba.setKeyDown(keyBit);
    if (!this.ejsPlayer || !this.ejsPlayer.gameManager) return;
    const gm = this.ejsPlayer.gameManager;
    const btn = this._keyBitToEJSButton(keyBit);
    if (btn !== -1 && gm.simulateInput) {
      gm.simulateInput(0, btn, 1);
    }
  }

  setKeyUp(keyBit) {
    if (this.useFallback) return this.fallbackGba.setKeyUp(keyBit);
    if (!this.ejsPlayer || !this.ejsPlayer.gameManager) return;
    const gm = this.ejsPlayer.gameManager;
    const btn = this._keyBitToEJSButton(keyBit);
    if (btn !== -1 && gm.simulateInput) {
      gm.simulateInput(0, btn, 0);
    }
  }

  _keyBitToEJSButton(keyBit) {
    const map = {
      0x0001: 8,   // A -> 8
      0x0002: 0,   // B -> 0
      0x0004: 2,   // SELECT -> 2
      0x0008: 3,   // START -> 3
      0x0010: 7,   // RIGHT -> 7
      0x0020: 6,   // LEFT -> 6
      0x0040: 4,   // UP -> 4
      0x0080: 5,   // DOWN -> 5
      0x0100: 10,  // R -> 10
      0x0200: 11,  // L -> 11
    };
    return map[keyBit] ?? -1;
  }

  // --- Save / Load State ---

  saveState(slot = 1) {
    if (this.useFallback) return this.fallbackGba.saveState(slot);
    if (!this._romLoaded || !this.ejsPlayer) return null;

    try {
      let stateData = null;
      if (this.ejsPlayer.gameManager && this.ejsPlayer.gameManager.getState) {
        stateData = this.ejsPlayer.gameManager.getState();
      }

      const stateObj = {
        version: 2,
        engine: 'emulatorjs',
        romTitle: this.romTitle,
        timestamp: Date.now(),
        state: stateData ? Array.from(new Uint8Array(stateData)) : [],
        screenshot: this.canvas ? this.canvas.toDataURL('image/jpeg', 0.8) : null
      };

      localStorage.setItem(`myboy_savestate_${this.romTitle}_slot${slot}`, JSON.stringify(stateObj));
      return stateObj;
    } catch (e) {
      console.warn('[GBA_K] Error saving state:', e);
      return null;
    }
  }

  loadState(slot = 1) {
    if (this.useFallback) return this.fallbackGba.loadState(slot);
    if (!this._romLoaded || !this.ejsPlayer) return false;

    try {
      const json = localStorage.getItem(`myboy_savestate_${this.romTitle}_slot${slot}`);
      if (!json) return false;
      const stateObj = JSON.parse(json);

      if (stateObj.engine === 'emulatorjs' && stateObj.state && this.ejsPlayer.gameManager) {
        const gm = this.ejsPlayer.gameManager;
        if (gm.loadState) {
          gm.loadState(new Uint8Array(stateObj.state));
          return true;
        }
      }
      return false;
    } catch (e) {
      console.error('[GBA_K] Error loading state:', e);
      return false;
    }
  }

  getStateInfo(slot = 1) {
    if (this.useFallback) return this.fallbackGba.getStateInfo(slot);
    try {
      const json = localStorage.getItem(`myboy_savestate_${this.romTitle}_slot${slot}`);
      if (!json) return null;
      const data = JSON.parse(json);
      return { timestamp: data.timestamp, screenshot: data.screenshot };
    } catch (e) {
      return null;
    }
  }

  // --- Battery Saves (.sav) ---

  exportSavFile() {
    if (this.useFallback) return this.fallbackGba.exportSavFile();
    if (!this._romLoaded || !this.ejsPlayer) return;
    try {
      const gm = this.ejsPlayer.gameManager;
      if (gm && gm.getSave) {
        const saveData = gm.getSave();
        if (saveData) {
          const blob = new Blob([saveData], { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${this.romTitle || 'game'}.sav`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
    } catch (e) {
      console.warn('[GBA_K] Error exporting save:', e);
    }
  }

  importSavFile(arrayBuffer) {
    if (this.useFallback) return this.fallbackGba.importSavFile(arrayBuffer);
    if (!this.ejsPlayer) return;
    try {
      const gm = this.ejsPlayer.gameManager;
      if (gm && gm.loadSave) {
        gm.loadSave(new Uint8Array(arrayBuffer));
      }
    } catch (e) {
      console.warn('[GBA_K] Error importing save:', e);
    }
  }

  // --- Cheats ---

  get cheats() {
    if (this.useFallback) return this.fallbackGba.cheats;
    const self = this;
    return {
      get cheats() { return self._cheats; },
      addCheat(name, code) {
        const id = Date.now().toString(36);
        self._cheats.push({ id, name: name || 'Cheat', code, enabled: true });
        self._applyCheatsToEJS();
        self._saveCheatsToStorage();
      },
      removeCheat(id) {
        self._cheats = self._cheats.filter(c => c.id !== id);
        self._applyCheatsToEJS();
        self._saveCheatsToStorage();
      },
      toggleCheat(id, enabled) {
        const cheat = self._cheats.find(c => c.id === id);
        if (cheat) {
          cheat.enabled = enabled;
          self._applyCheatsToEJS();
          self._saveCheatsToStorage();
        }
      },
      loadFromStorage() { self._loadCheatsFromStorage(); },
      applyCheats() {}
    };
  }

  _applyCheatsToEJS() {
    if (!this.ejsPlayer || !this.ejsPlayer.gameManager) return;
    const gm = this.ejsPlayer.gameManager;
    if (gm.resetCheats) gm.resetCheats();
    for (const cheat of this._cheats) {
      if (!cheat.enabled) continue;
      const lines = cheat.code.trim().split(/[\n\r]+/);
      for (const line of lines) {
        const clean = line.replace(/\s+/g, ' ').trim();
        if (clean && gm.addCheat) gm.addCheat(clean);
      }
    }
  }

  _saveCheatsToStorage() {
    try {
      const key = 'myboy_cheats_' + (this.romTitle || 'default');
      localStorage.setItem(key, JSON.stringify(this._cheats));
    } catch (e) {}
  }

  _loadCheatsFromStorage() {
    try {
      const key = 'myboy_cheats_' + (this.romTitle || 'default');
      const data = localStorage.getItem(key);
      this._cheats = data ? JSON.parse(data) : [];
      this._applyCheatsToEJS();
    } catch (e) {
      this._cheats = [];
    }
  }

  // --- Speed & Audio ---

  _applySpeed() {
    if (!this.ejsPlayer || !this.ejsPlayer.gameManager) return;
    const gm = this.ejsPlayer.gameManager;
    const targetSpeed = this._fastForward ? this._speedMultiplier : this.speed;
    if (gm.setFastForwardRatio) gm.setFastForwardRatio(targetSpeed);
    if (gm.setSpeed) gm.setSpeed(targetSpeed);
  }

  get apu() {
    if (this.useFallback) return this.fallbackGba.apu;
    const self = this;
    return {
      setVolume(v) {
        const vol = Math.max(0, Math.min(1, v));
        if (self.ejsPlayer && self.ejsPlayer.gameManager && self.ejsPlayer.gameManager.setVolume) {
          self.ejsPlayer.gameManager.setVolume(vol);
        }
      }
    };
  }

  // --- Memory Scanner & Freeze List Compatibility ---

  applyFreezes() {
    if (this.useFallback) return this.fallbackGba.applyFreezes();
  }

  addFreeze(address, value, dataType) {
    if (this.useFallback) return this.fallbackGba.addFreeze(address, value, dataType);
    this.freezeList = this.freezeList.filter(f => f.address !== address);
    this.freezeList.push({ address, value, dataType });
  }

  removeFreeze(address) {
    if (this.useFallback) return this.fallbackGba.removeFreeze(address);
    this.freezeList = this.freezeList.filter(f => f.address !== address);
  }

  get mmu() {
    if (this.useFallback) return this.fallbackGba.mmu;
    return {
      get rom() { return new Uint8Array(0); },
      get romSize() { return 0; },
      get ewram() { return new Uint8Array(0x40000); },
      get iwram() { return new Uint8Array(0x8000); },
      read8() { return 0; },
      read16() { return 0; },
      read32() { return 0; },
      write8() {},
      write16() {},
      write32() {},
      get saveData() { return new Uint8Array(0); }
    };
  }

  get core() {
    if (this.useFallback) return this.fallbackGba.core;
    const self = this;
    return {
      audio: { context: null, masterVolume: 1.0 },
      video: { skipDraw: false },
      advanceFrame() {},
      keypad: {
        keydown(bit) { self.setKeyDown(bit); },
        keyup(bit) { self.setKeyUp(bit); }
      }
    };
  }
}
