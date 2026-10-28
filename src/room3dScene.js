import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {buildRoomGeometry,roomGeometryKey} from './room3dGeometry.js';
import {seatCell,seatAriaLabel} from './seatMap.js';
const COLORS={free:{token:'--success',fallback:0x51886b},taken:{token:'--text-muted',fallback:0x596660},mine:{token:'--accent',fallback:0x247fa0},myhold:{token:'--accent',fallback:0x247fa0},held:{token:'--warning',fallback:0xc79944}};
export function mountRoom3d(container,map,{onSeat=()=>{},onError=()=>{},paused=false}={}) {
 const geometry=buildRoomGeometry(map?.seats||[]),{room}=geometry,key=roomGeometryKey(map);
 let currentMap=map,disposed=false,failed=false,frame=0,selected=map?.me?.seat||map?.me?.hold?.seat_code||null,preset='oblique',multi=false,fit=1,pausedNow=Boolean(paused);
 let renderer,controls,observer,canvas;
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(43,1,.1,100);
 let cleanupListeners=()=>{};
 const allocatedGeometry=new Set();const trackGeometry=g=>{allocatedGeometry.add(g);return g;};
 const materials=[],textures=[],labels=[],pickMeshes=[],rings=new Map(),badges=new Map(),pointers=new Map();
 const mat=(color,roughness=.7,metalness=0)=>{const m=new THREE.MeshStandardMaterial({color,roughness,metalness});materials.push(m);return m;};
 const safe=fn=>{try{fn();}catch{/* Continue releasing independent resources. */}};
 const dispose=()=>{if(disposed)return;disposed=true;cancelAnimationFrame(frame);frame=0;safe(()=>observer?.disconnect());
  safe(cleanupListeners);safe(()=>controls?.dispose());
  scene.traverse(o=>{if(o.geometry)allocatedGeometry.add(o.geometry);});allocatedGeometry.forEach(g=>safe(()=>g.dispose()));materials.forEach(m=>safe(()=>m.dispose()));textures.forEach(t=>safe(()=>t.dispose()));safe(()=>renderer?.dispose());safe(()=>canvas?.remove());pointers.clear();
 };
 function fail(error){if(disposed||failed)return;failed=true;dispose();onError(error);}
 function contextLost(event){event.preventDefault();fail(new Error('WebGL context lost'));}
 try {
 scene.background=new THREE.Color(0xf3f1e9);
 renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;container.append(renderer.domElement);
 canvas=renderer.domElement;canvas.setAttribute('aria-hidden','true');canvas.style.touchAction='none';canvas.style.width='100%';canvas.style.height='100%';canvas.style.display='block';
 controls=new OrbitControls(camera,canvas);controls.enableDamping=false;controls.minDistance=4;controls.maxDistance=50;controls.maxPolarAngle=Math.PI/2.05;controls.target.set(room.width/2,.3,4.6);controls.enabled=!pausedNow&&!document.hidden;
 scene.add(new THREE.HemisphereLight(0xffffff,0xcbb78e,2.4));const light=new THREE.DirectionalLight(0xfff2dc,2.1);light.position.set(-2,12,3);scene.add(light);
 const chrome=mat(0xaeb6b5,.25,.78),leather=mat(0x3b332e,.65),edge=mat(0x282a25,.6),wood=mat(0x965a40,.5),rearwood=mat(0xc29b66,.6),cream=mat(0xd8cbae,.8),post=mat(0x57412d,.7),curtain=mat(0x822f42,.95);
 function box(w,h,d,material,x,y,z,parent=scene){const m=new THREE.Mesh(trackGeometry(new THREE.BoxGeometry(w,h,d)),material);m.position.set(x,y,z);parent.add(m);return m;}
 function cylinder(radius,height,material,x,y,z,parent=scene){const m=new THREE.Mesh(trackGeometry(new THREE.CylinderGeometry(radius,radius,height,8)),material);m.position.set(x,y,z);parent.add(m);return m;}
 // Warm oak planks: geometry colours, no photo textures or external assets.
 for(let x=-1;x<room.width+1;x+=.6){box(.595,.08,16,mat(x%1>.5?0xd4af73:0xdec08a,.84),x+.3,-.065,4.1);}
 const architectureStart=scene.children.length;
 box(room.width+2,2.9,.14,cream,room.width/2,1.4,-3.85);
 for(let x=-.9;x<room.width+1;x+=1.4){box(.09,2.9,.18,post,x,1.4,-3.72);for(let y=.5;y<2.7;y+=.5){const dot=new THREE.Mesh(trackGeometry(new THREE.SphereGeometry(.025,6,4)),post);dot.position.set(x+.65,y,-3.75);scene.add(dot);}}
 box(room.width+2,.22,.22,post,room.width/2,2.88,-3.8);
 box(.14,2.8,15.5,cream,-1.02,1.35,3.7);
 for(let z=-3.5;z<10.8;z+=1.85){box(.10,2.35,1.60,curtain,-.89,1.35,z+.8);for(let k=0;k<1.6;k+=.14)cylinder(.047,2.36,curtain,-.80,1.35,z+k);}
 const screen=mat(0xfcfcf8,.85);box(4.5,2.1,.09,edge,room.width/2,1.55,-3.6);box(4.3,1.9,.10,screen,room.width/2,1.55,-3.53);
 box(.85,1.1,.65,rearwood,.35,.55,-2.8);box(.95,.10,.75,wood,.35,1.12,-2.8);
 const cutawayArchitecture=scene.children.slice(architectureStart);
 // Two adjoining central tables preserve the single shared footprint. Seam is explicit.
 for(const d of geometry.desks){const tabletop=d.kind==='rear'?rearwood:wood;box(d.w,.08,d.d,edge,d.x+d.w/2,d.h-.04,d.z+d.d/2);box(d.w-.018,.045,d.d-.018,tabletop,d.x+d.w/2,d.h+.018,d.z+d.d/2);
  box(Math.max(.1,d.w-.10),.42,.045,cream,d.x+d.w/2,.42,d.z+d.d/2);
  for(const x of [d.x+.08,d.x+d.w-.08])box(.045,.64,.06,post,x,.32,d.z+d.d/2);
 }
 const t=room.table;box(.014,.006,t.d,edge,t.x+t.w/2,.745,t.z+t.d/2);
 // Monitor on the moderator's front desk, facing toward the moderator (+z-facing chairs).
 const md=geometry.desks.find(d=>d.kind==='moderator');if(md){const x=md.x+md.w/2,z=md.z+md.d-.05;box(.12,.20,.12,chrome,x,.85,z);box(.65,.40,.065,edge,x,1.06,z);box(.57,.32,.01,mat(0x627b7b,.9),x,1.06,z-.038);}
 for(const chair of geometry.chairs){const group=new THREE.Group();group.position.set(chair.x,0,chair.z);group.rotation.y=chair.angle;group.userData.seatCode=chair.seat_code;scene.add(group);
  box(.49,.09,.40,leather,0,.43,0,group);box(.49,.41,.08,leather,0,.68,.18,group);
  for(const x of [-.23,.23]){cylinder(.018,.42,chrome,x,.21,-.14,group);cylinder(.018,.75,chrome,x,.38,.17,group);box(.035,.03,.37,chrome,x,.05,.01,group);}
  const liveSeat=currentMap.seats.find(s=>s.seat_code===chair.seat_code),state=seatCell(liveSeat,currentMap).state,color=liveColor(state);
  const ring=new THREE.Mesh(trackGeometry(new THREE.RingGeometry(.29,.34,24)),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.65,side:THREE.DoubleSide}));materials.push(ring.material);ring.rotation.x=-Math.PI/2;ring.position.set(chair.x,.005,chair.z);scene.add(ring);rings.set(chair.seat_code,ring);
  const badge=new THREE.Mesh(trackGeometry(new THREE.SphereGeometry(.055,8,6)),mat(color,.6));badge.position.set(0,.72,.23);group.add(badge);badges.set(chair.seat_code,badge);
  group.traverse(o=>{if(o.isMesh)pickMeshes.push(o);});
  const c=document.createElement('canvas');c.width=128;c.height=64;const ctx=c.getContext('2d');ctx.fillStyle='#fcfcf3';ctx.fillRect(2,5,124,54);ctx.fillStyle='#243d33';ctx.font='bold 30px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(chair.seat_code,64,34);const texture=new THREE.CanvasTexture(c);textures.push(texture);const material=new THREE.SpriteMaterial({map:texture,depthTest:true});materials.push(material);const sprite=new THREE.Sprite(material);sprite.scale.set(.49,.245,1);sprite.position.set(chair.x,1.03,chair.z);scene.add(sprite);labels.push({code:chair.seat_code,sprite});
 }
 function declutter(){const used=[];for(const item of [...labels].sort((a,b)=>(a.code===selected?-1:b.code===selected?1:camera.position.distanceTo(a.sprite.position)-camera.position.distanceTo(b.sprite.position)))){const p=item.sprite.position.clone().project(camera);const x=(p.x+1)*container.clientWidth/2,y=(1-p.y)*container.clientHeight/2;const visible=p.z<1&&p.z>-1&&!used.some(q=>Math.abs(q.x-x)<24&&Math.abs(q.y-y)<13);item.sprite.visible=visible;if(visible)used.push({x,y});}}
 function draw(){frame=0;if(disposed||pausedNow||document.hidden)return;try{for(const object of cutawayArchitecture)object.visible=camera.position.z>=-2.8;declutter();renderer.render(scene,camera);}catch(error){fail(error);}}
 function request(){if(!frame&&!disposed&&!pausedNow&&!document.hidden)frame=requestAnimationFrame(draw);}
 function resize(){const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;const nextFit=Math.max(1,1.1/camera.aspect);camera.position.sub(controls.target).multiplyScalar(nextFit/fit).add(controls.target);fit=nextFit;camera.updateProjectionMatrix();controls.update();request();}
 const presets={oblique:{p:[room.width/2+10,15,23],t:[room.width/2,.3,4.4]},top:{p:[room.width/2,24,4.6],t:[room.width/2,0,4.6]},front:{p:[room.width/2,7,-10],t:[room.width/2,.3,4]},back:{p:[room.width/2,8,23],t:[room.width/2,.3,4.5]}};
 function setPreset(id){const v=presets[id]||presets.oblique;preset=id;camera.position.set(...v.p);controls.target.set(...v.t);camera.position.sub(controls.target).multiplyScalar(fit).add(controls.target);controls.update();request();}
 function liveColor(state){const rule=COLORS[state]||COLORS.free;const value=getComputedStyle(document.documentElement).getPropertyValue(rule.token).trim();return value||rule.fallback;}
 function emitSelection(){const seat=currentMap?.seats?.find(s=>s.seat_code===selected);if(!seat){selected=null;onSeat(null);return;}const cell=seatCell(seat,currentMap);onSeat({...seat,...cell,ariaLabel:seatAriaLabel(seat,cell)});}
 function select(code){if(disposed)return;const chair=geometry.chairs.find(s=>s.seat_code===code);if(!chair)return;selected=code;for(const [id,ring]of rings){ring.material.opacity=id===code?1:.5;ring.scale.setScalar(id===code?1.2:1);}emitSelection();request();}
 function syncMap(nextMap){if(disposed)return;if(roomGeometryKey(nextMap)!==key)throw new Error('Room geometry changed; rebuild the scene');currentMap=nextMap;
  for(const seat of currentMap.seats){const visual=seatCell(seat,currentMap),color=liveColor(visual.state);rings.get(seat.seat_code)?.material.color.set(color);badges.get(seat.seat_code)?.material.color.set(color);}
  if(selected)emitSelection();request();
 }
 function setPaused(value){if(disposed)return;pausedNow=Boolean(value);controls.enabled=!pausedNow&&!document.hidden;pointers.clear();multi=false;if(pausedNow){cancelAnimationFrame(frame);frame=0;}else request();}
 const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
 function down(e){if(pausedNow||disposed||document.hidden)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,moved:false});if(pointers.size>1)multi=true;}
 function move(e){const p=pointers.get(e.pointerId);if(p&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>6)p.moved=true;}
 function up(e){if(pausedNow||disposed||document.hidden)return;const p=pointers.get(e.pointerId),tap=p&&!p.moved&&!multi;pointers.delete(e.pointerId);if(pointers.size===0)multi=false;if(!tap)return;const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera);let hit=ray.intersectObjects(pickMeshes,false)[0]?.object;while(hit&&!hit.userData.seatCode)hit=hit.parent;if(hit)select(hit.userData.seatCode);}
 function cancel(e){pointers.delete(e.pointerId);if(!pointers.size)multi=false;}
 function visibility(){controls.enabled=!pausedNow&&!document.hidden;if(document.hidden){cancelAnimationFrame(frame);frame=0;pointers.clear();multi=false;}else request();}
 cleanupListeners=()=>{canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('webglcontextlost',contextLost);document.removeEventListener('visibilitychange',visibility);controls.removeEventListener('change',request);};
 controls.addEventListener('change',request);canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',cancel);document.addEventListener('visibilitychange',visibility);
 observer=new ResizeObserver(resize);observer.observe(container);canvas.addEventListener('webglcontextlost',contextLost);setPreset('oblique');resize();if(selected)select(selected);
 return {geometry,select,syncMap,setPaused,setPreset,reset:()=>setPreset('oblique'),zoom(factor){if(disposed||pausedNow||!Number.isFinite(factor)||factor<=0)return;camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target);controls.update();request();},debug:()=>({seatCount:geometry.chairs.length,deskCount:geometry.desks.length,preset,selected,paused:pausedNow,pendingFrame:Boolean(frame),disposed,camera:camera.position.toArray(),colors:[...rings].map(([code,ring])=>({code,color:ring.material.color.getHexString()})),seatViewport:geometry.chairs.map(c=>new THREE.Vector3(c.x,.45,c.z).project(camera).toArray())}),dispose};
 } catch(error){dispose();throw error;}
}
