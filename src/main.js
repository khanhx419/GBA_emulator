import { GBA } from './core/gba.js';
import { EmulatorAdapter } from './core/emulator-adapter.js';
import { GBAControls } from './ui/controls.js';
import { GBALibrary } from './ui/library.js';
import { GBAShaders } from './ui/shaders.js';
import { GBAMemoryScanner } from './core/memory-scanner.js';
import { OrientationManager } from './ui/orientation-manager.js';
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
  // Default: EmulatorJS WASM core (mGBA, fast 60FPS, local files + CDN core cache)
  // Alternative: JS engine (full Memory Scanner, set via Settings)
  const enginePref = localStorage.getItem('gba_k_engine') || 'wasm';
  const gba = enginePref === 'wasm' ? new EmulatorAdapter(canvas) : new GBA(canvas);
  window.gba = gba;
  window.gba_instance = gba;
  const controls = new GBAControls(gba);
  const shaders = new GBAShaders(canvasWrapper);
  const scanner = new GBAMemoryScanner(gba);
  const orientationMgr = new OrientationManager();
  orientationMgr.init();

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

  // Global Toast Helper
  const showAppToast = (message) => {
    const toastEl = document.getElementById('app-toast');
    if (!toastEl) return;
    if (window._appToastTimer) clearTimeout(window._appToastTimer);
    toastEl.textContent = message;
    toastEl.classList.add('visible');
    window._appToastTimer = setTimeout(() => {
      toastEl.classList.remove('visible');
    }, 2200);
  };
  window.showAppToast = showAppToast;

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
      btn.addEventListener('click', async () => {
        const slot = parseInt(btn.getAttribute('data-slot'), 10);
        if (!gba.romLoaded) {
          showAppToast('⚠️ Vui lòng mở game trước khi Lưu State!');
          return;
        }
        btn.disabled = true;
        const prevText = btn.textContent;
        btn.textContent = '...';
        try {
          const res = await gba.saveState(slot);
          if (res) {
            showAppToast(`💾 Đã lưu thành công vào Slot ${slot}!`);
          } else {
            showAppToast(`❌ Lưu State Slot ${slot} thất bại!`);
          }
        } catch (e) {
          showAppToast(`❌ Lưu State Slot ${slot} lỗi: ${e.message}`);
        } finally {
          btn.disabled = false;
          btn.textContent = prevText;
          renderSaveSlots();
        }
      });
    });

    grid.querySelectorAll('.btn-slot-load').forEach(btn => {
      btn.addEventListener('click', async () => {
        const slot = parseInt(btn.getAttribute('data-slot'), 10);
        if (!gba.romLoaded) {
          showAppToast('⚠️ Vui lòng mở game trước khi Tải State!');
          return;
        }
        btn.disabled = true;
        const prevText = btn.textContent;
        btn.textContent = '...';
        try {
          const ok = await gba.loadState(slot);
          if (ok) {
            showAppToast(`⚡ Đã tải State Slot ${slot}!`);
            closeAllModals();
          } else {
            showAppToast(`❌ Tải State Slot ${slot} thất bại!`);
          }
        } catch (e) {
          showAppToast(`❌ Tải State Slot ${slot} lỗi: ${e.message}`);
        } finally {
          btn.disabled = false;
          btn.textContent = prevText;
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
  const scannerBatchToolbar = document.getElementById('scanner-batch-toolbar');

  // Compare mode buttons
  const compareButtons = document.querySelectorAll('.btn-compare-mode');
  compareButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      compareButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.getAttribute('data-mode');
      scanner.setCompareType(mode);
      if (mode === 'unchanged') {
        scannerStatus.textContent = 'Chế độ so sánh: "Không đổi" (bằng giá trị lần trước). Bấm Lọc Tiếp.';
      } else if (mode === 'changed') {
        scannerStatus.textContent = 'Chế độ so sánh: "Đã thay đổi" (khác giá trị lần trước). Bấm Lọc Tiếp.';
      } else if (mode === 'greater') {
        scannerStatus.textContent = 'Chế độ so sánh: "Tăng lên" (>). Nhập số hoặc để trống để so với lần trước.';
      } else if (mode === 'less') {
        scannerStatus.textContent = 'Chế độ so sánh: "Giảm đi" (<). Nhập số hoặc để trống để so với lần trước.';
      } else {
        scannerStatus.textContent = 'Chế độ so sánh: "Bằng chính xác" (=). Nhập giá trị rồi bấm Tìm Mới / Lọc Tiếp.';
      }
    });
  });

  const updateScannerUI = () => {
    scannerCount.textContent = scanner.results.length;
    if (scanner.results.length === 0) {
      scannerResultsList.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 16px;">Chưa có kết quả tìm kiếm nào</div>`;
      btnScannerNext.disabled = true;
      if (scannerBatchToolbar) scannerBatchToolbar.style.display = 'none';
      return;
    }

    btnScannerNext.disabled = false;
    if (scannerBatchToolbar) scannerBatchToolbar.style.display = 'flex';

    const displayResults = scanner.results.slice(0, 50); // display first 50 results
    scannerResultsList.innerHTML = displayResults.map(item => `
      <div class="scanner-result-item">
        <div>
          <span class="scanner-addr">${item.formattedAddr}</span>
          <span style="color: var(--text-dim); margin: 0 4px;">=</span>
          <span class="scanner-val">${item.value}</span>
        </div>
        <div class="scanner-item-actions">
          <button class="btn-mini btn-scanner-edit" data-addr="${item.address}" title="Sửa giá trị ô nhớ này">✏️ Sửa</button>
          <button class="btn-mini btn-scanner-freeze" data-addr="${item.address}" data-val="${item.value}" title="Đóng băng giá trị ô nhớ này">❄️ Khóa</button>
          <button class="btn-mini btn-scanner-cheat" data-addr="${item.address}" data-val="${item.value}" title="Tạo mã Cheat GameShark/CodeBreaker">📋 Cheat</button>
        </div>
      </div>
    `).join('');

    if (scanner.results.length > 50) {
      scannerResultsList.innerHTML += `<div style="text-align: center; color: var(--text-dim); font-size: 0.75rem; padding: 6px;">(Hiển thị 50 / ${scanner.results.length} kết quả, hãy đổi giá trị trong game rồi bấm "Lọc Tiếp")</div>`;
    }

    // Attach Edit, Freeze, and Cheat buttons
    scannerResultsList.querySelectorAll('.btn-scanner-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const addr = parseInt(btn.getAttribute('data-addr'), 10);
        const currentVal = scanner.readValue(addr);
        const newVal = prompt(`Nhập giá trị mới cho địa chỉ 0x${addr.toString(16).toUpperCase()}:`, currentVal);
        if (newVal !== null && newVal !== '') {
          scanner.writeValue(addr, Number(newVal));
          showAppToast(`✏️ Đã sửa giá trị 0x${addr.toString(16).toUpperCase()} thành ${newVal}!`);
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
          showAppToast(`❄️ Đã khóa địa chỉ 0x${addr.toString(16).toUpperCase()} = ${freezeVal}!`);
        }
      });
    });

    scannerResultsList.querySelectorAll('.btn-scanner-cheat').forEach(btn => {
      btn.addEventListener('click', () => {
        const addr = parseInt(btn.getAttribute('data-addr'), 10);
        const currentVal = scanner.readValue(addr);
        const cheatName = prompt(`Nhập tên mã Cheat cho 0x${addr.toString(16).toUpperCase()}:`, `Cheat ${addr.toString(16).toUpperCase()}`);
        if (cheatName !== null && cheatName.trim() !== '') {
          const ok = scanner.createCheat(addr, currentVal, cheatName.trim());
          if (ok) {
            showAppToast(`📋 Đã tạo mã Cheat "${cheatName}" thành công!`);
            renderCheatsList();
          }
        }
      });
    });
  };

  // Batch Action Toolbar Handlers
  document.getElementById('btn-batch-edit')?.addEventListener('click', () => {
    if (scanner.results.length === 0) return;
    const newVal = prompt(`Nhập giá trị mới để áp dụng cho tất cả ${scanner.results.length} địa chỉ:`);
    if (newVal !== null && newVal.trim() !== '') {
      scanner.editAll(Number(newVal));
      showAppToast(`✏️ Đã sửa ${scanner.results.length} địa chỉ thành ${newVal}!`);
      updateScannerUI();
    }
  });

  document.getElementById('btn-batch-freeze')?.addEventListener('click', () => {
    if (scanner.results.length === 0) return;
    const confirmFreeze = confirm(`Bạn có muốn khóa toàn bộ ${scanner.results.length} địa chỉ ô nhớ này không?`);
    if (confirmFreeze) {
      scanner.freezeAll();
      renderScannerFrozenList();
      showAppToast(`❄️ Đã khóa ${scanner.results.length} địa chỉ ô nhớ!`);
    }
  });

  document.getElementById('btn-batch-cheat')?.addEventListener('click', () => {
    if (scanner.results.length === 0) return;
    const name = prompt('Nhập tên cho mã cheat hàng loạt:', 'Mã Cheat Tìm Được');
    if (name !== null && name.trim() !== '') {
      const ok = scanner.createCheatForAll(name.trim());
      if (ok) {
        showAppToast(`📋 Đã tạo mã Cheat "${name}" thành công!`);
        renderCheatsList();
      }
    }
  });

  document.getElementById('btn-batch-clear')?.addEventListener('click', () => {
    scanner.reset();
    scannerValInput.value = '';
    scannerStatus.textContent = 'Đã xóa kết quả tìm kiếm.';
    updateScannerUI();
  });

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
        <div style="display:flex; align-items:center; gap:6px;">
          <button class="btn-mini btn-freeze-to-cheat" data-addr="${f.address}" data-val="${f.value}" data-type="${f.dataType}" title="Chuyển thành Cheat Code">📋 Cheat</button>
          <button class="btn-delete-freeze" data-addr="${f.address}" style="background:transparent; border:none; color:#ff4444; cursor:pointer; font-weight:bold; font-size:1rem;" title="Hủy khóa">✕</button>
        </div>
      </div>
    `).join('');

    scannerFrozenList.querySelectorAll('.btn-freeze-to-cheat').forEach(btn => {
      btn.addEventListener('click', () => {
        const addr = parseInt(btn.getAttribute('data-addr'), 10);
        const val = parseInt(btn.getAttribute('data-val'), 10);
        const type = btn.getAttribute('data-type') || 'u16';
        const name = prompt('Nhập tên mã cheat:', `Cheat 0x${addr.toString(16).toUpperCase()}`);
        if (name !== null && name.trim() !== '') {
          const code = scanner.generateCheatCode(addr, val, type);
          if (code && gba.cheats?.addCheat) {
            gba.cheats.addCheat(name.trim(), code);
            showAppToast(`📋 Đã lưu vào Cheat: ${name}`);
            renderCheatsList();
          }
        }
      });
    });

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
    if (scanner.compareType === 'exact' && val === '') {
      alert('Vui lòng nhập giá trị cần tìm!');
      return;
    }
    scanner.setValueType(scannerTypeSelect.value);
    const results = scanner.searchFirst(val !== '' ? Number(val) : null);
    scannerStatus.textContent = `Tìm thấy ${results.length} ô nhớ (chế độ ${scanner.compareType}). Hãy thay đổi thông số trong game rồi bấm "Lọc Tiếp".`;
    updateScannerUI();
  });

  btnScannerNext?.addEventListener('click', () => {
    const val = scannerValInput.value.trim();
    if (scanner.compareType === 'exact' && val === '') {
      alert('Vui lòng nhập giá trị mới để lọc tiếp!');
      return;
    }
    const results = scanner.searchNext(val !== '' ? Number(val) : null);
    scannerStatus.textContent = `Còn lại ${results.length} ô nhớ phù hợp điều kiện.`;
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
    const num = Math.max(1.0, Math.min(5.0, parseFloat(val) || 1.0));
    gba.speedMultiplier = num;
    gba.fastForward = num > 1.001;
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

  // Load saved speed or default 1.0 (normal)
  const savedSpeed = localStorage.getItem('myboy_ff_speed') || '1.0';
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
    engineSelect.value = localStorage.getItem('gba_k_engine') || 'wasm';
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
    if (gba._resumeAudio) {
      gba._resumeAudio();
    }
    if (gba.core && gba.core.audio && gba.core.audio.context && gba.core.audio.context.state === 'suspended') {
      gba.core.audio.context.resume().catch(() => {});
    }
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

  // Auto load last played ROM if available
  setTimeout(async () => {
    const roms = await library.getAllRoms();
    // Filter out any old dummy demo files
    const realRoms = roms.filter(r => r.name !== 'Neon_Blast_Demo.gba' && r.size > 1024);
    if (realRoms.length > 0) {
      handleLoadRom(realRoms[0].data, realRoms[0].name);
    } else {
      romBadge.textContent = 'Nhấn 📂 để mở ROM GBA';
    }
  }, 150);
});
