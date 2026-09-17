const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

async function test() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edge = spawn(edgePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=850,420',
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
          ws.send(JSON.stringify({ id: 1, method: 'Page.enable' }));
          ws.send(JSON.stringify({ id: 2, method: 'Runtime.enable' }));
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

        setTimeout(() => {
          ws.send(JSON.stringify({
            id: 100,
            method: 'Page.captureScreenshot',
            params: { format: 'png' }
          }));
        }, 6000);

        ws.onmessage = (msg) => {
          const parsed = JSON.parse(msg.data);
          if (parsed.id === 100) {
            const buf = Buffer.from(parsed.result.data, 'base64');
            fs.writeFileSync('scratch/clean_screen.png', buf);
            console.log('CLEAN SCREENSHOT SAVED, size:', buf.length);
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
