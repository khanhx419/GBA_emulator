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

    // Load custom key bindings or fallback to default
    this.keyMap = this.loadKeyMap();

    this.initKeyboard();
    this.initTouchControls();
    this.initGamepad();
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
      e.preventDefault();
      el.classList.add('pressed');
      this.triggerHaptic();
      this.gba.setKeyDown(keyBit);
    };

    const release = (e) => {
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
      if (gp) {
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
