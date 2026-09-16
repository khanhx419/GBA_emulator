const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

async function test() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edge = spawn(edgePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
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

        // After 6s, inspect iframe inner canvas pixels
        setTimeout(() => {
          ws.send(JSON.stringify({
            id: 99,
            method: 'Runtime.evaluate',
            params: {
              expression: `(() => {
                const iframe = document.getElementById('ejs-core-frame');
                const doc = iframe?.contentWindow?.document;
                const canvas = doc?.querySelector('canvas');
                let pixelSample = null;
                if (canvas) {
                  try {
                    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
                    pixelSample = ctx ? 'WebGL context active' : 'No WebGL';
                  } catch(e) { pixelSample = e.message; }
                }
                return JSON.stringify({
                  iframeDisplay: iframe?.style?.display,
                  canvasW: canvas?.width,
                  canvasH: canvas?.height,
                  canvasStyle: canvas?.getAttribute('style'),
                  pixelSample: pixelSample,
                  gameHtml: doc?.getElementById('game')?.innerHTML?.slice(0, 200)
                }, null, 2);
              })()`
            }
          }));
        }, 6000);

        ws.onmessage = (msg) => {
          const parsed = JSON.parse(msg.data);
          if (parsed.id === 99) {
            console.log('[INNER CANVAS STATUS]:', parsed.result?.result?.value);
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
