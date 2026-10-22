/**
 * EmulatorAdapter v3 — Production-grade Isolated WASM Bridge for GBA_K.
 * 
 * Uses an isolated iframe to run EmulatorJS / mGBA WebAssembly:
 * - 100% memory isolation (no Emscripten global collisions)
 * - Clean teardown & recreation on each ROM switch
 * - Direct WebGL canvas rendering inside canvas-wrapper
 * - Full parity for Input, Fast-Forward, Save/Load States, and Cheats
 */

import { saveStateManager } from './save-state-manager.js';
import { downloadFile } from './download-helper.js';
import { writeSavToIndexedDB, readSavFromIndexedDB } from './battery-save-helper.js';
import { deleteBatteryFiles } from './delete-battery-save.js';

export class EmulatorAdapter {
  constructor(canvas) {
    this.canvas = canvas;
    this.iframe = null;
    this.ejsReady = false;
    this.ejsInstance = null;

    // State flags (matches GBA class interface)
    this.running = false;
    this.paused = false;
    this.romLoaded = false;
    this.romName = 'Chưa chọn ROM';
    this.romTitle = '';

    // Speed & Sync
    this.speed = 1.0;
    this._fastForward = false;
    this._fastForwardHeld = false;
    this._speedMultiplier = 1.0;
    this._vsyncEnabled = true;

    // Performance / FPS
    this.fps = 0;
    this.onFpsUpdate = null;
    this._fpsFrames = 0;
    this._fpsLastTime = performance.now();
    this._fpsRafId = null;

    // Cheats & Freezes
    this._cheats = [];
    this.freezeList = [];

    // Pending ROM config for iframe handshake
    this._pendingGameConfig = null;
    this._sessionId = 0;

    // Input state caching to prevent bridge flooding on touchmove
    this._keyState = {};
    this._audioUnlocked = false;

    // Create the iframe container inside canvas-wrapper
    this._setupIframe();

    // Listen to messages from the iframe
    this._setupMessageListener();
  }

  _setupIframe() {
    const wrapper = this.canvas.parentElement; // #canvas-wrapper
    wrapper.style.position = 'relative';

    this.iframe = document.createElement('iframe');
    this.iframe.id = 'ejs-core-frame';
    this.iframe.setAttribute('allow', 'autoplay');
    this.iframe.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: none;
      background: #000;
      z-index: 2;
      display: none;
    `;
    wrapper.appendChild(this.iframe);
  }

  _setupMessageListener() {
    window.addEventListener('message', (event) => {
      if (event.source !== this.iframe?.contentWindow) return;
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.sessionId !== String(this._sessionId)) return;

      if (event.data.type === 'EJS_IFRAME_READY') {
        if (this._pendingGameConfig && this.iframe && this.iframe.contentWindow) {
          this.iframe.contentWindow.postMessage({
            type: 'EJS_INIT_GAME',
            gameUrl: this._pendingGameConfig.gameUrl,
            gameName: this._pendingGameConfig.gameName,
            initialSaveData: this._pendingGameConfig.initialSaveData
          }, '*');
        }
      } else if (event.data.type === 'EJS_GAME_STARTED') {
        console.log('[GBA_K] mGBA WASM core running inside isolated frame!');
        this.ejsReady = true;
        this.running = true;
        this.paused = false;
        this.romLoaded = true;

        try {
          this.ejsInstance = this.iframe.contentWindow?.EJS_emulator || null;
        } catch (e) {
          this.ejsInstance = null;
        }

        this._startFpsCounter();
        this._loadCheatsFromStorage();
        this.loadFreezeList();

        let savedVol = null;
        try { savedVol = localStorage.getItem('gba_k_volume'); } catch (e) {}
        if (savedVol !== null) {
          this.setVolume(parseFloat(savedVol));
        }

        let savedVsync = false;
        try { savedVsync = localStorage.getItem('myboy_vsync') === 'true'; } catch (e) {}
        this.setVSync(savedVsync);

        this._applySpeed();
      } else if (event.data.type === 'EJS_BATTERY_SAVE_UPDATED') {
        const u8 = new Uint8Array(event.data.data);
        if (u8 && u8.length > 0) {
          this._currentSaveData = u8;
          if (this._pendingGameConfig) {
            this._pendingGameConfig.initialSaveData = Array.from(u8);
          }
          const gm = this._gameManager;
          const savePath = gm?.getSaveFilePath ? gm.getSaveFilePath() : null;
          writeSavToIndexedDB(this.romTitle, this.romName, u8, savePath ? [savePath] : []);
          try {
            let binary = '';
            for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
            localStorage.setItem('gba_sav_backup_' + (this.romTitle || 'game'), btoa(binary));
          } catch (e) {}
        }
      }
    });

    // Auto-flush saves on tab switch or page close
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.releaseAllKeys();
        this.flushBatterySave();
      }
    });
    window.addEventListener('beforeunload', () => {
      this.flushBatterySave();
    });
    window.addEventListener('blur', () => this.releaseAllKeys());
    window.addEventListener('pagehide', () => this.flushBatterySave());
  }

  flushBatterySave() {
    try {
      const gm = this._gameManager;
      if (gm && typeof gm.saveSaveFiles === 'function') {
        gm.saveSaveFiles();
        const data = gm.getSaveFile?.(false);
        if (data?.length) {
          const snapshot = new Uint8Array(data);
          const romTitle = this.romTitle;
          const romName = this.romName;
          const savePath = gm.getSaveFilePath?.();
          this._currentSaveData = snapshot;
          if (this._pendingGameConfig) this._pendingGameConfig.initialSaveData = Array.from(snapshot);
          try {
            localStorage.setItem('gba_sav_backup_' + romTitle, saveStateManager._uint8ToBase64(snapshot));
          } catch (error) {}
          writeSavToIndexedDB(romTitle, romName, snapshot, savePath ? [savePath] : []);
        }
      } else {
        this.iframe?.contentWindow?.postMessage({ type: 'EJS_FLUSH_SAVES' }, '*');
      }
    } catch (e) {}
  }

  reboot() {
    if (!this._pendingGameConfig) return;
    this.ejsReady = false;
    this.running = false;
    this.romLoaded = false;
    this._sessionId++;
    clearTimeout(this._reloadTimer);
    this.releaseAllKeys();
    this.iframe.src = 'about:blank';
    this._reloadTimer = setTimeout(() => {
      this.iframe.src = '/emulatorjs/embed.html?session=' + this._sessionId;
    }, 100);
  }

  // ===== ROM LOADING =====

  loadRom(arrayBuffer, fileName = 'game.gba') {
    const data = new Uint8Array(arrayBuffer);
    if (data.length < 0xc0 || data.length > 0x2000000) throw new Error('ROM GBA không hợp lệ.');
    const preparedRom = globalThis.GBAKCompatibility.prepareRom(data);
    this.flushBatterySave();
    this.releaseAllKeys();
    clearTimeout(this._reloadTimer);
    if (this._romBlobUrl) URL.revokeObjectURL(this._romBlobUrl);
    this._currentSaveData = null;
    this._cheats = [];
    this.freezeList = [];
    this.ejsInstance = null;
    this.romSize = data.length;
    this._romCompatibility = { compatibilityId: preparedRom.compatibilityId,
      sourceCrc32: preparedRom.sourceCrc32, runtimeCrc32: preparedRom.runtimeCrc32 };
    this._sessionId++;
    this.romName = fileName;

    // Extract title from ROM header (offset 0xA0, 12 bytes)
    let title = '';
    for (let i = 0xA0; i < 0xAC; i++) {
      const ch = data[i];
      if (ch === 0) break;
      title += String.fromCharCode(ch);
    }
    this.romTitle = title.trim() || fileName.replace(/\.[^/.]+$/, '');

    // Reset state
    this.ejsReady = false;
    this.running = false;
    this.paused = false;
    this.romLoaded = false;
    this._fastForward = false;
    this._fastForwardHeld = false;
    this._speedMultiplier = 1.0;
    this._keyState = {};
    this._audioUnlocked = false;
    if (this._fpsRafId) {
      cancelAnimationFrame(this._fpsRafId);
      this._fpsRafId = null;
    }
    if (this._fpsIntervalId) {
      clearInterval(this._fpsIntervalId);
      this._fpsIntervalId = null;
    }
    // Stop any legacy freeze timer
    this._stopFreezeLoop();

    // Hide original canvas, show iframe
    this.canvas.style.display = 'none';
    this.iframe.style.display = 'block';

    // Create a blob URL for the ROM
    const blob = new Blob([preparedRom.bytes], { type: 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);
    this._romBlobUrl = blobUrl;

    // Restore previous session save data if available
    let initialSave = this._currentSaveData;
    if (!initialSave) {
      let b64 = null;
      try { b64 = localStorage.getItem('gba_sav_backup_' + this.romTitle); } catch (e) {}
      if (b64) {
        try {
          const raw = atob(b64);
          const u8 = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
          initialSave = u8;
        } catch (e) {}
      }
    }
    if (initialSave) {
      this._currentSaveData = initialSave;
    }

    // Save pending config for handshake
    this._pendingGameConfig = {
      gameUrl: blobUrl,
      gameName: this.romTitle + '.gba', // Ensure extension for mGBA
      initialSaveData: this._currentSaveData ? Array.from(this._currentSaveData) : null
    };

    // Reload iframe cleanly to destroy any previous WASM memory
    this.iframe.src = 'about:blank';
    this._reloadTimer = setTimeout(() => {
      this.iframe.src = '/emulatorjs/embed.html?session=' + this._sessionId;
    }, 50);

    return true;
  }

  getRomTitle() {
    return this.romTitle || this.romName.replace(/\.[^/.]+$/, '');
  }

  getRomChecksum() {
    const gm = this._gameManager;
    try { return globalThis.GBAKMemory.stateMemory(gm?.getState?.())?.romCrc32 ?? null; }
    catch (error) { return null; }
  }

  // ===== CONTROLS & LIFECYCLE =====

  get _gameManager() {
    try {
      return this.iframe?.contentWindow?.EJS_emulator?.gameManager || null;
    } catch (e) {
      return null;
    }
  }

  reset() {
    const gm = this._gameManager;
    if (gm && gm.restart) gm.restart();
  }

  start() {
    if (!this.romLoaded) return;
    this.running = true;
    this.paused = false;
    const gm = this._gameManager;
    if (gm && gm.toggleMainLoop) gm.toggleMainLoop(1);
  }

  pause() {
    this.releaseAllKeys();
    this.paused = true;
    const gm = this._gameManager;
    if (gm && gm.toggleMainLoop) gm.toggleMainLoop(0);
  }

  resume() {
    if (this.romLoaded && this.paused) {
      this.paused = false;
      const gm = this._gameManager;
      if (gm && gm.toggleMainLoop) gm.toggleMainLoop(1);
    }
  }

  _resumeAudio() {
    try {
      this.iframe?.contentWindow?.postMessage({ type: 'EJS_RESUME_AUDIO' }, '*');
    } catch (e) {}
  }

  // ===== INPUT =====

  releaseAllKeys({ releaseFastForwardHold = true } = {}) {
    for (const key of Object.keys(this._keyState)) this.setKeyUp(Number(key));
    if (releaseFastForwardHold) this.setFastForwardHeld(false);
  }

  setKeyDown(keyBit) {
    if (this._keyState[keyBit]) return;
    this._keyState[keyBit] = true;

    if (!this._audioUnlocked) {
      this._resumeAudio();
      this._audioUnlocked = true;
    }

    const gm = this._gameManager;
    if (!gm || !gm.simulateInput) return;
    const btn = this._keyBitToEJSButton(keyBit);
    if (btn !== -1) {
      gm.simulateInput(0, btn, 1);
    }
  }

  setKeyUp(keyBit) {
    if (!this._keyState[keyBit]) return;
    this._keyState[keyBit] = false;

    const gm = this._gameManager;
    if (!gm || !gm.simulateInput) return;
    const btn = this._keyBitToEJSButton(keyBit);
    if (btn !== -1) {
      gm.simulateInput(0, btn, 0);
    }
  }

  _keyBitToEJSButton(key) {
    // Exact mapping from GBA KEYS index (0-9) to RetroArch / Libretro RetroPad buttons:
    // 0: KEYS.A      -> 8 (A)
    // 1: KEYS.B      -> 0 (B)
    // 2: KEYS.SELECT -> 2 (SELECT)
    // 3: KEYS.START  -> 3 (START)
    // 4: KEYS.RIGHT  -> 7 (RIGHT)
    // 5: KEYS.LEFT   -> 6 (LEFT)
    // 6: KEYS.UP     -> 4 (UP)
    // 7: KEYS.DOWN   -> 5 (DOWN)
    // 8: KEYS.R      -> 11 (R)
    // 9: KEYS.L      -> 10 (L)
    const GBA_TO_EJS = [8, 0, 2, 3, 7, 6, 4, 5, 11, 10];
    return GBA_TO_EJS[key] ?? -1;
  }

  // ===== SPEED / FAST FORWARD =====

  get fastForward() { return !!(this._fastForward || this._fastForwardHeld); }
  set fastForward(val) {
    const bool = !!val;
    if (this._fastForward === bool) return;
    this._fastForward = bool;
    this._applySpeed();
  }

  get speedMultiplier() { return this._speedMultiplier; }
  set speedMultiplier(val) {
    const parsed = Number(val);
    const num = Number.isFinite(parsed) ? Math.max(1, Math.min(5, parsed)) : 1;
    if (this._speedMultiplier === num) return;
    this._speedMultiplier = num;
    this._applySpeed();
  }

  setFastForwardHeld(held) {
    const enabled = Boolean(held);
    if (Boolean(this._fastForwardHeld) === enabled) return;
    this._fastForwardHeld = enabled;
    this._applySpeed();
  }

  _applySpeed(force = false) {
    const ratio = this._speedMultiplier;
    const enabled = this.fastForward && ratio > 1;
    try {
      const frame = this.iframe?.contentWindow;
      if (typeof frame?.EJS_applySpeed === 'function') {
        frame.EJS_applySpeed(enabled, ratio, this._vsyncEnabled, force);
      } else {
        frame?.postMessage({ type: 'EJS_SET_SPEED', fastForward: enabled,
          speedMultiplier: ratio, vsyncEnabled: this._vsyncEnabled, force }, '*');
      }
    } catch (error) {
      console.warn('[GBA_K] Speed bridge unavailable:', error);
    }
    this.onSpeedChange?.(enabled, ratio);
  }

  setVSync(enabled) {
    this._vsyncEnabled = Boolean(enabled);
    this._applySpeed();
  }

  // ===== SAVE / LOAD STATE =====

  async saveState(slot = 1) {
    const gm = this._gameManager;
    if (!this.romLoaded || !gm) return null;

    try {
      let stateData = null;
      if (typeof gm.getState === 'function') {
        const u8 = gm.getState();
        if (u8 && u8.length > 0) {
          stateData = new Uint8Array(u8);
        }
      } else if (gm.functions && typeof gm.functions.saveStateInfo === 'function') {
        const parts = gm.functions.saveStateInfo().split('|');
        if (parts[2] === '1') {
          const size = parseInt(parts[0], 10);
          const start = parseInt(parts[1], 10);
          const arr = gm.Module.HEAPU8.subarray(start, start + size);
          stateData = new Uint8Array(arr);
        }
      }

      if (!stateData || stateData.length === 0) {
        console.warn('[GBA_K] Save state: failed to obtain state data');
        return null;
      }

      let screenshot = null;
      try {
        const ejsCanvas = this.iframe?.contentWindow?.document?.querySelector('canvas');
        if (ejsCanvas) screenshot = ejsCanvas.toDataURL('image/jpeg', 0.8);
      } catch (e) {}

      return await saveStateManager.saveState(this.romTitle, slot, stateData, screenshot);
    } catch (e) {
      console.warn('[GBA_K] Save state error:', e);
      return null;
    }
  }

  async loadState(slot = 1) {
    const gm = this._gameManager;
    const romTitle = this.romTitle;
    if (!this.romLoaded || !gm) return false;

    try {
      const loaded = await saveStateManager.loadState(romTitle, slot);
      if (gm !== this._gameManager || romTitle !== this.romTitle) return false;
      if (!loaded || !loaded.state) return false;

      let u8 = loaded.state instanceof Uint8Array ? loaded.state : new Uint8Array(loaded.state);
      if (typeof gm.loadState === 'function') {
        const liveMemory = typeof gm.getState === 'function' ? globalThis.GBAKMemory.stateMemory(gm.getState()) : null;
        u8 = globalThis.GBAKCompatibility.prepareState(u8, liveMemory?.romCrc32 ?? this._romCompatibility?.runtimeCrc32 ?? null);
        const savedMemory = globalThis.GBAKMemory.stateMemory(u8);
        if (!savedMemory || (liveMemory && savedMemory.romCrc32 !== liveMemory.romCrc32)) {
          throw new Error('State không hợp lệ hoặc thuộc ROM khác.');
        }
        this.releaseAllKeys({ releaseFastForwardHold: false });
        try {
          const result = await gm.loadState(u8);
          return result !== false && result !== 0;
        } finally {
          if (gm === this._gameManager && romTitle === this.romTitle) this._applySpeed(true);
        }
      }
      return false;
    } catch (e) {
      console.error('[GBA_K] Load state error:', e);
      return false;
    }
  }

  getStateInfo(slot = 1) {
    return saveStateManager.getStateInfo(this.romTitle, slot);
  }

  async deleteState(slot = 1) {
    return await saveStateManager.deleteState(this.romTitle, slot);
  }

  async deleteAllStates() {
    return await saveStateManager.deleteAllStates(this.romTitle);
  }

  // ===== HIGH-PERFORMANCE DIRECT WASM MEMORY ACCESS =====

  _getMemoryBases() {
    try {
      const cw = this.iframe?.contentWindow;
      if (cw && typeof cw.EJS_getMemoryBases === 'function') {
        return cw.EJS_getMemoryBases();
      }
    } catch (e) {}
    return null;
  }

  getMemorySnapshot() {
    const gm = this._gameManager;
    if (!this.romLoaded || !gm) return null;
    try {
      const heapU8 = gm.Module?.HEAPU8;
      if (heapU8) {
        const { ewramBase = -1, iwramBase = -1 } = this._getMemoryBases() || {};
        if (ewramBase >= 0 && ewramBase + 0x40000 <= heapU8.length &&
            iwramBase >= 0 && iwramBase + 0x8000 <= heapU8.length) {
          return {
            ewram: heapU8.subarray(ewramBase, ewramBase + 0x40000),
            iwram: heapU8.subarray(iwramBase, iwramBase + 0x8000),
            fullState: null
          };
        }
      }

      // Fallback: saveStateInfo
      let state = null;
      if (typeof gm.getState === 'function') {
        state = gm.getState();
      } else if (gm.functions && typeof gm.functions.saveStateInfo === 'function') {
        const parts = gm.functions.saveStateInfo().split('|');
        if (parts[2] === '1') {
          const size = parseInt(parts[0], 10);
          const start = parseInt(parts[1], 10);
          const arr = gm.Module.HEAPU8.subarray(start, start + size);
          state = new Uint8Array(arr);
        }
      }

      const memory = globalThis.GBAKMemory.stateMemory(state);
      if (memory) {
        return {
          ewram: new Uint8Array(memory.ewram),
          iwram: new Uint8Array(memory.iwram),
          fullState: state
        };
      }
    } catch (e) {
      console.warn('[EmulatorAdapter] getMemorySnapshot error:', e);
    }
    return null;
  }

  readMemory(addr, type = 'u16', cachedSnapshot = null) {
    if (!globalThis.GBAKMemory.ramAccess(addr, type)) return 0;
    // 1. Direct iframe memory read (instant, zero overhead)
    try {
      const cw = this.iframe?.contentWindow;
      if (cw && typeof cw.EJS_readMemory === 'function') {
        const value = cw.EJS_readMemory(addr, type);
        if (value !== null) return value;
      }
    } catch (e) {}

    // 2. Direct HEAPU8 read
    const gm = this._gameManager;
    const heapU8 = gm?.Module?.HEAPU8;
    if (heapU8) {
      const { ewramBase = -1, iwramBase = -1 } = this._getMemoryBases() || {};
      let ptr = -1;
      if (ewramBase >= 0 && addr >= 0x02000000 && addr < 0x02040000) {
        ptr = ewramBase + (addr & 0x3FFFF);
      } else if (iwramBase >= 0 && addr >= 0x03000000 && addr < 0x03008000) {
        ptr = iwramBase + (addr & 0x7FFF);
      }
      if (ptr !== -1 && ptr + globalThis.GBAKMemory.ramAccess(addr, type).size <= heapU8.length) {
        if (type === 'u8') return heapU8[ptr];
        if (type === 'u16') return heapU8[ptr] | (heapU8[ptr + 1] << 8);
        if (type === 'u32') return (heapU8[ptr] | (heapU8[ptr + 1] << 8) | (heapU8[ptr + 2] << 16) | (heapU8[ptr + 3] << 24)) >>> 0;
      }
    }

    // 3. Fallback snapshot read
    const snap = cachedSnapshot || this.getMemorySnapshot();
    if (!snap) return 0;
    let buf = null;
    let offset = 0;
    if (addr >= 0x02000000 && addr < 0x02040000) {
      buf = snap.ewram;
      offset = addr - 0x02000000;
    } else if (addr >= 0x03000000 && addr < 0x03008000) {
      buf = snap.iwram;
      offset = addr - 0x03000000;
    }
    if (!buf || offset < 0 || offset >= buf.length) return 0;
    if (type === 'u8') return buf[offset];
    if (type === 'u16') return buf[offset] | (buf[offset + 1] << 8);
    if (type === 'u32') return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
    return 0;
  }

  writeMemory(addr, val, type = 'u16') {
    val = Number(val);
    if (!globalThis.GBAKMemory.ramAccess(addr, type, val)) return false;

    // 1. Direct iframe poke (instant, zero overhead)
    try {
      const cw = this.iframe?.contentWindow;
      if (cw && typeof cw.EJS_pokeMemory === 'function') {
        const ok = cw.EJS_pokeMemory(addr, val, type);
        if (ok) return true;
      }
    } catch (e) {}

    // 2. Direct HEAPU8 poke
    const gm = this._gameManager;
    const heapU8 = gm?.Module?.HEAPU8;
    if (heapU8) {
      const { ewramBase = -1, iwramBase = -1 } = this._getMemoryBases() || {};
      let ptr = -1;
      if (ewramBase >= 0 && addr >= 0x02000000 && addr < 0x02040000) {
        ptr = ewramBase + (addr & 0x3FFFF);
      } else if (iwramBase >= 0 && addr >= 0x03000000 && addr < 0x03008000) {
        ptr = iwramBase + (addr & 0x7FFF);
      }
      if (ptr !== -1 && ptr + globalThis.GBAKMemory.ramAccess(addr, type).size <= heapU8.length) {
        if (type === 'u8') {
          heapU8[ptr] = val & 0xFF;
        } else if (type === 'u16') {
          heapU8[ptr] = val & 0xFF;
          heapU8[ptr + 1] = (val >> 8) & 0xFF;
        } else if (type === 'u32') {
          heapU8[ptr] = val & 0xFF;
          heapU8[ptr + 1] = (val >> 8) & 0xFF;
          heapU8[ptr + 2] = (val >> 16) & 0xFF;
          heapU8[ptr + 3] = (val >>> 24) & 0xFF;
        }
        return true;
      }
    }

    return false;
  }

  // ===== CHEATS =====

  get cheats() {
    const self = this;
    return {
      get cheats() { return self._cheats; },
      addCheat(name, code) {
        const id = crypto.randomUUID();
        const lines = (code || '').trim().split(/[\r\n]+/);
        const normalized = lines.filter(line => line.trim()).map(line => self.normalizeGbaCheatLine(line));
        if (!normalized.length || normalized.some(line => !line)) throw new Error('Mã cheat không hợp lệ.');
        const formatted = normalized.join('\n');
        self._cheats.push({ id, name: name || 'Cheat', code: formatted, enabled: true });
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
          cheat.enabled = enabled === undefined ? !cheat.enabled : Boolean(enabled);
          self._applyCheatsToEJS();
          self._saveCheatsToStorage();
        }
      },
      loadFromStorage() { self._loadCheatsFromStorage(); },
      applyCheats() {
        self._applyCheatsToEJS();
      }
    };
  }

  normalizeGbaCheatLine(rawLine) {
    return globalThis.GBAKMemory.normalizeCheat(rawLine);
  }

  _applyCheatsToEJS() {
    const codes = [];

    // 1. Regular Cheats
    for (const cheat of this._cheats) {
      if (!cheat.enabled) continue;
      const lines = cheat.code.trim().split(/[\n\r]+/);
      const normalized = lines.map(line => this.normalizeGbaCheatLine(line));
      if (normalized.length && normalized.every(Boolean)) codes.push(normalized.join('+'));
    }

    // 2. Active Freezes as hardware cheats
    for (const f of this.freezeList) {
      const codeOrArr = this._formatFreezeAsCheat(f.address, f.value, f.dataType);
      if (Array.isArray(codeOrArr)) {
        codes.push(...codeOrArr);
      } else if (codeOrArr) {
        codes.push(codeOrArr);
      }
    }

    // 3. Directly call EJS_setActiveCheats on iframe contentWindow if accessible
    try {
      const cw = this.iframe?.contentWindow;
      if (cw && typeof cw.EJS_setActiveCheats === 'function') {
        cw.EJS_setActiveCheats(codes);
        return;
      }
    } catch (e) {}

    // 5. Also register on gameManager if supported
    const gm = this._gameManager;
    if (gm && typeof gm.setCheat === 'function') {
      try {
        if (typeof gm.resetCheat === 'function') gm.resetCheat();
        for (let idx = 0; idx < codes.length; idx++) {
          gm.setCheat(idx, 1, codes[idx]);
        }
      } catch (e) {}
    }
  }

  _formatFreezeAsCheat(addr, val, type = 'u16') {
    val = Number(val);
    if (!globalThis.GBAKMemory.ramAccess(addr, type, val)) return null;
    const isEwram = (addr >= 0x02000000 && addr < 0x02040000);
    const isIwram = (addr >= 0x03000000 && addr < 0x03008000);
    if (!isEwram && !isIwram) return null;

    const prefix = isEwram ? '82' : '83';
    const bytePrefix = isEwram ? '32' : '33';
    const off = (addr & 0x00FFFFFF).toString(16).padStart(6, '0').toUpperCase();

    if (type === 'u8') {
      return `${bytePrefix}${off} 00${(val & 0xFF).toString(16).padStart(2, '0').toUpperCase()}`;
    }
    if (type === 'u32') {
      const off2 = ((addr + 2) & 0x00FFFFFF).toString(16).padStart(6, '0').toUpperCase();
      const low16 = (val & 0xFFFF).toString(16).padStart(4, '0').toUpperCase();
      const high16 = ((val >>> 16) & 0xFFFF).toString(16).padStart(4, '0').toUpperCase();
      return [`${prefix}${off} ${low16}`, `${prefix}${off2} ${high16}`];
    }
    return `${prefix}${off} ${(val & 0xFFFF).toString(16).padStart(4, '0').toUpperCase()}`;
  }

  _saveCheatsToStorage() {
    try {
      localStorage.setItem('myboy_cheats_' + (this.romTitle || 'default'), JSON.stringify(this._cheats));
      const checksum = this.getRomChecksum();
      if (checksum !== null) localStorage.setItem('myboy_cheats_crc_' + this.romTitle, String(checksum));
    } catch (e) {}
  }

  _loadCheatsFromStorage() {
    try {
      const data = localStorage.getItem('myboy_cheats_' + (this.romTitle || 'default'));
      const raw = data ? JSON.parse(data) : [];
      const savedChecksum = localStorage.getItem('myboy_cheats_crc_' + this.romTitle);
      const matchesRom = savedChecksum !== null && savedChecksum === String(this.getRomChecksum());
      this._cheats = (Array.isArray(raw) ? raw : []).filter(c => c && typeof c.code === 'string' && typeof c.id === 'string').map(c => {
        if (!c.code) return c;
        const lines = c.code.trim().split(/[\r\n]+/);
        const normalized = lines.map(line => this.normalizeGbaCheatLine(line));
        return { ...c, code: normalized.every(Boolean) ? normalized.join('\n') : c.code, enabled: matchesRom && normalized.every(Boolean) && c.enabled === true };
      });
      this._applyCheatsToEJS();
    } catch (e) {
      this._cheats = [];
    }
  }

  // ===== AUDIO =====

  setVolume(v) {
    const parsed = parseFloat(v);
    const vol = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 1;
    this._volume = vol;
    try {
      localStorage.setItem('gba_k_volume', vol.toString());
    } catch (e) {}

    try {
      this.iframe?.contentWindow?.postMessage({
        type: 'EJS_SET_VOLUME',
        volume: vol
      }, '*');
    } catch (e) {}

    try {
      const ejs = this.iframe?.contentWindow?.EJS_emulator;
      if (ejs && typeof ejs.setVolume === 'function') {
        ejs.setVolume(vol);
      }
      const al = ejs?.Module?.AL;
      if (al?.currentCtx?.sources) {
        al.currentCtx.sources.forEach(s => {
          if (s.gain && s.gain.gain) {
            s.gain.gain.value = vol;
          }
        });
      }
    } catch (e) {}
  }

  get apu() {
    const self = this;
    return {
      setVolume(v) {
        self.setVolume(v);
      }
    };
  }

  // ===== FPS COUNTER =====

  _startFpsCounter() {
    // Clean up any previous counter
    if (this._fpsRafId) cancelAnimationFrame(this._fpsRafId);
    if (this._fpsIntervalId) clearInterval(this._fpsIntervalId);

    this._fpsFrames = 0;
    this._fpsLastTime = performance.now();
    let lastFrameNum = 0;

    // Cache gameManager reference once — avoids cross-iframe property chain every tick
    let cachedGm = this._gameManager;

    // Use setInterval(1000) instead of requestAnimationFrame — only fires once per second
    // vs rAF which fires 60-144 times/sec and crosses the iframe boundary each time
    this._fpsIntervalId = setInterval(() => {
      if (!this.romLoaded) return;
      const now = performance.now();
      const elapsed = now - this._fpsLastTime;
      if (elapsed < 500) return; // Guard against early fires

      // Refresh cached GM if needed
      if (!cachedGm) cachedGm = this._gameManager;
      const gm = cachedGm;

      if (gm && typeof gm.getFrameNum === 'function') {
        try {
          const currentFrameNum = gm.getFrameNum();
          if (currentFrameNum > 0 && lastFrameNum > 0) {
            // Scale to per-second rate
            this.fps = Math.round((currentFrameNum - lastFrameNum) * (1000 / elapsed));
          }
          lastFrameNum = currentFrameNum;
        } catch (e) {
          // gameManager may have been destroyed
          cachedGm = null;
        }
      }

      this._fpsLastTime = now;
      if (this.onFpsUpdate) this.onFpsUpdate(this.fps);
    }, 1000);
  }

  // ===== BATTERY SAVE =====

  async exportSavFile() {
    if (!this.romLoaded) {
      if (window.showAppToast) window.showAppToast('⚠️ Vui lòng mở game trước khi xuất file .SAV!');
      return false;
    }

    try {
      const gm = this._gameManager;
      // 1. Force flush SRAM from core to filesystem
      if (gm) {
        if (typeof gm.saveSaveFiles === 'function') {
          gm.saveSaveFiles();
        } else if (gm.functions?.saveSaveFiles) {
          gm.functions.saveSaveFiles();
        }
      }

      // 2. Obtain save data buffer from GameManager
      let saveData = null;
      if (gm && typeof gm.getSaveFile === 'function') {
        saveData = gm.getSaveFile(false);
      }

      const savePath = gm?.getSaveFilePath ? gm.getSaveFilePath() : null;
      if (!saveData && savePath && gm?.FS) {
        try {
          if (gm.FS.analyzePath(savePath).exists) {
            saveData = gm.FS.readFile(savePath);
          }
        } catch (e) {}
      }

      // 3. Fallback: search common save paths in Emscripten MEMFS
      const safeTitle = (this.romTitle || 'game').trim();
      const baseName = (this.romName || safeTitle).replace(/\.[^/.]+$/, '').trim();
      const candidates = [
        savePath,
        `/data/saves/${safeTitle}.srm`,
        `/data/saves/${safeTitle}.sav`,
        `/data/saves/${baseName}.srm`,
        `/data/saves/${baseName}.sav`,
        `/${safeTitle}.srm`,
        `/${safeTitle}.sav`
      ].filter(Boolean);

      if (!saveData && gm?.FS) {
        for (const p of candidates) {
          try {
            if (gm.FS.analyzePath(p).exists) {
              saveData = gm.FS.readFile(p);
              if (saveData && saveData.length > 0) break;
            }
          } catch (e) {}
        }
      }

      // 4. Fallback: read directly from IndexedDB ('/data/saves')
      if (!saveData || saveData.length === 0) {
        const idbData = await readSavFromIndexedDB(safeTitle, baseName, candidates);
        if (idbData && idbData.length > 0) {
          saveData = idbData;
        }
      }

      // 5. Fallback: read from localStorage backup
      if (!saveData || saveData.length === 0) {
        const b64 = localStorage.getItem('gba_sav_backup_' + safeTitle);
        if (b64) {
          try {
            const raw = atob(b64);
            const u8 = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
            saveData = u8;
          } catch (e) {}
        }
      }

      if (!saveData || saveData.length === 0) {
        if (window.showAppToast) {
          window.showAppToast('⚠️ Game chưa có dữ liệu lưu! Hãy vào menu game (Start -> Save) trước.');
        }
        return false;
      }

      const fileName = `${safeTitle}.sav`;
      const ok = downloadFile(fileName, saveData);
      if (ok && window.showAppToast) {
        window.showAppToast(`📤 Đã xuất file ${fileName} thành công!`);
      }
      return ok;
    } catch (e) {
      console.error('[GBA_K] Export save error:', e);
      if (window.showAppToast) {
        window.showAppToast('❌ Lỗi khi xuất file .SAV: ' + e.message);
      }
      return false;
    }
  }

  async importSavFile(arrayBuffer, fileName = null) {
    const sessionId = this._sessionId;
    if (!this.romLoaded) {
      if (window.showAppToast) window.showAppToast('⚠️ Vui lòng mở game trước khi nạp file .SAV!');
      return false;
    }

    try {
      const u8 = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
      if (!u8 || u8.length === 0 || u8.length > 1024 * 1024) {
        if (window.showAppToast) window.showAppToast('❌ File .SAV trống hoặc không hợp lệ!');
        return false;
      }

      const gm = this._gameManager;
      const savePath = gm?.getSaveFilePath ? gm.getSaveFilePath() : null;
      const safeTitle = (this.romTitle || 'game').trim();
      const baseName = (fileName || this.romName || safeTitle).replace(/\.[^/.]+$/, '').trim();

      const candidatePaths = [
        savePath,
        `/data/saves/${safeTitle}.srm`,
        `/data/saves/${safeTitle}.sav`,
        `/data/saves/${baseName}.srm`,
        `/data/saves/${baseName}.sav`,
        `/${safeTitle}.srm`,
        `/${safeTitle}.sav`
      ].filter(Boolean);

      // 1. Write to Emscripten MEMFS if active
      if (gm?.FS) {
        for (const p of candidatePaths) {
          try {
            gm.FS.writeFile(p, u8);
          } catch (e) {}
        }
        try {
          gm.FS.syncfs(false, () => {});
        } catch (e) {}
      }

      // 2. Direct persistence into IndexedDB ('/data/saves', 'FILE_DATA')
      let persisted = await writeSavToIndexedDB(safeTitle, baseName, u8, candidatePaths);
      if (sessionId !== this._sessionId) throw new Error('ROM đã thay đổi trong lúc nạp SAV.');

      // 3. Backup to localStorage for redundancy and immediate restore
      try {
        let binary = '';
        for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
        localStorage.setItem('gba_sav_backup_' + safeTitle, btoa(binary));
        persisted = true;
      } catch (e) {}
      if (!persisted) throw new Error('Không thể lưu SAV bền vững; hãy kiểm tra dung lượng lưu trữ.');
      this._currentSaveData = new Uint8Array(u8);
      if (this._pendingGameConfig) this._pendingGameConfig.initialSaveData = Array.from(u8);

      // 4. Reload save into core and restart game immediately without black screen
      if (gm) {
        try {
          if (typeof gm.loadSaveFiles === 'function') {
            gm.loadSaveFiles();
          }
        } catch (e) {}
        try {
          if (typeof gm.restart === 'function') {
            gm.restart();
          }
        } catch (e) {}
        if (window.showAppToast) {
          window.showAppToast('⚡ Đã nạp file .SAV và khởi động lại game thành công!');
        }
      } else if (this._pendingGameConfig) {
        this.reboot();
      }

      return true;
    } catch (e) {
      console.error('[GBA_K] Import save error:', e);
      if (window.showAppToast) {
        window.showAppToast('❌ Lỗi khi nạp file .SAV: ' + e.message);
      }
      return false;
    }
  }

  async getBatterySaveBuffer() {
    const gm = this._gameManager;
    try { gm?.saveSaveFiles?.(); } catch (error) {}
    let saveData = null;
    if (gm && typeof gm.getSaveFile === 'function') {
      try { saveData = gm.getSaveFile(false); } catch (e) {}
    }
    const savePath = gm?.getSaveFilePath ? gm.getSaveFilePath() : null;
    if (!saveData && savePath && gm?.FS) {
      try {
        if (gm.FS.analyzePath(savePath).exists) {
          saveData = gm.FS.readFile(savePath);
        }
      } catch (e) {}
    }
    const safeTitle = (this.romTitle || 'game').trim();
    const baseName = (this.romName || safeTitle).replace(/\.[^/.]+$/, '').trim();
    const candidates = [
      savePath,
      `/data/saves/${safeTitle}.srm`,
      `/data/saves/${safeTitle}.sav`,
      `/data/saves/${baseName}.srm`,
      `/data/saves/${baseName}.sav`,
      `/${safeTitle}.srm`,
      `/${safeTitle}.sav`
    ].filter(Boolean);

    if (!saveData && gm?.FS) {
      for (const p of candidates) {
        try {
          if (gm.FS.analyzePath(p).exists) {
            saveData = gm.FS.readFile(p);
            if (saveData && saveData.length > 0) break;
          }
        } catch (e) {}
      }
    }
    if (!saveData || saveData.length === 0) {
      const idb = await readSavFromIndexedDB(safeTitle, baseName, candidates);
      if (idb && idb.length > 0) saveData = idb;
    }
    if (!saveData || saveData.length === 0) {
      const b64 = localStorage.getItem('gba_sav_backup_' + safeTitle);
      if (b64) {
        try {
          const raw = atob(b64);
          const u8 = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
          saveData = u8;
        } catch (e) {}
      }
    }
    return saveData;
  }

  getBatterySaveInfo() {
    const safeTitle = (this.romTitle || 'game').trim();
    if (this._currentSaveData && this._currentSaveData.length > 0) {
      return {
        exists: true,
        size: this._currentSaveData.length,
        sizeKb: Math.round(this._currentSaveData.length / 1024)
      };
    }
    const b64 = localStorage.getItem('gba_sav_backup_' + safeTitle);
    if (b64) {
      const approxBytes = Math.round(b64.length * 0.75);
      return {
        exists: true,
        size: approxBytes,
        sizeKb: Math.round(approxBytes / 1024)
      };
    }
    return { exists: false, size: 0, sizeKb: 0 };
  }

  async clearBatterySave() {
    if (!this.romLoaded) return false;
    const sessionId = this._sessionId;
    const safeTitle = (this.romTitle || 'game').trim();
    const baseName = (this.romName || safeTitle).replace(/\.[^/.]+$/, '').trim();
    const gm = this._gameManager;
    const paths = [...new Set([
      gm?.getSaveFilePath?.(),
      `/data/saves/${safeTitle}.srm`, `/data/saves/${safeTitle}.sav`,
      `/data/saves/${baseName}.srm`, `/data/saves/${baseName}.sav`,
      `/${safeTitle}.srm`, `/${safeTitle}.sav`
    ].filter(Boolean))];
    const wasPaused = this.paused;
    this.pause();
    try {
      if (gm?.FS) {
        for (const path of paths) {
          if (gm.FS.analyzePath(path).exists) gm.FS.unlink(path);
        }
        if (gm.FS.syncfs) {
          await new Promise((resolve, reject) => gm.FS.syncfs(false, error => error ? reject(error) : resolve()));
        }
      }
      if (!await deleteBatteryFiles(paths)) throw new Error('Không thể xoá SAV khỏi bộ nhớ lưu trữ.');
      if (sessionId !== this._sessionId) throw new Error('ROM đã thay đổi trong lúc xoá SAV.');
      localStorage.removeItem('gba_sav_backup_' + safeTitle);
      localStorage.removeItem('gba_sav_backup_' + baseName);
      this._currentSaveData = null;
      if (this._pendingGameConfig) this._pendingGameConfig.initialSaveData = null;
      this.reboot();
      return true;
    } catch (error) {
      if (!wasPaused && sessionId === this._sessionId) this.resume();
      throw error;
    }
  }

  // ===== FREEZE LIST =====
  // Freezes work ENTIRELY through mGBA's native cheat engine (setCheat).
  // This is ~10,000x faster than the old approach which did full save/load state
  // (400KB serialize + deserialize) every 120ms via setInterval.

  _startFreezeLoop() {
    // No longer needed — freezes are applied as cheats via _applyCheatsToEJS()
  }

  _stopFreezeLoop() {
    // Clean up old timer if it exists from a previous version
    if (this._freezeTimer) {
      clearInterval(this._freezeTimer);
      this._freezeTimer = null;
    }
  }

  _applyAllFreezes() {
    // Simply push all freezes as cheat codes to the mGBA core
    this._applyCheatsToEJS();
  }

  applyFreezes() {
    this._applyCheatsToEJS();
  }

  addFreeze(address, value, dataType) {
    if (!globalThis.GBAKMemory.ramAccess(address, dataType, Number(value))) return false;
    this.freezeList = this.freezeList.filter(f => f.address !== address);
    this.freezeList.push({ address, value, dataType });
    this.saveFreezeList();
    this._applyCheatsToEJS();
    return true;
  }

  removeFreeze(address) {
    this.freezeList = this.freezeList.filter(f => f.address !== address);
    this.saveFreezeList();
    this._applyCheatsToEJS();
  }

  saveFreezeList() {
    try {
      localStorage.setItem('myboy_freezes_' + (this.romTitle || 'default'), JSON.stringify(this.freezeList));
      const checksum = this.getRomChecksum();
      if (checksum !== null) localStorage.setItem('myboy_freezes_crc_' + this.romTitle, String(checksum));
    } catch (e) {}
  }

  loadFreezeList() {
    try {
      const data = localStorage.getItem('myboy_freezes_' + (this.romTitle || 'default'));
      const entries = data ? JSON.parse(data) : [];
      const checksum = localStorage.getItem('myboy_freezes_crc_' + this.romTitle);
      this.freezeList = checksum !== null && checksum === String(this.getRomChecksum())
        ? (Array.isArray(entries) ? entries : []).filter(entry => entry && globalThis.GBAKMemory.ramAccess(entry.address, entry.dataType, Number(entry.value))) : [];
      // Stop any legacy freeze timer from previous versions
      this._stopFreezeLoop();
      // Apply all freezes as cheat codes
      this._applyCheatsToEJS();
    } catch (e) {
      this.freezeList = [];
    }
  }

  // ===== MMU & CORE SHIMS =====

  get mmu() {
    const self = this;
    return {
      get rom() { return new Uint8Array(0); },
      get romSize() { return self.romLoaded ? (self.romSize || 33554432) : 0; },
      get ewram() {
        const snap = self.getMemorySnapshot();
        return snap ? snap.ewram : new Uint8Array(0x40000);
      },
      get iwram() {
        const snap = self.getMemorySnapshot();
        return snap ? snap.iwram : new Uint8Array(0x8000);
      },
      read8(addr) { return self.readMemory(addr, 'u8'); },
      read16(addr) { return self.readMemory(addr, 'u16'); },
      read32(addr) { return self.readMemory(addr, 'u32'); },
      write8(addr, val) { return self.writeMemory(addr, val, 'u8'); },
      write16(addr, val) { return self.writeMemory(addr, val, 'u16'); },
      write32(addr, val) { return self.writeMemory(addr, val, 'u32'); },
      get saveData() { return new Uint8Array(0); }
    };
  }

  get core() {
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

  scheduleNextFrame() {}
  loop() {}
  runFrame() {}
}
