import { GBA } from './core/gba.js';
import { EmulatorAdapter } from './core/emulator-adapter.js';
import { GBAControls } from './ui/controls.js';
import { GBALibrary } from './ui/library.js';
import { GBAShaders } from './ui/shaders.js';
import { GBAMemoryScanner } from './core/memory-scanner.js';
import { KEYS } from './core/gba-constants.js';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gba-screen');
  const canvasWrapper = document.getElementById('canvas-wrapper');
  const romBadge = document.getElementById('current-rom-name');
  const fpsBadge = document.getElementById('fps-counter');
  const powerLed = document.getElementById('power-led');
  const hamburgerBtn = document.getElementById('btn-hamburger');
  const hamburgerDropdown = document.getElementById('hamburger-dropdown');

  // Initialize GBA Subsystems
  // Default: Optimized JS engine (stable, full features including Memory Scanner)
  // Optional: EmulatorJS WASM core (faster but experimental, set via Settings)
  const enginePref = localStorage.getItem('gba_k_engine') || 'js';
  const gba = enginePref === 'wasm' ? new EmulatorAdapter(canvas) : new GBA(canvas);
  const controls = new GBAControls(gba);
  const shaders = new GBAShaders(canvasWrapper);
  const scanner = new GBAMemoryScanner(gba);

  // FPS Update Hook
  gba.onFpsUpdate = (fps) => {
    fpsBadge.textContent = `${fps} FPS`;
  };

  // ROM Loading Callback
  const handleLoadRom = (arrayBuffer, fileName) => {
    gba.loadRom(arrayBuffer, fileName);
    romBadge.textContent = gba.getRomTitle() || fileName;
    powerLed.classList.remove('paused');
    closeAllModals();
    scanner.reset();
  };

  const library = new GBALibrary(gba, handleLoadRom);

  // --- Hamburger Menu Logic ---
  if (hamburgerBtn && hamburgerDropdown) {
    hamburgerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hamburgerDropdown.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!hamburgerDropdown.contains(e.target) && e.target !== hamburgerBtn) {
        hamburgerDropdown.classList.remove('open');
      }
    });
  }

  // --- Modal Dialogs Handling ---
  const openModal = (id) => {
    closeAllModals();
    if (hamburgerDropdown) hamburgerDropdown.classList.remove('open');
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('open');
  };

  const closeAllModals = () => {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
  };

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeAllModals();
    });
  });

  // Hamburger Menu Item Triggers
  document.getElementById('menu-item-library')?.addEventListener('click', () => {
    library.renderLibraryList();
    openModal('modal-library');
  });

  document.getElementById('menu-item-states')?.addEventListener('click', () => {
    renderSaveSlots();
    openModal('modal-states');
  });

  document.getElementById('menu-item-cheats')?.addEventListener('click', () => {
    renderCheatsList();
    openModal('modal-cheats');
  });

  document.getElementById('menu-item-scanner')?.addEventListener('click', () => {
    renderScannerFrozenList();
    openModal('modal-scanner');
  });

  document.getElementById('menu-item-keybinds')?.addEventListener('click', () => {
    renderKeybindGrid();
    openModal('modal-keybinds');
  });

  document.getElementById('menu-item-settings')?.addEventListener('click', () => {
    openModal('modal-settings');
  });

  // --- ROM File Upload & Drag-Drop ---
  const fileInput = document.getElementById('file-rom-input');
  const dropZone = document.getElementById('drop-zone');

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--accent-cyan)';
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.style.borderColor = 'rgba(0, 242, 254, 0.3)';
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'rgba(0, 242, 254, 0.3)';
      if (e.dataTransfer.files.length > 0) {
        processRomFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        processRomFile(fileInput.files[0]);
      }
    });
  }

  const processRomFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = e.target.result;
      library.saveRomToDb(file.name, buffer);
      handleLoadRom(buffer, file.name);
    };
    reader.readAsArrayBuffer(file);
  };

  // Demo ROM button
  document.getElementById('btn-load-demo')?.addEventListener('click', () => {
    const demoBuffer = library.createSampleGbaRom('NEON BLAST GBA');
    library.saveRomToDb('Neon_Blast_Demo.gba', demoBuffer);
    handleLoadRom(demoBuffer, 'Neon_Blast_Demo.gba');
  });

  // --- Save / Load States Grid ---
  const renderSaveSlots = () => {
    const grid = document.getElementById('save-slots-grid');
    if (!grid) return;

    let html = '';
    for (let slot = 1; slot <= 6; slot++) {
      const info = gba.getStateInfo(slot);
      const thumb = info && info.screenshot ? info.screenshot : '';
      const timeStr = info ? new Date(info.timestamp).toLocaleTimeString() : 'Trống';

      html += `
        <div class="slot-card">
          <div style="font-weight: 700; font-size: 0.8rem; display: flex; justify-content: space-between;">
            <span>Slot ${slot}</span>
            <span style="color: var(--text-dim); font-size: 0.75rem;">${timeStr}</span>
          </div>
          ${thumb ? `<img src="${thumb}" class="slot-thumbnail" alt="Slot ${slot}" />` : `<div class="slot-thumbnail" style="display:flex;align-items:center;justify-content:center;color:#555;font-size:0.75rem;">Chưa có dữ liệu</div>`}
          <div class="slot-actions">
            <button class="btn-slot btn-slot-save" data-slot="${slot}">Lưu</button>
            <button class="btn-slot btn-slot-load" data-slot="${slot}" ${!info ? 'disabled style="opacity:0.4;"' : ''}>Tải</button>
          </div>
        </div>
      `;
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.btn-slot-save').forEach(btn => {
      btn.addEventListener('click', () => {
        const slot = parseInt(btn.getAttribute('data-slot'), 10);
        gba.saveState(slot);
        renderSaveSlots();
      });
    });

    grid.querySelectorAll('.btn-slot-load').forEach(btn => {
      btn.addEventListener('click', () => {
        const slot = parseInt(btn.getAttribute('data-slot'), 10);
        if (gba.loadState(slot)) {
          closeAllModals();
        }
      });
    });
  };

  // Battery Save .sav Export & Import
  document.getElementById('btn-export-sav')?.addEventListener('click', () => {
    gba.exportSavFile();
  });

  const savFileInput = document.getElementById('file-sav-input');
  document.getElementById('btn-import-sav')?.addEventListener('click', () => {
    savFileInput?.click();
  });
  savFileInput?.addEventListener('change', () => {
    if (savFileInput.files.length > 0) {
      const reader = new FileReader();
      reader.onload = (e) => {
        gba.importSavFile(e.target.result);
        alert('Đã nhập file lưu .sav thành công!');
        closeAllModals();
      };
      reader.readAsArrayBuffer(savFileInput.files[0]);
    }
  });

  // --- Cheats Manager ---
  const renderCheatsList = () => {
    const list = document.getElementById('cheats-list');
    if (!list) return;

    if (gba.cheats.cheats.length === 0) {
      list.innerHTML = `<div style="color: var(--text-dim); font-size: 0.85rem; text-align: center;">Chưa có mã cheat nào được thêm.</div>`;
      return;
    }

    list.innerHTML = gba.cheats.cheats.map(c => `
      <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.04); padding:8px 12px; border-radius:6px; border:1px solid var(--glass-border);">
        <div>
          <div style="font-weight:600; font-size:0.9rem;">${c.name}</div>
          <code style="font-size:0.75rem; color:var(--accent-cyan);">${c.code.replace(/\n/g, ' ')}</code>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" class="toggle-cheat" data-id="${c.id}" ${c.enabled ? 'checked' : ''} style="transform: scale(1.2); accent-color: var(--accent-cyan);" />
          <button class="btn-delete-cheat" data-id="${c.id}" style="background:transparent; border:none; color:#ff4444; cursor:pointer;">✕</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.toggle-cheat').forEach(chk => {
      chk.addEventListener('change', () => {
        gba.cheats.toggleCheat(chk.getAttribute('data-id'), chk.checked);
      });
    });

    list.querySelectorAll('.btn-delete-cheat').forEach(btn => {
      btn.addEventListener('click', () => {
        gba.cheats.removeCheat(btn.getAttribute('data-id'));
        renderCheatsList();
      });
    });
  };

  document.getElementById('btn-add-cheat')?.addEventListener('click', () => {
    const nameInput = document.getElementById('cheat-name');
    const codeInput = document.getElementById('cheat-code');
    if (codeInput && codeInput.value.trim()) {
      gba.cheats.addCheat(nameInput.value, codeInput.value);
      nameInput.value = '';
      codeInput.value = '';
      renderCheatsList();
    }
  });

  // --- Memory Scanner (Cheat Search) UI ---
  const scannerValInput = document.getElementById('scanner-value-input');
  const scannerTypeSelect = document.getElementById('scanner-datatype');
  const btnScannerFirst = document.getElementById('btn-scanner-first');
  const btnScannerNext = document.getElementById('btn-scanner-next');
  const btnScannerReset = document.getElementById('btn-scanner-reset');
  const scannerStatus = document.getElementById('scanner-status');
  const scannerCount = document.getElementById('scanner-result-count');
  const scannerResultsList = document.getElementById('scanner-results-list');
  const scannerFrozenList = document.getElementById('scanner-frozen-list');

  const updateScannerUI = () => {
    scannerCount.textContent = scanner.results.length;
    if (scanner.results.length === 0) {
      scannerResultsList.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 16px;">Chưa có kết quả tìm kiếm nào</div>`;
      btnScannerNext.disabled = true;
      return;
    }

    btnScannerNext.disabled = false;
    const displayResults = scanner.results.slice(0, 50); // display first 50 results
    scannerResultsList.innerHTML = displayResults.map(item => `
      <div class="scanner-result-item">
        <div>
          <span class="scanner-addr">${item.formattedAddr}</span>
          <span style="color: var(--text-dim); margin: 0 6px;">=</span>
          <span class="scanner-val">${item.value}</span>
        </div>
        <div class="scanner-item-actions">
          <button class="btn-mini btn-scanner-edit" data-addr="${item.address}">✏️ Sửa</button>
          <button class="btn-mini btn-scanner-freeze" data-addr="${item.address}" data-val="${item.value}">❄️ Khóa</button>
        </div>
      </div>
    `).join('');

    if (scanner.results.length > 50) {
      scannerResultsList.innerHTML += `<div style="text-align: center; color: var(--text-dim); font-size: 0.75rem; padding: 6px;">(Hiển thị 50 / ${scanner.results.length} kết quả, hãy đổi giá trị trong game rồi bấm "Lọc Tiếp")</div>`;
    }

    // Attach Edit & Freeze buttons
    scannerResultsList.querySelectorAll('.btn-scanner-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const addr = parseInt(btn.getAttribute('data-addr'), 10);
        const currentVal = scanner.readValue(addr);
        const newVal = prompt(`Nhập giá trị mới cho địa chỉ 0x${addr.toString(16).toUpperCase()}:`, currentVal);
        if (newVal !== null && newVal !== '') {
          scanner.writeValue(addr, Number(newVal));
          btnScannerNext.click(); // refresh list
        }
      });
    });

    scannerResultsList.querySelectorAll('.btn-scanner-freeze').forEach(btn => {
      btn.addEventListener('click', () => {
        const addr = parseInt(btn.getAttribute('data-addr'), 10);
        const currentVal = scanner.readValue(addr);
        const freezeVal = prompt(`Khóa giá trị tại 0x${addr.toString(16).toUpperCase()} ở mức:`, currentVal);
        if (freezeVal !== null && freezeVal !== '') {
          gba.addFreeze(addr, Number(freezeVal), scanner.valueType);
          renderScannerFrozenList();
        }
      });
    });
  };

  const renderScannerFrozenList = () => {
    if (!scannerFrozenList) return;
    if (gba.freezeList.length === 0) {
      scannerFrozenList.innerHTML = `<div style="color: var(--text-dim); font-size: 0.8rem; padding: 4px;">Chưa có ô nhớ nào được đóng băng.</div>`;
      return;
    }

    scannerFrozenList.innerHTML = gba.freezeList.map(f => `
      <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,242,254,0.06); padding:6px 10px; border-radius:6px; border:1px solid rgba(0,242,254,0.2);">
        <div>
          <span style="font-family:monospace; font-weight:700; color:var(--accent-cyan);">0x${f.address.toString(16).padStart(8, '0').toUpperCase()}</span>
          <span style="color:#fff; margin-left:8px; font-weight:600;">Khóa: ${f.value} (${f.dataType})</span>
        </div>
        <button class="btn-delete-freeze" data-addr="${f.address}" style="background:transparent; border:none; color:#ff4444; cursor:pointer; font-weight:bold;">✕</button>
      </div>
    `).join('');

    scannerFrozenList.querySelectorAll('.btn-delete-freeze').forEach(btn => {
      btn.addEventListener('click', () => {
        const addr = parseInt(btn.getAttribute('data-addr'), 10);
        gba.removeFreeze(addr);
        renderScannerFrozenList();
      });
    });
  };

  btnScannerFirst?.addEventListener('click', () => {
    const val = scannerValInput.value.trim();
    if (val === '') {
      alert('Vui lòng nhập giá trị cần tìm!');
      return;
    }
    scanner.setValueType(scannerTypeSelect.value);
    const results = scanner.searchFirst(Number(val));
    scannerStatus.textContent = `Tìm thấy ${results.length} ô nhớ có giá trị ${val}. Hãy chơi tiếp để giá trị thay đổi rồi bấm "Lọc Tiếp".`;
    updateScannerUI();
  });

  btnScannerNext?.addEventListener('click', () => {
    const val = scannerValInput.value.trim();
    if (val === '') {
      alert('Vui lòng nhập giá trị mới để lọc tiếp!');
      return;
    }
    const results = scanner.searchNext(Number(val));
    scannerStatus.textContent = `Còn lại ${results.length} ô nhớ có giá trị ${val}.`;
    updateScannerUI();
  });

  btnScannerReset?.addEventListener('click', () => {
    scanner.reset();
    scannerValInput.value = '';
    scannerStatus.textContent = 'Nhập giá trị hiện tại của thông số game rồi bấm "Tìm Mới"';
    updateScannerUI();
  });

  // --- Key Bindings Grid UI ---
  const keyNames = {
    [KEYS.A]: 'Nút A',
    [KEYS.B]: 'Nút B',
    [KEYS.L]: 'Nút L (Vai trái)',
    [KEYS.R]: 'Nút R (Vai phải)',
    [KEYS.START]: 'START',
    [KEYS.SELECT]: 'SELECT',
    [KEYS.UP]: 'D-Pad Lên',
    [KEYS.DOWN]: 'D-Pad Xuống',
    [KEYS.LEFT]: 'D-Pad Trái',
    [KEYS.RIGHT]: 'D-Pad Phải'
  };

  const renderKeybindGrid = () => {
    const grid = document.getElementById('keybind-grid');
    if (!grid) return;

    let html = '';
    for (const [bitStr, name] of Object.entries(keyNames)) {
      const bit = Number(bitStr);
      const keys = controls.getKeysForButton(bit);
      const displayKey = keys.length > 0 ? keys.map(k => k.replace('Key', '').replace('Arrow', '')).join(' / ') : '<em style="color:var(--text-dim);">Chưa gán</em>';

      html += `
        <div class="keybind-row">
          <span class="keybind-label">${name}</span>
          <div style="display:flex; align-items:center; gap:6px;">
            <button class="keybind-btn" data-bit="${bit}" title="Bấm để đổi phím (hoặc bấm Delete/Backspace để xóa)">${displayKey}</button>
            <button class="btn-clear-key" data-bit="${bit}" style="background:rgba(255,255,255,0.06); border:1px solid var(--glass-border); color:var(--text-dim); border-radius:6px; padding:4px 8px; font-size:0.75rem; cursor:pointer;" title="Xóa phím gán">✕</button>
          </div>
        </div>
      `;
    }
    grid.innerHTML = html;

    let activeListeningBtn = null;

    const handleKeyRebind = (e) => {
      e.preventDefault();
      if (!activeListeningBtn) return;
      const bit = Number(activeListeningBtn.getAttribute('data-bit'));
      if (e.code === 'Backspace' || e.code === 'Delete' || e.code === 'Escape') {
        controls.clearButtonBindings(bit);
      } else {
        controls.rebindButton(bit, e.code);
      }
      activeListeningBtn.classList.remove('listening');
      window.removeEventListener('keydown', handleKeyRebind);
      renderKeybindGrid();
    };

    grid.querySelectorAll('.keybind-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (activeListeningBtn) {
          activeListeningBtn.classList.remove('listening');
          window.removeEventListener('keydown', handleKeyRebind);
        }
        activeListeningBtn = btn;
        btn.classList.add('listening');
        btn.textContent = 'Nhấn phím...';
        window.addEventListener('keydown', handleKeyRebind, { once: true });
      });
    });

    grid.querySelectorAll('.btn-clear-key').forEach(btn => {
      btn.addEventListener('click', () => {
        const bit = Number(btn.getAttribute('data-bit'));
        controls.clearButtonBindings(bit);
        renderKeybindGrid();
      });
    });
  };

  document.getElementById('btn-reset-keys')?.addEventListener('click', () => {
    controls.resetKeyMap();
    renderKeybindGrid();
  });

  // --- Settings & Menu Fast-Forward Controls ---
  const speedSliderModal = document.getElementById('setting-speed');
  const speedSliderMenu = document.getElementById('menu-speed-slider');
  const speedDisplay = document.getElementById('speed-val-display');
  const ffLabel = document.getElementById('ff-label');
  const speedPresets = document.querySelectorAll('.btn-speed-preset');

  const updateSpeed = (val) => {
    const num = Math.max(1.0, Math.min(5.0, parseFloat(val)));
    gba.speedMultiplier = num;
    const formatted = `${num.toFixed(num % 1 === 0 ? 1 : 2)}x`;

    if (speedSliderModal) speedSliderModal.value = num;
    if (speedSliderMenu) speedSliderMenu.value = num;
    if (speedDisplay) speedDisplay.textContent = formatted;
    if (ffLabel) ffLabel.textContent = formatted;

    speedPresets.forEach(btn => {
      const pSpd = parseFloat(btn.getAttribute('data-speed'));
      btn.classList.toggle('active', Math.abs(pSpd - num) < 0.05);
    });

    try {
      localStorage.setItem('myboy_ff_speed', num.toString());
    } catch (e) {}
  };

  // Load saved speed or default 2.0
  const savedSpeed = localStorage.getItem('myboy_ff_speed') || '2.0';
  updateSpeed(savedSpeed);

  speedSliderModal?.addEventListener('input', (e) => updateSpeed(e.target.value));
  speedSliderMenu?.addEventListener('input', (e) => updateSpeed(e.target.value));

  speedPresets.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const spd = parseFloat(btn.getAttribute('data-speed'));
      updateSpeed(spd);
    });
  });

  // --- Movement Mode (D-Pad / Fixed Joystick / Floating Joystick) ---
  const controlTypeSelect = document.getElementById('setting-control-type');
  const ctrlModeButtons = document.querySelectorAll('.btn-ctrl-mode');

  const updateMovementMode = (mode) => {
    controls.setMovementMode(mode);
    if (controlTypeSelect) controlTypeSelect.value = mode;

    ctrlModeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });

    try {
      localStorage.setItem('myboy_control_type', mode);
    } catch (e) {}
  };

  const savedMode = localStorage.getItem('myboy_control_type') || 'dpad';
  updateMovementMode(savedMode);

  controlTypeSelect?.addEventListener('change', (e) => updateMovementMode(e.target.value));

  ctrlModeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = btn.getAttribute('data-mode');
      updateMovementMode(mode);
    });
  });

  // --- Layout Editor Triggers ---
  const triggerLayoutEditor = () => {
    closeAllModals();
    if (hamburgerDropdown) hamburgerDropdown.classList.remove('open');
    if (gba.running && !gba.paused) {
      gba.pause();
      powerLed.classList.add('paused');
    }
    controls.openLayoutEditor();
  };

  document.getElementById('btn-open-layout-editor')?.addEventListener('click', triggerLayoutEditor);
  document.getElementById('btn-menu-layout-editor')?.addEventListener('click', triggerLayoutEditor);

  document.getElementById('setting-shader')?.addEventListener('change', (e) => {
    shaders.setFilter(e.target.value);
  });

  document.getElementById('setting-volume')?.addEventListener('input', (e) => {
    gba.apu.setVolume(parseFloat(e.target.value));
  });

  document.getElementById('setting-haptic')?.addEventListener('change', (e) => {
    controls.hapticsEnabled = e.target.checked;
  });

  const engineSelect = document.getElementById('setting-engine');
  if (engineSelect) {
    engineSelect.value = localStorage.getItem('gba_k_engine') || 'js';
    engineSelect.addEventListener('change', (e) => {
      const chosen = e.target.value;
      localStorage.setItem('gba_k_engine', chosen);
      if (confirm(`Đã đổi động cơ sang ${chosen === 'wasm' ? 'mGBA WebAssembly (Thử nghiệm)' : 'JavaScript Engine (Ổn định)'}. Tải lại ứng dụng ngay để áp dụng?`)) {
        window.location.reload();
      }
    });
  }

  // Audio Unlock on First Touch / Click (Web Audio mobile policy)
  const unlockAudio = () => {
    if (gba.core && gba.core.audio && gba.core.audio.context && gba.core.audio.context.state === 'suspended') {
      gba.core.audio.context.resume().catch(() => {});
    }
    window.removeEventListener('touchstart', unlockAudio);
    window.removeEventListener('click', unlockAudio);
  };
  window.addEventListener('touchstart', unlockAudio, { passive: true });
  window.addEventListener('click', unlockAudio, { passive: true });

  // Android Capacitor Hardware Back Button
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('backButton', () => {
      const openModalEl = document.querySelector('.modal-backdrop.open');
      if (openModalEl) {
        closeAllModals();
      } else if (hamburgerDropdown && hamburgerDropdown.classList.contains('open')) {
        hamburgerDropdown.classList.remove('open');
      } else {
        if (gba.running && !gba.paused) {
          gba.pause();
          powerLed.classList.add('paused');
          openModal('modal-settings');
        }
      }
    });
  }

  // Auto load demo on first start if no ROM loaded
  setTimeout(async () => {
    const roms = await library.getAllRoms();
    if (roms.length > 0) {
      handleLoadRom(roms[0].data, roms[0].name);
    } else {
      const demoBuffer = library.createSampleGbaRom('NEON BLAST GBA');
      library.saveRomToDb('Neon_Blast_Demo.gba', demoBuffer);
      handleLoadRom(demoBuffer, 'Neon_Blast_Demo.gba');
    }
  }, 150);
});
