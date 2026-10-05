import { parseArgs } from 'node:util';
import { mkdirSync, chmodSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { openStore, importActive, insertChunks, vectorSearch, lexicalSearch, fuse } from './store.ts';
import { rankCandidates, judgedMetrics, selectPolicy } from './round.ts';

process.umask(0o077);
const {values}=parseArgs({options:{db:{type:'string',default:join(homedir(),'.cache/e5-memory-benchmark/engram.db')},
  source:{type:'string',default:join(homedir(),'.engram/engram.db')},url:{type:'string',default:'http://127.0.0.1:8000'},
  command:{type:'string',default:'status'},batch:{type:'string',default:'8'},limit:{type:'string'},
  report:{type:'string'},fixtures:{type:'string'}}});
const batch=Number(values.batch),limit=values.limit?Number(values.limit):Infinity;
if (!Number.isInteger(batch)||batch<1||batch>8||limit<=0) throw new Error('Batch 1..8, positive limit');
const url=values.url!.replace(/\/$/,'');
mkdirSync(dirname(values.db!),{recursive:true,mode:0o700});
const db=openStore(values.db!); chmodSync(values.db!,0o600);
async function request(route:string,payload?:unknown):Promise<any>{
  const response=await fetch(url+route,{method:payload===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},
    body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(120_000)});
  const result=await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error?.code??'invalid_response'}`);
  return result;
}
let health:any;
async function ready(){
  health=await request('/health');
  if(health.status!=='ready'||health.model!=='intfloat/e5-small-v2'||health.dimensions!==384||health.normalization!=='l2'||health.max_input_tokens!==512)
    throw new Error('Unexpected English E5 health');
  const signature=JSON.stringify([health.model,health.model_revision,health.dimensions,health.normalization]);
  const old=db.prepare("SELECT value FROM meta WHERE key='model'").get();
  if(old&&old.value!==signature) throw new Error('Model changed; use a fresh evaluation DB rather than mixing vectors');
  db.prepare("INSERT OR IGNORE INTO meta VALUES('model',?)").run(signature);
}
function validate(body:any,texts:string[]):any[]{
  for(const key of ['model','model_revision','dimensions','normalization','max_input_tokens']) if(body[key]!==health[key]) throw new Error('Metadata mismatch');
  if(body.data.length!==texts.length) throw new Error('Response count mismatch');
  for(let i=0;i<texts.length;i++){
    const item=body.data[i],source=Array.from(texts[i]); let end=0;
    if(item.input_index!==i||!item.chunks.length) throw new Error('Response ordering mismatch');
    for(let j=0;j<item.chunks.length;j++){
      const c=item.chunks[j],v=c.embedding;
      if(c.chunk_index!==j||c.start<0||c.start>end||c.end<=end||c.end>source.length||source.slice(c.start,c.end).join('')!==c.text
        ||c.token_count<1||c.token_count>512) throw new Error('Invalid source coverage/token count');
      if(v.length!==384||v.some((x:any)=>typeof x!=='number'||!Number.isFinite(x))||Math.abs(Math.sqrt(v.reduce((s:number,x:number)=>s+x*x,0))-1)>1e-4)
        throw new Error('Invalid embedding');
      end=c.end;
    }
    if(end!==source.length) throw new Error('Incomplete source coverage');
  }
  return body.data;
}
async function embed(texts:string[],mode='passage'){
  return validate(await request('/v1/embeddings',{input:texts,mode}),texts);
}
function status(){return {memories:db.prepare('SELECT COUNT(*) n FROM memories').get()!.n,
  indexed:db.prepare('SELECT COUNT(*) n FROM memories WHERE indexed_hash=hash').get()!.n,
  chunks:db.prepare('SELECT COUNT(*) n FROM chunks').get()!.n,
  projects:db.prepare('SELECT COUNT(DISTINCT project) n FROM memories').get()!.n,
  sqliteVec:db.prepare('SELECT vec_version() version').get()!.version};}
async function index(){
  await ready(); const start=performance.now();let processed=0,requests=0;
  while(processed<limit){
    const rows=db.prepare('SELECT id,title,content,hash FROM memories WHERE indexed_hash IS NULL ORDER BY id LIMIT ?').all(Math.min(batch,limit-processed));
    if(!rows.length)break;
    // Limit batch to <=100k code units, safely below 1MiB JSON and chunk cap in this corpus.
    const chosen:any[]=[];let size=0;
    for(const row of rows){const length=String(row.title).length+String(row.content).length+1;if(chosen.length&&size+length>100000)break;chosen.push(row);size+=length;}
    const texts=chosen.map(row=>String(row.title)+'\n'+String(row.content));
    const response=await embed(texts);requests++;
    for(let i=0;i<chosen.length;i++)insertChunks(db,Number(chosen[i].id),response[i].chunks,String(chosen[i].hash));
    processed+=chosen.length;
    if(processed%80<batch) console.log(JSON.stringify({processed,elapsedSeconds:(performance.now()-start)/1000,...status()}));
  }
  console.log(JSON.stringify({action:'index',processed,requests,elapsedSeconds:(performance.now()-start)/1000,...status()}));
}
async function evaluate(){
  if(!values.fixtures||!values.report)throw new Error('Evaluation needs --fixtures and --report');
  await ready(); const st=status();if(st.memories!==st.indexed)throw new Error('Index incomplete; finish before evaluation');
  const {readFileSync}=await import('node:fs');
  const fixture=JSON.parse(readFileSync(values.fixtures,'utf8'));
  const rows=fixture.tasks;
  const queryResults=[];
  for(const task of rows){
    const vector=(await embed([task.query],'query'))[0].chunks[0].embedding;
    const start=performance.now();
    const project=task.project===undefined?'j0k3r-pi':task.project;
    const sem=vectorSearch(db,vector,project,200),lex=lexicalSearch(db,task.query,project,100);
    const global=vectorSearch(db,vector,null,200);
    if(sem.some(row=>row.project!==project))throw new Error('Project leak');
    queryResults.push({...task,semantic:sem,lexical:lex,globalTop:global.slice(0,5),searchMs:performance.now()-start});
  }
  function results(row:any,floor:number,lexFloor:number,coverage:number){
    const admitted=row.semantic.filter((x:any)=>x.score>=floor);
    const scores=new Map(row.semantic.map((x:any)=>[x.id,x.score]));
    const lexical=row.lexical.filter((x:any)=>x.matched>=2&&x.coverage>=coverage&&Number(scores.get(x.id)??-1)>=lexFloor);
    return fuse(admitted,lexical);
  }
  function metrics(group:any[],policy:number[]){
    let high=0,hit=0,useful=0,returned=0,noLabels=0;
    for(const row of group){const ranked=results(row,...policy as [number,number,number]);const expected=new Set(row.highValue),support=new Set([...row.highValue,...row.context]);
      high+=expected.size;hit+=ranked.filter(x=>expected.has(x.id)).length;useful+=ranked.filter(x=>support.has(x.id)).length;returned+=ranked.length;
      if(!support.size&&!ranked.length)noLabels++;
    }
    const precision=returned?useful/returned:0,recall=high?hit/high:0;
    return {highValueHit:hit,highValueTotal:high,highValueRecall:recall,labeledUsefulPrecision:precision,returned,unjudgedOrNoise:returned-useful,
      correctEmpty:noLabels,objective:precision+recall?1.25*precision*recall/(.25*precision+recall):0};
  }
  const cal=queryResults.filter(x=>x.split==='calibration'),hold=queryResults.filter(x=>x.split==='validation');
  const trials=[];
  for(const floor of [.74,.78,.8,.82,.84,.86,.88])for(const lexical of [.74,.78,.82])for(const coverage of [.2,.35,.5])trials.push({policy:[floor,lexical,coverage],metrics:metrics(cal,[floor,lexical,coverage])});
  trials.sort((a,b)=>b.metrics.objective-a.metrics.objective||b.metrics.highValueRecall-a.metrics.highValueRecall);
  const chosen=trials[0].policy;
  const report={createdAt:new Date().toISOString(),snapshot:JSON.parse(String(db.prepare("SELECT value FROM meta WHERE key='snapshot'").get()!.value)),
    model:health,store:st,selectedCalibrationPolicy:{semanticFloor:chosen[0],lexicalFloor:chosen[1],coverage:chosen[2]},
    calibration:metrics(cal,chosen),validation:metrics(hold,chosen),trials,
    tasks:queryResults.map(row=>({...row,selected:results(row,...chosen as [number,number,number]),semantic:row.semantic.slice(0,10),lexical:row.lexical.slice(0,10)})),
    limitations:['Task labels cover known positives/context, not every newly discovered matching record in full corpus; unjudgedOrNoise requires review.',
      'Prior evaluation-generated observations remain in full active snapshot and can contaminate memory-design queries; these task fixtures predate those tests.',
      'English model over unchanged multilingual corpus; no language detector/translation or exclusions.',
      'Different actual Engram project aliases are preserved, not merged. Project filter uses stored project; scope remains provenance metadata.',
      'Candidate budget 200 chunks/100 lexical; best-chunk de-dup may leave fewer than 200 memories.',
      'Real vec0 cosine and FTS5 unicode61, not full Pi memory implementation or Engram trigram ranking.',
      'Global comparison validates retrieval scope but is not globally labeled quality evidence.']};
  writeFileSync(values.report,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({action:'evaluate',report:values.report,selected:report.selectedCalibrationPolicy,calibration:report.calibration,validation:report.validation,store:st}));
}
async function collect(){
  if(!values.fixtures||!values.report)throw new Error('Collection needs fixtures and private report');
  await ready();if(status().memories!==status().indexed)throw new Error('Incomplete vectors');
  const {readFileSync}=await import('node:fs');
  const fixture=JSON.parse(readFileSync(values.fixtures,'utf8'));
  const tasks=[];
  for(const task of fixture.tasks){
    const vector=(await embed([task.query],'query'))[0].chunks[0].embedding;
    const start=performance.now();
    const semantic=vectorSearch(db,vector,task.project,500);
    const lexical=lexicalSearch(db,task.query,task.project,200);
    if(task.project!==null&&[...semantic,...lexical].some(row=>row.project!==task.project))throw new Error('Project leak');
    const pool=new Set<number>();
    const policies=[];
    for(const floor of [.78,.8,.82,.84,.86])for(const lexicalFloor of [.78,.82])for(const coverage of [.2,.35,.5])policies.push({floor,lexicalFloor,coverage});
    const row={...task,semantic,lexical};
    for(const policy of policies)for(const result of rankCandidates(row,policy))pool.add(result.id);
    for(const result of semantic.slice(0,8))pool.add(result.id);
    for(const result of lexical.slice(0,8))pool.add(result.id);
    const documents=[...pool].map(id=>db.prepare('SELECT id,title,content,project,scope,type,updated_at FROM memories WHERE id=?').get(id));
    tasks.push({...row,documents,searchMs:performance.now()-start});
    console.log(JSON.stringify({collected:task.id,pool:pool.size}));
  }
  const output={createdAt:new Date().toISOString(),model:health,store:status(),fixtureSource:values.fixtures,tasks};
  writeFileSync(values.report,JSON.stringify(output,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({action:'collect',tasks:tasks.length,report:values.report}));
}
async function assess(){
  if(!values.fixtures||!values.report)throw new Error('Assess needs judged private fixture and report');
  const {readFileSync}=await import('node:fs');
  const input=JSON.parse(readFileSync(values.fixtures,'utf8'));
  const policies=[];
  for(const floor of [.78,.8,.82,.84,.86])for(const lexicalFloor of [.78,.82])for(const coverage of [.2,.35,.5])policies.push({floor,lexicalFloor,coverage});
  const selected=selectPolicy(input.tasks,policies);
  const output={createdAt:new Date().toISOString(),store:input.store,model:input.model,judging:input.judging,
    selected: selected.policy,calibration:selected.metrics,trials:selected.trials,
    comparison:{},tasks:[]};
  for(const split of ['calibration','validation']){
    const rows=input.tasks.filter((row:any)=>row.split===split);
    (output.comparison as any)[split]={
      previousPolicy:judgedMetrics(rows,rows.map((row:any)=>rankCandidates(row,{floor:.86,lexicalFloor:.82,coverage:.35}))),
      selectedPolicy:judgedMetrics(rows,rows.map((row:any)=>rankCandidates(row,selected.policy))),
      semanticTop5:judgedMetrics(rows,rows.map((row:any)=>row.semantic.slice(0,5))),
      lexicalTop5:judgedMetrics(rows,rows.map((row:any)=>row.lexical.slice(0,5)))};
    if((output.comparison as any)[split].selectedPolicy.unjudged)throw new Error('Unjudged selected candidates');
  }
  output.tasks=input.tasks.map((row:any)=>({id:row.id,query:row.query,project:row.project,split:row.split,noHistory:row.noHistory,
    positiveIds:row.positiveIds,selected:rankCandidates(row,selected.policy).map(item=>({...item,grade:row.judgments[String(item.id)]})),
    missedPositives:row.positiveIds.filter((id:number)=>!rankCandidates(row,selected.policy).some(item=>item.id===id))}));
  (output as any).limitations=['Single-orchestrator relevance judgments are not independent human labels.',
    'Known positive recall denominator is pooled reviewed positives, not every relevant record in 4124 observations.',
    'Judgments collected from multiple policies before calibration selection; holdout labels not used to choose parameters.',
    'Task set is small with limited domains and negative queries; do not infer universal quality.',
    'Source snapshot/model fixed; no parameters applied to production or plan.'];
  writeFileSync(values.report,JSON.stringify(output,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({action:'assess',selected:output.selected,comparison:output.comparison,report:values.report}));
}
try{
  if(values.command==='collect')await collect();
  else if(values.command==='assess')await assess();
  else if(values.command==='import')console.log(JSON.stringify(importActive(values.source!,db)));
  else if(values.command==='index')await index();
  else if(values.command==='evaluate')await evaluate();
  else if(values.command==='status')console.log(JSON.stringify(status()));
  else throw new Error('Commands: import, index, evaluate, collect, assess, status');
}finally{db.close();}
