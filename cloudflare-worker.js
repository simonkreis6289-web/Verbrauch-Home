/** Verbrauch Zuhause: Cloudflare Worker + KV + FCM HTTP v1. */
const encoder = new TextEncoder();
const respond = (obj, status=200, headers={}) => new Response(JSON.stringify(obj), {status,headers:{'Content-Type':'application/json; charset=utf-8',...headers}});
function b64url(bytes){ let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
async function accessToken(env){
  const now=Math.floor(Date.now()/1000);
  const header=b64url(encoder.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const body=b64url(encoder.encode(JSON.stringify({iss:env.FCM_CLIENT_EMAIL,sub:env.FCM_CLIENT_EMAIL,aud:'https://oauth2.googleapis.com/token',scope:'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore',iat:now,exp:now+3500})));
  const input=header+'.'+body;
const rawKey = String(env.FCM_PRIVATE_KEY || '').trim();
// Firebase JSON stores newlines as the two characters backslash + n.
// Accept both that representation and a multiline PEM secret.
const normalizedKey = rawKey.replace(/\\n/g, '\n');
const pem = normalizedKey
  .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '')
  .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, '')
  .replace(/\s/g, '');
if (!pem || !/^[A-Za-z0-9+/]+={0,2}$/.test(pem)) {
  throw new Error('FCM_PRIVATE_KEY hat ein ungültiges PEM/Base64-Format');
}
const keyBytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',keyBytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const signature=b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(input))));
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:input+'.'+signature})});
  const json=await res.json();if(!res.ok||!json.access_token)throw new Error('Google OAuth: '+(json.error_description||json.error||res.status));
  return json.access_token;
}
function safePart(value, max=120){return typeof value==='string'&&value.length<=max&&/^[a-zA-Z0-9_-]+$/.test(value)?value:null;}
function safeString(value,max=180){return typeof value==='string'?value.trim().slice(0,max):'';}
function corsHeaders(origin,env){const expected=(env.ALLOWED_ORIGIN||'').replace(/\/$/,'');return origin===expected&&expected?{'Access-Control-Allow-Origin':expected,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'}:{};}
async function compareSecret(actual, expected){if(!expected)return false;const a=await crypto.subtle.digest('SHA-256',encoder.encode(actual));const b=await crypto.subtle.digest('SHA-256',encoder.encode(expected));const aa=new Uint8Array(a),bb=new Uint8Array(b);let delta=0;for(let i=0;i<aa.length;i++)delta|=aa[i]^bb[i];return delta===0;}
async function deviceList(env, household){let cursor,devices=[];do{const res=await env.PUSH_DEVICES.list({prefix:'push:'+household+':',cursor,limit:1000});devices.push(...res.keys);cursor=res.list_complete?undefined:res.cursor;}while(cursor&&devices.length<2000);return devices;}
export default {
 async scheduled(event,env,ctx){
  ctx.waitUntil(Promise.allSettled([
    checkEvents(env).catch(error=>console.error('Firestore Push Watch:',String(error))),
    checkPriceSchedules(env).catch(error=>console.error('Preis-Erinnerung:',String(error))),
      weatherCron(env).catch(error=>console.error('Wetter-Cron:',String(error))),
    syncWeatherAlarm(env,safePart(env.PUSH_HOUSEHOLD_ID)).catch(error=>console.error('Wetteralarm-Sync:',String(error))),
    forecastCron(env).catch(error=>console.error('Vorhersage-Cron:',String(error))),
    fuelAverageDispatchCron(env).catch(error=>console.error('Spritpreis-Dispatch:',String(error)))
  ]));
 },
 async fetch(req,env){
  const origin=req.headers.get('Origin')||'';
  const headers=corsHeaders(origin,env);
  if(req.method==='OPTIONS')return origin&&(headers['Access-Control-Allow-Origin'])?new Response(null,{status:204,headers}):respond({error:'Origin nicht erlaubt'},403);
  //  v108: Bedarfsabruf der Live-Spritpreise. Ohne Push-Passwort, aber nur von der zugelassenen App-Origin.*
  //  Die API-Key-Konfiguration bleibt ausschließlich als Cloudflare-Secret gespeichert.*
      if(new URL(req.url).pathname==='/forecast'){
        if(req.method!=='GET')return respond({error:'Nur GET erlaubt'},405,headers);
        if(origin&&!headers['Access-Control-Allow-Origin'])return respond({error:'Origin nicht erlaubt'},403,headers);
        if(!env.PUSH_DEVICES)return respond({error:'Wettercache nicht konfiguriert'},503,headers);
        let forecast=await env.PUSH_DEVICES.get('forecast:default:v1','json');
        if(!forecast){
          try{forecast=await fetchAndCacheForecast(env,'initial');}
          catch(error){console.error('Vorhersage-Erstabruf:',String(error));return respond({error:'Wetterdaten momentan nicht erreichbar. Bitte später erneut versuchen.'},503,{...headers,'Cache-Control':'no-store'});}
        }
        return respond(forecast,200,{...headers,'Cache-Control':'public, max-age=120'});
      }
      if(new URL(req.url).pathname.startsWith('/weather/')){
      if(req.method!=='POST')return respond({error:'Nur POST erlaubt'},405,headers);
      if(origin&&!headers['Access-Control-Allow-Origin'])return respond({error:'Origin nicht erlaubt'},403,headers);
      return weatherRoute(req,env,new URL(req.url).pathname,headers);
    }
if(new URL(req.url).pathname==='/fuel-prices'){
    if(req.method!=='POST')return respond({error:'Nur POST erlaubt'},405,headers);
    if(!origin||!headers['Access-Control-Allow-Origin'])return respond({error:'Origin nicht erlaubt'},403,headers);
    try{return respond(await fetchLiveFuel(req,env),200,headers);}
    catch(error){console.error('Tankerkönig:',String(error));return respond({error:String(error.message||error)},502,headers);}
  }
  if(req.method!=='POST')return respond({error:'Nur POST erlaubt'},405,headers);
  //  Browser-Origin streng prüfen; vertrauenswürdige Serverjobs senden keinen Origin-Header.*
  //  Der Geheimcode wird für beide Varianten unmittelbar danach zwingend geprüft.*
  if(origin&&!headers['Access-Control-Allow-Origin'])return respond({error:'Origin nicht erlaubt'},403,headers);
  if(!env.PUSH_SECRET||!env.FCM_CLIENT_EMAIL||!env.FCM_PRIVATE_KEY||!env.FCM_PROJECT_ID||!env.PUSH_DEVICES)return respond({error:'Server nicht eingerichtet'},503,headers);
  const authorized=await compareSecret((req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,''),env.PUSH_SECRET);
  if(!authorized)return respond({error:'Push-Zugangscode falsch'},401,headers);
  let input;try{input=await req.json();}catch(_){return respond({error:'Ungültige Anfrage'},400,headers);}
  const household=safePart(input.household);
  if(!household)return respond({error:'Ungültiger Haushalt'},400,headers);
  const url=new URL(req.url),route=url.pathname;
  if(route==='/settings/get')return respond({ok:true,rules:await getRules(env,household)},200,headers);
  if(route==='/settings/set'){
    if(!input.rules||typeof input.rules!=='object'||Array.isArray(input.rules))return respond({error:'Regeln fehlen'},400,headers);
    const rules=normalizeRules(input.rules);
    await env.PUSH_DEVICES.put(RULE_PREFIX+household,JSON.stringify(rules));
    return respond({ok:true,rules},200,headers);
  }
  if(route==='/register'){
    const deviceId=safePart(input.deviceId,80),token=safeString(input.token,4096);
    if(!deviceId||!token||token.length<30)return respond({error:'Ungültige Gerätekennung oder FCM-Token'},400,headers);
    await env.PUSH_DEVICES.put('push:'+household+':'+deviceId,JSON.stringify({token,added:new Date().toISOString()}));
    const devices=await deviceList(env,household);return respond({ok:true,devices:devices.length},200,headers);
  }
  if(route==='/unregister'){
    const deviceId=safePart(input.deviceId,80);if(!deviceId)return respond({error:'Ungültige Gerätekennung'},400,headers);
    await env.PUSH_DEVICES.delete('push:'+household+':'+deviceId);
    const devices=await deviceList(env,household);return respond({ok:true,devices:devices.length},200,headers);
  }
  if(route==='/broadcast'){
    const title=safeString(input.title,80)||'Verbrauch Zuhause';const body=safeString(input.body,180)||'Push-Test erfolgreich.';
    const keys=await deviceList(env,household);
    if(keys.length>100)return respond({error:'Zu viele registrierte Geräte für den Test (maximal 100)'},400,headers);
    const bearer=keys.length?await accessToken(env):null;
    let sent=0,failed=0;
    for(const key of keys){
      const info=await env.PUSH_DEVICES.get(key.name,'json');if(!info?.token)continue;
      try{
        const res=await fetch('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(env.FCM_PROJECT_ID)+'/messages:send',{
          method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},
          body:JSON.stringify({message:{token:info.token,data:{title,body},webpush:{headers:{TTL:'3600',Urgency:'high'}}}})
        });
        if(res.ok){sent++;continue;}
        failed++;
        const responseText=await res.text();
        if(res.status===404||res.status===410||responseText.includes('UNREGISTERED'))await env.PUSH_DEVICES.delete(key.name);
        console.error('FCM Fehler',res.status,responseText.slice(0,300));
      }catch(error){failed++;console.error('FCM Ausnahme',String(error));}
    }
    return respond({ok:failed===0,total:keys.length,sent,failed},200,headers);
  }
  return respond({error:'Unbekannte Aktion'},404,headers);
 }
};
//  v85: Serverseitige Auswertung. Ein Cron Trigger ruft scheduled() auf.*
//  Keine Passwörter oder Push-Secrets in der öffentlichen Web-App.*
//  v86: Haushaltsbezogene Push-Regeln im bestehenden KV-Namespace.*
const RULE_PREFIX='pushrules86:';
const DEFAULT_RULES={prices:true,reminder:true,warnings:true,fuel:true,threshold:30,priceIntervalDays:1};
function normalizeRules(raw){const obj=raw&&typeof raw==='object'?raw:{};const result={};
  for(const key of ['prices','reminder','warnings','fuel'])result[key]=typeof obj[key]==='boolean'?obj[key]:DEFAULT_RULES[key];
  const threshold=Number(obj.threshold);result.threshold=Number.isFinite(threshold)&&threshold>=10&&threshold<=200?threshold:30;
  const inputTimes=Array.isArray(obj.priceTimes)?obj.priceTimes:undefined;
  result.priceTimes=(inputTimes===undefined?[]:inputTimes)
    .filter(x=>typeof x==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(x))
    .slice(0,12).filter((v,i,a)=>a.indexOf(v)===i).sort();
  return result;
}
async function getRules(env,household){return normalizeRules(await env.PUSH_DEVICES.get(RULE_PREFIX+household,'json'));}
const WATCH_PREFIX = 'watch85:';
function unpackField(field){
  if(!field)return null;
  if('stringValue' in field)return field.stringValue;
  if('integerValue' in field)return Number(field.integerValue);
  if('doubleValue' in field)return Number(field.doubleValue);
  if('timestampValue' in field)return field.timestampValue;
  if('booleanValue' in field)return field.booleanValue;
  if('nullValue' in field)return null;
  return null;
}
function unpackDocument(doc){
  if(!doc)return null;
  const out={id:String(doc.name||'').split('/').pop(),createTime:doc.createTime||''};
  for(const [key,value] of Object.entries(doc.fields||{}))out[key]=unpackField(value);
  return out;
}
async function firestoreQuery(env,token,household,collection,limit=90){
  const path='https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(env.FCM_PROJECT_ID)+'/databases/(default)/documents/households/'+encodeURIComponent(household)+':runQuery';
  const query={structuredQuery:{from:[{collectionId:collection}],orderBy:[{field:{fieldPath:'serverCreatedAt'},direction:'DESCENDING'}],limit}};
  const res=await fetch(path,{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(query)
  });
  if(!res.ok)throw new Error('Firestore '+collection+' HTTP '+res.status+': '+(await res.text()).slice(0,180));
  const data=await res.json();
  return (Array.isArray(data)?data:[]).filter(x=>x.document).map(x=>unpackDocument(x.document));
}
function deNumber(x){const n=Number(x);return Number.isFinite(n)?n:null;}
function deCurrency(x){return Number(x).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2});}
function deDay(x){
  const d=new Date(x);
  return Number.isNaN(d.getTime())?'unbekannt':new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
}
async function broadcastInternal(env,household,title,body){
  const keys=await deviceList(env,household);
  if(keys.length>100)throw new Error('Zu viele Push-Geräte: '+keys.length);
  if(!keys.length){console.log('Noch keine Push-Geräte in '+household);return {sent:0,failed:0};}
  const bearer=await accessToken(env);
  let sent=0,failed=0;
  for(const key of keys){
    const info=await env.PUSH_DEVICES.get(key.name,'json');
    if(!info?.token)continue;
    const res=await fetch('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(env.FCM_PROJECT_ID)+'/messages:send',{
      method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},
      body:JSON.stringify({message:{token:info.token,data:{title:safeString(title,80),body:safeString(body,180)},webpush:{headers:{TTL:'3600',Urgency:'high'}}}})
    });
    if(res.ok){sent++;continue;}
    failed++;
    const output=await res.text();
    if(res.status===404||res.status===410||output.includes('UNREGISTERED'))await env.PUSH_DEVICES.delete(key.name);
    console.error('Push Watch FCM:',res.status,output.slice(0,150));
  }
  if(failed)throw new Error('Push Watch '+failed+' Versandfehler, '+sent+' erfolgreich');
  return {sent,failed};
}
async function sendEventOnce(env,household,key,title,body){
  if(await env.PUSH_DEVICES.get(WATCH_PREFIX+'event:'+household+':'+key))return false;
  const result=await broadcastInternal(env,household,title,body);
  //  Erst nach erfolgreichem Übergeben an FCM als gesendet markieren.*
  //  Ohne registrierte Geräte nicht nachträglich alte Ereignisse zustellen.*
  await env.PUSH_DEVICES.put(WATCH_PREFIX+'event:'+household+':'+key,new Date().toISOString(),{expirationTtl:7776000});
  console.log('Push-Ereignis',key,'gesendet',result.sent);
  return true;
}
function readingAlert(latest,all,type,threshold=30){
  const series=all.filter(row=>row.type===type&&Number.isFinite(deNumber(row.value))&&Date.parse(row.date))
    .sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
  const pos=series.findIndex(x=>x.id===latest.id);
  if(pos<1)return null;
  const prior=series[pos-1];
  const days=(Date.parse(latest.date)-Date.parse(prior.date))/86400000;
  if(!(days>=7&&days<=90))return null; //  Einzelne Tage und extreme Lücken nicht vergleichen.*
  const current=(Number(latest.value)-Number(prior.value))/days;
  if(!(current>0))return null;
  //  Historischer Durchschnitt ausschließlich vor dem neuen Intervall.*
  const before=series.slice(0,pos);
  const oldest=before.find(x=>(Date.parse(prior.date)-Date.parse(x.date))/86400000>=90
    &&(Date.parse(prior.date)-Date.parse(x.date))/86400000<=365);
  if(!oldest||before.length<4)return null;
  const refDays=(Date.parse(prior.date)-Date.parse(oldest.date))/86400000;
  const baseline=(Number(prior.value)-Number(oldest.value))/refDays;
  if(!(baseline>0))return null;
  const ratio=current/baseline;
  const minIncrease=type==='strom'?2:0.08;
  if(!(ratio>=1+(threshold/100) && current-baseline>=minIncrease))return null;
  return {days,baseline,current,ratio};
}
//  v96: Genau ein Firestore-Kontrolldokument je Cron-Durchlauf lesen.*
//  Nur bei erhoehter Sequenz werden neue Ereignisse (max. 25 pro Seite) abgefragt.*
async function readPushControl(env,token,household){
  const url='https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(env.FCM_PROJECT_ID)+
    '/databases/(default)/documents/households/'+encodeURIComponent(household)+'/pushControl/main';
  const res=await fetch(url,{headers:{Authorization:'Bearer '+token}});
  if(res.status===404)return 0;
  if(!res.ok)throw new Error('Push-Kontrollstatus HTTP '+res.status+': '+(await res.text()).slice(0,180));
  const d=await res.json();
  const seq=Number(d.fields?.seq?.integerValue||0);
  if(!Number.isSafeInteger(seq)||seq<0)throw new Error('Ungueltige Push-Sequenz in Firestore');
  return seq;
}
async function readPendingPushEvents(env,token,household,cursor,limit=25){
  const url='https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(env.FCM_PROJECT_ID)+
    '/databases/(default)/documents/households/'+encodeURIComponent(household)+':runQuery';
  const q={structuredQuery:{from:[{collectionId:'pushEvents'}],
    where:{fieldFilter:{field:{fieldPath:'seq'},op:'GREATER_THAN',value:{integerValue:String(cursor)}}},
    orderBy:[{field:{fieldPath:'seq'},direction:'ASCENDING'}],limit}};
  const res=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(q)});
  if(!res.ok)throw new Error('Neue Push-Ereignisse HTTP '+res.status+': '+(await res.text()).slice(0,180));
  const raw=await res.json();
  return (Array.isArray(raw)?raw:[]).filter(x=>x.document).map(x=>unpackDocument(x.document))
    .sort((a,b)=>Number(a.seq)-Number(b.seq));
}
async function handleQueuedEvent(env,household,record,rules){
  const seq=Number(record.seq);
  if(record.kind==='fuel' && rules.fuel){
    await sendEventOnce(env,household,'fuelq:'+seq,
      safeString(record.title,80)||'⛽ Neue Tankung',safeString(record.body,180)||'Neue Tankung gespeichert.');
  }
  if(record.kind==='reading' && rules.warnings){
    const ratio=Number(record.ratio),current=Number(record.current),baseline=Number(record.baseline);
    const delta=current-baseline,type=record.readingType;
    const minimum=type==='strom'?2:0.08;
    if(['strom','wasser'].includes(type)&&Number.isFinite(ratio)&&Number.isFinite(delta)&&
      ratio>=1+rules.threshold/100&&delta>=minimum){
      const name=type==='strom'?'Strom':'Wasser',unit=type==='strom'?'kWh':'m³';
      await sendEventOnce(env,household,'warnq:'+seq,'⚠️ Verbrauchswarnung',
        name+': '+Math.round((ratio-1)*100)+' % über historischem Tagesmittel ('+
        deCurrency(current)+' statt '+deCurrency(baseline)+' '+unit+'/Tag).');
    }
  }
}
async function checkEvents(env){
  const household=safePart(env.PUSH_HOUSEHOLD_ID);
  if(!household)throw new Error('PUSH_HOUSEHOLD_ID fehlt.');
  if(!env.PUSH_DEVICES||!env.FCM_CLIENT_EMAIL||!env.FCM_PRIVATE_KEY||!env.FCM_PROJECT_ID)
    throw new Error('Push-Konfiguration unvollstaendig.');
  const rules=await getRules(env,household);
  const cursorKey='push96:cursor:'+household;
  const quotaKey='push96:quotaPause:'+household;
  if(Date.now()<Number(await env.PUSH_DEVICES.get(quotaKey)||0))return;
  try{
    const token=await accessToken(env);
    const latest=await readPushControl(env,token,household);
    const cursor=Number(await env.PUSH_DEVICES.get(cursorKey)||0);
    if(latest<=cursor)return;
    //  max. 100 Ereignisse pro Zyklus; Rest bleibt fuer den naechsten Lauf.*
    let current=cursor, processed=0;
    while(current<latest && processed<100){
      const events=await readPendingPushEvents(env,token,household,current,25);
      if(!events.length)throw new Error('Push-Sequenz hat Luecke hinter '+current);
      for(const e of events){
        const seq=Number(e.seq);
        if(!Number.isSafeInteger(seq)||seq!==current+1)
          throw new Error('Unvollstaendige Push-Sequenz: '+current+' -> '+seq);
        await handleQueuedEvent(env,household,e,rules);
        current=seq;processed++;
        //  Cursor nur nach erfolgreich bearbeitetem Ereignis weiterschieben.*
        await env.PUSH_DEVICES.put(cursorKey,String(current));
      }
      if(events.length<25)break;
    }
    if(processed)console.log('Push v96: '+processed+' Ereignisse verarbeitet; Sequenz '+current+'/'+latest);
  }catch(error){
    if(String(error).includes('HTTP 429')){
      //  Spark-Kontingent wird um Mitternacht America/Los_Angeles erneuert.*
      //  Bei Quotenproblemen verhindert die Pause unnoetige Wiederholungsabfragen.*
      await env.PUSH_DEVICES.put(quotaKey,String(Date.now()+3*60*60*1000));
    }
    throw error;
  }
}
async function firestoreQueryCars(env,token,household){
  //  Autos besitzen nicht zwingend den gleichen Sortierwert wie Ablesungen.*
  const path='https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(env.FCM_PROJECT_ID)+'/databases/(default)/documents/households/'+encodeURIComponent(household)+'/cars?pageSize=100';
  const res=await fetch(path,{headers:{Authorization:'Bearer '+token}});
  if(!res.ok)throw new Error('Fahrzeuge lesen HTTP '+res.status);
  const data=await res.json();
  const result=new Map();
  for(const doc of data.documents||[]){
    const car=unpackDocument(doc);
    result.set(car.id,safeString(car.name||[car.brand,car.model].filter(Boolean).join(' ')||'Fahrzeug',65));
  }
  return result;
}
//  v93: globally scheduled price notifications for the currently configured household.*
const localClock=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function berlinParts(date){
  const p=Object.fromEntries(localClock.formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return {day:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
const minuteOf=time=>{const [h,m]=time.split(':').map(Number);return h*60+m;};
async function checkPriceSchedules(env){
  if(!env.PUSH_DEVICES||!env.PUSH_HOUSEHOLD_ID)return;
  const household=safePart(env.PUSH_HOUSEHOLD_ID);if(!household)return;
  const now=new Date(),local=berlinParts(now),mins=minuteOf(local.time);
  const rules=await getRules(env,household);
    if(rules.prices){
    const interval=rules.priceIntervalDays||1;
    const epochDay=Math.floor(Date.UTC(Number(local.day.slice(0,4)),Number(local.day.slice(5,7))-1,Number(local.day.slice(8,10)))/86400000);
    if(epochDay%interval===0){
      for(const time of rules.priceTimes.slice(0,1).filter(t=>mins>=minuteOf(t)&&mins-minuteOf(t)<10)){
        await sendEventOnce(env,household,'manual-price-reminder:'+local.day+':'+time,
          '✍️ Energiepreise eintragen','Bitte Heizöl- und Pelletspreise in Verbrauch Zuhause manuell aktualisieren.');
      }
    }
  }
if(rules.reminder&&mins>=17*60+15&&mins<17*60+25){
    const tomorrow=berlinParts(new Date(now.getTime()+24*3600000)).day;
    if(local.day.slice(0,7)!==tomorrow.slice(0,7)){
      await sendEventOnce(env,household,'monthly:'+local.day,
        '📅 Zählerstände eintragen','Heute ist Monatsende. Bitte Strom, Wasser und Pellets in Verbrauch Zuhause erfassen.');
    }
  }
}
//  v110: Cloudflare loest nur den Github-Workflow fuer BUNDESWEITE Durchschnittspreise aus.*
//  Keine zeitgesteuerten Tankerkoenig-Live-Abfragen! Der bestehende Cron */5 wird genutzt.*
//  GitHub Token: Fine-grained PAT, auf Verbrauch-Home beschraenkt, Actions: Read and write.*
const FUEL_CACHE_KEY='fuel-live92:global';
const FUEL_LOCK_KEY='fuel-live92:pending';
const FUEL_COOLDOWN=10*60*1000;
let liveFuelPromise=null; //  innerhalb einer Worker-Instanz parallele Anfragen bündeln*
async function fetchLiveFuel(req,env){
  if(!env.TANKERKOENIG_API_KEY)throw new Error('Tankerkönig-API-Key ist in Cloudflare noch nicht als Secret eingerichtet.');
  if(!env.PUSH_DEVICES)throw new Error('KV-Binding PUSH_DEVICES fehlt.');
  let input;try{input=await req.json();}catch(_){throw new Error('Ungültige Standortdaten.');}
  const lat=Number(input.lat),lng=Number(input.lng),rad=Number(input.radius||10);
  if(!Number.isFinite(lat)||lat< -90||lat>90||!Number.isFinite(lng)||lng< -180||lng>180||![5,10,15,25].includes(rad))throw new Error('Standort oder Umkreis ungültig.');
  const saved=await env.PUSH_DEVICES.get(FUEL_CACHE_KEY,'json');
  const now=Date.now();
  if(saved?.fetched_at&&now-Date.parse(saved.fetched_at)<FUEL_COOLDOWN){
    return {...saved,cached:true,next_allowed_at:new Date(Date.parse(saved.fetched_at)+FUEL_COOLDOWN).toISOString()};
  }
  if(liveFuelPromise)return liveFuelPromise;
  liveFuelPromise=(async()=>{
    //  Der KV-Cache ist geräteübergreifend. Bei parallelen Cold-Starts kann KV wegen*
    //  eventual consistency jedoch KEINE harte atomare Sperre gewährleisten.*
    const second=await env.PUSH_DEVICES.get(FUEL_CACHE_KEY,'json');
    if(second?.fetched_at&&Date.now()-Date.parse(second.fetched_at)<FUEL_COOLDOWN){
      return {...second,cached:true,next_allowed_at:new Date(Date.parse(second.fetched_at)+FUEL_COOLDOWN).toISOString()};
    }
    const wait=await env.PUSH_DEVICES.get(FUEL_LOCK_KEY,'json');
    if(wait?.time&&Date.now()-Date.parse(wait.time)<45000){
      //  Parallel begonnene Anfrage wartet kurz auf Daten aus dem laufenden Abruf.*
      for(let i=0;i<5;i++){
        await new Promise(resolve=>setTimeout(resolve,900));
        const pending=await env.PUSH_DEVICES.get(FUEL_CACHE_KEY,'json');
        if(pending?.fetched_at&&Date.now()-Date.parse(pending.fetched_at)<FUEL_COOLDOWN)return {...pending,cached:true,next_allowed_at:new Date(Date.parse(pending.fetched_at)+FUEL_COOLDOWN).toISOString()};
      }
      throw new Error('Preisabfrage läuft bereits. Bitte gleich erneut öffnen.');
    }
    await env.PUSH_DEVICES.put(FUEL_LOCK_KEY,JSON.stringify({time:new Date().toISOString()}),{expirationTtl:60});
    try{
      const url=new URL('https://creativecommons.tankerkoenig.de/json/list.php');
      url.searchParams.set('lat',String(lat));url.searchParams.set('lng',String(lng));url.searchParams.set('rad',String(rad));
      url.searchParams.set('type','all');url.searchParams.set('apikey',env.TANKERKOENIG_API_KEY);
      const response=await fetch(url.toString(),{headers:{Accept:'application/json','User-Agent':'VerbrauchZuhause/1.3.1.144'}});
      if(!response.ok)throw new Error('Tankerkönig HTTP '+response.status);
      const json=await response.json();if(!json.ok||!Array.isArray(json.stations))throw new Error(json.message||'Tankerkönig lieferte keine gültigen Preisdaten.');
      const timestamp=new Date().toISOString();
      const result={fetched_at:timestamp,origin:{label:'Standort beim letzten Abruf',lat:Math.round(lat*1000)/1000,lng:Math.round(lng*1000)/1000,rad},stations:json.stations,cached:false,next_allowed_at:new Date(Date.now()+FUEL_COOLDOWN).toISOString()};
      await env.PUSH_DEVICES.put(FUEL_CACHE_KEY,JSON.stringify(result));
      return result;
    }finally{await env.PUSH_DEVICES.delete(FUEL_LOCK_KEY);}
  })();
  try{return await liveFuelPromise;}finally{liveFuelPromise=null;}
}
// Wetterstationen v124: KV storage, device ingestion, thresholds and daily summary.*
const WEATHER_PREFIX='weather124:';
const WEATHER_DEFAULT_LAT=51.042840,WEATHER_DEFAULT_LON=7.819017;
// NOAA sunrise/sunset approximation; return UTC milliseconds for a Berlin calendar date.
function solarInstant(day,lat,lon,sunrise){
 const [y,m,d]=day.split('-').map(Number),base=Date.UTC(y,m-1,d),N=Math.floor((base-Date.UTC(y,0,0))/86400000);
 const lngHour=lon/15,t=N+((sunrise?6:18)-lngHour)/24,M=0.9856*t-3.289;
 const rad=Math.PI/180,sin=x=>Math.sin(x*rad),cos=x=>Math.cos(x*rad);
 let L=(M+1.916*sin(M)+0.020*sin(2*M)+282.634+360)%360;
 let RA=(Math.atan(0.91764*Math.tan(L*rad))/rad+360)%360;
 RA=(RA+Math.floor(L/90)*90-Math.floor(RA/90)*90)/15;
 const sinDec=0.39782*sin(L),cosDec=Math.cos(Math.asin(sinDec));
 const cosH=(cos(90.833)-sinDec*sin(lat))/(cosDec*cos(lat));
 if(cosH>1||cosH< -1)return null;
 const H=(sunrise?360-Math.acos(cosH)/rad:Math.acos(cosH)/rad)/15;
 const T=H+RA-(0.06571*t)-6.622;
 const UT=T-lngHour;
 return base+UT*3600000;
}
function berlinInstant(day,time){
 const [yy,mm,dd]=day.split('-').map(Number),[hh,mi]=time.split(':').map(Number);
 let candidate=Date.UTC(yy,mm-1,dd,hh,mi);
 for(let i=0;i<4;i++){
  const actual=berlinParts(new Date(candidate));
  const difference=(Date.parse(day+'T'+time+':00Z')-Date.parse(actual.day+'T'+actual.time+':00Z'))/60000;
  if(!difference)break;candidate+=difference*60000;
 }
 return candidate;
}
function dayBefore(day){const [y,m,d]=day.split('-').map(Number);return new Date(Date.UTC(y,m-1,d-1,12)).toISOString().slice(0,10);}

const weatherKey=(h,id)=>WEATHER_PREFIX+h+':'+id;
function weatherDefaults(x){return {id:x.id,name:x.name||x.id,enabled:x.enabled!==false,alerts:x.alerts!==false,morning:x.morning!==false,emoji:x.emoji||'🌡️',reportTime:x.reportTime||'07:00',dayStart:x.dayStart||'06:00',nightStart:x.nightStart||'18:00',latitude:x.latitude??WEATHER_DEFAULT_LAT,longitude:x.longitude??WEATHER_DEFAULT_LON,location:x.location==='outside'?'outside':'inside',reportMode:x.reportMode==='fixed'?'fixed':'sunrise',dayNightMode:x.dayNightMode==='solar'||x.dayNightMode==='fixed'?x.dayNightMode:(x.reportMode==='fixed'?'fixed':'solar'),reportRevision:Number.isSafeInteger(x.reportRevision)?x.reportRevision:0,tempMin:x.tempMin??0,tempMax:x.tempMax??35,humidityMin:x.humidityMin??20,humidityMax:x.humidityMax??80,lightMin:x.lightMin??0,lightMax:x.lightMax??100,offlineMinutes:x.offlineMinutes??30,latest:x.latest||null,tokenHash:x.tokenHash||'',created:x.created||new Date().toISOString()};}
async function weatherHash(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s))),x=>x.toString(16).padStart(2,'0')).join('');}
async function weatherStations(env,h){return (await env.PUSH_DEVICES.get(weatherKey(h,'stations'),'json'))||[];}
async function weatherSaveStations(env,h,rows){await env.PUSH_DEVICES.put(weatherKey(h,'stations'),JSON.stringify(rows));}
function weatherSafe(st){const {tokenHash,...out}=st;return out;}
async function weatherRoute(req,env,route,headers){
 if(!env.PUSH_DEVICES)return respond({error:'KV-Binding PUSH_DEVICES fehlt'},503,headers);
 let input;try{input=await req.json();}catch{return respond({error:'Ungültiges JSON'},400,headers);}
 const h=safePart(input.household),id=safePart(input.id,40);
 if(!h)return respond({error:'Haushalt fehlt'},400,headers);
 const auth=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
 const admin=await compareSecret(auth,env.PUSH_SECRET);
 if(route!=='/weather/ingest'&&!admin)return respond({error:'Push-Zugangscode erforderlich'},401,headers);
 let rows=await weatherStations(env,h);
 if(route==='/weather/list')return respond({stations:rows.map(weatherSafe)},200,headers);
 if(route==='/weather/latest')return respond({readings:rows.map(st=>({id:st.id,latest:st.latest||null}))},200,headers);
 if(route==='/weather/admin'){
  if(input.action==='add'){
   if(!id||rows.some(s=>s.id===id)||rows.length>=25||!safeString(input.name,70)||typeof input.token!=='string'||input.token.length<32)return respond({error:'Stationsdaten ungültig, ID belegt oder Maximum erreicht'},400,headers);
   rows.push(weatherDefaults({id,name:safeString(input.name,70),location:input.location==='outside'?'outside':'inside',tokenHash:await weatherHash(input.token)}));
  }else if(input.action==='update'){
   const i=rows.findIndex(s=>s.id===id);if(i<0)return respond({error:'Station nicht gefunden'},404,headers);
   const c=input.config||{};const st=rows[i];
   // A saved change of report scheduling opens one new send opportunity.
   // Other station settings must not cause duplicate weather reports.
   const previousSchedule=JSON.stringify([st.reportMode||'sunrise',st.reportTime||'07:00',st.dayStart||'06:00',st.nightStart||'18:00',st.dayNightMode||(st.reportMode==='fixed'?'fixed':'solar'),st.morning!==false]);
   if(typeof c.name==='string')st.name=safeString(c.name,70)||st.name;
   if(typeof c.emoji==='string'&&c.emoji.length<=16&&c.emoji.trim())st.emoji=c.emoji.trim();
   for(const k of ['reportTime','dayStart','nightStart'])if(c[k]!==undefined){
     if(typeof c[k]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(c[k]))return respond({error:'Ungültige Uhrzeit'},400,headers);
     st[k]=c[k];
   }
   if(c.location!==undefined){if(!['inside','outside'].includes(c.location))return respond({error:'Ungültiger Stationstyp'},400,headers);st.location=c.location;}
   if(c.reportMode!==undefined){if(!['sunrise','fixed'].includes(c.reportMode))return respond({error:'Ungültiger Berichtsmodus'},400,headers);st.reportMode=c.reportMode;}
   if(c.dayNightMode!==undefined){if(!['solar','fixed'].includes(c.dayNightMode))return respond({error:'Ungültiger Tag/Nacht-Modus'},400,headers);st.dayNightMode=c.dayNightMode;}
   for(const k of ['latitude','longitude'])if(Object.prototype.hasOwnProperty.call(c,k)){const v=c[k];if(v===null||v===''){st[k]=k==='latitude'?WEATHER_DEFAULT_LAT:WEATHER_DEFAULT_LON;}else{const n=Number(v);if(!Number.isFinite(n)||Math.abs(n)>(k==='latitude'?90:180))return respond({error:'Standortkoordinate ungültig'},400,headers);st[k]=n;}}
   for(const k of ['enabled','alerts','morning'])if(typeof c[k]==='boolean')st[k]=c[k];
   const nextSchedule=JSON.stringify([st.reportMode||'sunrise',st.reportTime||'07:00',st.dayStart||'06:00',st.nightStart||'18:00',st.dayNightMode||(st.reportMode==='fixed'?'fixed':'solar'),st.morning!==false]);
   if(nextSchedule!==previousSchedule)st.reportRevision=(Number.isSafeInteger(st.reportRevision)?st.reportRevision:0)+1;
   for(const k of ['tempMin','tempMax','humidityMin','humidityMax','lightMin','lightMax','offlineMinutes'])if(c[k]!==undefined){const n=Number(c[k]);if(!Number.isFinite(n)||n< -100||n>1440)return respond({error:'Grenzwert ungültig'},400,headers);st[k]=n;}
  }else if(input.action==='remove'){rows=rows.filter(s=>s.id!==id);}else return respond({error:'Unbekannte Aktion'},400,headers);
  await weatherSaveStations(env,h,rows);await syncWeatherAlarm(env,h);return respond({ok:true,stations:rows.map(weatherSafe)},200,headers);
 }
 if(route==='/weather/ingest'){
  const st=rows.find(s=>s.id===id&&s.enabled);if(!st||!auth||await weatherHash(auth)!==st.tokenHash)return respond({error:'Stationsschlüssel falsch oder Station deaktiviert'},401,headers);
  const temperatureC=Number(input.temperatureC),humidityPercent=Number(input.humidityPercent),brightnessPercent=Number(input.brightnessPercent);
  if(![temperatureC,humidityPercent,brightnessPercent].every(Number.isFinite)||temperatureC< -50||temperatureC>85||humidityPercent<0||humidityPercent>100||brightnessPercent<0||brightnessPercent>100)return respond({error:'Messwerte ungültig'},400,headers);
  const now=new Date(),at=now.toISOString();if(st.latest?.at&&Date.now()-Date.parse(st.latest.at)<9*60000)return respond({ok:true,duplicate:true},200,headers);
  const point={at,temperatureC,humidityPercent,brightnessPercent};
  // A separate key per sample avoids KV read/modify/write races; 10-minute cadence is enforced above.*
  await env.PUSH_DEVICES.put(weatherKey(h,'point:'+id+':'+at),JSON.stringify(point),{expirationTtl:366*86400});
  st.latest=point;await weatherSaveStations(env,h,rows);
  return respond({ok:true,at},200,headers);
 }
 if(route==='/weather/history'){
  const st=rows.find(s=>s.id===id);if(!st)return respond({error:'Station nicht gefunden'},404,headers);
  const hours=Math.min(8760,Math.max(1,Number(input.hours)||24)),cutoff=Date.now()-hours*3600000;
  let cursor,points=[],loops=0;do{const page=await env.PUSH_DEVICES.list({prefix:weatherKey(h,'point:'+id+':'),cursor,limit:1000});for(const k of page.keys){const at=k.name.split(':').slice(-3).join(':');if(Date.parse(at)>=cutoff){const p=await env.PUSH_DEVICES.get(k.name,'json');if(p)points.push(p);}}cursor=page.list_complete?null:page.cursor;loops++;}while(cursor&&loops<15);
  points.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));return respond({points,partial:!!cursor},200,headers);
 }
 return respond({error:'Unbekannter Wetter-Endpunkt'},404,headers);
}
async function weatherCron(env){
 const h=safePart(env.PUSH_HOUSEHOLD_ID);if(!h||!env.PUSH_DEVICES)return;
 const rows=await weatherStations(env,h),now=Date.now(),local=berlinParts(new Date());
 for(const st of rows.filter(x=>x.enabled)){
  const v=st.latest,age=v?.at?now-Date.parse(v.at):Infinity;
  const checks=[['tempMin','temperatureC','unter'],['tempMax','temperatureC','über'],['humidityMin','humidityPercent','unter'],['humidityMax','humidityPercent','über'],['lightMin','brightnessPercent','unter'],['lightMax','brightnessPercent','über']];
  if(st.alerts&&v&&age<25*60000){for(const [limit,field,side] of checks){const value=Number(v[field]),threshold=Number(st[limit]);if(!Number.isFinite(threshold))continue;const hit=side==='unter'?value<threshold:value>threshold;const key=weatherKey(h,'alert:'+st.id+':'+limit),old=await env.PUSH_DEVICES.get(key,'json');if(hit&&(!old||old.active===false)&&(!old||now-(old.changed||0)>15*60000)){await broadcastInternal(env,h,'🌡️ '+st.name+' · Grenzwert',field+': '+value+' '+side+' '+threshold);await env.PUSH_DEVICES.put(key,JSON.stringify({active:true,changed:now}));}else if(!hit&&old?.active&&Math.abs(value-threshold)>= (field==='temperatureC'?0.5:2)){await env.PUSH_DEVICES.put(key,JSON.stringify({active:false,changed:now}));}}}
  if(st.alerts&&age>Number(st.offlineMinutes||30)*60000){await sendEventOnce(env,h,'offline:'+st.id+':'+local.day,'📡 Wetterstation offline',st.name+': Seit mehr als '+(st.offlineMinutes||30)+' Minuten keine Messung.');}

 }
}


// Precise report execution is handled by a Durable Object alarm, not the 5-minute cron.
async function weatherSendReport(env,h,st){
 const now=Date.now(),local=berlinParts(new Date());
  if(st.morning){
   const yesterday=dayBefore(local.day);
   const lat=Number.isFinite(Number(st.latitude))?Number(st.latitude):WEATHER_DEFAULT_LAT;
   const lon=Number.isFinite(Number(st.longitude))?Number(st.longitude):WEATHER_DEFAULT_LON;
   const mode=st.reportMode||'sunrise';
   const todaySunrise=solarInstant(local.day,lat,lon,true);
   const due=mode==='sunrise'?todaySunrise:berlinInstant(local.day,st.reportTime||'07:00');
   const dayNightMode=st.dayNightMode||(mode==='fixed'?'fixed':'solar');
   const dayBegin=dayNightMode==='solar'?solarInstant(yesterday,lat,lon,true):berlinInstant(yesterday,st.dayStart||'06:00');
   const nightBegin=dayNightMode==='solar'?solarInstant(yesterday,lat,lon,false):berlinInstant(yesterday,st.nightStart||'18:00');
   const nightEnd=dayNightMode==='solar'?todaySunrise:berlinInstant(local.day,st.dayStart||'06:00');
   // Cheap due check: never list or read historical measurements before sunrise.
   if(due!==null&&dayBegin!==null&&nightBegin!==null&&nightEnd!==null&&
      now>=due&&now>=nightEnd&&dayBegin<nightBegin&&nightBegin<nightEnd){
     const eventId='morning:'+st.id+':'+local.day+':r'+(Number.isSafeInteger(st.reportRevision)?st.reportRevision:0);
     // Already sent? Avoid scanning historical KV keys on subsequent five-minute ticks.
     if(!(await env.PUSH_DEVICES.get(WATCH_PREFIX+'event:'+h+':'+eventId))){
       const prefix=weatherKey(h,'point:'+st.id+':');
       let cursor,dayVals=[],nightVals=[],loops=0;
       do{
         const page=await env.PUSH_DEVICES.list({prefix,cursor,limit:1000});
         for(const k of page.keys){
           const at=Date.parse(k.name.slice(prefix.length));
           if(at>=dayBegin&&at<nightEnd){
             const p=await env.PUSH_DEVICES.get(k.name,'json');
             const value=Number(p?.temperatureC);
             if(p&&Number.isFinite(value))(at<nightBegin?dayVals:nightVals).push(value);
           }
         }
         cursor=page.list_complete?null:page.cursor;loops++;
       }while(cursor&&loops<15);
       const range=vals=>vals.length?'Min '+Math.min(...vals).toFixed(1)+' °C · Max '+Math.max(...vals).toFixed(1)+' °C':'Keine Daten';
       const clock=ms=>berlinParts(new Date(ms)).time;
       await sendEventOnce(env,h,eventId,
         (st.emoji||'🌡️')+' '+st.name+' · Wetterbericht',
         '☀️ Tag ('+clock(dayBegin)+'–'+clock(nightBegin)+'): '+range(dayVals)+
         '\\n🌙 Nacht ('+clock(nightBegin)+'–'+clock(nightEnd)+'): '+range(nightVals)+
         (cursor?'\\n⚠️ Datenabfrage unvollständig':''));
     }
   }

 }
}
function nextWeatherReportTime(st,from=Date.now()){
 if(!st.enabled||!st.morning)return null;
 const lat=Number.isFinite(Number(st.latitude))?Number(st.latitude):WEATHER_DEFAULT_LAT;
 const lon=Number.isFinite(Number(st.longitude))?Number(st.longitude):WEATHER_DEFAULT_LON;
 let day=berlinParts(new Date(from)).day;
 for(let i=0;i<4;i++){
  const due=st.reportMode==='fixed'?berlinInstant(day,st.reportTime||'07:00'):solarInstant(day,lat,lon,true);
  const prev=dayBefore(day),mode=st.dayNightMode||(st.reportMode==='fixed'?'fixed':'solar');
  const end=mode==='solar'?solarInstant(day,lat,lon,true):berlinInstant(day,st.dayStart||'06:00');
  const at=due===null||end===null?null:Math.max(due,end);
  if(at!==null&&at>from+250)return at;
  day=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 }
 return null;
}
async function syncWeatherAlarm(env,h){
 if(!env.WEATHER_REPORT_ALARM)return;
 const stub=env.WEATHER_REPORT_ALARM.get(env.WEATHER_REPORT_ALARM.idFromName(h));
 const response=await stub.fetch('https://weather-alarm.internal/sync',{method:'POST',body:JSON.stringify({household:h})});
 if(!response.ok)throw Error('Wetteralarm konnte nicht synchronisiert werden: '+response.status);
}
export class WeatherReportAlarm {
 constructor(state,env){this.state=state;this.env=env;}
 async fetch(req){
  if(new URL(req.url).pathname!=='/sync'||req.method!=='POST')return new Response('Not found',{status:404});
  const {household}=await req.json();if(!safePart(household))return new Response('Invalid household',{status:400});
  await this.state.storage.put('household',household);
  await this.plan(household);
  return new Response('ok');
 }
 async plan(h){
  const rows=await weatherStations(this.env,h);
  const due=rows.map(st=>nextWeatherReportTime(st)).filter(t=>t!==null);
  const next=due.length?Math.min(...due):null;
  const current=await this.state.storage.getAlarm();
  if(next!==null&&current!==next)await this.state.storage.setAlarm(next);
  else if(next===null&&current!==null)await this.state.storage.deleteAlarm();
 }
 async alarm(){
  const h=await this.state.storage.get('household');if(!h)return;
  try{
   const now=Date.now(),rows=await weatherStations(this.env,h);
   for(const st of rows){
    if(!st.enabled||!st.morning)continue;
    const local=berlinParts(new Date(now));
    const lat=Number.isFinite(Number(st.latitude))?Number(st.latitude):WEATHER_DEFAULT_LAT;
    const lon=Number.isFinite(Number(st.longitude))?Number(st.longitude):WEATHER_DEFAULT_LON;
    const due=st.reportMode==='fixed'?berlinInstant(local.day,st.reportTime||'07:00'):solarInstant(local.day,lat,lon,true);
    const end=st.dayNightMode==='solar'?solarInstant(local.day,lat,lon,true):berlinInstant(local.day,st.dayStart||'06:00');
    if(due!==null&&end!==null&&now>=Math.max(due,end)&&now-Math.max(due,end)<15*60000){
     try{await weatherSendReport(this.env,h,st);console.log('Wetteralarm verarbeitet:',st.id,local.day,st.reportTime);}
     catch(error){console.error('Wetteralarm Versandfehler:',st.id,String(error));throw error;}
    }
   }
  }catch(error){console.error('Wetteralarm Fehler:',String(error));throw error;}
  finally{await this.plan(h);}
 }
}

// Drei tägliche Aktualisierungen in Europe/Berlin; der vorhandene 5-Minuten-Cron reicht aus.
async function forecastCron(env){
 if(!env.PUSH_DEVICES)return;
 const local=berlinParts(new Date());
 const slot=['06:00','12:00','18:00'].filter(t=>local.time>=t).pop();
 if(!slot)return;
 const stamp=local.day+'-'+slot;
 const doneKey='forecast:slot:'+stamp;
 if(await env.PUSH_DEVICES.get(doneKey))return;
 await fetchAndCacheForecast(env,slot);
 await env.PUSH_DEVICES.put(doneKey,'1',{expirationTtl:3*86400});
}

// Only request Open-Meteo when no cache exists or one of the three daily slots is due.
async function fetchAndCacheForecast(env,slot){
 const url=new URL('https://api.open-meteo.com/v1/forecast');
 url.search=new URLSearchParams({
  latitude:'51.042840',longitude:'7.819017',timezone:'Europe/Berlin',
  forecast_days:'4',past_days:'1',
  current:'temperature_2m,relative_humidity_2m,weather_code',
  hourly:'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m',
  daily:'sunrise,sunset,temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum,precipitation_probability_max,wind_speed_10m_max'
 }).toString();
 const response=await fetch(url.toString(),{headers:{'Accept':'application/json'}});
 if(!response.ok)throw new Error('Open-Meteo '+response.status);
 const data=await response.json();
 if(!Array.isArray(data.hourly?.time)||!Array.isArray(data.daily?.time))throw new Error('Unvollständige Vorhersage');
 const result={updatedAt:new Date().toISOString(),slot,latitude:51.042840,longitude:7.819017,data};
 await env.PUSH_DEVICES.put('forecast:default:v1',JSON.stringify(result));
 return result;
}

// v136: Trigger GitHub fuel-price workflow from the existing 5-minute Cloudflare cron.
// Scheduled slots are local Europe/Berlin: 00:15,04:15,08:15,11:45,12:15,16:15,20:15.
// Only dispatch GitHub Actions; Python fetch + JSON history remain in GitHub.
const FUEL_AVERAGE_SLOTS=['00:15','04:15','08:15','11:45','12:15','16:15','20:15'];
async function fuelAverageDispatchCron(env){
  if(!env.PUSH_DEVICES)return;
  const local=berlinParts(new Date());
  const nowMinutes=minuteOf(local.time);
  // Five-minute grace window. Cloudflare can run slightly late.
  const slot=FUEL_AVERAGE_SLOTS.find(time=>nowMinutes>=minuteOf(time)&&nowMinutes<minuteOf(time)+10);
  if(!slot)return;
  const token=env.GITHUB_WORKFLOW_TOKEN;
  if(!token){console.error('Fuel Dispatch: GITHUB_WORKFLOW_TOKEN fehlt');return;}
  const repo=String(env.GITHUB_FUEL_REPOSITORY||'simonkreis6289-web/Verbrauch-Home');
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw Error('GITHUB_FUEL_REPOSITORY ungültig');
  const stamp=local.day+':'+slot;
  const key='fuel-average-dispatch:v1:'+stamp;
  if(await env.PUSH_DEVICES.get(key))return;
  const url='https://api.github.com/repos/'+repo+'/actions/workflows/update_fuel_average.yml/dispatches';
  const response=await fetch(url,{
    method:'POST',headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28','User-Agent':'Verbrauch-Zuhause-Cloudflare'},
    body:JSON.stringify({ref:'main'})
  });
  if(response.status!==204){
    const message=(await response.text()).slice(0,500);
    throw Error('GitHub Workflow Dispatch '+response.status+': '+message);
  }
  // Write success marker only after GitHub accepts the dispatch.
  await env.PUSH_DEVICES.put(key,new Date().toISOString(),{expirationTtl:4*86400});
  console.log('Fuel GitHub workflow triggered for '+stamp);
}
