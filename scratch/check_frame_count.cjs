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

        // Check frame count every 1.5 seconds, and try resuming audio
        let count = 0;
        const iv = setInterval(() => {
          count++;
          ws.send(JSON.stringify({
            id: 100 + count,
            method: 'Runtime.evaluate',
            params: {
              expression: `(() => {
                const iframe = document.getElementById('ejs-core-frame');
                const win = iframe?.contentWindow;
                const gm = win?.EJS_emulator?.gameManager;
                
                // Try resuming any audio context in iframe
                if (win?.AudioContext) {
                  // check if there's any audio context
                }
                if (win?.EJS_emulator?.Module?.AL) {
                  const al = win.EJS_emulator.Module.AL;
                  if (al.currentCtx && al.currentCtx.audioCtx && al.currentCtx.audioCtx.state === 'suspended') {
                    al.currentCtx.audioCtx.resume();
                  }
                }
                
                return JSON.stringify({
                  frameNum: gm?.getFrameNum ? gm.getFrameNum() : 'no gm',
                  dimensions: gm?.getVideoDimensions ? gm.getVideoDimensions() : 'no dim'
                });
              })()`
            }
          }));
          if (count >= 7) {
            clearInterval(iv);
            setTimeout(() => { ws.close(); edge.kill(); process.exit(0); }, 1000);
          }
        }, 1500);

        ws.onmessage = (msg) => {
          const parsed = JSON.parse(msg.data);
          if (parsed.id > 100) {
            console.log('[FRAME TICK]:', parsed.result?.result?.value);
          }
        };
        return;
      }
    } catch (e) {}
  }
}

test();
