const http = require('http');
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
        };
        ws.onmessage = (msg) => {
          const parsed = JSON.parse(msg.data);
          if (parsed.method === 'Runtime.consoleAPICalled') {
            console.log(`[CONSOLE ${parsed.params.type}]:`, parsed.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' '));
          } else if (parsed.method === 'Runtime.exceptionThrown') {
            console.log('[EXCEPTION]:', parsed.params.exceptionDetails.text, parsed.params.exceptionDetails.exception?.description);
          } else if (parsed.id === 20) {
            console.log('[DEBUG INFO]:', parsed.result?.result?.value);
          }
        };

        // Every 3 seconds, evaluate state
        setTimeout(() => {
          ws.send(JSON.stringify({
            id: 20,
            method: 'Runtime.evaluate',
            params: {
              expression: `(() => {
                const e = window.EJS_emulator;
                if (!e) return 'No EJS';
                return JSON.stringify({
                  textElem: e.textElem?.innerText,
                  hasModule: !!e.Module,
                  hasGameManager: !!e.gameManager,
                  started: e.started,
                  paused: e.paused,
                  fileName: e.fileName,
                  fsFiles: e.gameManager?.FS ? e.gameManager.FS.readdir('/') : null,
                  failedToStart: e.failedToStart
                }, null, 2);
              })()`
            }
          }));
        }, 8000);

        setTimeout(() => {
          ws.close();
          edge.kill();
          process.exit(0);
        }, 11000);
        return;
      }
    } catch (e) {}
  }
}

test();
