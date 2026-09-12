import { mkdir, writeFile } from 'node:fs/promises';
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
  await call('Page.navigate', { url: origin + '/scan' });
  await wait("document.body.innerText.includes('Start Camera')");
  const result = await evaluate(`(async()=>{
    const {contentChanged}=await import('/src/services/pageFingerprint.ts');
    const worker=new Worker('/src/workers/imageProcessing.worker.ts',{type:'module'});
    let id=0; const pending=new Map();
    worker.onmessage=e=>{const job=pending.get(e.data.id);pending.delete(e.data.id);e.data.error?job.reject(new Error(e.data.error)):job.resolve(e.data.result);};
    worker.onerror=e=>{for(const job of pending.values())job.reject(new Error(e.message));pending.clear();};
    const request=async(type,canvas,corners=null,recent=[])=>{const bitmap=await createImageBitmap(canvas);return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});worker.postMessage({id:key,type,bitmap,corners,recent},[bitmap]);});};
    function fixture(kind='text',variant=0){
      const c=document.createElement('canvas');c.width=600;c.height=800;const ctx=c.getContext('2d');
      ctx.fillStyle='#202520';ctx.fillRect(0,0,600,800);ctx.save();
      if(kind==='tilted')ctx.transform(1,.025,-.025,1,12,-8);
      if(kind==='shifted')ctx.translate(8,5);
      ctx.fillStyle=kind==='dim'?'#c7c5b9':'#fffef2';
      if(kind==='spread')ctx.fillRect(15,120,570,460);else ctx.fillRect(86,80,428,640);
      if(kind==='gutter'){ctx.fillStyle='#202520';ctx.beginPath();ctx.moveTo(86,170);ctx.quadraticCurveTo(118,370,86,650);ctx.closePath();ctx.fill();}
      ctx.fillStyle=kind==='dim'?'#171717':'#111';ctx.font='bold 20px Georgia';
      ctx.fillText('A Book of Ordinary Days',110,135);
      if(kind!=='title'&&kind!=='spread'){
        ctx.font='17px Georgia';
        const words=variant?['Clouds gathered above the quiet town.','We walked beside the winding river.','A new chapter starts with small steps.']:['The morning light came through the door.','They spoke about the journey ahead.','Every little detail remained in memory.'];
        for(let i=0;i<18;i++)ctx.fillText(words[i%3],110,180+i*26);
      }
      if(kind==='image'){ctx.fillStyle='#567b55';ctx.fillRect(200,340,150,130);}
      ctx.font='12px Georgia';ctx.fillStyle='#111';ctx.fillText('17',295,693);ctx.restore();return c;
    }
    const output=[];
    try {
      const canvas=fixture(), detection=await request('analyze',canvas);
      if(!detection.aligned||!detection.textBody)throw new Error('Missing aligned text page/body: '+JSON.stringify(detection));
      const first=await request('process',canvas,detection.corners);
      const recent=[{id:'first',pageNumber:1,fingerprint:first.visualFingerprint}];
      output.push({case:'text',aligned:detection.aligned,body:!!detection.textBody,features:first.visualFingerprint.features?.points.length,bytes:first.blob.size});
      for(const kind of ['text','shifted','tilted','dim','gutter','title','image','spread']){
        const c=fixture(kind),d=await request('analyze',c);
        if(kind==='spread'){if(d.aligned||d.hint!=='centerOnePage')throw new Error('Spread should prompt one page');output.push({case:kind,hint:d.hint});continue;}
        if(!d.aligned)throw new Error('Not aligned '+kind+' '+JSON.stringify({corners:d.corners,sharpness:d.sharpness,alignment:d.alignment,hint:d.hint}));
        const p=await request('process',c,d.corners,recent);
        if(['text','shifted','tilted','dim'].includes(kind)&&contentChanged(d.content,detection.content).changed)throw new Error('Held page unnecessarily rearms '+kind);
        if(['text','shifted','tilted','dim'].includes(kind)&&!p.duplicateMatch?.duplicate)throw new Error('Duplicate missed '+kind+' '+JSON.stringify(p.duplicateMatch));
        if(kind==='title'&&p.duplicateMatch?.duplicate)throw new Error('Sparse title falsely rejected');
        output.push({case:kind,body:!!d.textBody,sharpness:d.sharpness,duplicate:p.duplicateMatch});
      }
      const other=fixture('text',1), d=await request('analyze',other),p=await request('process',other,d.corners,recent);
      if(!contentChanged(d.content,detection.content).changed)throw new Error('Different text does not rearm without a blank transition');
      if(p.duplicateMatch?.duplicate)throw new Error('Different text falsely rejected '+JSON.stringify(p.duplicateMatch));
      output.push({case:'same-layout-different-text',duplicate:p.duplicateMatch});
      return output;
    } finally {worker.terminate();}
  })()`);
  console.log(JSON.stringify(result, null, 2));
  console.log('ALL PASS real OpenCV fixtures; no OCR requests');
} catch (e) {
  console.log('ERRORS', JSON.stringify(errors));
  throw e;
} finally {
  ws.close();
}
