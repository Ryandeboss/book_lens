// Run against the credential-free local stack in an isolated browser profile.
import { mkdir, writeFile } from 'node:fs/promises';
const origin = process.argv[2] || 'http://localhost';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Local test origin required');
const tabs = await (await fetch('http://localhost:9225/json')).json();
const ws = new WebSocket(
  tabs.find((t) => t.type === 'page').webSocketDebuggerUrl,
);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const jobs = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (!m.id) return;
  const job = jobs.get(m.id);
  jobs.delete(m.id);
  if (m.error) job.reject(new Error(JSON.stringify(m.error)));
  else job.resolve(m.result);
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
async function wait(expression, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Timeout: ' + expression);
}
const click = (label) =>
  evaluate(
    `[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
  );
async function readDb() {
  return evaluate(`(async()=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('booklens-drafts',1);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
    try{return await new Promise((r,j)=>{const tx=db.transaction(['draft','images'],'readonly');const q=tx.objectStore('draft').get('active'), keys=tx.objectStore('images').getAllKeys();tx.oncomplete=()=>r({record:q.result,keys:keys.result});tx.onabort=()=>j(tx.error);});}finally{db.close();}})()`);
}
async function navigate(path) {
  await call('Page.navigate', { url: origin + path });
  await wait(
    `location.pathname===${JSON.stringify(path)} && document.readyState==='complete'`,
  );
}
async function seed(mode = 'ready') {
  // Leave the app so no active autosave can race these synthetic fixtures.
  await navigate('/favicon.png');
  return evaluate(`(async()=>{
    const db=await new Promise((r,j)=>{const q=indexedDB.open('booklens-drafts',1);q.onupgradeneeded=()=>{q.result.createObjectStore('draft');q.result.createObjectStore('images');};q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
    const first=crypto.randomUUID(), second=crypto.randomUUID(), retry=crypto.randomUUID();
    const pages=[{id:first,pageNumber:1,capturePosition:5,status:'ready',ocrCompleted:true,rawText:'Original OCR kept',editedText:'Manual edit survives refresh',correctedText:'Corrected version',ocrProvider:'google-document-ai',confidence:94}];
    const mode=${JSON.stringify(mode)};
    if(mode==='pending')pages.push({id:second,pageNumber:2,capturePosition:13,status:'processing',rawText:'',editedText:''},{id:retry,pageNumber:3,capturePosition:14,status:'error',rawText:'',editedText:'',error:'Retry photo'});
    else pages.push({...pages[0],id:second,pageNumber:2,capturePosition:6,duplicateOf:first,duplicateScore:1});
    const canvas=document.createElement('canvas');canvas.width=720;canvas.height=960;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,720,960);ctx.fillStyle='black';ctx.font='26px Georgia';for(let i=0;i<15;i++)ctx.fillText('Recovered photographed page text.',45,90+i*42);
    const image=await new Promise(r=>canvas.toBlob(r,'image/png')); const now=Date.now()-(mode==='expired'?25*3600000:0);
    const value={revision:crypto.randomUUID(),draft:{version:1,updatedAt:now,expiresAt:now+24*3600000,captureSequence:mode==='pending'?14:12,cleanupEnabled:false,pages}};
    await new Promise((r,j)=>{const tx=db.transaction(['draft','images'],'readwrite');tx.objectStore('draft').put(value,'active');const images=tx.objectStore('images');images.clear();if(mode==='pending'){images.put(image,second);images.put(image,retry);}if(mode==='expired')images.put(image,'expired-image');tx.oncomplete=r;tx.onabort=()=>j(tx.error);});db.close();return {first,second,retry};
  })()`);
}
let scriptId;
try {
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  if (
    (await (await fetch(origin + '/api/ocr/status')).json())
      .googleDocumentAiConfigured !== false
  )
    throw new Error('Use unconfigured local OCR');
  // Guard every new document against accidental paid requests; only browser fallback runs.
  scriptId = (
    await call('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.testOcrCalls=0;window.testCameraCalls=0;const f=window.fetch;window.fetch=async(...a)=>{if(String(a[0]).endsWith('/ocr')){window.testOcrCalls++;return new Response(JSON.stringify({error:{message:'Local test fallback'}}),{status:503,headers:{'Content-Type':'application/json'}});}if(String(a[0]).endsWith('/proofread'))throw new Error('No paid cleanup in recovery tests');return f(...a);};navigator.mediaDevices.getUserMedia=async()=>{window.testCameraCalls++;throw new Error('Camera should not auto-start');};window.confirm=()=>true;`,
    })
  ).identifier;

  if (process.argv.includes('--after-restart')) {
    await navigate('/review');
    await wait("document.body.innerText.includes('Resume previous scan?')");
    await click('Resume scan');
    await wait(
      "document.querySelector('textarea')?.value==='Manual edit survives refresh'",
    );
    console.log('PASS real browser restart recovery');
    await click('Finish scan');
    await wait("location.pathname==='/'");
    if ((await readDb()).record.draft !== null)
      throw new Error('Restart draft not cleared');
  } else {
    await seed();
    await navigate('/review');
    await wait("document.body.innerText.includes('Resume previous scan?')");
    if (await evaluate('window.testOcrCalls || window.testCameraCalls'))
      throw new Error('Work started before consent');
    await mkdir('.docker-local', { recursive: true });
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      '.docker-local/draft-resume.png',
      Buffer.from(shot.data, 'base64'),
    );
    await click('Resume scan');
    await wait(
      "document.querySelector('textarea')?.value==='Manual edit survives refresh'",
    );
    const before = (await readDb()).record.draft;
    if (
      before.pages.length !== 2 ||
      before.captureSequence !== 12 ||
      !before.pages[1].duplicateOf
    )
      throw new Error('Lost order/duplicate metadata');
    await evaluate(
      `const editor=document.querySelector('textarea');editor.value='Saved again after editing';editor.dispatchEvent(new Event('input',{bubbles:true}));`,
    );
    await wait(
      "document.querySelector('.draft-status')?.textContent.includes('Draft saved')",
    );
    await call('Page.reload');
    await wait("document.body.innerText.includes('Resume previous scan?')");
    await click('Resume scan');
    await wait(
      "document.querySelector('textarea')?.value==='Saved again after editing'",
    );
    if (await evaluate('window.testOcrCalls || window.testCameraCalls'))
      throw new Error('Completed text reran OCR/camera');
    console.log(
      'PASS refresh recovery, manual edits, raw text, duplicates, no repeated OCR',
    );
    await click('Start New Scan');
    await wait(
      "location.pathname==='/scan' && document.body.innerText.includes('Start Camera')",
    );
    if ((await readDb()).record.draft !== null)
      throw new Error('Start New did not clear');
    console.log('PASS explicit Start New clears recovery');

    const ids = await seed('pending');
    await navigate('/review');
    await wait("document.body.innerText.includes('Resume previous scan?')");
    await click('Resume scan');
    await wait(
      "[...document.querySelectorAll('textarea')].some(t=>t.value.includes('Recovered photographed page text'))",
      150000,
    );
    await wait(
      "document.querySelector('.draft-status')?.textContent.includes('Draft saved')",
    );
    const resumed = await readDb();
    if (
      resumed.record.draft.pages[1].id !== ids.second ||
      resumed.record.draft.pages[1].capturePosition !== 13 ||
      resumed.keys.length !== 1 ||
      resumed.keys[0] !== ids.retry
    )
      throw new Error('Pending image not resumed/pruned or retry lost');
    await click('Retry');
    await wait(
      "!document.body.innerText.includes('Retry photo') && document.querySelector('.draft-status')?.textContent.includes('Draft saved')",
      150000,
    );
    // A duplicate may move to the excluded section after its OCR completes.
    const end = Date.now() + 150000;
    while ((await readDb()).keys.length && Date.now() < end)
      await new Promise((r) => setTimeout(r, 150));
    if ((await readDb()).keys.length)
      throw new Error('Finished images retained');
    console.log(
      'PASS pending/retry image recovery, capture IDs/order, image pruning',
    );
    await click('Finish scan');
    await wait("location.pathname==='/'");
    if ((await readDb()).record.draft !== null)
      throw new Error('Finish did not clear');
    console.log('PASS Finish clears draft and images');

    await seed('expired');
    await navigate('/review');
    await wait("document.body.innerText.includes('No pages yet')");
    const expired = await readDb();
    if (expired.record.draft !== null || expired.keys.length)
      throw new Error('Expired data retained');
    console.log('PASS expiry deletion');
    await seed();
    await navigate('/review');
    await wait("document.body.innerText.includes('Resume previous scan?')");
    await click('Discard draft');
    await wait("document.body.innerText.includes('No pages yet')");
    if ((await readDb()).record.draft !== null)
      throw new Error('Discard did not clear');
    console.log('PASS discard deletion');
    await seed(); // Leave a known draft for a separate browser-process restart test.
    console.log('READY for browser restart check');
  }
  console.log('ALL PASS draft recovery');
} finally {
  if (scriptId)
    await call('Page.removeScriptToEvaluateOnNewDocument', {
      identifier: scriptId,
    });
  ws.close();
}
