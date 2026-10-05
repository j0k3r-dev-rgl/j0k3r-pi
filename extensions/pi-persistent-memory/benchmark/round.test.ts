import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judgedMetrics, rankCandidates, selectPolicy } from './round.ts';

test('unjudged candidates are not counted as irrelevant or useful', () => {
  const m = judgedMetrics([{id:'q',judgments:{'1':2,'2':0},positiveIds:[1]}], [[{id:1},{id:2},{id:3}]]);
  assert.equal(m.useful,1);assert.equal(m.irrelevant,1);assert.equal(m.unjudged,1);
  assert.equal(m.judgedPrecision,.5);assert.equal(m.judgmentCoverage,2/3);
});
test('lexical support can supplement semantic candidates without duplicate memories',()=>{
  const row={semantic:[{id:1,score:.87},{id:2,score:.8}],lexical:[{id:2,matched:3,coverage:.5}]};
  const ranked=rankCandidates(row,{floor:.84,lexicalFloor:.78,coverage:.35});
  assert.equal(ranked.length,2);assert.deepEqual(new Set(ranked.map(x=>x.id)),new Set([1,2]));
});
test('parameter selection ignores validation labels and results',()=>{
  const cal={id:'c',split:'calibration',semantic:[{id:1,score:.85},{id:2,score:.8}],lexical:[],judgments:{'1':2,'2':0},positiveIds:[1]};
  const validation={...cal,id:'v',split:'validation',judgments:{'1':0,'2':2},positiveIds:[2]};
  const policies=[{floor:.78,lexicalFloor:.78,coverage:.35},{floor:.84,lexicalFloor:.78,coverage:.35}];
  assert.deepEqual(selectPolicy([cal,validation],policies).policy,selectPolicy([cal],policies).policy);
});
