// Local coordinate (0,0) is the swaged end of the needle. The tip is at (98,-71).
export const METAL = 'M0 -2.4 C28 7 64 7 85 -20 C99 -39 103 -57 98 -71 C111 -50 101 -16 80 3 C56 21 23 11 0 2.4 Z';
export function suturePose(phase){
 const t=Math.max(0,Math.min(1,phase)),a=Math.sin(Math.PI*t)**2;
 const x=407+60*a, y=154-29*a, deg=-13*a;
 const tangent=.29+deg*Math.PI/180, c=Math.cos(tangent),s=Math.sin(tangent);
 const r=v=>Number(v.toFixed(3))||0;
 const d='M8 198 C49 182 81 177 109 184 C'+[146,193,168+12*a,204-4*a,191+14*a,183-5*a].map(r).join(' ')
 +' C'+[242+8*a,143-7*a,221+16*a,59+20*a,174+22*a,67+17*a].map(r).join(' ')
 +' C'+[114+29*a,79+8*a,159+15*a,202-6*a,253+25*a,178-8*a].map(r).join(' ')
 +' C'+[310+32*a,162-13*a,x-52*c,y-52*s,r(x),r(y)].map(r).join(' ');
 return {d,x:r(x),y:r(y),deg:r(deg),transform:'translate('+r(x)+' '+r(y)+') rotate('+r(deg)+')'};
}
