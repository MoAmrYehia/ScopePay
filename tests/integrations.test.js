import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paypalRequest,extractAgreement} from '../integrations.js';
test('PayPal authenticates and creates an invoice only against sandbox',async()=>{
 const original=global.fetch;const previous=[process.env.PAYPAL_CLIENT_ID,process.env.PAYPAL_CLIENT_SECRET];
 process.env.PAYPAL_CLIENT_ID='test-client';process.env.PAYPAL_CLIENT_SECRET='test-secret';const calls=[];
 global.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>calls.length===1?{access_token:'test-token'}:{id:'INV2-TEST'}}};
 try{const result=await paypalRequest('/invoices',{method:'POST',body:{items:[]},requestId:'stable-id'});assert.equal(result.id,'INV2-TEST');assert(calls.every(c=>c.url.startsWith('https://api-m.sandbox.paypal.com/')));assert.equal(calls[1].options.headers['PayPal-Request-Id'],'stable-id');assert.equal(calls[1].options.headers.Authorization,'Bearer test-token');}
 finally{global.fetch=original;for(const [i,k] of ['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET'].entries()){if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i]}}
});
test('Provider failures never become successful payment results',async()=>{
 const original=global.fetch;const previous=[process.env.PAYPAL_CLIENT_ID,process.env.PAYPAL_CLIENT_SECRET];process.env.PAYPAL_CLIENT_ID='test';process.env.PAYPAL_CLIENT_SECRET='test';global.fetch=async()=>({ok:false,status:401});
 try{await assert.rejects(paypalRequest('/invoices'),/authentication failed/)}finally{global.fetch=original;for(const [i,k] of ['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET'].entries()){if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i]}}
});
test('AI extraction refuses to fabricate output without a configured provider',async()=>{const previous=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;try{await assert.rejects(extractAgreement('agreement'),/not configured/)}finally{if(previous!==undefined)process.env.OPENAI_API_KEY=previous}});
