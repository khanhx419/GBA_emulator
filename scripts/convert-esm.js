import fs from 'fs';

// 1. util.js
let util = fs.readFileSync('src/core/engine/util.js', 'utf8');
util = util.replace(/exports\.inherit\s*=\s*inherit;/, '');
util = util.replace(/exports\.hex\s*=\s*hex;/, '');
util = util.replace(/exports\.Serializer\s*=\s*Serializer;/, 'export { inherit, hex, Serializer };');
fs.writeFileSync('src/core/engine/util.js', util);

// 2. memory-view.js
let mv = fs.readFileSync('src/core/engine/memory-view.js', 'utf8');
mv = mv.replace(/var inherit = require\(['"]\.\/util['"]\)\.inherit;/, "import { inherit } from './util.js';");
mv = mv.replace(/module\.exports\s*=\s*MemoryView;/, 'export default MemoryView;');
fs.writeFileSync('src/core/engine/memory-view.js', mv);

// 3. memory-canvas.js
let mc = fs.readFileSync('src/core/engine/memory-canvas.js', 'utf8');
mc = mc.replace(/module\.exports\s*=\s*MemoryCanvas;/, 'export default MemoryCanvas;');
fs.writeFileSync('src/core/engine/memory-canvas.js', mc);

// 4. arm.js
let arm = fs.readFileSync('src/core/engine/arm.js', 'utf8');
arm = arm.replace(/module\.exports\s*=\s*ARMCoreArm;/, 'export default ARMCoreArm;');
fs.writeFileSync('src/core/engine/arm.js', arm);

// 5. thumb.js
let thumb = fs.readFileSync('src/core/engine/thumb.js', 'utf8');
thumb = thumb.replace(/module\.exports\s*=\s*ARMCoreThumb;/, 'export default ARMCoreThumb;');
fs.writeFileSync('src/core/engine/thumb.js', thumb);

// 6. core.js
let core = fs.readFileSync('src/core/engine/core.js', 'utf8');
core = core.replace(/var inherit = require\(['"]\.\/util['"]\)\.inherit;/, "import { inherit } from './util.js';");
core = core.replace(/var ARMCoreArm = require\(['"]\.\/arm['"]\);/, "import ARMCoreArm from './arm.js';");
core = core.replace(/var ARMCoreThumb = require\(['"]\.\/thumb['"]\);/, "import ARMCoreThumb from './thumb.js';");
core = core.replace(/module\.exports\s*=\s*ARMCore;/, 'export default ARMCore;');
fs.writeFileSync('src/core/engine/core.js', core);

// 7. gpio.js
let gpio = fs.readFileSync('src/core/engine/gpio.js', 'utf8');
gpio = gpio.replace(/exports\.GameBoyAdvanceGPIO\s*=\s*GameBoyAdvanceGPIO;/, '');
gpio = gpio.replace(/exports\.GameBoyAdvanceRTC\s*=\s*GameBoyAdvanceRTC;/, 'export { GameBoyAdvanceGPIO, GameBoyAdvanceRTC };');
fs.writeFileSync('src/core/engine/gpio.js', gpio);

// 8. savedata.js
let save = fs.readFileSync('src/core/engine/savedata.js', 'utf8');
save = save.replace(/var MemoryView = require\(['"]\.\/memory-view['"]\);/, "import MemoryView from './memory-view.js';");
save = save.replace(/exports\.SRAMSavedata\s*=\s*SRAMSavedata;/, '');
save = save.replace(/exports\.FlashSavedata\s*=\s*FlashSavedata;/, '');
save = save.replace(/exports\.EEPROMSavedata\s*=\s*EEPROMSavedata;/, 'export { SRAMSavedata, FlashSavedata, EEPROMSavedata };');
fs.writeFileSync('src/core/engine/savedata.js', save);

// 9. mmu.js
let mmu = fs.readFileSync('src/core/engine/mmu.js', 'utf8');
mmu = mmu.replace(/var DataView = require\(['"]buffer-dataview['"]\);/, '');
mmu = mmu.replace(/var MemoryView = require\(['"]\.\/memory-view['"]\);/, "import MemoryView from './memory-view.js';");
mmu = mmu.replace(/var GameBoyAdvanceGPIO = require\(['"]\.\/gpio['"]\)\.GameBoyAdvanceGPIO;/, "import { GameBoyAdvanceGPIO } from './gpio.js';");
mmu = mmu.replace(/var FlashSavedata = require\(['"]\.\/savedata['"]\)\.FlashSavedata;/, "import { FlashSavedata, EEPROMSavedata, SRAMSavedata } from './savedata.js';");
mmu = mmu.replace(/var EEPROMSavedata = require\(['"]\.\/savedata['"]\)\.EEPROMSavedata;/, '');
mmu = mmu.replace(/var SRAMSavedata = require\(['"]\.\/savedata['"]\)\.SRAMSavedata;/, '');
mmu = mmu.replace(/exports\.MemoryBlock\s*=\s*MemoryBlock;/, '');
mmu = mmu.replace(/exports\.ROMView\s*=\s*ROMView;/, '');
mmu = mmu.replace(/exports\.BIOSView\s*=\s*BIOSView;/, '');
mmu = mmu.replace(/exports\.GameBoyAdvanceMMU\s*=\s*GameBoyAdvanceMMU;/, 'export { GameBoyAdvanceMMU, MemoryBlock, ROMView, BIOSView };');
fs.writeFileSync('src/core/engine/mmu.js', mmu);

// 10. video/software.js
let soft = fs.readFileSync('src/core/engine/video/software.js', 'utf8');
soft = soft.replace(/exports\.GameBoyAdvanceSoftwareRenderer\s*=\s*GameBoyAdvanceSoftwareRenderer;/, 'export { GameBoyAdvanceSoftwareRenderer };');
fs.writeFileSync('src/core/engine/video/software.js', soft);

// 11. video.js
let vid = fs.readFileSync('src/core/engine/video.js', 'utf8');
vid = vid.replace(/var GameBoyAdvanceSoftwareRenderer = require\(['"]\.\/video\/software['"]\)\.GameBoyAdvanceSoftwareRenderer;/, "import { GameBoyAdvanceSoftwareRenderer } from './video/software.js';");
vid = vid.replace(/module\.exports\s*=\s*GameBoyAdvanceVideo;/, 'export default GameBoyAdvanceVideo;');
fs.writeFileSync('src/core/engine/video.js', vid);

// 12. audio.js
let aud = fs.readFileSync('src/core/engine/audio.js', 'utf8');
aud = aud.replace(/module\.exports\s*=\s*GameBoyAdvanceAudio;/, 'export default GameBoyAdvanceAudio;');
fs.writeFileSync('src/core/engine/audio.js', aud);

// 13. keypad.js
let kp = fs.readFileSync('src/core/engine/keypad.js', 'utf8');
kp = kp.replace(/module\.exports\s*=\s*GameBoyAdvanceKeypad;/, 'export default GameBoyAdvanceKeypad;');
fs.writeFileSync('src/core/engine/keypad.js', kp);

// 14. sio.js
let sio = fs.readFileSync('src/core/engine/sio.js', 'utf8');
sio = sio.replace(/module\.exports\s*=\s*GameBoyAdvanceSIO;/, 'export default GameBoyAdvanceSIO;');
fs.writeFileSync('src/core/engine/sio.js', sio);

// 15. irq.js
let irq = fs.readFileSync('src/core/engine/irq.js', 'utf8');
irq = irq.replace(/var DataView = require\(['"]buffer-dataview['"]\);/, '');
irq = irq.replace(/module\.exports\s*=\s*GameBoyAdvanceInterruptHandler;/, 'export default GameBoyAdvanceInterruptHandler;');
fs.writeFileSync('src/core/engine/irq.js', irq);

// 16. gba.js
let gba = fs.readFileSync('src/core/engine/gba.js', 'utf8');
gba = gba.replace(/var ARMCore = require\(['"]\.\/core['"]\);/, "import ARMCore from './core.js';");
gba = gba.replace(/var GameBoyAdvanceMMU = require\(['"]\.\/mmu['"]\)\.GameBoyAdvanceMMU;/, "import { GameBoyAdvanceMMU } from './mmu.js';");
gba = gba.replace(/var GameBoyAdvanceInterruptHandler = require\(['"]\.\/irq['"]\);/, "import GameBoyAdvanceInterruptHandler from './irq.js';");
gba = gba.replace(/var GameBoyAdvanceIO = require\(['"]\.\/io['"]\);/, "import GameBoyAdvanceIO from './io.js';");
gba = gba.replace(/var GameBoyAdvanceAudio = require\(['"]\.\/audio['"]\);/, "import GameBoyAdvanceAudio from './audio.js';");
gba = gba.replace(/var GameBoyAdvanceVideo = require\(['"]\.\/video['"]\);/, "import GameBoyAdvanceVideo from './video.js';");
gba = gba.replace(/var GameBoyAdvanceKeypad = require\(['"]\.\/keypad['"]\);/, "import GameBoyAdvanceKeypad from './keypad.js';");
gba = gba.replace(/var GameBoyAdvanceSIO = require\(['"]\.\/sio['"]\);/, "import GameBoyAdvanceSIO from './sio.js';");
gba = gba.replace(/var MemoryCanvas = require\(['"]\.\/memory-canvas['"]\);/, "import MemoryCanvas from './memory-canvas.js';");
gba = gba.replace(/module\.exports\s*=\s*GameBoyAdvance;/, '');
if (!gba.includes('export default GameBoyAdvance')) {
  gba += '\nexport default GameBoyAdvance;\n';
}
fs.writeFileSync('src/core/engine/gba.js', gba);

console.log('Successfully converted all engine files to native ESM!');
