import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import { isCaseHnTrialEnabled, sealTrialHn } from '../src/caseHnTrialCrypto.js';

test('staging flag never enables the HN trial with the production or a substituted origin', () => {
  const staging = 'https://vijxiststybmuchcghux.supabase.co';
  assert.equal(isCaseHnTrialEnabled('true', staging), true);
  for (const url of [undefined, 'https://dyiiivcyoatgmkmvgcnt.supabase.co', staging + '.example.com', staging.replace('https','http')])
    assert.equal(isCaseHnTrialEnabled('true', url), false);
  assert.equal(isCaseHnTrialEnabled(undefined, staging), false);
});

test('the upload is ciphertext only, randomized and bound to the exact case and configured key', async () => {
  const params={name:'RSA-OAEP', hash:'SHA-256'};
  const keys=await webcrypto.subtle.generateKey({...params,modulusLength:3072,publicExponent:new Uint8Array([1,0,1])}, true, ['encrypt','decrypt']);
  const spki=await webcrypto.subtle.exportKey('spki',keys.publicKey);
  const kid=Buffer.from(await webcrypto.subtle.digest('SHA-256',spki)).toString('hex');
  const input={publicKey:{format:'rc-hn-demo-v1',type:'public',keyId:kid,spki:Buffer.from(spki).toString('base64')},
    configuredKey:kid,caseUuid:'ac100000-0000-4000-8000-000000000001',caseCode:'ADM-00001',hn:'DEMO-654321'};
  const result=await sealTrialHn(input);
  assert.deepEqual(Object.keys(result),['keyId','ciphertext']);
  assert.equal(result.ciphertext.length,512);
  assert.notEqual((await sealTrialHn(input)).ciphertext,result.ciphertext);
  await assert.rejects(sealTrialHn({...input,hn:'654321'}));
  await assert.rejects(sealTrialHn({...input,configuredKey:'0'.repeat(64)}));
  const open=(uuid,code)=>webcrypto.subtle.decrypt({name:'RSA-OAEP',label:new TextEncoder().encode(`rc-hn-trial-v1:${uuid}:${code}:${kid}`)},
    keys.privateKey,Buffer.from(result.ciphertext,'base64'));
  assert.equal(new TextDecoder().decode(await open(input.caseUuid,input.caseCode)),input.hn);
  await assert.rejects(open(input.caseUuid,'ADM-00002'));
  await assert.rejects(open('ac100000-0000-4000-8000-000000000002',input.caseCode));
});
