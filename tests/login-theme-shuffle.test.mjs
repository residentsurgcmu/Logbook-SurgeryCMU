import assert from 'node:assert/strict';
import {createLoginThemePicker as mk, LOGIN_THEME_IDS as ids} from '../src/loginThemes.mjs';
function store(){const data=new Map;return {getItem(k){return data.get(k)??null},setItem(k,v){data.set(k,v)}}}
async function checkRound(factory,n=5){let group=[],last='',first=[];for(let i=0;i<n*5;i++){
  const {id,position}=await factory().next();assert.ok(ids.includes(id));assert.notEqual(id,last);last=id;
  assert.equal(position,(i%5)+1);group.push(id);if(i%5===0)first.push(id);
  if(group.length===5){assert.deepEqual([...group].sort(),[...ids].sort());group=[]}
}return first}
const db=store(),eachVisit=()=>mk({storage:db});
await checkRound(eachVisit,400);
for(const invalid of ['{','null','[]','{"v":1,"last":"horizon","remaining":["bogus"]}','{"v":1,"last":"index","remaining":["index"]}','{"v":1,"last":"index","remaining":["fold","fold"]}']){
 db.setItem('rc:login:appearance:v2',invalid);assert.equal((await eachVisit().next()).position,1);
}
const blocked={getItem(){throw Error('denied')},setItem(){throw Error('denied')}};
const local=mk({storage:blocked});await checkRound(()=>local,30);assert.equal((await local.next()).persisted,false);
const noLocks=mk({storage:store(),locks:{request(){throw Error('denied')}}});await checkRound(()=>noLocks,10);
let row=Promise.resolve();const lock={request(k,m,job){return row=row.then(job)}};const combined=store();
const hits=await Promise.all(Array.from({length:5},()=>mk({storage:combined,locks:lock}).next()));
assert.equal(new Set(hits.map(h=>h.id)).size,5);
console.log('PASS: 400 persisted cycles (new instance per open); boundary duplicates, corrupt/blocked state and concurrent lock cases checked.');
