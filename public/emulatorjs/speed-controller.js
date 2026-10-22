(() => {
  function createSpeedController(getEmulator) {
    let applied = null;
    return function applySpeed(fastForward, speedMultiplier, vsyncEnabled, force = false) {
      const parsed = Number(speedMultiplier);
      const ratio = Number.isFinite(parsed) ? Math.max(1, Math.min(5, parsed)) : 2;
      const enabled = Boolean(fastForward) && ratio > 1;
      const vsync = Boolean(vsyncEnabled) && !enabled;
      const emulator = getEmulator();
      const manager = emulator?.gameManager;
      if (!manager) return false;
      const changed = force || applied?.manager !== manager;
      if (!changed && applied.enabled === enabled && applied.ratio === ratio && applied.vsync === vsync) return true;
      emulator.isFastForward = enabled;
      if (emulator.settings) {
        emulator.settings['ff-ratio'] = String(ratio);
        emulator.settings.fastForward = enabled ? 'enabled' : 'disabled';
      }
      const invoke = (name, ...argumentsList) => {
        const owner = typeof manager[name] === 'function' ? manager : manager.functions;
        if (typeof owner?.[name] !== 'function') return false;
        owner[name](...argumentsList);
        return true;
      };
      try {
        const restartFastForward = !changed && applied.enabled && enabled && applied.ratio !== ratio;
        if (restartFastForward) invoke('toggleFastForward', 0);
        if (changed || applied.ratio !== ratio) invoke('setFastForwardRatio', ratio);
        if (changed) invoke('setVariable', 'mgba_frameskip', '0');
        if (changed || applied.vsync !== vsync) invoke('setVSync', vsync ? 1 : 0);
        if (changed || applied.enabled !== enabled || restartFastForward) {
          if (manager.Module?.ccall) {
            for (const [key, value] of [['audio_sync', enabled ? 'false' : 'true'], ['video_vsync', vsync ? 'true' : 'false']]) {
              try { manager.Module.ccall('retroarch_set_config_option', 'void', ['string', 'string'], [key, value]); } catch (error) {}
            }
          }
          invoke('toggleFastForward', enabled ? 1 : 0);
        } else if (changed || applied.vsync !== vsync) {
          try { manager.Module?.ccall?.('retroarch_set_config_option', 'void', ['string', 'string'], ['video_vsync', vsync ? 'true' : 'false']); } catch (error) {}
        }
        applied = { manager, ratio, enabled, vsync };
        return true;
      } catch (error) {
        applied = null;
        console.warn('[GBA_K] Speed update failed:', error);
        return false;
      }
    };
  }
  globalThis.GBAKSpeed = { createSpeedController };
})();
