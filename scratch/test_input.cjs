const { GBAControls } = require; // wait, let's test via edge headless

const http = require('http');
const { spawn } = require('child_process');

async function test() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edge = spawn(edgePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--autoplay-policy=no-user-gesture-required',
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
        };

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
              })()`
            }
          }));
        }, 1000);

        // After 5s, intercept simulateInput and test pressing A and B
        setTimeout(() => {
          ws.send(JSON.stringify({
            id: 77,
            method: 'Runtime.evaluate',
            params: {
              expression: `(() => {
                const iframe = document.getElementById('ejs-core-frame');
                const gm = iframe?.contentWindow?.EJS_emulator?.gameManager;
                if (!gm) return 'no gm';
                
                const calls = [];
                const origSimulate = gm.simulateInput.bind(gm);
                gm.simulateInput = (player, btn, val) => {
                  calls.push({ player, btn, val });
                  origSimulate(player, btn, val);
                };
                
                // Press A (KEYS.A = 0)
                window.gba_instance.setKeyDown(0);
                window.gba_instance.setKeyUp(0);
                
                // Press B (KEYS.B = 1)
                window.gba_instance.setKeyDown(1);
                window.gba_instance.setKeyUp(1);

                // Press START (KEYS.START = 3)
                window.gba_instance.setKeyDown(3);
                window.gba_instance.setKeyUp(3);
                
                return JSON.stringify(calls);
              })()`
            }
          }));
        }, 5000);

        ws.onmessage = (msg) => {
          const parsed = JSON.parse(msg.data);
          if (parsed.id === 77) {
            console.log('[INPUT SIMULATION TEST]:', parsed.result?.result?.value);
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
