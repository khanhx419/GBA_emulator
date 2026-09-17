/**
 * EmulatorAdapter v3 — Production-grade Isolated WASM Bridge for GBA_K.
 * 
 * Uses an isolated iframe to run EmulatorJS / mGBA WebAssembly:
 * - 100% memory isolation (no Emscripten global collisions)
 * - Clean teardown & recreation on each ROM switch
 * - Direct WebGL canvas rendering inside canvas-wrapper
 * - Full parity for Input, Fast-Forward, Save/Load States, and Cheats
 */

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

  saveState(slot = 1) {
    const gm = this._gameManager;
    if (!this.romLoaded || !gm) return null;

    try {
      const stateInfo = gm.saveStateInfo();
      const statePath = `/data/saves/state_slot${slot}.state`;
      gm.loadState(statePath, 1); // 1 = save to path

      let stateData = [];
      try {
        stateData = Array.from(gm.FS.readFile(statePath));
      } catch (e) {}

      let screenshot = null;
      try {
        const ejsCanvas = this.iframe?.contentWindow?.document?.querySelector('canvas');
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
    const gm = this._gameManager;
    if (!this.romLoaded || !gm) return false;

    try {
      const json = localStorage.getItem(`myboy_savestate_${this.romTitle}_slot${slot}`);
      if (!json) return false;
      const stateObj = JSON.parse(json);

      if (stateObj.engine === 'emulatorjs' && stateObj.state) {
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
      applyCheats() {}
    };
  }

  _applyCheatsToEJS() {
    const gm = this._gameManager;
    if (!gm || !gm.setCheat) return;

    if (gm.resetCheat) gm.resetCheat();

    let idx = 0;
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
    if (!this.romLoaded || !gm) return;
    try {
      if (gm.saveSaveFiles) gm.saveSaveFiles();
      const savePath = gm.getSaveFilePath ? gm.getSaveFilePath() : null;
      if (savePath && gm.FS) {
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
    const gm = this._gameManager;
    if (!gm) return;
    try {
      const savePath = gm.getSaveFilePath ? gm.getSaveFilePath() : null;
      if (savePath && gm.FS) {
        gm.FS.writeFile(savePath, new Uint8Array(arrayBuffer));
        if (gm.loadSaveFiles) gm.loadSaveFiles();
      }
    } catch (e) {
      console.warn('[GBA_K] Import save error:', e);
    }
  }

  // ===== FREEZE LIST (limited in WASM mode) =====

  applyFreezes() {}
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

  // ===== MMU & CORE SHIMS =====

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
