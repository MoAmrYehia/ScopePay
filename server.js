import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {paypalRequest,extractAgreement} from './integrations.js';
const root=path.resolve('public');
let records={};try{records=JSON.parse(await readFile('data/invoices.json','utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
const persist=async()=>{await mkdir('data',{recursive:true});await writeFile('data/invoices.json',JSON.stringify(records,null,2),{mode:0o600})};
const json=(res,body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body))};
async function input(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>200000)throw new Error('Request too large.')}return JSON.parse(text||'{}')}
http.createServer(async(req,res)=>{
 try {
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/api/health')return json(res,{status:'ok',payments:process.env.PAYPAL_CLIENT_ID&&process.env.PAYPAL_CLIENT_SECRET?'sandbox':'demo',extraction:process.env.OPENAI_API_KEY?'ai':'structured-demo'});
  if(pathname.startsWith('/api/')&&req.method==='POST'){
   // Same-origin POSTs only. This is a local single-user prototype, not a public multi-tenant service.
   if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(res,{error:'Cross-origin requests are not allowed.'},403);
   const body=await input(req);
   if(pathname==='/api/extract'){
    if(typeof body.text!=='string'||body.text.length>50000)return json(res,{error:'Supply a text agreement smaller than 50,000 characters.'},400);
    return json(res,await extractAgreement(body.text));
   }
   if(pathname==='/api/paypal/approve'){
    if(!body.id||body.pages?.length!==5||!['Home','About','Services','Portfolio','Contact'].every(p=>body.pages.includes(p))||!Number.isFinite(body.amount)||body.amount<=0||body.amount>1000000)return json(res,{error:'Five evidence references and a valid milestone amount are required.'},400);
    const key=String(body.id);if(!records[key]){records[key]={approved:true,name:String(body.name).slice(0,150),amount:body.amount,approvedAt:new Date().toISOString()};await persist()}
    return json(res,{approved:true});
   }
   const record=records[String(body.id)];
   if(!record?.approved)return json(res,{error:'Record client acceptance first.'},409);
   if(pathname==='/api/paypal/create'){
    if(!process.env.PAYPAL_INVOICER_EMAIL||!process.env.PAYPAL_RECIPIENT_EMAIL)return json(res,{error:'Configure sandbox merchant and recipient email addresses on the server.'},400);
    if(!record.invoice){
     const result=await paypalRequest('/invoices',{method:'POST',requestId:'scopepay-'+body.id,body:{detail:{currency_code:'USD',note:'Approved ScopePay development milestone'},invoicer:{email_address:process.env.PAYPAL_INVOICER_EMAIL},primary_recipients:[{billing_info:{email_address:process.env.PAYPAL_RECIPIENT_EMAIL}}],items:[{name:record.name+' — development milestone',quantity:'1',unit_amount:{currency_code:'USD',value:record.amount.toFixed(2)}}]}});
     record.invoice=result.id||result.href?.split('/').pop();if(!/^INV2-[A-Z0-9-]+$/.test(record.invoice||''))throw new Error('PayPal did not return a valid invoice ID.');await persist();
    }
    return json(res,{id:record.invoice});
   }
   if(!record.invoice)return json(res,{error:'Create a sandbox invoice first.'},409);
   const invoiceRoute='/invoices/'+encodeURIComponent(record.invoice);
   if(pathname==='/api/paypal/send'){if(!record.sent){await paypalRequest(invoiceRoute+'/send',{method:'POST',body:{send_to_invoicer:true}});record.sent=true;await persist()}return json(res,{sent:true})}
   if(pathname==='/api/paypal/status'){const result=await paypalRequest(invoiceRoute);return json(res,{id:record.invoice,status:result.status})}
   if(pathname==='/api/paypal/remind'){if(!record.sent)return json(res,{error:'Send the invoice before reminding the recipient.'},409);await paypalRequest(invoiceRoute+'/remind',{method:'POST',body:{subject:'Reminder: approved ScopePay milestone',note:'Your approved milestone invoice is ready for payment.',send_to_invoicer:true}});return json(res,{sent:true})}
   return json(res,{error:'Unknown endpoint.'},404);
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,{error:'Method not allowed.'},405);
  const file=path.join(root,pathname==='/'?'index.html':pathname);
  if(!file.startsWith(root+path.sep))return json(res,{error:'Forbidden'},403);
  let body;try{body=await readFile(file)}catch{return json(res,{error:'Not found'},404)}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.end(req.method==='HEAD'?undefined:body);
 }catch(error){json(res,{error:error.message||'Request failed.'},502)}
}).listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('ScopePay running on port '+(process.env.PORT||3000)));
