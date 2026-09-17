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

    // Speed
    this.speed = 1.0;
    this._fastForward = false;
    this._speedMultiplier = 2.0;

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
      if (!event.data || typeof event.data !== 'object') return;

      if (event.data.type === 'EJS_IFRAME_READY') {
        if (this._pendingGameConfig && this.iframe && this.iframe.contentWindow) {
          this.iframe.contentWindow.postMessage({
            type: 'EJS_INIT_GAME',
            gameUrl: this._pendingGameConfig.gameUrl,
            gameName: this._pendingGameConfig.gameName
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

        if (this._fastForward) {
          this._applySpeed();
        }
      }
    });
  }

  // ===== ROM LOADING =====

  loadRom(arrayBuffer, fileName = 'game.gba') {
    this.romName = fileName;

    // Extract title from ROM header (offset 0xA0, 12 bytes)
    const data = new Uint8Array(arrayBuffer);
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
    if (this._fpsRafId) {
      cancelAnimationFrame(this._fpsRafId);
      this._fpsRafId = null;
    }

    // Hide original canvas, show iframe
    this.canvas.style.display = 'none';
    this.iframe.style.display = 'block';

    // Create a blob URL for the ROM
    const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);

    // Save pending config for handshake
    this._pendingGameConfig = {
      gameUrl: blobUrl,
      gameName: this.romTitle + '.gba' // Ensure extension for mGBA
    };

    // Reload iframe cleanly to destroy any previous WASM memory
    this.iframe.src = 'about:blank';
    setTimeout(() => {
      this.iframe.src = '/emulatorjs/embed.html';
    }, 50);

    return true;
  }

  getRomTitle() {
    return this.romTitle || this.romName.replace(/\.[^/.]+$/, '');
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

  setKeyDown(keyBit) {
    this._resumeAudio();
    const gm = this._gameManager;
    if (!gm || !gm.simulateInput) return;
    const btn = this._keyBitToEJSButton(keyBit);
    if (btn !== -1) {
      gm.simulateInput(0, btn, 1);
    }
  }

  setKeyUp(keyBit) {
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

  get fastForward() { return this._fastForward; }
  set fastForward(val) {
    this._fastForward = val;
    this._applySpeed();
  }

  get speedMultiplier() { return this._speedMultiplier; }
  set speedMultiplier(val) {
    this._speedMultiplier = val;
    this._applySpeed();
  }

  _applySpeed() {
    const ratio = Math.max(1, parseFloat(this._speedMultiplier) || 2.0);
    const isFF = !!this._fastForward;

    // 1. Post message to iframe (reliable across frame boundaries)
    try {
      this.iframe?.contentWindow?.postMessage({
        type: 'EJS_SET_SPEED',
        fastForward: isFF,
        speedMultiplier: ratio
      }, '*');
    } catch (e) {}

    // 2. Direct calls if same-context accessible
    try {
      const ejs = this.iframe?.contentWindow?.EJS_emulator;
      const gm = this._gameManager;

      if (ejs) {
        ejs.isFastForward = isFF;
        if (typeof ejs.changeSettingOption === 'function') {
          ejs.changeSettingOption('ff-ratio', ratio.toString());
          ejs.changeSettingOption('fastForward', isFF ? 'enabled' : 'disabled');
        }
      }

      if (gm) {
        if (gm.setFastForwardRatio) {
          gm.setFastForwardRatio(ratio);
        } else if (gm.functions?.setFastForwardRatio) {
          gm.functions.setFastForwardRatio(ratio);
        }

        if (gm.toggleFastForward) {
          gm.toggleFastForward(isFF ? 1 : 0);
        } else if (gm.functions?.toggleFastForward) {
          gm.functions.toggleFastForward(isFF ? 1 : 0);
        }
      }
    } catch (e) {}
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
          stateData = u8;
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
    if (!this.romLoaded || !gm) return false;

    try {
      const loaded = await saveStateManager.loadState(this.romTitle, slot);
      if (!loaded || !loaded.state) return false;

      const u8 = loaded.state instanceof Uint8Array ? loaded.state : new Uint8Array(loaded.state);
      if (typeof gm.loadState === 'function') {
        gm.loadState(u8);
        return true;
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

  // ===== MEMORY ACCESS FOR SCANNER =====

  getMemorySnapshot() {
    const gm = this._gameManager;
    if (!this.romLoaded || !gm) return null;
    try {
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

      if (state && state.length >= 0x61000) {
        // EWRAM starts at 0x21000, length 0x40000 (256KB)
        // IWRAM starts at 0x19000, length 0x8000 (32KB)
        return {
          ewram: state.subarray(0x21000, 0x21000 + 0x40000),
          iwram: state.subarray(0x19000, 0x19000 + 0x8000),
          fullState: state
        };
      }
    } catch (e) {
      console.warn('[EmulatorAdapter] getMemorySnapshot error:', e);
    }
    return null;
  }

  readMemory(addr, type = 'u16', cachedSnapshot = null) {
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

    if (type === 'u8') {
      return buf[offset];
    } else if (type === 'u16') {
      return buf[offset] | (buf[offset + 1] << 8);
    } else if (type === 'u32') {
      return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
    }
    return 0;
  }

  writeMemory(addr, val, type = 'u16') {
    const gm = this._gameManager;
    if (!this.romLoaded || !gm) return false;
    try {
      const snap = this.getMemorySnapshot();
      if (!snap) return false;
      const state = snap.fullState;

      let targetOffset = -1;
      if (addr >= 0x02000000 && addr < 0x02040000) {
        targetOffset = 0x21000 + (addr - 0x02000000);
      } else if (addr >= 0x03000000 && addr < 0x03008000) {
        targetOffset = 0x19000 + (addr - 0x03000000);
      }

      if (targetOffset !== -1) {
        val = Number(val);
        if (type === 'u8') {
          state[targetOffset] = val & 0xFF;
        } else if (type === 'u16') {
          state[targetOffset] = val & 0xFF;
          state[targetOffset + 1] = (val >> 8) & 0xFF;
        } else if (type === 'u32') {
          state[targetOffset] = val & 0xFF;
          state[targetOffset + 1] = (val >> 8) & 0xFF;
          state[targetOffset + 2] = (val >> 16) & 0xFF;
          state[targetOffset + 3] = (val >>> 24) & 0xFF;
        }
        gm.loadState(state);
        return true;
      }
    } catch (e) {
      console.warn('[EmulatorAdapter] writeMemory error:', e);
    }
    return false;
  }

  // ===== CHEATS =====

  get cheats() {
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
    const gm = this._gameManager;
    if (!gm || !gm.setCheat) return;

    if (gm.resetCheat) gm.resetCheat();

    let idx = 0;
    // 1. Regular Cheats
    for (const cheat of this._cheats) {
      if (!cheat.enabled) continue;
      const lines = cheat.code.trim().split(/[\n\r]+/);
      for (const line of lines) {
        const clean = line.replace(/\s+/g, ' ').trim();
        if (clean) {
          gm.setCheat(idx, 1, clean);
          idx++;
        }
      }
    }

    // 2. Active Freezes as hardware cheats
    for (const f of this.freezeList) {
      const code = this._formatFreezeAsCheat(f.address, f.value, f.dataType);
      if (code) {
        gm.setCheat(idx, 1, code);
        idx++;
      }
    }
  }

  _formatFreezeAsCheat(addr, val, type = 'u16') {
    val = Number(val);
    if (addr >= 0x02000000 && addr < 0x02040000) {
      const offset = (addr - 0x02000000).toString(16).padStart(6, '0').toUpperCase();
      if (type === 'u8') return `3200${offset.slice(2)} 00${(val & 0xFF).toString(16).padStart(2, '0').toUpperCase()}`;
      if (type === 'u32') return `0400${offset.slice(2)} ${(val >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
      return `8200${offset.slice(2)} ${(val & 0xFFFF).toString(16).padStart(4, '0').toUpperCase()}`;
    } else if (addr >= 0x03000000 && addr < 0x03008000) {
      const offset = (addr - 0x03000000).toString(16).padStart(6, '0').toUpperCase();
      if (type === 'u8') return `3300${offset.slice(2)} 00${(val & 0xFF).toString(16).padStart(2, '0').toUpperCase()}`;
      if (type === 'u32') return `0400${offset.slice(2)} ${(val >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
      return `8300${offset.slice(2)} ${(val & 0xFFFF).toString(16).padStart(4, '0').toUpperCase()}`;
    }
    return null;
  }

  _saveCheatsToStorage() {
    try {
      localStorage.setItem('myboy_cheats_' + (this.romTitle || 'default'), JSON.stringify(this._cheats));
    } catch (e) {}
  }

  _loadCheatsFromStorage() {
    try {
      const data = localStorage.getItem('myboy_cheats_' + (this.romTitle || 'default'));
      this._cheats = data ? JSON.parse(data) : [];
      this._applyCheatsToEJS();
    } catch (e) {
      this._cheats = [];
    }
  }

  // ===== AUDIO =====

  get apu() {
    const self = this;
    return {
      setVolume(v) {
        try {
          const ejs = self.iframe?.contentWindow?.EJS_emulator;
          if (ejs && ejs.setVolume) {
            ejs.setVolume(Math.max(0, Math.min(1, v)));
          }
        } catch (e) {}
      }
    };
  }

  // ===== FPS COUNTER =====

  _startFpsCounter() {
    if (this._fpsRafId) cancelAnimationFrame(this._fpsRafId);
    this._fpsFrames = 0;
    this._fpsLastTime = performance.now();

    const tick = () => {
      this._fpsFrames++;
      const now = performance.now();
      if (now - this._fpsLastTime >= 1000) {
        this.fps = this._fpsFrames;
        this._fpsFrames = 0;
        this._fpsLastTime = now;
        if (this.onFpsUpdate) this.onFpsUpdate(this.fps);
      }
      this._fpsRafId = requestAnimationFrame(tick);
    };
    tick();
  }

  // ===== BATTERY SAVE =====

  exportSavFile() {
    const gm = this._gameManager;
    if (!this.romLoaded || !gm) {
      if (window.showAppToast) window.showAppToast('⚠️ Vui lòng mở game trước khi xuất file .SAV!');
      return false;
    }

    try {
      // 1. Force flush SRAM from core to filesystem
      if (typeof gm.saveSaveFiles === 'function') {
        gm.saveSaveFiles();
      } else if (gm.functions?.saveSaveFiles) {
        gm.functions.saveSaveFiles();
      }

      // 2. Obtain save data buffer
      let saveData = null;
      if (typeof gm.getSaveFile === 'function') {
        saveData = gm.getSaveFile(false);
      }

      if (!saveData && gm.getSaveFilePath && gm.FS) {
        const savePath = gm.getSaveFilePath();
        if (savePath && gm.FS.analyzePath(savePath).exists) {
          saveData = gm.FS.readFile(savePath);
        }
      }

      // 3. Fallback: search common save paths in Emscripten MEMFS
      if (!saveData && gm.FS) {
        const title = this.romTitle || 'game';
        const candidates = [
          `/data/saves/${title}.srm`,
          `/data/saves/${title}.sav`,
          `/${title}.srm`,
          `/${title}.sav`,
          `/data/saves/game.srm`,
          `/data/saves/game.sav`,
          `/game.srm`,
          `/game.sav`
        ];
        for (const p of candidates) {
          try {
            if (gm.FS.analyzePath(p).exists) {
              saveData = gm.FS.readFile(p);
              break;
            }
          } catch (e) {}
        }
      }

      if (!saveData || saveData.length === 0) {
        if (window.showAppToast) {
          window.showAppToast('⚠️ Game chưa có dữ liệu lưu! Hãy vào menu game (Start -> Save) trước.');
        }
        return false;
      }

      const fileName = `${this.romTitle || 'game'}.sav`;
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

  importSavFile(arrayBuffer) {
    const gm = this._gameManager;
    if (!gm || !gm.FS) {
      if (window.showAppToast) window.showAppToast('⚠️ Vui lòng mở game trước khi nạp file .SAV!');
      return false;
    }
    try {
      const u8 = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
      const savePath = gm.getSaveFilePath ? gm.getSaveFilePath() : null;
      if (savePath) {
        gm.FS.writeFile(savePath, u8);
      }
      // Also write to common candidates so RetroArch finds it
      const title = this.romTitle || 'game';
      const paths = [
        savePath,
        `/data/saves/${title}.srm`,
        `/data/saves/${title}.sav`,
        `/${title}.srm`,
        `/${title}.sav`
      ].filter(Boolean);

      for (const p of paths) {
        try {
          gm.FS.writeFile(p, u8);
        } catch (e) {}
      }

      if (typeof gm.loadSaveFiles === 'function') {
        gm.loadSaveFiles();
      } else if (gm.functions?.loadSaveFiles) {
        gm.functions.loadSaveFiles();
      }

      if (window.showAppToast) {
        window.showAppToast('📥 Đã nạp file .SAV! Đang khởi động lại để nhận file lưu...');
      }

      setTimeout(() => {
        this.reset();
      }, 500);

      return true;
    } catch (e) {
      console.error('[GBA_K] Import save error:', e);
      if (window.showAppToast) {
        window.showAppToast('❌ Lỗi khi nạp file .SAV: ' + e.message);
      }
      return false;
    }
  }

  // ===== FREEZE LIST =====

  applyFreezes() {
    this._applyCheatsToEJS();
  }

  addFreeze(address, value, dataType) {
    this.freezeList = this.freezeList.filter(f => f.address !== address);
    this.freezeList.push({ address, value, dataType });
    this.saveFreezeList();
    this._applyCheatsToEJS();
  }

  removeFreeze(address) {
    this.freezeList = this.freezeList.filter(f => f.address !== address);
    this.saveFreezeList();
    this._applyCheatsToEJS();
  }

  saveFreezeList() {
    try {
      localStorage.setItem('myboy_freezes_' + (this.romTitle || 'default'), JSON.stringify(this.freezeList));
    } catch (e) {}
  }

  loadFreezeList() {
    try {
      const data = localStorage.getItem('myboy_freezes_' + (this.romTitle || 'default'));
      this.freezeList = data ? JSON.parse(data) : [];
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
      get romSize() { return 0; },
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
