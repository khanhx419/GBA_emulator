/**
 * EmulatorAdapter v2 — Correct integration with EmulatorJS.
 * 
 * Architecture:
 * - EmulatorJS renders DIRECTLY into the canvas-wrapper area (no canvas copy hack)
 * - GBA_K UI controls (virtual buttons, menu, modals) overlay on top
 * - EmulatorJS default UI (toolbar, virtual gamepad) is hidden via CSS
 * - ROM loading: each new ROM creates a fresh EmulatorJS instance with blob URL
 * - Input: our controls → gameManager.simulateInput()
 * - Save/Load: gameManager state API
 * - Cheats: gameManager.setCheat / resetCheat
 * - Speed: gameManager.toggleFastForward / setFastForwardRatio
 */

export class EmulatorAdapter {
  constructor(canvas) {
    this.canvas = canvas;
    this.ejsReady = false;
    this.ejsInstance = null;

    // State flags (same API as GBA class)
    this.running = false;
    this.paused = false;
    this.romLoaded = false;
    this.romName = 'No ROM Loaded';
    this.romTitle = '';

    // Speed
    this.speed = 1.0;
    this._fastForward = false;
    this._speedMultiplier = 2.0;

    // FPS
    this.fps = 0;
    this.onFpsUpdate = null;
    this._fpsFrames = 0;
    this._fpsLastTime = performance.now();

    // Freeze list (limited in WASM mode)
    this.freezeList = [];

    // Cheats
    this._cheats = [];

    // Create the EJS container inside canvas-wrapper
    this._setupContainer();

    // Inject CSS to hide EmulatorJS default UI
    this._injectHideCSS();
  }

  // ===== SETUP =====

  _setupContainer() {
    // Find the canvas wrapper and create an EJS container inside it
    const wrapper = this.canvas.parentElement; // #canvas-wrapper
    
    this._ejsContainer = document.createElement('div');
    this._ejsContainer.id = 'ejs-game-container';
    this._ejsContainer.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      z-index: 1; display: none;
    `;
    wrapper.style.position = 'relative';
    wrapper.appendChild(this._ejsContainer);

    // Hide the original canvas — EmulatorJS will provide its own
    this.canvas.style.display = 'none';
  }

  _injectHideCSS() {
    const style = document.createElement('style');
    style.textContent = `
      /* Hide ALL EmulatorJS default UI elements — we use our own */
      .ejs_parent .ejs_bar,
      .ejs_parent .ejs_bottom_bar,
      .ejs_parent .ejs_bottom_bar_area,
      .ejs_parent .ejs_context_menu,
      .ejs_parent .ejs_virtualGamepad_container,
      .ejs_parent .ejs_menu_bar,
      .ejs_parent .ejs_menu_bar_hidden,
      .ejs_parent .ejs_cheat_menu,
      .ejs_parent .ejs_control_bar,
      .ejs_parent [class*="ejs_menu"],
      .ejs_parent [class*="ejs_popup"],
      .ejs_parent .ejs_loading_text,
      .ejs_start_button {
        display: none !important;
        pointer-events: none !important;
      }
      /* Make the EJS canvas fill our container */
      #ejs-game-container {
        background: #000;
      }
      #ejs-game-container .ejs_parent {
        width: 100% !important;
        height: 100% !important;
      }
      #ejs-game-container canvas {
        width: 100% !important;
        height: 100% !important;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
    `;
    document.head.appendChild(style);
  }

  // ===== ROM LOADING =====

  loadRom(arrayBuffer, fileName = 'game.gba') {
    this.romName = fileName;

    // Extract title from ROM header
    const data = new Uint8Array(arrayBuffer);
    let title = '';
    for (let i = 0xA0; i < 0xAC; i++) {
      const ch = data[i];
      if (ch === 0) break;
      title += String.fromCharCode(ch);
    }
    this.romTitle = title.trim() || fileName.replace(/\.[^/.]+$/, '');

    // Destroy existing instance if any
    this._destroyEJS();

    // Create blob URL for the ROM
    const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);

    // Show the EJS container
    this._ejsContainer.style.display = 'block';
    this._ejsContainer.innerHTML = ''; // Clear previous

    // Configure EmulatorJS globals
    window.EJS_player = '#ejs-game-container';
    window.EJS_core = 'gba';
    window.EJS_gameUrl = blobUrl;
    window.EJS_gameName = this.romTitle;
    window.EJS_color = '#000000';
    window.EJS_backgroundColor = '#000000';
    window.EJS_startOnLoaded = true;  // Auto-start, no "Start Game" button
    window.EJS_threads = false;       // Single-thread for Android WebView
    window.EJS_pathtodata = '/emulatorjs/'; // LOCAL files, not CDN!
    window.EJS_DEBUG_XX = false;
    window.EJS_language = 'vi';
    window.EJS_noAutoFocus = true;

    // Disable ALL EmulatorJS UI
    window.EJS_Buttons = {
      playPause: false, restart: false, mute: false, settings: false,
      fullscreen: false, saveState: false, loadState: false,
      screenRecord: false, gamepad: false, cheat: false, volume: false,
      saveSavFiles: false, loadSavFiles: false, quickSave: false, quickLoad: false,
      screenshot: false, cacheManager: false
    };
    window.EJS_VirtualGamepadSettings = { type: 'none' };

    // Set up callbacks
    window.EJS_onGameStart = () => {
      console.log('[GBA_K] WASM game started!');
      this.ejsReady = true;
      this.running = true;
      this.paused = false;
      this.romLoaded = true;
      this.ejsInstance = window.EJS_emulator;
      this._startFpsCounter();
      this._loadCheatsFromStorage();
      this.loadFreezeList();

      // Apply speed if fast forward was on
      if (this._fastForward) {
        this._applySpeed();
      }
    };

    // Load EmulatorJS — it will download core WASM, then start the game
    this._loadEJS();

    return true;
  }

  _loadEJS() {
    // Remove any previous EmulatorJS scripts to prevent conflicts
    document.querySelectorAll('script[data-ejs-loader]').forEach(s => s.remove());

    const script = document.createElement('script');
    script.src = '/emulatorjs/loader.js';
    script.setAttribute('data-ejs-loader', 'true');
    script.async = true;
    script.onload = () => {
      console.log('[GBA_K] EmulatorJS loader initialized');
    };
    script.onerror = () => {
      console.error('[GBA_K] Failed to load EmulatorJS');
      // Show error to user
      this._ejsContainer.innerHTML = '<div style="color:#ff4444;text-align:center;padding:20px;font-size:14px;">Không tải được WASM engine. Hãy chuyển sang JavaScript Engine trong Cài đặt.</div>';
    };
    document.head.appendChild(script);
  }

  _destroyEJS() {
    if (this.ejsInstance) {
      try {
        this.ejsInstance.callEvent('exit');
      } catch (e) {
        console.warn('[GBA_K] Error destroying EJS:', e);
      }
      this.ejsInstance = null;
    }
    this.ejsReady = false;
    // Clean up global EJS state
    delete window.EJS_emulator;
    delete window.EJS_onGameStart;
    // Stop FPS counter
    if (this._fpsRafId) {
      cancelAnimationFrame(this._fpsRafId);
      this._fpsRafId = null;
    }
  }

  getRomTitle() {
    return this.romTitle || this.romName.replace(/\.[^/.]+$/, '');
  }

  // ===== EMULATION CONTROLS =====

  reset() {
    if (this.ejsInstance && this.ejsInstance.gameManager) {
      this.ejsInstance.gameManager.restart();
    }
  }

  start() {
    if (!this.romLoaded) return;
    this.running = true;
    this.paused = false;
    if (this.ejsInstance && this.ejsInstance.gameManager) {
      this.ejsInstance.gameManager.toggleMainLoop(1);
    }
  }

  pause() {
    this.paused = true;
    if (this.ejsInstance && this.ejsInstance.gameManager) {
      this.ejsInstance.gameManager.toggleMainLoop(0);
    }
  }

  resume() {
    if (this.romLoaded && this.paused) {
      this.paused = false;
      if (this.ejsInstance && this.ejsInstance.gameManager) {
        this.ejsInstance.gameManager.toggleMainLoop(1);
      }
    }
  }

  // ===== INPUT =====

  setKeyDown(keyBit) {
    if (!this.ejsInstance || !this.ejsInstance.gameManager) return;
    const btn = this._keyBitToEJSButton(keyBit);
    if (btn !== -1) {
      this.ejsInstance.gameManager.simulateInput(0, btn, 1);
    }
  }

  setKeyUp(keyBit) {
    if (!this.ejsInstance || !this.ejsInstance.gameManager) return;
    const btn = this._keyBitToEJSButton(keyBit);
    if (btn !== -1) {
      this.ejsInstance.gameManager.simulateInput(0, btn, 0);
    }
  }

  _keyBitToEJSButton(keyBit) {
    // GBA_K KEYS → RetroArch/Libretro button indices
    // RetroArch GBA mapping: 0=B, 1=Y(n/a), 2=Select, 3=Start,
    // 4=Up, 5=Down, 6=Left, 7=Right, 8=A, 9=X(n/a), 10=L, 11=R
    const map = {
      0x0001: 8,   // A
      0x0002: 0,   // B
      0x0004: 2,   // SELECT
      0x0008: 3,   // START
      0x0010: 7,   // RIGHT
      0x0020: 6,   // LEFT
      0x0040: 4,   // UP
      0x0080: 5,   // DOWN
      0x0100: 10,  // R
      0x0200: 11,  // L
    };
    return map[keyBit] ?? -1;
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
    if (!this.ejsInstance || !this.ejsInstance.gameManager) return;
    const gm = this.ejsInstance.gameManager;
    if (this._fastForward) {
      gm.toggleFastForward(1);
      gm.setFastForwardRatio(this._speedMultiplier);
    } else {
      gm.toggleFastForward(0);
    }
  }

  // ===== SAVE / LOAD STATE =====

  saveState(slot = 1) {
    if (!this.romLoaded || !this.ejsInstance || !this.ejsInstance.gameManager) return null;

    try {
      const gm = this.ejsInstance.gameManager;
      const stateInfo = gm.saveStateInfo();
      
      // Save state to FS
      const statePath = `/data/saves/state_slot${slot}.state`;
      gm.loadState(statePath, 1); // 1 = save

      // Read back the state file
      let stateData = [];
      try {
        stateData = Array.from(gm.FS.readFile(statePath));
      } catch (e) {}

      // Get screenshot from the EJS canvas
      let screenshot = null;
      try {
        const ejsCanvas = this._ejsContainer.querySelector('canvas');
        if (ejsCanvas) screenshot = ejsCanvas.toDataURL('image/jpeg', 0.8);
      } catch (e) {}

      const stateObj = {
        version: 2,
        engine: 'emulatorjs',
        romTitle: this.romTitle,
        timestamp: Date.now(),
        state: stateData,
        screenshot
      };

      localStorage.setItem(`myboy_savestate_${this.romTitle}_slot${slot}`, JSON.stringify(stateObj));
      return stateObj;
    } catch (e) {
      console.warn('[GBA_K] Save state error:', e);
      return null;
    }
  }

  loadState(slot = 1) {
    if (!this.romLoaded || !this.ejsInstance || !this.ejsInstance.gameManager) return false;

    try {
      const json = localStorage.getItem(`myboy_savestate_${this.romTitle}_slot${slot}`);
      if (!json) return false;
      const stateObj = JSON.parse(json);

      if (stateObj.engine === 'emulatorjs' && stateObj.state) {
        const gm = this.ejsInstance.gameManager;
        const statePath = `/data/saves/state_slot${slot}.state`;
        gm.FS.writeFile(statePath, new Uint8Array(stateObj.state));
        gm.loadState(statePath, 0); // 0 = load
        return true;
      }
      return false;
    } catch (e) {
      console.error('[GBA_K] Load state error:', e);
      return false;
    }
  }

  getStateInfo(slot = 1) {
    try {
      const json = localStorage.getItem(`myboy_savestate_${this.romTitle}_slot${slot}`);
      if (!json) return null;
      const data = JSON.parse(json);
      return { timestamp: data.timestamp, screenshot: data.screenshot };
    } catch (e) {
      return null;
    }
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
      applyCheats() { /* handled by mGBA core internally */ }
    };
  }

  _applyCheatsToEJS() {
    if (!this.ejsInstance || !this.ejsInstance.gameManager) return;
    const gm = this.ejsInstance.gameManager;

    // Reset all cheats first
    gm.resetCheat();

    // Apply enabled cheats
    let idx = 0;
    for (const cheat of this._cheats) {
      if (!cheat.enabled) continue;
      const lines = cheat.code.trim().split(/[\n\r]+/);
      for (const line of lines) {
        const clean = line.replace(/\s+/g, ' ').trim();
        if (clean) {
          gm.setCheat(idx, 1, clean); // index, enabled, code
          idx++;
        }
      }
    }
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
        if (self.ejsInstance && self.ejsInstance.setVolume) {
          self.ejsInstance.setVolume(Math.max(0, Math.min(1, v)));
        }
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
    if (!this.romLoaded || !this.ejsInstance || !this.ejsInstance.gameManager) return;
    try {
      const gm = this.ejsInstance.gameManager;
      gm.saveSaveFiles();
      const savePath = gm.getSaveFilePath();
      if (savePath) {
        const saveData = gm.FS.readFile(savePath);
        const blob = new Blob([saveData], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.romTitle || 'game'}.sav`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.warn('[GBA_K] Export save error:', e);
    }
  }

  importSavFile(arrayBuffer) {
    if (!this.ejsInstance || !this.ejsInstance.gameManager) return;
    try {
      const gm = this.ejsInstance.gameManager;
      const savePath = gm.getSaveFilePath();
      if (savePath) {
        gm.FS.writeFile(savePath, new Uint8Array(arrayBuffer));
        gm.loadSaveFiles();
      }
    } catch (e) {
      console.warn('[GBA_K] Import save error:', e);
    }
  }

  // ===== FREEZE LIST (limited in WASM) =====

  applyFreezes() { /* No-op in WASM mode — use cheats instead */ }

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
      localStorage.setItem('myboy_freezes_' + (this.romTitle || 'default'), JSON.stringify(this.freezeList));
    } catch (e) {}
  }

  loadFreezeList() {
    try {
      const data = localStorage.getItem('myboy_freezes_' + (this.romTitle || 'default'));
      this.freezeList = data ? JSON.parse(data) : [];
    } catch (e) {
      this.freezeList = [];
    }
  }

  // ===== MMU BRIDGE (limited in WASM) =====

  get mmu() {
    return {
      get rom() { return new Uint8Array(0); },
      get romSize() { return 0; },
      get ewram() { return new Uint8Array(0x40000); },
      get iwram() { return new Uint8Array(0x8000); },
      read8() { return 0; }, read16() { return 0; }, read32() { return 0; },
      write8() {}, write16() {}, write32() {},
      get saveData() { return new Uint8Array(0); }
    };
  }

  // ===== CORE COMPAT SHIM =====

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

  // ===== UNUSED BUT NEEDED FOR API COMPAT =====
  scheduleNextFrame() {}
  loop() {}
  runFrame() {}
}
