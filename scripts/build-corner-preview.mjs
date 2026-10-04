import {build} from 'vite';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.resolve(process.argv[2] || path.join(root,'preview-dist/Resident_Corner_Local_Preview.html'));
const result=await build({root,configFile:false,envDir:false,publicDir:false,define:{"process.env.NODE_ENV":JSON.stringify("production")},
 plugins:[{name:'offline-preview',enforce:'pre',resolveId(id){if(/(?:^|\/)supabase(?:\.js)?$/.test(id))return path.join(root,'preview/offline-api.js');}}],
 build:{write:false,lib:{entry:path.join(root,'preview/main.jsx'),name:'ResidentCornerPreview',formats:['iife']},rollupOptions:{output:{inlineDynamicImports:true}},assetsInlineLimit:Infinity,minify:true},
});
const outputs=(Array.isArray(result)?result:[result]).flatMap(item=>item.output);
const code=outputs.filter(item=>item.type==='chunk').map(item=>item.code).join('\n');
let css=outputs.filter(item=>item.type==='asset' && item.fileName.endsWith('.css')).map(item=>item.source).join('\n');
const font='data:font/ttf;base64,'+(await readFile(path.join(root,'public/fonts/NotoSansThai.ttf'))).toString('base64');
css=css.replaceAll('/fonts/NotoSansThai.ttf',font);
const logo='data:image/png;base64,'+(await readFile(path.join(root,'public/surgery-cmu-logo.png'))).toString('base64');
const js=code.replaceAll('/surgery-cmu-logo.png',logo).replace(/<\/script/gi,'<\\/script');
const html=`<!doctype html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Resident Corner — Local preview</title><style>${css.replace(/<\/style/gi,'<\\/style')}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
await mkdir(path.dirname(out),{recursive:true});
await writeFile(out,html);
console.log(`Standalone offline preview: ${out} (${Buffer.byteLength(html)} bytes)`);
