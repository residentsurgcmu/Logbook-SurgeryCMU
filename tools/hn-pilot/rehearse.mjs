// In-memory fixture only. No network or live Supabase credentials.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import {isCaseHn, isCaseHnPilotEnabled, sealPilotHn} from "../../src/caseHnPilotCrypto.js";

const db=new PGlite();
try {
  const publicKey=JSON.parse(readFileSync(process.argv[2],"utf8"));
  const keyId=publicKey.keyId, auth="authenticated";
  const owner="00000000-1111-4000-8000-000000000001";
  const other="00000000-1111-4000-8000-000000000002";
  const admin="00000000-1111-4000-8000-000000000003";
  const uuid="00000000-2222-4000-8000-000000000001";
  const uuid2="00000000-2222-4000-8000-000000000002";
  const code="ADM-00001";
  const q=async (s,p=[]) => (await db.query(s,p)).rows[0]?.result;
  const run=(f)=>db.exec(readFileSync(new URL("../../supabase/migrations/"+f,import.meta.url),"utf8"));
  const role=async (who,id=null)=>{
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??""]);
    if(who) await db.exec("set role "+who);
  };
  const status=(id=uuid)=>q("select public.rc_hn_pilot_case($1,'status') as result",[id]);
  const save=(cipher,revision)=>q("select public.rc_hn_pilot_case($1,'save',$2,$3,$4) as result",[uuid,keyId,cipher,revision]);
  const exportBundle=(ids=[uuid])=>q("select rc_hn_prod_private.export_bundle($1::uuid[]) as result",[ids]);
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create schema auth;
    create function auth.uid() returns uuid language sql stable return nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    create table public.resident_user_roles(user_id uuid primary key,role text,active boolean);
    create table public.resident_profiles(user_id uuid primary key,active boolean);
    create sequence public.resident_admission_case_seq start 3;
    create table public.resident_admission_cases(id uuid primary key,owner_id uuid,case_code text unique,deleted_at timestamptz,
      admit_date date,age_years smallint check(age_years between 0 and 120),sex text,diagnosis text,
      management text,operation text,unit_name text,status text,treatment_type text,created_by uuid,updated_by uuid);
  `);
  for(const [id,who] of [[owner,"resident"],[other,"resident"],[admin,"admin"]]){
    await db.query("insert into public.resident_user_roles values($1,$2,true)",[id,who]);
    await db.query("insert into public.resident_profiles values($1,true)",[id]);
  }
  await db.query("insert into public.resident_admission_cases(id,owner_id,case_code,deleted_at) values($1,$3,$4,null),($2,$3,'ADM-00002',null)",[uuid,uuid2,owner,code]);
  await run("20261122100000_hn_production_foundation.sql");
  await run("20261122110000_hn_production_pilot_interfaces.sql");
  await run("20261126160000_hn_pilot_create_case.sql");
  const host="https://dyiiivcyoatgmkmvgcnt.supabase.co";
  assert.equal(isCaseHnPilotEnabled("true",host,keyId),true);
  assert.equal(isCaseHnPilotEnabled("false",host,keyId),false);
  assert.equal(isCaseHnPilotEnabled("true",host),false);
  assert.equal(isCaseHnPilotEnabled("true","https://vijxiststybmuchcghux.supabase.co",keyId),false);
  for(const bad of ["123456","00123456","DEMO-0123456",1234567,"0123456\n"]) assert.equal(isCaseHn(bad),false);
  const hn="0123456";
  const sealed=await sealPilotHn({publicKey,configuredKey:keyId,caseUuid:uuid,caseCode:code,hn});
  await assert.rejects(sealPilotHn({publicKey:{...publicKey,format:"rc-hn-demo-v1"},configuredKey:keyId,caseUuid:uuid,caseCode:code,hn}));
  await role(auth,owner);
  assert.equal(await status(),null);
  await assert.rejects(save(sealed.ciphertext,0),{code:"42501"});
  await role(null);
  await db.query("insert into rc_hn_prod_private.public_keys(spki) values(decode($1,'base64'))",[publicKey.spki]);
  await db.query("insert into rc_hn_prod_private.pilot_config(enabled,key_id) values(true,$1)",[keyId]);
  await db.query("insert into rc_hn_prod_private.pilot_cases values($1)",[uuid]);
  await role(auth,owner);
  assert.deepEqual(await status(),{saved:false,revision:0,publicKey});
  assert.equal(await status(uuid2),null);
  await assert.rejects(save(hn,0),{code:"22023"});
  assert.deepEqual(await save(sealed.ciphertext,0),{saved:true,revision:1});
  await assert.rejects(save(sealed.ciphertext,0),{code:"40001"});
  assert.deepEqual(await status(),{saved:true,revision:1,publicKey});
  for(const [who,id] of [[auth,other],[auth,admin],["anon",null],["service_role",null]]){
    await role(who,id);
    if(who===auth) assert.equal(await status(),null);
    else await assert.rejects(status(),{code:"42501"});
    await assert.rejects(save(sealed.ciphertext,1),{code:"42501"});
    await assert.rejects(exportBundle(),{code:"42501"});
    await assert.rejects(q("select ciphertext from rc_hn_prod_private.records"),{code:"42501"});
  }
  await role(auth,owner);
  await assert.rejects(exportBundle(),{code:"42501"});
  await assert.rejects(q("select public.rc_hn_pilot_case($1,'download') as result",[uuid]),{code:"42501"});
  await role(null);
  await assert.rejects(exportBundle([uuid,uuid2]),{code:"22023"});
  await assert.rejects(exportBundle([uuid,uuid]),{code:"22023"});
  assert.equal(await q("select count(*)::int as result from rc_hn_prod_private.export_log"),0);
  const bundle=await exportBundle();
  assert.equal(bundle.records[0].ciphertext,sealed.ciphertext);
  assert.equal(bundle.records[0].revision,1);
  assert.equal(await q("select count(*)::int as result from rc_hn_prod_private.export_log where case_ids=array[$1]::uuid[] and revisions=array[1]",[uuid]),1);
  const createId="00000000-2222-4000-8000-000000000003";
  const create=(op,fields,key,cipher)=>q("select public.rc_hn_pilot_create_case($1,$2,$3,$4,$5) as result",
    [op,createId,fields??null,key??null,cipher??null]);
  const fields={admit_date:"2026-11-20",age_years:"40",sex:"male",diagnosis:"fixture",
    management:"",operation:"",unit_name:"Upper GI",status:"admit",treatment_type:"conservative"};
  await role(auth,owner);
  assert.equal(await create("status"),null);
  await assert.rejects(create("reserve"),{code:"42501"});
  await role(null);
  await db.query("insert into rc_hn_prod_private.pilot_creators values($1)",[owner]);
  await role(auth,owner);
  assert.equal((await create("status")).eligible,true);
  const reserved=await create("reserve");
  assert.equal(reserved.caseCode,"ADM-00003");
  assert.deepEqual(await create("reserve"),reserved);
  const encrypted=await sealPilotHn({publicKey:reserved.publicKey,configuredKey:keyId,
    caseUuid:createId,caseCode:reserved.caseCode,hn});
  await assert.rejects(create("save",fields,keyId,null),{code:"22023"});
  await assert.rejects(create("save",fields,keyId,hn),{code:"22023"});
  await assert.rejects(create("save",{...fields,hn},keyId,encrypted.ciphertext),{code:"22023"});
  await assert.rejects(create("save",{...fields,age_years:"999"},keyId,encrypted.ciphertext),{code:"23514"});
  await role(null);
  assert.equal(await q("select count(*)::int as result from public.resident_admission_cases where id=$1",[createId]),0);
  assert.equal(await q("select count(*)::int as result from rc_hn_prod_private.records where case_id=$1",[createId]),0);
  await role(auth,other);
  await assert.rejects(create("save",fields,keyId,encrypted.ciphertext),{code:"42501"});
  await role(auth,owner);
  assert.deepEqual(await create("save",fields,keyId,encrypted.ciphertext),{id:createId});
  assert.deepEqual(await create("save",fields,keyId,encrypted.ciphertext),{id:createId});
  await assert.rejects(create("save",{...fields,diagnosis:"different"},keyId,encrypted.ciphertext),{code:"40001"});
  await role(null);
  const roundTrip=await exportBundle([createId]);
  assert.equal(roundTrip.records[0].ciphertext,encrypted.ciphertext);
  assert.equal(roundTrip.records[0].caseId,reserved.caseCode);
  await db.query("update public.resident_profiles set active=false where user_id=$1",[owner]);
  await role(auth,owner);
  assert.equal(await status(),null);
  await assert.rejects(save(sealed.ciphertext,1),{code:"42501"});
  await role(null);
  await db.exec("update rc_hn_prod_private.pilot_config set enabled=false");
  await assert.rejects(exportBundle(),{code:"42501"});
  console.log(JSON.stringify(roundTrip));
} finally { await db.close(); }
