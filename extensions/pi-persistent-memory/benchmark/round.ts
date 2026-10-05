import { fuse } from './store.ts';

export function rankCandidates(row: any, policy: any): any[] {
  const semantic=row.semantic.filter((item:any)=>item.score>=policy.floor);
  const scores=new Map(row.semantic.map((item:any)=>[item.id,item.score]));
  const lexical=row.lexical.filter((item:any)=>item.matched>=2&&item.coverage>=policy.coverage
    &&Number(scores.get(item.id)??-1)>=policy.lexicalFloor);
  return fuse(semantic,lexical);
}

export function judgedMetrics(rows: any[], results: any[]): any {
  let useful=0,irrelevant=0,unjudged=0,highValue=0,positiveTotal=0,positiveHits=0,returned=0;
  let noHistory=0,empty=0;
  for(let i=0;i<rows.length;i++){
    const row=rows[i],ids=new Set(results[i].slice(0,5).map((item:any)=>item.id));
    returned+=ids.size;
    for(const id of ids){
      const grade=row.judgments?.[String(id)];
      if(grade===undefined)unjudged++;
      else if(grade===0)irrelevant++;
      else {useful++;if(grade===2)highValue++;}
    }
    const positive=new Set(row.positiveIds??[]);
    positiveTotal+=positive.size;positiveHits+=[...ids].filter(id=>positive.has(id)).length;
    if(row.noHistory){noHistory++;if(!ids.size)empty++;}
  }
  const precision=useful+irrelevant?useful/(useful+irrelevant):0;
  const recall=positiveTotal?positiveHits/positiveTotal:0;
  return {useful,highValue,irrelevant,unjudged,returned,judgedPrecision:precision,
    judgmentCoverage:returned?(returned-unjudged)/returned:1,
    knownPositiveRecall:recall,positiveHits,positiveTotal,noHistory,empty,
    objective:precision+recall?1.25*precision*recall/(.25*precision+recall):0};
}

export function selectPolicy(rows: any[], policies: any[]): any {
  const calibration=rows.filter(row=>row.split==='calibration');
  if(!calibration.length)throw new Error('Missing calibration tasks');
  const trials=policies.map(policy=>({policy,metrics:judgedMetrics(calibration,calibration.map(row=>rankCandidates(row,policy)))}));
  if(trials.some(trial=>trial.metrics.unjudged))throw new Error('Incomplete calibration judgments: review the entire policy candidate pool');
  trials.sort((a,b)=>b.metrics.objective-a.metrics.objective||b.metrics.knownPositiveRecall-a.metrics.knownPositiveRecall||a.metrics.irrelevant-b.metrics.irrelevant);
  return {...trials[0],trials};
}
