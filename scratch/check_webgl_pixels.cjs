const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

async function test() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edge = spawn(edgePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    'http://localhost:3000/'
  ]);

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const data = await new Promise((res, rej) => {
        http.get('http://127.0.0.1:9222/json', (r) => {
          let s = '';
          r.on('data', d => s += d);
          r.on('end', () => res(s));
        }).on('error', rej);
      });
      const pages = JSON.parse(data);
      const page = pages.find(p => p.url.includes('3000'));
      if (page && page.webSocketDebuggerUrl) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        ws.onopen = () => {
          ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
          ws.send(JSON.stringify({ id: 2, method: 'Page.enable' }));
        };

        // Load Pokemon Radical Red after 1s
        setTimeout(() => {
          ws.send(JSON.stringify({
            id: 50,
            method: 'Runtime.evaluate',
            params: {
              awaitPromise: true,
              expression: `(async () => {
                const res = await fetch('/game/Radical%20Red%20(v4.0).gba');
                const buf = await res.arrayBuffer();
                window.gba_instance.loadRom(buf, 'Radical Red (v4.0).gba');
                return buf.byteLength;
              })()`
            }
          }));
        }, 1000);

        // After 6s, read WebGL pixels from inside the iframe
        setTimeout(() => {
          ws.send(JSON.stringify({
            id: 77,
            method: 'Runtime.evaluate',
            params: {
              awaitPromise: true,
              expression: `new Promise((resolve) => {
                const iframe = document.getElementById('ejs-core-frame');
                const win = iframe.contentWindow;
                const canvas = win.document.querySelector('canvas');
                
                win.requestAnimationFrame(() => {
                  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                  if (!gl) return resolve('no gl');
                  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
                  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                  
                  // Count non-black, non-white pixels
                  let colored = 0;
                  for (let i = 0; i < pixels.length; i += 4) {
                    const r = pixels[i], g = pixels[i+1], b = pixels[i+2];
                    if ((r > 10 || g > 10 || b > 10) && !(r > 245 && g > 245 && b > 245)) colored++;
                  }
                  
                  resolve(JSON.stringify({
                    width: canvas.width,
                    height: canvas.height,
                    totalPixels: canvas.width * canvas.height,
                    coloredPixels: colored,
                    sample: [pixels[0], pixels[1], pixels[2], pixels[3]]
                  }));
                });
              })`
            }
          }));
        }, 6000);

        ws.onmessage = (msg) => {
          const parsed = JSON.parse(msg.data);
          if (parsed.id === 77) {
            console.log('[WEBGL PIXEL ANALYSIS]:', parsed.result?.result?.value);
            ws.close();
            edge.kill();
            process.exit(0);
          }
        };
        return;
      }
    } catch (e) {}
  }
}

test();
