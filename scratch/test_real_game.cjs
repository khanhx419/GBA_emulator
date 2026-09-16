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
          ws.send(JSON.stringify({ id: 1, method: 'Console.enable' }));
          ws.send(JSON.stringify({ id: 2, method: 'Runtime.enable' }));
          ws.send(JSON.stringify({ id: 3, method: 'Page.enable' }));
        };

        // Load Pokemon Radical Red after 2s
        setTimeout(() => {
          console.log('Dispatching load of Radical Red...');
          ws.send(JSON.stringify({
            id: 50,
            method: 'Runtime.evaluate',
            params: {
              awaitPromise: true,
              expression: `(async () => {
                const res = await fetch('/game/Radical%20Red%20(v4.0).gba');
                const buf = await res.arrayBuffer();
                console.log('Fetched ROM size:', buf.byteLength);
                window.gba_instance.loadRom(buf, 'Radical Red (v4.0).gba');
                return buf.byteLength;
              })()`
            }
          }));
        }, 1500);

        // Every 3 seconds, check iframe internal canvas
        const interval = setInterval(() => {
          ws.send(JSON.stringify({
            id: 88,
            method: 'Runtime.evaluate',
            params: {
              expression: `(() => {
                const iframe = document.getElementById('ejs-core-frame');
                const doc = iframe?.contentWindow?.document;
                const canvas = doc?.querySelector('canvas');
                const ejs = iframe?.contentWindow?.EJS_emulator;
                return JSON.stringify({
                  iframeDisplay: iframe?.style?.display,
                  hasCanvas: !!canvas,
                  canvasW: canvas?.width,
                  canvasH: canvas?.height,
                  ejsStarted: ejs?.started,
                  ejsPaused: ejs?.paused,
                  fps: window.gba_instance?.fps
                });
              })()`
            }
          }));
        }, 3000);

        // After 18s, take screenshot
        setTimeout(() => {
          console.log('Taking screenshot at 18s...');
          ws.send(JSON.stringify({
            id: 100,
            method: 'Page.captureScreenshot',
            params: { format: 'png' }
          }));
        }, 18000);

        ws.onmessage = (msg) => {
          const parsed = JSON.parse(msg.data);
          if (parsed.method === 'Runtime.consoleAPICalled') {
            console.log(`[CONSOLE ${parsed.params.type}]:`, parsed.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' '));
          } else if (parsed.id === 88) {
            console.log('[STATUS TICK]:', parsed.result?.result?.value);
          } else if (parsed.id === 100) {
            const buf = Buffer.from(parsed.result.data, 'base64');
            fs.writeFileSync('scratch/screenshot_pokemon_18s.png', buf);
            console.log('POKEMON 18s SCREENSHOT SAVED! size:', buf.length);
          }
        };

        setTimeout(() => {
          clearInterval(interval);
          ws.close();
          edge.kill();
          process.exit(0);
        }, 22000);
        return;
      }
    } catch (e) {}
  }
}

test();
