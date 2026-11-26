// Cosmetic, local-only. Invoke next() at entry, never from the form's render path.
export const LOGIN_THEME_IDS = Object.freeze(['horizon','index','aperture','suture','fold']);
export function createLoginThemePicker({storage,locks,random=Math.random,key='rc:login:appearance:v2'}={}) {
 const ids=LOGIN_THEME_IDS; let memory=null;
 function valid(s){return !!s && s.v===1 && ids.includes(s.last) && Array.isArray(s.remaining)
  && s.remaining.length<ids.length && new Set(s.remaining).size===s.remaining.length
  && s.remaining.every(id=>ids.includes(id)&&id!==s.last)}
 function draw(){
  let old=memory;if(storage)try{const raw=storage.getItem(key);if(raw!==null){const s=JSON.parse(raw);if(valid(s))old=s}}catch{}
  const pool=old?.remaining.length?[...old.remaining]:[...ids];
  const candidates=pool.length===ids.length && old ? pool.filter(id=>id!==old.last):pool;
  const id=candidates[Math.floor(random()*candidates.length)];
  memory={v:1,last:id,remaining:pool.filter(x=>x!==id)};
  let persisted=false;try{if(storage){storage.setItem(key,JSON.stringify(memory));persisted=true}}catch{storage=null}
  return {id,position:ids.length-memory.remaining.length,persisted};
 }
 return {async next(){
   if(locks && typeof locks.request==='function')try{return await locks.request(key,{mode:'exclusive'},draw)}catch{}
   return draw();
 }};
}
