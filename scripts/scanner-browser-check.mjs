import { mkdir, writeFile } from 'node:fs/promises';
const noOffscreen = process.argv.includes('--no-offscreen');
const nativePhoto = process.argv.includes('--native-photo');
const borderless = process.argv.includes('--borderless');
const origin = process.argv[2] || 'http://localhost:5173';
const debugOrigin = process.env.BROWSER_DEBUG_URL || 'http://localhost:9225';
const tabs = await (await fetch(debugOrigin + '/json')).json();
const ws = new WebSocket(
  tabs.find((t) => t.type === 'page' && !t.url.startsWith('edge:'))
    .webSocketDebuggerUrl,
);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const jobs = new Map();
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    const job = jobs.get(m.id);
    jobs.delete(m.id);
    m.error
      ? job.reject(new Error(JSON.stringify(m.error)))
      : job.resolve(m.result);
  }
  if (m.method === 'Runtime.exceptionThrown')
    errors.push(m.params.exceptionDetails);
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    jobs.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function wait(expression, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Timeout ' + expression);
}
async function click(label) {
  await evaluate(
    `[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
  );
}
async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}
try {
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await call('Page.navigate', { url: origin + '/scan' });
  await wait("document.body.innerText.includes('Start Camera')");
  await evaluate(`window.noOffscreen=${noOffscreen};window.nativePhoto=${nativePhoto};
    if(window.noOffscreen)window.OffscreenCanvas=undefined;
    if(window.nativePhoto)window.ImageCapture=class{async takePhoto(){const c=document.createElement('canvas');c.width=1600;c.height=1600;const q=c.getContext('2d');q.fillStyle='#202520';q.fillRect(0,0,1600,1600);q.drawImage(window.cameraCanvas,200,0,1200,1600);return new Promise(r=>c.toBlob(r,'image/jpeg',.96));}};
  `);
  await evaluate(`window.testBorderless=${borderless};window.testPage=1;window.moving=true;window.workers=[];window.stops=0;window.analysisTimes=[];window.analysisStarts=[];const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(...args){let boot;if(window.noOffscreen && String(args[0]).includes('imageProcessing')){boot=URL.createObjectURL(new Blob(['self.OffscreenCanvas=undefined;const queued=[];self.onmessage=e=>queued.push(e);await import('+JSON.stringify(String(args[0]))+');for(const e of queued)self.onmessage(e);'],{type:'text/javascript'}));args[0]=boot;}super(...args);this.boot=boot;this.jobs=new Map();this.addEventListener('message',e=>{const start=this.jobs.get(e.data.id);if(start!==undefined){window.analysisTimes.push(performance.now()-start);this.jobs.delete(e.data.id);}});window.workers.push(this)}postMessage(message,...rest){if(message.type==='analyze'){const now=performance.now();this.jobs.set(message.id,now);window.analysisStarts.push(now);}return super.postMessage(message,...rest);}terminate(){if(this.boot)URL.revokeObjectURL(this.boot);window.stops++;return super.terminate()}};
 navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');c.width=900;c.height=1200;window.cameraCanvas=c;const ctx=c.getContext('2d');setInterval(()=>{ctx.fillStyle=window.testBorderless?'#fffef2':'#202520';ctx.fillRect(0,0,900,1200);if(!window.testPage)return;const offset=window.moving?Math.sin(Date.now()/90)*45:0;ctx.save();ctx.translate(offset,0);if(window.testPage===2)ctx.transform(1,.055,-.075,1,45,-25);ctx.fillStyle='#fffef2';ctx.fillRect(130,120,640,960);ctx.fillStyle='#111';ctx.font='bold 30px Georgia';ctx.fillText('BOOKLENS PAGE '+window.testPage,165,210);ctx.font='26px Georgia';for(let i=0;i<19;i++){const text=window.testPage===1?'The morning light filled the room.':'A different chapter begins today.';ctx.fillText(text,165,270+i*38)}ctx.restore();},50);const stream=c.captureStream(20);window.track=stream.getVideoTracks()[0];return stream;}`);
  await evaluate(
    `window.ocrUploads=[];const originalFetch=window.fetch;window.fetch=async(...args)=>{const [url,options]=args;if(String(url).endsWith('/ocr')&&options?.body instanceof FormData){const capability=await originalFetch(String(url)+'/status');if(!capability.ok||(await capability.json()).googleDocumentAiConfigured!==false)throw new Error('Smoke check requires unconfigured cloud OCR; no image uploaded');const image=options.body.get('image');const info={type:image.type,bytes:image.size,pageId:options.body.get('pageId')};window.ocrUploads.push(info);const response=await originalFetch(...args);info.status=response.status;return response;}return originalFetch(...args);};`,
  );
  await click('Start Camera');
  await wait(
    "document.querySelector('[data-state]')?.dataset.state==='stabilizing' || document.querySelector('[data-state]')?.dataset.state==='detected' || document.querySelector('[data-state]')?.dataset.state==='error'",
    60000,
  );
  console.log(
    'INITIAL',
    await evaluate("document.querySelector('[data-state]')?.textContent"),
  );
  await sleep(1800);
  if (
    !(await evaluate(
      "document.querySelector('.counts').textContent.includes('0 captured')",
    ))
  )
    throw new Error('Captured moving page');
  console.log('PASS motion prevents capture');
  await evaluate('window.moving=false');
  await wait("!!document.querySelector('.scan-sweep')");
  if (
    !(await evaluate(
      "!!document.querySelector('.text-body') && !!document.querySelector('.capture-progress')",
    ))
  )
    throw new Error('Missing text outline or automatic progress');
  await mkdir('.docker-local', { recursive: true });
  const scanningShot = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(
    '.docker-local/auto-text-scanning.png',
    Buffer.from(scanningShot.data, 'base64'),
  );
  console.log('PASS animated text outline and automatic capture progress');
  await wait(
    "document.querySelector('.counts')?.textContent.includes('1 captured')",
    45000,
  );
  if (
    !(await evaluate(
      "document.querySelector('[data-state]')?.dataset.state==='captured'",
    ))
  )
    throw new Error('Missing green capture state');
  console.log(
    'PASS stable page automatically captured with green confirmation',
  );
  if (
    !(await evaluate(
      "!!document.querySelector('.accepted-region') && !getComputedStyle(document.querySelector('.scanner-guide')).backgroundColor.includes('0.13')",
    ))
  )
    throw new Error('Missing regional success overlay');
  await sleep(5200);
  if (
    !(await evaluate(
      "document.querySelector('.counts').textContent.includes('1 captured')",
    ))
  )
    throw new Error('Duplicate captured');
  console.log('PASS held page stays locked');
  await evaluate('window.testPage=0');
  await sleep(900);
  await evaluate('window.testPage=2');
  await wait(
    "document.querySelector('.counts')?.textContent.includes('2 captured')",
    45000,
  );
  console.log('PASS turn re-arms and new page captured');
  await click('Manual Capture');
  await sleep(1000);
  if (
    !(await evaluate(
      "document.querySelector('.counts').textContent.includes('2 captured')",
    ))
  )
    throw new Error('Manual duplicate accepted');
  console.log('PASS manual duplicate ignored');
  await evaluate('window.testPage=0');
  await sleep(650);
  await evaluate('window.testPage=1');
  await wait(
    "document.querySelector('[data-state]')?.dataset.state==='duplicate'",
    45000,
  );
  if (
    !(await evaluate(
      "document.querySelector('.counts').textContent.includes('2 captured')",
    ))
  )
    throw new Error('Backward page duplicated');
  console.log('PASS backward turn rejects an older page before OCR');
  if (
    !(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'))
  )
    throw new Error('Mobile horizontal overflow');
  await mkdir('.docker-local', { recursive: true });
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(
    '.docker-local/phase4-scanner.png',
    Buffer.from(shot.data, 'base64'),
  );
  await click('Done');
  await wait(
    "location.pathname==='/review' && document.querySelectorAll('textarea').length===2",
    150000,
  );
  const texts = await evaluate(
    "[...document.querySelectorAll('textarea')].map(t=>t.value)",
  );
  console.log(
    'OCR',
    texts.map((t) => t.slice(0, 120)),
  );
  if (!texts[0].includes('morning') || !texts[1].includes('different'))
    throw new Error('OCR content mismatch');
  if (!(await evaluate("window.track.readyState==='ended'")))
    throw new Error('Camera leaked');
  console.log(
    'PASS real corrected-page OCR, capture order, Done drain, camera cleanup',
  );
  const workers = await evaluate(
    '({created:window.workers.length,stopped:window.stops})',
  );
  console.log('WORKERS', workers);
  if (workers.created !== 2 || workers.stopped !== 2)
    throw new Error('Worker reuse/cleanup mismatch');
  const uploads = await evaluate('window.ocrUploads');
  if (
    !uploads.length ||
    !uploads.every(
      (u) =>
        ['image/png', 'image/jpeg'].includes(u.type) &&
        u.bytes > 0 &&
        u.bytes <= 12 * 1024 * 1024 &&
        u.pageId &&
        u.status === 503,
    )
  )
    throw new Error(
      'Expected validated image upload and unconfigured cloud fallback',
    );
  console.log(
    'PASS corrected image upload, backend unavailable response, real Tesseract fallback',
    uploads,
  );
  console.log(
    'ANALYSIS',
    await evaluate(
      `(()=>{const d=window.analysisTimes.slice(1).sort((a,b)=>a-b),t=window.analysisStarts;return {samples:d.length,medianMs:d[Math.floor(d.length*.5)],p95Ms:d[Math.floor(d.length*.95)],averageHz:t.length>1?1000*(t.length-1)/(t[t.length-1]-t[0]):0};})()`,
    ),
  );
  console.log(
    'ALL PASS',
    origin,
    borderless ? 'no visible page border' : 'visible page border',
  );
} catch (e) {
  console.log(await evaluate('document.body.innerText'));
  console.log('ERRORS', JSON.stringify(errors));
  throw e;
} finally {
  ws.close();
}
