import { KEYS } from '../core/gba-constants.js';

export const DEFAULT_KEY_MAP = {
  'KeyZ': KEYS.A,
  'KeyJ': KEYS.A,
  'KeyX': KEYS.B,
  'KeyK': KEYS.B,
  'KeyA': KEYS.L,
  'KeyQ': KEYS.L,
  'KeyS': KEYS.R,
  'KeyE': KEYS.R,
  'Enter': KEYS.START,
  'Space': KEYS.SELECT,
  'ShiftRight': KEYS.SELECT,
  'ArrowUp': KEYS.UP,
  'KeyW': KEYS.UP,
  'ArrowDown': KEYS.DOWN,
  'ArrowLeft': KEYS.LEFT,
  'KeyD': KEYS.RIGHT,
  'ArrowRight': KEYS.RIGHT
};

export class GBAControls {
  constructor(gba) {
    this.gba = gba;
    this.turboAInterval = null;
    this.turboBInterval = null;
    this.hapticsEnabled = true;

    // Movement mode: 'dpad' | 'fixed' | 'floating'
    this.movementMode = localStorage.getItem('myboy_control_type') || 'dpad';

    // Layout Editor state
    this.isEditingLayout = false;
    this.selectedElementId = 'dpad-container';
    this.scales = {
      'dpad-container': 1.0,
      'action-buttons-container': 1.0,
      'shoulder-container': 1.0
    };

    // Load custom key bindings or fallback to default
    this.keyMap = this.loadKeyMap();

    this.initKeyboard();
    this.initTouchControls();
    this.initJoystick();
    this.initGamepad();
    this.initLayoutSystem();
  }

  loadKeyMap() {
    try {
      const saved = localStorage.getItem('myboy_key_bindings');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {}
    return { ...DEFAULT_KEY_MAP };
  }

  saveKeyMap() {
    try {
      localStorage.setItem('myboy_key_bindings', JSON.stringify(this.keyMap));
    } catch (e) {}
  }

  resetKeyMap() {
    this.keyMap = { ...DEFAULT_KEY_MAP };
    this.saveKeyMap();
  }

  // Clear all key codes mapped to a specific button
  clearButtonBindings(gbaKeyBit) {
    for (const [code, bit] of Object.entries(this.keyMap)) {
      if (bit === gbaKeyBit) {
        delete this.keyMap[code];
      }
    }
    this.saveKeyMap();
  }

  // Replace all bindings for a button with a new key code
  rebindButton(gbaKeyBit, keyCode) {
    // Delete any other button using this keyCode
    delete this.keyMap[keyCode];
    // Clear old keys for this specific button
    for (const [code, bit] of Object.entries(this.keyMap)) {
      if (bit === gbaKeyBit) {
        delete this.keyMap[code];
      }
    }
    this.keyMap[keyCode] = gbaKeyBit;
    this.saveKeyMap();
  }

  // Set key code for a specific GBA button bit (additional binding)
  setKeyBinding(keyCode, gbaKeyBit) {
    // Remove existing binding for this code
    delete this.keyMap[keyCode];
    this.keyMap[keyCode] = gbaKeyBit;
    this.saveKeyMap();
  }

  // Get current key codes mapped to a GBA button
  getKeysForButton(gbaKeyBit) {
    const keys = [];
    for (const [code, bit] of Object.entries(this.keyMap)) {
      if (bit === gbaKeyBit) {
        keys.push(code);
      }
    }
    return keys;
  }

  triggerHaptic() {
    if (!this.hapticsEnabled) return;
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) {
        window.Capacitor.Plugins.Haptics.impact({ style: 'LIGHT' });
      } else if (navigator.vibrate) {
        navigator.vibrate(12);
      }
    } catch (e) {}
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Hotkeys
      if (e.code === 'Tab') {
        e.preventDefault();
        this.gba.fastForward = true;
        return;
      }
      if (e.code === 'F1') {
        e.preventDefault();
        this.gba.saveState(1);
        return;
      }
      if (e.code === 'F3') {
        e.preventDefault();
        this.gba.loadState(1);
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
      }

      if (this.keyMap[e.code] !== undefined) {
        e.preventDefault();
        this.gba.setKeyDown(this.keyMap[e.code]);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.gba.fastForward = false;
        return;
      }

      if (this.keyMap[e.code] !== undefined) {
        e.preventDefault();
        this.gba.setKeyUp(this.keyMap[e.code]);
      }
    });
  }

  initTouchControls() {
    // Virtual D-Pad Touch handling
    const dpad = document.getElementById('dpad');
    if (dpad) {
      let activeTouchId = null;

      const handleDpad = (clientX, clientY) => {
        const rect = dpad.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = clientX - centerX;
        const dy = clientY - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Deadzone check
        if (dist < rect.width * 0.12) {
          this.gba.setKeyUp(KEYS.UP);
          this.gba.setKeyUp(KEYS.DOWN);
          this.gba.setKeyUp(KEYS.LEFT);
          this.gba.setKeyUp(KEYS.RIGHT);
          return;
        }

        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        // 8 Directions
        const isRight = (angle >= -67.5 && angle <= 67.5);
        const isDown = (angle >= 22.5 && angle <= 157.5);
        const isLeft = (angle >= 112.5 || angle <= -112.5);
        const isUp = (angle >= -157.5 && angle <= -22.5);

        if (isRight) this.gba.setKeyDown(KEYS.RIGHT); else this.gba.setKeyUp(KEYS.RIGHT);
        if (isLeft) this.gba.setKeyDown(KEYS.LEFT); else this.gba.setKeyUp(KEYS.LEFT);
        if (isUp) this.gba.setKeyDown(KEYS.UP); else this.gba.setKeyUp(KEYS.UP);
        if (isDown) this.gba.setKeyDown(KEYS.DOWN); else this.gba.setKeyUp(KEYS.DOWN);
      };

      dpad.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.changedTouches.length > 0) {
          const t = e.changedTouches[0];
          activeTouchId = t.identifier;
          this.triggerHaptic();
          handleDpad(t.clientX, t.clientY);
        }
      }, { passive: false });

      dpad.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === activeTouchId) {
            handleDpad(t.clientX, t.clientY);
            break;
          }
        }
      }, { passive: false });

      const releaseDpad = (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === activeTouchId) {
            activeTouchId = null;
            this.gba.setKeyUp(KEYS.UP);
            this.gba.setKeyUp(KEYS.DOWN);
            this.gba.setKeyUp(KEYS.LEFT);
            this.gba.setKeyUp(KEYS.RIGHT);
            break;
          }
        }
      };

      dpad.addEventListener('touchend', releaseDpad, { passive: false });
      dpad.addEventListener('touchcancel', releaseDpad, { passive: false });
    }

    // Bind standard button elements
    this.bindTouchButton('btn-a', KEYS.A);
    this.bindTouchButton('btn-b', KEYS.B);
    this.bindTouchButton('btn-l', KEYS.L);
    this.bindTouchButton('btn-r', KEYS.R);
    this.bindTouchButton('btn-start', KEYS.START);
    this.bindTouchButton('btn-select', KEYS.SELECT);

    // Turbo A & B
    this.bindTurboButton('btn-turbo-a', KEYS.A);
    this.bindTurboButton('btn-turbo-b', KEYS.B);

    // Fast-Forward Toggle
    const ffBtn = document.getElementById('btn-fastforward');
    if (ffBtn) {
      ffBtn.addEventListener('click', () => {
        if (this.isEditingLayout) return;
        this.triggerHaptic();
        this.gba.fastForward = !this.gba.fastForward;
        ffBtn.classList.toggle('active', this.gba.fastForward);
      });
    }
  }

  bindTouchButton(elementId, keyBit) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const press = (e) => {
      if (this.isEditingLayout) return;
      e.preventDefault();
      el.classList.add('pressed');
      this.triggerHaptic();
      this.gba.setKeyDown(keyBit);
    };

    const release = (e) => {
      if (this.isEditingLayout) return;
      e.preventDefault();
      el.classList.remove('pressed');
      this.gba.setKeyUp(keyBit);
    };

    el.addEventListener('touchstart', press, { passive: false });
    el.addEventListener('touchend', release, { passive: false });
    el.addEventListener('touchcancel', release, { passive: false });
    el.addEventListener('mousedown', press);
    el.addEventListener('mouseup', release);
    el.addEventListener('mouseleave', release);
  }

  bindTurboButton(elementId, keyBit) {
    const el = document.getElementById(elementId);
    if (!el) return;

    let timer = null;
    let state = false;

    const startTurbo = (e) => {
      if (this.isEditingLayout) return;
      e.preventDefault();
      el.classList.add('pressed');
      this.triggerHaptic();
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        state = !state;
        if (state) this.gba.setKeyDown(keyBit);
        else this.gba.setKeyUp(keyBit);
      }, 33);
    };

    const stopTurbo = (e) => {
      if (this.isEditingLayout) return;
      e.preventDefault();
      el.classList.remove('pressed');
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      this.gba.setKeyUp(keyBit);
    };

    el.addEventListener('touchstart', startTurbo, { passive: false });
    el.addEventListener('touchend', stopTurbo, { passive: false });
    el.addEventListener('touchcancel', stopTurbo, { passive: false });
    el.addEventListener('mousedown', startTurbo);
    el.addEventListener('mouseup', stopTurbo);
    el.addEventListener('mouseleave', stopTurbo);
  }

  // =========================================================================
  // Movement Mode & Virtual Joystick (Fixed / Floating)
  // =========================================================================
  setMovementMode(mode) {
    this.movementMode = mode;
    const dpadEl = document.getElementById('dpad-container');
    const joyEl = document.getElementById('joystick-zone');
    const base = document.getElementById('joystick-base');

    if (dpadEl && joyEl) {
      if (mode === 'dpad') {
        dpadEl.style.display = 'flex';
        joyEl.style.display = 'none';
      } else {
        dpadEl.style.display = 'none';
        joyEl.style.display = 'flex';
        if (mode === 'floating' && base) {
          base.style.opacity = '0.35';
        } else if (mode === 'fixed' && base) {
          base.style.opacity = '1';
          base.style.position = 'relative';
          base.style.left = '';
          base.style.top = '';
        }
      }
    }
  }

  initJoystick() {
    const zone = document.getElementById('joystick-zone');
    const base = document.getElementById('joystick-base');
    const knob = document.getElementById('joystick-knob');
    if (!zone || !base || !knob) return;

    let activeTouchId = null;
    let isMouseDown = false;
    let center = { x: 0, y: 0 };
    const maxRadius = 42; // Maximum knob displacement in px

    const updateDirection = (dx, dy) => {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 10) {
        // Deadzone
        this.gba.setKeyUp(KEYS.UP);
        this.gba.setKeyUp(KEYS.DOWN);
        this.gba.setKeyUp(KEYS.LEFT);
        this.gba.setKeyUp(KEYS.RIGHT);
        return;
      }

      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const isRight = (angle >= -67.5 && angle <= 67.5);
      const isDown = (angle >= 22.5 && angle <= 157.5);
      const isLeft = (angle >= 112.5 || angle <= -112.5);
      const isUp = (angle >= -157.5 && angle <= -22.5);

      if (isRight) this.gba.setKeyDown(KEYS.RIGHT); else this.gba.setKeyUp(KEYS.RIGHT);
      if (isLeft) this.gba.setKeyDown(KEYS.LEFT); else this.gba.setKeyUp(KEYS.LEFT);
      if (isUp) this.gba.setKeyDown(KEYS.UP); else this.gba.setKeyUp(KEYS.UP);
      if (isDown) this.gba.setKeyDown(KEYS.DOWN); else this.gba.setKeyUp(KEYS.DOWN);
    };

    const startStick = (clientX, clientY) => {
      if (this.isEditingLayout) return;
      this.triggerHaptic();

      if (this.movementMode === 'floating') {
        base.style.opacity = '1';
        const baseRect = base.getBoundingClientRect();
        const halfW = baseRect.width / 2;
        const halfH = baseRect.height / 2;
        base.style.position = 'fixed';
        base.style.left = `${clientX - halfW}px`;
        base.style.top = `${clientY - halfH}px`;
        center = { x: clientX, y: clientY };
      } else {
        const rect = base.getBoundingClientRect();
        center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }

      moveStick(clientX, clientY);
    };

    const moveStick = (clientX, clientY) => {
      if (this.isEditingLayout) return;
      let dx = clientX - center.x;
      let dy = clientY - center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }

      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      updateDirection(dx, dy);
    };

    const endStick = () => {
      activeTouchId = null;
      isMouseDown = false;
      knob.style.transform = 'translate(0px, 0px)';
      this.gba.setKeyUp(KEYS.UP);
      this.gba.setKeyUp(KEYS.DOWN);
      this.gba.setKeyUp(KEYS.LEFT);
      this.gba.setKeyUp(KEYS.RIGHT);

      if (this.movementMode === 'floating') {
        base.style.opacity = '0.35';
      }
    };

    // Touch events on joystick zone
    zone.addEventListener('touchstart', (e) => {
      if (this.isEditingLayout) return;
      e.preventDefault();
      if (activeTouchId === null && e.changedTouches.length > 0) {
        const t = e.changedTouches[0];
        activeTouchId = t.identifier;
        startStick(t.clientX, t.clientY);
      }
    }, { passive: false });

    // Floating joystick can be spawned anywhere in left half of screen
    window.addEventListener('touchstart', (e) => {
      const menu = document.getElementById('hamburger-dropdown');
      if (menu && menu.classList.contains('open')) return;
      if (this.isEditingLayout || this.movementMode !== 'floating' || activeTouchId !== null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.clientX < window.innerWidth * 0.55 && t.clientY > 44) {
          const target = document.elementFromPoint(t.clientX, t.clientY);
          if (!target || !target.closest('button, .top-toolbar, .dropdown-menu, .modal-backdrop, .layout-editor-overlay')) {
            activeTouchId = t.identifier;
            startStick(t.clientX, t.clientY);
            break;
          }
        }
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (activeTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === activeTouchId) {
          e.preventDefault();
          moveStick(t.clientX, t.clientY);
          break;
        }
      }
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
      if (activeTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId) {
          endStick();
          break;
        }
      }
    }, { passive: false });

    window.addEventListener('touchcancel', (e) => {
      if (activeTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId) {
          endStick();
          break;
        }
      }
    }, { passive: false });

    // Mouse events for desktop browser testing
    zone.addEventListener('mousedown', (e) => {
      if (this.isEditingLayout) return;
      e.preventDefault();
      isMouseDown = true;
      startStick(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
      if (!isMouseDown) return;
      moveStick(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', () => {
      if (isMouseDown) endStick();
    });
  }

  // =========================================================================
  // Custom Layout Editor (Drag & Drop + Resize 60%-160% + Orientation Memory)
  // =========================================================================
  getOrientation() {
    return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
  }

  getStorageKey() {
    return `myboy_custom_layout_${this.getOrientation()}`;
  }

  loadLayout() {
    try {
      const data = localStorage.getItem(this.getStorageKey());
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  applyLayout() {
    const layout = this.loadLayout();
    const dpadEl = document.getElementById('dpad-container');
    const joyEl = document.getElementById('joystick-zone');
    const actionEl = document.getElementById('action-buttons-container');
    const shoulderEl = document.getElementById('shoulder-container');

    const elements = [
      { id: 'dpad-container', el: dpadEl },
      { id: 'action-buttons-container', el: actionEl },
      { id: 'shoulder-container', el: shoulderEl }
    ];

    if (!layout) {
      this.scales = {
        'dpad-container': 1.0,
        'action-buttons-container': 1.0,
        'shoulder-container': 1.0
      };

      elements.forEach(({ el }) => {
        if (!el) return;
        el.style.position = '';
        el.style.left = '';
        el.style.top = '';
        el.style.right = '';
        el.style.bottom = '';
        el.style.transform = '';
      });

      if (joyEl) {
        joyEl.style.position = '';
        joyEl.style.left = '';
        joyEl.style.top = '';
        joyEl.style.right = '';
        joyEl.style.bottom = '';
        joyEl.style.transform = '';
      }
      this.setMovementMode(this.movementMode);
      return;
    }

    elements.forEach(({ id, el }) => {
      if (!el || !layout[id]) return;
      const item = layout[id];
      if (item.left !== undefined && item.top !== undefined) {
        el.style.position = 'fixed';
        el.style.left = `${item.left}px`;
        el.style.top = `${item.top}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      }
      const scale = item.scale !== undefined ? item.scale : 1.0;
      this.scales[id] = scale;
      el.style.transform = `scale(${scale})`;
      el.style.transformOrigin = 'center center';
    });

    // Synchronize joystick-zone with dpad-container coordinates and scale
    if (joyEl && layout['dpad-container']) {
      const item = layout['dpad-container'];
      if (item.left !== undefined && item.top !== undefined) {
        joyEl.style.position = 'fixed';
        joyEl.style.left = `${item.left}px`;
        joyEl.style.top = `${item.top}px`;
        joyEl.style.right = 'auto';
        joyEl.style.bottom = 'auto';
      }
      const scale = item.scale !== undefined ? item.scale : 1.0;
      joyEl.style.transform = `scale(${scale})`;
      joyEl.style.transformOrigin = 'center center';
    }

    this.setMovementMode(this.movementMode);
  }

  initLayoutSystem() {
    this.applyLayout();

    window.addEventListener('resize', () => {
      this.applyLayout();
    });

    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.applyLayout(), 150);
    });

    // Toolbar actions
    document.getElementById('btn-layout-scale-up')?.addEventListener('click', () => {
      this.adjustScale(0.1);
    });

    document.getElementById('btn-layout-scale-down')?.addEventListener('click', () => {
      this.adjustScale(-0.1);
    });

    document.getElementById('btn-layout-reset')?.addEventListener('click', () => {
      this.resetLayout();
    });

    document.getElementById('btn-layout-save')?.addEventListener('click', () => {
      this.saveLayout();
    });

    // Setup drag events for the customizable control clusters
    this.setupElementDrag('dpad-container');
    this.setupElementDrag('joystick-zone');
    this.setupElementDrag('action-buttons-container');
    this.setupElementDrag('shoulder-container');
  }

  openLayoutEditor() {
    this.isEditingLayout = true;
    const overlay = document.getElementById('layout-editor-overlay');
    if (overlay) overlay.style.display = 'block';

    const editableIds = ['dpad-container', 'action-buttons-container', 'shoulder-container', 'joystick-zone'];
    editableIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('layout-editable');
    });

    this.selectElement('dpad-container');
  }

  closeLayoutEditor() {
    this.isEditingLayout = false;
    const overlay = document.getElementById('layout-editor-overlay');
    if (overlay) overlay.style.display = 'none';

    document.querySelectorAll('.layout-editable').forEach(el => {
      el.classList.remove('layout-editable', 'layout-selected');
    });
  }

  selectElement(id) {
    this.selectedElementId = id;
    document.querySelectorAll('.layout-editable').forEach(el => {
      el.classList.remove('layout-selected');
    });

    const el = document.getElementById(id);
    if (el) el.classList.add('layout-selected');

    if (id === 'dpad-container') {
      const joy = document.getElementById('joystick-zone');
      if (joy) joy.classList.add('layout-selected');
    }

    const currentScale = this.scales[id] || 1.0;
    const badge = document.getElementById('layout-scale-badge');
    if (badge) {
      badge.textContent = `${Math.round(currentScale * 100)}%`;
    }
  }

  adjustScale(delta) {
    if (!this.selectedElementId) return;
    const id = this.selectedElementId;
    let current = this.scales[id] || 1.0;
    current = Math.round((current + delta) * 10) / 10;
    current = Math.max(0.6, Math.min(1.6, current));
    this.scales[id] = current;

    const el = document.getElementById(id);
    if (el) {
      el.style.transform = `scale(${current})`;
      el.style.transformOrigin = 'center center';
    }

    if (id === 'dpad-container') {
      const joy = document.getElementById('joystick-zone');
      if (joy) {
        joy.style.transform = `scale(${current})`;
        joy.style.transformOrigin = 'center center';
      }
    }

    const badge = document.getElementById('layout-scale-badge');
    if (badge) {
      badge.textContent = `${Math.round(current * 100)}%`;
    }
  }

  setupElementDrag(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let isDragging = false;

    const onStart = (clientX, clientY) => {
      if (!this.isEditingLayout) return;
      isDragging = true;
      startX = clientX;
      startY = clientY;

      const selectId = elementId === 'joystick-zone' ? 'dpad-container' : elementId;
      this.selectElement(selectId);

      const rect = el.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      el.style.position = 'fixed';
      el.style.left = `${initialLeft}px`;
      el.style.top = `${initialTop}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    };

    const onMove = (clientX, clientY) => {
      if (!this.isEditingLayout || !isDragging) return;
      const dx = clientX - startX;
      const dy = clientY - startY;

      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      const rect = el.getBoundingClientRect();
      const maxLeft = window.innerWidth - rect.width;
      const maxTop = window.innerHeight - rect.height;

      newLeft = Math.max(0, Math.min(maxLeft, newLeft));
      newTop = Math.max(40, Math.min(maxTop, newTop));

      el.style.left = `${newLeft}px`;
      el.style.top = `${newTop}px`;

      if (elementId === 'dpad-container') {
        const joy = document.getElementById('joystick-zone');
        if (joy) {
          joy.style.position = 'fixed';
          joy.style.left = `${newLeft}px`;
          joy.style.top = `${newTop}px`;
          joy.style.right = 'auto';
          joy.style.bottom = 'auto';
        }
      } else if (elementId === 'joystick-zone') {
        const dpad = document.getElementById('dpad-container');
        if (dpad) {
          dpad.style.position = 'fixed';
          dpad.style.left = `${newLeft}px`;
          dpad.style.top = `${newTop}px`;
          dpad.style.right = 'auto';
          dpad.style.bottom = 'auto';
        }
      }
    };

    const onEnd = () => {
      isDragging = false;
    };

    el.addEventListener('touchstart', (e) => {
      if (!this.isEditingLayout) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.touches.length > 0) {
        onStart(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (!this.isEditingLayout || !isDragging) return;
      if (e.touches.length > 0) {
        e.preventDefault();
        onMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });

    window.addEventListener('touchend', () => {
      if (isDragging) onEnd();
    });

    window.addEventListener('touchcancel', () => {
      if (isDragging) onEnd();
    });

    el.addEventListener('mousedown', (e) => {
      if (!this.isEditingLayout) return;
      e.preventDefault();
      e.stopPropagation();
      onStart(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
      if (isDragging) {
        onMove(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) onEnd();
    });
  }

  saveLayout() {
    const orientation = this.getOrientation();
    const config = {};

    ['dpad-container', 'action-buttons-container', 'shoulder-container'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      config[id] = {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        scale: this.scales[id] || 1.0
      };
    });

    try {
      localStorage.setItem(`myboy_custom_layout_${orientation}`, JSON.stringify(config));
    } catch (e) {}

    this.closeLayoutEditor();
    if (this.gba.paused && this.gba.romLoaded) {
      this.gba.resume();
      const powerLed = document.getElementById('power-led');
      if (powerLed) powerLed.classList.remove('paused');
    }
  }

  resetLayout() {
    const orientation = this.getOrientation();
    try {
      localStorage.removeItem(`myboy_custom_layout_${orientation}`);
    } catch (e) {}

    this.scales = {
      'dpad-container': 1.0,
      'action-buttons-container': 1.0,
      'shoulder-container': 1.0
    };

    ['dpad-container', 'action-buttons-container', 'shoulder-container', 'joystick-zone'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.style.position = '';
        el.style.left = '';
        el.style.top = '';
        el.style.right = '';
        el.style.bottom = '';
        el.style.transform = '';
      }
    });

    this.setMovementMode(this.movementMode);

    const badge = document.getElementById('layout-scale-badge');
    if (badge) badge.textContent = '100%';
  }

  // =========================================================================
  // Gamepad API
  // =========================================================================
  initGamepad() {
    window.addEventListener('gamepadconnected', (e) => {
      console.log('Gamepad connected:', e.gamepad.id);
      this.pollGamepad();
    });
  }

  pollGamepad() {
    const poll = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = gamepads[0];
      if (gp && !this.isEditingLayout) {
        if (gp.buttons[0]?.pressed) this.gba.setKeyDown(KEYS.A); else this.gba.setKeyUp(KEYS.A);
        if (gp.buttons[1]?.pressed) this.gba.setKeyDown(KEYS.B); else this.gba.setKeyUp(KEYS.B);
        if (gp.buttons[4]?.pressed) this.gba.setKeyDown(KEYS.L); else this.gba.setKeyUp(KEYS.L);
        if (gp.buttons[5]?.pressed) this.gba.setKeyDown(KEYS.R); else this.gba.setKeyUp(KEYS.R);
        if (gp.buttons[8]?.pressed) this.gba.setKeyDown(KEYS.SELECT); else this.gba.setKeyUp(KEYS.SELECT);
        if (gp.buttons[9]?.pressed) this.gba.setKeyDown(KEYS.START); else this.gba.setKeyUp(KEYS.START);
        if (gp.buttons[12]?.pressed || gp.axes[1] < -0.5) this.gba.setKeyDown(KEYS.UP); else this.gba.setKeyUp(KEYS.UP);
        if (gp.buttons[13]?.pressed || gp.axes[1] > 0.5) this.gba.setKeyDown(KEYS.DOWN); else this.gba.setKeyUp(KEYS.DOWN);
        if (gp.buttons[14]?.pressed || gp.axes[0] < -0.5) this.gba.setKeyDown(KEYS.LEFT); else this.gba.setKeyUp(KEYS.LEFT);
        if (gp.buttons[15]?.pressed || gp.axes[0] > 0.5) this.gba.setKeyDown(KEYS.RIGHT); else this.gba.setKeyUp(KEYS.RIGHT);
      }
      requestAnimationFrame(poll);
    };
    poll();
  }
}
