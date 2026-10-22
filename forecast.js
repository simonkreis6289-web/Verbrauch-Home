/* Verbrauch Zuhause v131 – Forecast and display preferences */
(()=>{'use strict';
const API='https://verbrauch-push.simonkreis6289.workers.dev';
const defs=[
 ['forecast','🌤️ Wettervorhersage'],['stations','🌡️ Wetterstationen'],
 ['energy','🔥 Energiepreise'],['fuel','⛽ Spritpreise'],['cost','💰 Kostenblick'],
 ['pellet','🪵 Heizkostenvergleich'],['monthlyChart','📊 Monatsvergleich'],['monthlyOverview','📅 Monatsübersicht']
];
const KEY='verbrauch-display-v131';
let prefs={};try{prefs=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch(_){}
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','&quot;':'&quot;',"'":'&#39;'}[c]));
function apply(){
 document.querySelectorAll('[data-display-key]').forEach(el=>{
  const show=prefs[el.dataset.displayKey]!==false;
  // The weather station widget manages its own hidden state, never force-show it.
  if(el.dataset.displayKey==='stations'){
   if(!show)el.style.setProperty('display','none');else el.style.removeProperty('display');
  }else el.hidden=!show;
 });
}
function settings(){
 const el=$('displayOptions');if(!el)return;
 el.innerHTML=defs.map(([id,name])=>`<label><input type="checkbox" data-option="${id}" ${prefs[id]===false?'':'checked'}><span>${esc(name)}</span></label>`).join('');
 el.addEventListener('change',e=>{if(!e.target.matches('[data-option]'))return;prefs[e.target.dataset.option]=e.target.checked;localStorage.setItem(KEY,JSON.stringify(prefs));apply();});
 $('displayReset')?.addEventListener('click',()=>{prefs={};localStorage.removeItem(KEY);settingsRefresh();apply();});
}
function settingsRefresh(){const el=$('displayOptions');if(!el)return;el.querySelectorAll('[data-option]').forEach(x=>x.checked=prefs[x.dataset.option]!==false);}
const fmtTime=s=>s?String(s).slice(11,16):'–';
const codeIcon=c=>c===0?'☀️':c<=2?'🌤️':c===3?'☁️':c<=48?'🌫️':c<=57?'🌦️':c<=67?'🌧️':c<=77?'🌨️':c<=82?'🌦️':c<=86?'❄️':c<=99?'⛈️':'🌡️';
const moon=()=>{const age=((Date.now()/86400000+2440587.5-2451550.1)/29.530588853%1+1)%1;return ['🌑 Neumond','🌒 Zunehmende Sichel','🌓 Erstes Viertel','🌔 Zunehmender Mond','🌕 Vollmond','🌖 Abnehmender Mond','🌗 Letztes Viertel','🌘 Abnehmende Sichel'][Math.round(age*8)%8];};
const dateLabel=s=>new Date(s+'T12:00:00').toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit'});
function draw(record){
 const d=record.data,day=d.daily,hour=d.hourly;
 const now=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Berlin'});
 const idx=day.time.indexOf(now);
 const start=idx>=0?idx:0;
 $('forecastUpdated').textContent='Zuletzt aktualisiert: '+new Date(record.updatedAt).toLocaleString('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' Uhr';
 $('forecastBody').innerHTML=day.time.slice(start,start+4).map((date,i)=>{
  const j=start+i;
  return `<div class="forecast-day"><small>${i===0?'Heute':dateLabel(date)}</small><span class="forecast-icon">${codeIcon(day.weather_code[j])}</span><strong>${Math.round(day.temperature_2m_max[j])}°</strong> <span class="low">${Math.round(day.temperature_2m_min[j])}°</span><div class="forecast-day-detail">☔ ${Math.round(day.precipitation_probability_max?.[j]??0)} % · ${Number(day.precipitation_sum?.[j]??0).toFixed(1)} mm</div><div class="forecast-day-detail">💨 ${Math.round(day.wind_speed_10m_max?.[j]??0)} km/h</div></div>`;
 }).join('');
 $('forecastAstro').innerHTML=`<div>🌅 Sonnenaufgang<strong>${fmtTime(day.sunrise[start])} Uhr</strong></div><div>🌇 Sonnenuntergang<strong>${fmtTime(day.sunset[start])} Uhr</strong></div><div>${moon().split(' ')[0]} Mondphase<strong>${moon().split(' ').slice(1).join(' ')}</strong></div>`;
 const current=new Date().toLocaleString('sv-SE',{timeZone:'Europe/Berlin'}).replace(' ','T').slice(0,13);
 const first=hour.time.findIndex(x=>x.slice(0,13)>=current);
 const offset=first<0?0:first;
 const entries=hour.time.slice(offset,offset+48).map((date,i)=>({date,j:offset+i})).filter((entry,i)=>i%2===0);
 const groups=new Map();
 for(const entry of entries){const date=entry.date.slice(0,10);if(!groups.has(date))groups.set(date,[]);groups.get(date).push(entry);}
 const n=v=>Number.isFinite(Number(v))?Math.round(Number(v)):null;
 $('forecastHours').innerHTML=[...groups].map(([date,entries])=>`<section class="forecast-hour-group"><h4>${esc(dateLabel(date))}</h4><div class="forecast-hour-grid">${entries.map(({date,j})=>{
   const t=n(hour.temperature_2m[j]),rain=n(hour.precipitation_probability?.[j]);
   const mm=n(hour.precipitation?.[j]),wind=n(hour.wind_speed_10m?.[j]);
   return `<div class="forecast-hour-item"><strong class="forecast-hour-time">${esc(date.slice(11,16))} Uhr</strong><span class="forecast-hour-weather">${codeIcon(hour.weather_code[j])} ${t===null?'–':t+' °C'}</span><span class="forecast-hour-rain">☔ ${rain===null?'–':rain+' %'}${mm===null?'':' · '+mm+' mm'}</span>${wind===null?'':`<span class="forecast-hour-wind">💨 ${wind} km/h</span>`}</div>`;
  }).join('')}</div></section>`).join('');
}
async function load(){
 const body=$('forecastBody');if(!body)return;
 try{
  const r=await fetch(API+'/forecast',{cache:'no-store'});
  const j=await r.json();
  if(!r.ok||!j.data)throw Error(j.error||'Vorhersage derzeit nicht verfügbar');
  draw(j);
 }catch(e){body.innerHTML='<p class="muted">Wettervorhersage noch nicht verfügbar. '+esc(e.message)+'</p>';$('forecastUpdated').textContent='Nächste Aktualisierung: 06:00, 12:00 oder 18:00 Uhr';}
}
document.addEventListener('DOMContentLoaded',()=>{settings();apply();void load();});
})();
