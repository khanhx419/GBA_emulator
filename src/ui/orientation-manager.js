import { ScreenOrientation } from '@capacitor/screen-orientation';

export class OrientationManager {
  constructor() {
    this.mode = localStorage.getItem('gba_k_orientation_mode') || 'auto'; // 'auto' | 'portrait' | 'landscape'
    this.headerBtn = null;
    this.iconEl = null;
    this.badgeEl = null;
    this.toastEl = null;
    this.toastTimeout = null;
  }

  init() {
    this.headerBtn = document.getElementById('btn-orientation-lock');
    this.iconEl = document.getElementById('orient-btn-icon');
    this.badgeEl = document.getElementById('orient-btn-badge');
    this.toastEl = document.getElementById('app-toast');

    // Header Quick Toggle Button
    if (this.headerBtn) {
      this.headerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cycleMode();
      });
    }

    // Hamburger Dropdown Buttons
    const btnAuto = document.getElementById('btn-orient-auto');
    const btnPortrait = document.getElementById('btn-orient-portrait');
    const btnLandscape = document.getElementById('btn-orient-landscape');

    btnAuto?.addEventListener('click', () => this.setMode('auto'));
    btnPortrait?.addEventListener('click', () => this.setMode('portrait'));
    btnLandscape?.addEventListener('click', () => this.setMode('landscape'));

    // Settings Modal Select
    const settingSelect = document.getElementById('setting-orientation');
    if (settingSelect) {
      settingSelect.value = this.mode;
      settingSelect.addEventListener('change', (e) => {
        this.setMode(e.target.value);
      });
    }

    // Apply initial saved orientation (silent without toast)
    this.applyOrientation(this.mode, false);
  }

  async cycleMode() {
    let nextMode = 'auto';
    if (this.mode === 'auto') {
      nextMode = 'portrait';
    } else if (this.mode === 'portrait') {
      nextMode = 'landscape';
    } else {
      nextMode = 'auto';
    }
    await this.setMode(nextMode);
  }

  async setMode(mode, showFeedback = true) {
    this.mode = mode;
    localStorage.setItem('gba_k_orientation_mode', mode);
    await this.applyOrientation(mode, showFeedback);
  }

  async applyOrientation(mode, showFeedback = true) {
    this.updateUI(mode);

    try {
      if (mode === 'portrait') {
        await ScreenOrientation.lock({ orientation: 'portrait' });
      } else if (mode === 'landscape') {
        await ScreenOrientation.lock({ orientation: 'landscape' });
      } else {
        await ScreenOrientation.unlock();
      }
    } catch (err) {
      // Fallback to standard W3C Screen Orientation API if available
      try {
        if (screen && screen.orientation) {
          if (mode === 'portrait' && screen.orientation.lock) {
            await screen.orientation.lock('portrait');
          } else if (mode === 'landscape' && screen.orientation.lock) {
            await screen.orientation.lock('landscape');
          } else if (screen.orientation.unlock) {
            screen.orientation.unlock();
          }
        }
      } catch (fallbackErr) {
        console.warn('Orientation lock fallback not available:', fallbackErr);
      }
    }

    if (showFeedback) {
      if (mode === 'portrait') {
        this.showToast('📱 Đã cố định màn hình Dọc (Chống tự xoay)');
      } else if (mode === 'landscape') {
        this.showToast('🖥️ Đã cố định màn hình Ngang (Landscape)');
      } else {
        this.showToast('🔄 Đã mở khóa xoay tự do (Theo cảm biến máy)');
      }
    }
  }

  updateUI(mode) {
    if (!this.headerBtn) return;

    // Reset button states
    this.headerBtn.classList.remove('mode-portrait', 'mode-landscape', 'mode-auto');

    if (mode === 'portrait') {
      this.headerBtn.classList.add('mode-portrait');
      if (this.iconEl) this.iconEl.textContent = '🔒';
      if (this.badgeEl) this.badgeEl.textContent = 'Dọc';
      this.headerBtn.title = 'Khóa màn hình: Cố định Dọc (Bấm để đổi sang Ngang)';
    } else if (mode === 'landscape') {
      this.headerBtn.classList.add('mode-landscape');
      if (this.iconEl) this.iconEl.textContent = '🔒';
      if (this.badgeEl) this.badgeEl.textContent = 'Ngang';
      this.headerBtn.title = 'Khóa màn hình: Cố định Ngang (Bấm để mở Tự do)';
    } else {
      this.headerBtn.classList.add('mode-auto');
      if (this.iconEl) this.iconEl.textContent = '🔄';
      if (this.badgeEl) this.badgeEl.textContent = 'Tự do';
      this.headerBtn.title = 'Khóa màn hình: Tự do theo máy (Bấm để Khóa Dọc)';
    }

    // Update hamburger buttons active states
    document.getElementById('btn-orient-auto')?.classList.toggle('active', mode === 'auto');
    document.getElementById('btn-orient-portrait')?.classList.toggle('active', mode === 'portrait');
    document.getElementById('btn-orient-landscape')?.classList.toggle('active', mode === 'landscape');

    // Update settings modal select
    const settingSelect = document.getElementById('setting-orientation');
    if (settingSelect && settingSelect.value !== mode) {
      settingSelect.value = mode;
    }
  }

  showToast(message) {
    if (!this.toastEl) {
      this.toastEl = document.getElementById('app-toast');
    }
    if (!this.toastEl) return;

    this.toastEl.textContent = message;
    this.toastEl.classList.add('visible');

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }

    this.toastTimeout = setTimeout(() => {
      this.toastEl.classList.remove('visible');
    }, 2000);
  }
}
