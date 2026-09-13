import { GBA } from './core/gba.js';
import { GBAControls } from './ui/controls.js';
import { GBALibrary } from './ui/library.js';
import { GBAShaders } from './ui/shaders.js';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gba-screen');
  const canvasWrapper = document.getElementById('canvas-wrapper');
  const romBadge = document.getElementById('current-rom-name');
  const fpsBadge = document.getElementById('fps-counter');
  const powerLed = document.getElementById('power-led');

  // Initialize GBA Core
  const gba = new GBA(canvas);
  const controls = new GBAControls(gba);
  const shaders = new GBAShaders(canvasWrapper);

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
  };

  const library = new GBALibrary(gba, handleLoadRom);

  // --- Modal Dialogs Handling ---
  const openModal = (id) => {
    closeAllModals();
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

  // Toolbar Modal Triggers
  document.getElementById('btn-open-library')?.addEventListener('click', () => {
    library.renderLibraryList();
    openModal('modal-library');
  });

  document.getElementById('btn-open-states')?.addEventListener('click', () => {
    renderSaveSlots();
    openModal('modal-states');
  });

  document.getElementById('btn-open-cheats')?.addEventListener('click', () => {
    renderCheatsList();
    openModal('modal-cheats');
  });

  document.getElementById('btn-open-settings')?.addEventListener('click', () => {
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

    fileInput.addEventListener('change', (e) => {
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

  // --- Settings ---
  document.getElementById('setting-speed')?.addEventListener('change', (e) => {
    const val = parseFloat(e.target.value);
    gba.speedMultiplier = val;
    document.getElementById('ff-label').textContent = `${val}x`;
  });

  document.getElementById('setting-shader')?.addEventListener('change', (e) => {
    shaders.setFilter(e.target.value);
  });

  document.getElementById('setting-volume')?.addEventListener('input', (e) => {
    gba.apu.setVolume(parseFloat(e.target.value));
  });

  document.getElementById('setting-haptic')?.addEventListener('change', (e) => {
    controls.hapticsEnabled = e.target.checked;
  });

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
