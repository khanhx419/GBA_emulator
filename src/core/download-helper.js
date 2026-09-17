/**
 * downloadFile — Universal file downloader for Web Browser and Android APK.
 * 
 * - On Android APK (Capacitor): writes directly to device /Download/ folder via AndroidBridge
 * - On Web Browser: triggers browser download via Blob and <a> tag
 */
export function downloadFile(fileName, data, mimeType = 'application/octet-stream') {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);

  // 1. Android APK native bridge
  if (window.AndroidBridge && typeof window.AndroidBridge.saveBase64File === 'function') {
    try {
      let binary = '';
      const len = u8.byteLength;
      const chunkSize = 8192;
      for (let i = 0; i < len; i += chunkSize) {
        binary += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + chunkSize, len)));
      }
      const b64 = btoa(binary);
      const ok = window.AndroidBridge.saveBase64File(fileName, b64);
      if (ok) return true;
    } catch (e) {
      console.warn('[downloadFile] AndroidBridge error, falling back to browser blob:', e);
    }
  }

  // 2. Browser Blob download fallback
  try {
    const blob = new Blob([u8], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
    return true;
  } catch (err) {
    console.error('[downloadFile] Failed to download file:', err);
    return false;
  }
}
