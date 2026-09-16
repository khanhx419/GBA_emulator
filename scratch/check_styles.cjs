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
          ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
        };

        setTimeout(() => {
          ws.send(JSON.stringify({
            id: 99,
            method: 'Runtime.evaluate',
            params: {
              expression: `(() => {
                const cw = document.getElementById('canvas-wrapper');
                const gbaCanvas = document.getElementById('gba-screen');
                const iframe = document.getElementById('ejs-core-frame');
                const cwStyle = window.getComputedStyle(cw);
                const iframeStyle = iframe ? window.getComputedStyle(iframe) : null;
                const innerCanvas = iframe?.contentWindow?.document?.querySelector('canvas');
                const innerStyle = innerCanvas ? iframe.contentWindow.getComputedStyle(innerCanvas) : null;
                return JSON.stringify({
                  cwBg: cwStyle.backgroundColor,
                  cwColor: cwStyle.color,
                  cwChildren: Array.from(cw.children).map(c => ({ tag: c.tagName, id: c.id, display: c.style.display, zIndex: c.style.zIndex })),
                  iframeBg: iframeStyle?.backgroundColor,
                  iframeOpacity: iframeStyle?.opacity,
                  innerCanvasBg: innerStyle?.backgroundColor,
                  innerCanvasW: innerCanvas?.width,
                  innerCanvasH: innerCanvas?.height
                }, null, 2);
              })()`
            }
          }));
        }, 3000);

        ws.onmessage = (msg) => {
          const parsed = JSON.parse(msg.data);
          if (parsed.id === 99) {
            console.log('[COMPUTED STYLES]:', parsed.result?.result?.value);
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
