/* Verbrauch Zuhause v124 – Wetterstationen. Keine Bosch-Schnittstelle. */
(()=>{'use strict';
const API='https://verbrauch-push.simonkreis6289.workers.dev';
let stations=[],history=[],selected='',period='24',metric='temperatureC',rotateTimer=null,loadTimer=null;
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const household=()=>localStorage.getItem('verbrauch-household-id-v1')||'zuhause-haupt';
const STORED_KEY='verbrauch-weather-admin-key-device-v1';
const key=()=>sessionStorage.getItem('weatherAdminKey')||localStorage.getItem(STORED_KEY)||'';
let refreshing=null;
const fmt=(n,d=1)=>Number.isFinite(Number(n))?Number(n).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}):'–';
const date=t=>t?new Date(t).toLocaleString('de-DE'):'noch nie';
async function request(route,payload={},admin=true){const headers={'Content-Type':'application/json'};if(admin){if(!key())throw Error('Bitte in Einstellungen → Wetterstationen den Push-Zugangscode eingeben.');headers.Authorization='Bearer '+key();}const r=await fetch(API+route,{method:'POST',headers,body:JSON.stringify({household:household(),...payload})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Serverfehler '+r.status);return j;}
function showError(msg){const el=$('weatherMessage');if(el)el.textContent=msg;}
function selectedStation(){return stations.find(x=>x.id===selected)||stations[0];}
function latest(st){return st?.latest||{};}
function renderOverview(){const el=$('weatherOverview');if(!el)return;const active=stations.filter(s=>s.enabled);if(!active.length){el.hidden=true;return;}el.hidden=false;const st=active.find(s=>s.id===selected)||active[0];selected=st.id;const v=latest(st);const age=v.at?Date.now()-Date.parse(v.at):Infinity;el.innerHTML=`<div class="weather-row" style="justify-content:space-between"><strong>🌤️ Wetterstationen</strong><span class="weather-muted">${age<25*60000?'🟢 Online':'⚪ Keine aktuellen Daten'}</span></div><div class="weather-row">${active.map(x=>`<button type="button" data-wselect="${esc(x.id)}" class="${x.id===selected?'selected':''}">${esc(x.emoji||'🌡️')} ${esc(x.name)}</button>`).join('')}</div><div class="weather-kpis"><div>🌡️<strong>${fmt(v.temperatureC)} °C</strong><span class="weather-muted">Temperatur</span></div><div>💧<strong>${fmt(v.humidityPercent,0)} %</strong><span class="weather-muted">Luftfeuchte</span></div><div>☀️<strong>${fmt(v.brightnessPercent,0)} %</strong><span class="weather-muted">Helligkeit</span></div></div><p class="weather-muted" style="margin:9px 0 0">Letzte Messung: ${esc(date(v.at))}</p>`;el.querySelectorAll('[data-wselect]').forEach(b=>b.onclick=()=>{selected=b.dataset.wselect;renderOverview();});}
function rotate(){const active=stations.filter(s=>s.enabled);if(active.length>1){const i=active.findIndex(s=>s.id===selected);selected=active[(i+1)%active.length].id;renderOverview();}}
function renderSettings(){const el=$('weatherSettings');if(!el)return;el.innerHTML=`<div class="weather-config"><label>Push-Zugangscode<input type="password" id="weatherSecret" placeholder="Cloudflare PUSH_SECRET" autocomplete="off" value="${esc(key())}"></label><label class="weather-remember"><input type="checkbox" id="weatherRemember" ${localStorage.getItem(STORED_KEY)?'checked':''}> Zugangscode auf diesem Gerät merken (nicht auf fremden Geräten)</label><label>&nbsp;<button type="button" class="btn secondary" id="weatherLogin">🔄 Stationen laden</button></label></div><p class="weather-muted" id="weatherMessage">Die Stationen werden zentral im Cloudflare-Worker verwaltet.</p><form id="weatherAddForm"><h3>Neue Station hinzufügen</h3><div class="weather-config"><label>Stations-ID<input name="id" pattern="[A-Za-z0-9_-]+" maxlength="40" placeholder="WS-01" required></label><label>Name<input name="name" maxlength="70" placeholder="Garten" required></label><label>Standort<select name="location"><option value="inside">🏠 Innenstation</option><option value="outside">🌳 Außenstation</option></select></label></div><button class="btn primary" type="submit">➕ Station anlegen</button></form><div id="weatherStationSettings"></div>`;
$('weatherLogin').onclick=()=>{const value=$('weatherSecret').value.trim();sessionStorage.setItem('weatherAdminKey',value);if($('weatherRemember')?.checked)localStorage.setItem(STORED_KEY,value);else localStorage.removeItem(STORED_KEY);void refresh();};
$('weatherAddForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const token=Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');await request('/weather/admin',{action:'add',id:String(f.get('id')).trim(),name:String(f.get('name')).trim(),location:String(f.get('location')||'inside'),token});alert('Einmaliger Stationsschlüssel für den ESP8266 (sicher aufbewahren):\n\n'+token+'\n\nEr wird aus Sicherheitsgründen nicht wieder angezeigt.');e.target.reset();await refresh();}catch(err){showError(err.message);}};renderStationSettings();}
const WEATHER_DEFAULT_LAT=51.042840,WEATHER_DEFAULT_LON=7.819017;
const WEATHER_EMOJIS=['🌡️','🏠','🛋️','🛏️','🍳','🛁','🌳','🌻','🏡','🌦️','☀️','❄️','🏭','🚗','📡','🌍'];
function renderStationSettings(){
 const el=$('weatherStationSettings');if(!el)return;
 const openIds=new Set([...el.querySelectorAll('details[open]')].map(x=>x.dataset.station));
 const field=(s,label,k,type='number',step='1')=>`<label>${label}<input data-field="${k}" data-id="${esc(s.id)}" type="${type}" ${type==='number'?`step="${step}"`:''} value="${esc(s[k]??'')}"></label>`;
 const slider=(s,label,k,min,max,step=1,unit='')=>{const v=Number.isFinite(Number(s[k]))?Number(s[k]):min;return `<div class="weather-range-field"><label for="range-${esc(s.id)}-${k}">${label}</label><div class="weather-range-row"><input id="range-${esc(s.id)}-${k}" type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-range="${k}"><input type="number" aria-label="${label}" data-field="${k}" min="${min}" max="${max}" step="${step}" value="${v}"><span>${unit}</span></div><div class="weather-range-limits"><span>${min} ${unit}</span><span>${max} ${unit}</span></div></div>`;};
 const toggle=(s,label,k)=>`<label>${label}<select data-field="${k}" data-id="${esc(s.id)}"><option value="true" ${s[k]!==false?'selected':''}>Ein</option><option value="false" ${s[k]===false?'selected':''}>Aus</option></select></label>`;
 el.innerHTML=stations.map(s=>`<details class="weather-station-card" data-station="${esc(s.id)}" ${openIds.has(s.id)?"open":""}><summary><span class="weather-station-emoji">${esc(s.emoji||'🌡️')}</span><span><strong>${esc(s.name)}</strong><small>${esc(s.id)} · ${s.enabled?'Aktiv':'Inaktiv'} · Letzte Messung: ${esc(date(s.latest?.at))}</small></span><span class="weather-station-chevron">⌄</span></summary><div class="weather-station-body">
 <div class="weather-config"><label>Stationsname<input data-field="name" data-id="${esc(s.id)}" value="${esc(s.name)}"></label>${toggle(s,'Station aktiv','enabled')}<label>Standort<select data-field="location"><option value="inside" ${(s.location||'inside')==='inside'?'selected':''}>🏠 Innenstation</option><option value="outside" ${s.location==='outside'?'selected':''}>🌳 Außenstation</option></select></label></div>
 <h4>🎨 Symbol der Station</h4><div class="weather-emoji-picker">${WEATHER_EMOJIS.map(e=>`<label title="${e}"><input type="radio" name="emoji-${esc(s.id)}" data-emoji="${esc(s.id)}" value="${e}" ${(s.emoji||'🌡️')===e?'checked':''}><span>${e}</span></label>`).join('')}</div>
 <h4>🔔 Wetterbericht</h4><div class="weather-config"><label>Bericht auslösen<select data-field="reportMode"><option value="sunrise" ${(s.reportMode||'sunrise')==='sunrise'?'selected':''}>🌅 Bei Sonnenaufgang (automatisch)</option><option value="fixed" ${s.reportMode==='fixed'?'selected':''}>🕒 Feste Uhrzeit</option></select></label>${toggle(s,'Morgendlichen Bericht senden','morning')}${field({...s,reportTime:s.reportTime||'07:00'},'Push-Uhrzeit (nur bei fester Zeit)','reportTime','time')}</div>
 <div class="weather-solar-choice"><label><input type="checkbox" data-field="dayNightSolar" ${(s.dayNightMode||(s.reportMode==='fixed'?'fixed':'solar'))==='solar'?'checked':''}> 🌅 Tag/Nacht dynamisch nach Sonnenaufgang und Sonnenuntergang</label><p class="weather-muted">Ohne Häkchen gelten die eigenen Uhrzeiten. Mit Häkchen werden die Sonnenzeiten täglich anhand des Stationsstandorts berechnet.</p></div>
 <div class="weather-config weather-day-times">${field({...s,dayStart:s.dayStart||'06:00'},'Tag beginnt','dayStart','time')}${field({...s,nightStart:s.nightStart||'18:00'},'Nacht beginnt','nightStart','time')}</div>

 <div class="weather-day-preview" data-day-preview><div class="weather-day-heading">🌗 Tagesverlauf · <span data-day-date></span></div><div class="weather-day-bar" data-day-bar></div><div class="weather-day-ticks"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div><p class="weather-muted" data-day-description></p><p class="weather-muted" data-solar-description>☀️ Sonnenzeiten: Standort eintragen</p></div>
 <div class="weather-config"><label>Breitengrad (optional, z. B. 51.1)<input type="number" data-field="latitude" min="-90" max="90" step="0.0001" placeholder="Breitengrad" value="${esc(s.latitude??WEATHER_DEFAULT_LAT)}"></label><label>Längengrad (optional, z. B. 8.1)<input type="number" data-field="longitude" min="-180" max="180" step="0.0001" placeholder="Längengrad" value="${esc(s.longitude??WEATHER_DEFAULT_LON)}"></label></div><div class="weather-row"><button type="button" class="btn secondary" data-gps>📍 GPS-Position übernehmen</button><span class="weather-muted" data-gps-status aria-live="polite">Standort wird erst nach deiner Zustimmung abgefragt.</span></div>
 <h4>⚠️ Grenzwerte und Ausfall</h4><div class="weather-config">${toggle(s,'Grenzwertwarnungen','alerts')}${slider(s,'Temperatur unter','tempMin',-30,50,0.5,'°C')}${slider(s,'Temperatur über','tempMax',-30,50,0.5,'°C')}${slider(s,'Luftfeuchte unter','humidityMin',0,100,1,'%')}${slider(s,'Luftfeuchte über','humidityMax',0,100,1,'%')}${slider(s,'Helligkeit unter','lightMin',0,100,1,'%')}${slider(s,'Helligkeit über','lightMax',0,100,1,'%')}${slider(s,'Ausfallwarnung nach','offlineMinutes',10,240,5,'Min.')}</div>
 <div class="weather-row"><button class="btn primary" type="button" data-save="${esc(s.id)}">💾 Speichern</button><button class="btn ghost" type="button" data-remove="${esc(s.id)}">Entfernen</button></div></div></details>`).join('');
 el.querySelectorAll('.weather-station-card').forEach(card=>{
   card.querySelectorAll('[data-range]').forEach(range=>{
     const number=card.querySelector(`[data-field="${range.dataset.range}"]`);
     range.addEventListener('input',()=>{number.value=range.value;});
     number.addEventListener('input',()=>{if(number.value!==''&&Number.isFinite(number.valueAsNumber))range.value=number.value;});
   });
   const updateTimeline=()=>{
     const day=(card.querySelector('[data-field="dayNightSolar"]')?.checked?card._solarTimes?.sunrise:null)||card.querySelector('[data-field="dayStart"]').value||'06:00',night=(card.querySelector('[data-field="dayNightSolar"]')?.checked?card._solarTimes?.sunset:null)||card.querySelector('[data-field="nightStart"]').value||'18:00';
     const mins=t=>{const [h,m]=t.split(':').map(Number);return h*60+m;};
     const d=mins(day),n=mins(night),bar=card.querySelector('[data-day-bar]');
     bar.innerHTML=d<n?`<div class="weather-night" style="width:${d/1440*100}%"></div><div class="weather-day" style="width:${(n-d)/1440*100}%"></div><div class="weather-night" style="width:${(1440-n)/1440*100}%"></div>`:'<div class="weather-night" style="width:100%"></div>';
     card.querySelector('[data-day-description]').textContent=`🌙 00:00–${day}  ·  ☀️ ${day}–${night}  ·  🌙 ${night}–24:00`;
   };
   card.querySelectorAll('[data-field="dayStart"],[data-field="nightStart"]').forEach(el=>el.addEventListener('input',updateTimeline));
   updateTimeline();
   const today=new Date();card.querySelector('[data-day-date]').textContent=today.toLocaleDateString('de-DE',{day:'2-digit',month:'long',year:'numeric',timeZone:'Europe/Berlin'});
   const solar=card.querySelector('[data-solar-description]');
   const solarCheck=card.querySelector('[data-field="dayNightSolar"]');
   let solarTimes=null;
   const syncDayNight=()=>{
     const automatic=solarCheck.checked;
     card.querySelectorAll('[data-field="dayStart"],[data-field="nightStart"]').forEach(el=>el.disabled=automatic);
     card.querySelector('.weather-day-times').classList.toggle('weather-times-inactive',automatic);
     updateTimeline();
   };
   solarCheck.addEventListener('change',syncDayNight);
   syncDayNight();
   const latitude=card.querySelector('[data-field="latitude"]'),longitude=card.querySelector('[data-field="longitude"]');
   const moon=()=>{const jd=today.getTime()/86400000+2440587.5,age=((jd-2451550.1)/29.530588853%1+1)%1;const phases=['🌑 Neumond','🌒 Zunehmende Sichel','🌓 Erstes Viertel','🌔 Zunehmender Mond','🌕 Vollmond','🌖 Abnehmender Mond','🌗 Letztes Viertel','🌘 Abnehmende Sichel'];return phases[Math.round(age*8)%8]+' (Näherung)';};
   const showSolar=async()=>{
     solarTimes=null;card._solarTimes=null;
     const lat=Number(latitude.value),lon=Number(longitude.value);if(latitude.value===''||longitude.value===''||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180){solar.textContent='☀️ Sonnenzeiten: Standort eintragen · '+moon();updateTimeline();return;}
     solar.textContent='☀️ Sonnenzeiten werden geladen … · '+moon();
     try{const ymd=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(today);const url=`https://api.sunrise-sunset.org/json?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lon)}&date=${ymd}&formatted=0`;const response=await fetch(url);if(!response.ok)throw Error('HTTP '+response.status);const json=await response.json();if(json.status!=='OK')throw Error('Keine Sonnenzeiten');const fmtTime=v=>new Date(v).toLocaleTimeString('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
       const sunrise=fmtTime(json.results.sunrise),sunset=fmtTime(json.results.sunset);
       if(!/^\d{2}:\d{2}$/.test(sunrise)||!/^\d{2}:\d{2}$/.test(sunset)||sunrise>=sunset)throw Error('Ungültige Sonnenzeiten');
       solarTimes={sunrise,sunset};card._solarTimes=solarTimes;updateTimeline();
       solar.textContent=`🌅 Sonnenaufgang ${sunrise} · 🌇 Sonnenuntergang ${sunset} · ${moon()}`;
     }catch(_){solar.textContent='Sonnenzeiten derzeit nicht verfügbar · '+moon();updateTimeline();}
   };
   latitude.addEventListener('change',showSolar);longitude.addEventListener('change',showSolar);void showSolar();
   const gpsButton=card.querySelector('[data-gps]'),gpsStatus=card.querySelector('[data-gps-status]');
   gpsButton.addEventListener('click',()=>{
     if(!navigator.geolocation){gpsStatus.textContent='GPS-Standort wird von diesem Browser nicht unterstützt.';return;}
     gpsButton.disabled=true;gpsStatus.textContent='Standort wird abgefragt …';
     navigator.geolocation.getCurrentPosition(pos=>{
       latitude.value=pos.coords.latitude.toFixed(6);
       longitude.value=pos.coords.longitude.toFixed(6);
       card.dataset.unsaved='true';
       gpsStatus.textContent='📍 Position übernommen (Genauigkeit ca. '+Math.round(pos.coords.accuracy)+' m). Bitte Speichern drücken.';
       gpsButton.disabled=false;void showSolar();
     },err=>{
       gpsStatus.textContent=err.code===1?'Standortfreigabe verweigert. Bitte Browser-Berechtigung prüfen.':err.code===2?'Standort konnte nicht ermittelt werden.':'Standortabfrage hat zu lange gedauert.';
       gpsButton.disabled=false;
     },{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
   });
 });
 el.querySelectorAll('.weather-station-card').forEach(card=>{const mark=()=>{card.dataset.unsaved='true';};card.addEventListener('input',mark);card.addEventListener('change',mark);});
 el.querySelectorAll('[data-save]').forEach(b=>b.onclick=async()=>{
   const id=b.dataset.save,card=b.closest('details'),config={};
   card.querySelectorAll('[data-field]').forEach(x=>{const k=x.dataset.field;config[k]=k==='dayNightSolar'?(x.checked?'solar':'fixed'):['enabled','alerts','morning'].includes(k)?x.value==='true':['name','reportTime','dayStart','nightStart','location','reportMode'].includes(k)?x.value:Number(x.value);});
   for(const k of ['latitude','longitude']){const el=card.querySelector(`[data-field="${k}"]`);config[k]=el.value===''?(k==='latitude'?WEATHER_DEFAULT_LAT:WEATHER_DEFAULT_LON):Number(el.value);}
   config.dayNightMode=config.dayNightSolar;delete config.dayNightSolar;
   config.emoji=card.querySelector('[data-emoji]:checked')?.value||'🌡️';
   if(['tempMin','humidityMin','lightMin'].some(k=>config[k]>=config[({tempMin:'tempMax',humidityMin:'humidityMax',lightMin:'lightMax'})[k]])){showError('Unterer Grenzwert muss kleiner als oberer Grenzwert sein.');return;}
   if(config.dayStart>=config.nightStart){showError('Der Tagesbeginn muss vor dem Nachtbeginn liegen.');return;}
   try{b.disabled=true;const response=await request('/weather/admin',{action:'update',id,config});const saved=(response.stations||[]).find(st=>st.id===id);if(!saved||saved.reportMode!==config.reportMode||saved.reportTime!==config.reportTime||saved.dayNightMode!==config.dayNightMode)throw Error('Server hat Berichtsmodus/Uhrzeit nicht wie gewünscht übernommen.');card.dataset.unsaved='false';await refresh();showError('✓ Gespeichert: '+(saved.reportMode==='fixed'?'Feste Uhrzeit '+saved.reportTime:'Bei Sonnenaufgang')+'.');}catch(e){showError('Speichern fehlgeschlagen: '+e.message);}finally{b.disabled=false;}
 });
 el.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{if(!confirm('Station '+b.dataset.remove+' wirklich entfernen? Die Historie bleibt zunächst erhalten.'))return;try{await request('/weather/admin',{action:'remove',id:b.dataset.remove});await refresh();}catch(e){showError(e.message);}});
}
function graph(data){const vals=data.map(p=>Number(p[metric])).filter(Number.isFinite);if(!vals.length)return '<p class="muted">Für diesen Zeitraum liegen noch keine Messwerte vor.</p>';const lo=Math.min(...vals),hi=Math.max(...vals),span=Math.max(hi-lo,.5);const w=720,h=240;const path=data.map((p,i)=>{const n=Number(p[metric]);if(!Number.isFinite(n))return '';const x=38+i/Math.max(data.length-1,1)*665,y=205-(n-lo)/span*166;return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;}).join(' ');return `<svg class="weather-plot" viewBox="0 0 ${w} ${h}" role="img" aria-label="Messwertverlauf"><path d="M38 20V205H703" stroke="currentColor" opacity=".35" fill="none"/><path d="${path}" fill="none" stroke="#0891b2" stroke-width="2.5"/><text x="5" y="23" font-size="13" fill="currentColor">${fmt(hi)}</text><text x="5" y="205" font-size="13" fill="currentColor">${fmt(lo)}</text><text x="38" y="230" font-size="12" fill="currentColor">${esc(new Date(data[0].at).toLocaleString('de-DE'))}</text><text x="703" y="230" font-size="12" text-anchor="end" fill="currentColor">${esc(new Date(data[data.length-1].at).toLocaleString('de-DE'))}</text></svg><p class="weather-muted">Min: ${fmt(lo)} · Max: ${fmt(hi)} · Ø ${fmt(vals.reduce((a,b)=>a+b,0)/vals.length)} · ${vals.length} Messungen</p>`;}
function weatherDateTimeLocal(date){const d=new Date(date),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;}
let customStart=weatherDateTimeLocal(Date.now()-24*3600000),customEnd=weatherDateTimeLocal(Date.now());
let historyLoadSerial=0;
async function renderHistory(){
 const el=$('weatherHistory');if(!el)return;
 if(!stations.length){el.innerHTML='<p class="muted">Noch keine Station eingerichtet. Unter Einstellungen → Wetterstationen hinzufügen.</p>';return;}
 const st=selectedStation();if(!st)return;selected=st.id;
 const custom=period==='custom';
 el.innerHTML=`<div class="weather-config"><label>Station<select id="weatherChartStation">${stations.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.emoji||'🌡️')} ${esc(x.name)}</option>`).join('')}</select></label><label>Messwert<select id="weatherChartMetric"><option value="temperatureC">Temperatur (°C)</option><option value="humidityPercent">Luftfeuchtigkeit (%)</option><option value="brightnessPercent">Helligkeit (%)</option></select></label><label>Zeitraum<select id="weatherChartPeriod"><option value="24">24 Stunden</option><option value="168">7 Tage</option><option value="720">30 Tage</option><option value="8760">1 Jahr</option><option value="custom">Eigener Zeitraum</option></select></label></div><div id="weatherCustomRange" class="weather-config" ${custom?'':'hidden'} style="margin:12px 0"><label>Von<input id="weatherCustomFrom" type="datetime-local" value="${esc(customStart)}"></label><label>Bis<input id="weatherCustomTo" type="datetime-local" value="${esc(customEnd)}"></label><label><span>&nbsp;</span><button type="button" class="btn secondary" id="weatherCustomApply">Zeitraum anzeigen</button></label></div><p id="weatherRangeInfo" class="weather-muted" style="margin:8px 0"></p><div id="weatherChart">Lade Messwerte …</div>`;
 $('weatherChartMetric').value=metric;$('weatherChartPeriod').value=period;
 $('weatherChartStation').onchange=e=>{selected=e.target.value;renderOverview();void renderHistory();};
 $('weatherChartMetric').onchange=e=>{metric=e.target.value;$('weatherChart').innerHTML=graph(history);};
 $('weatherChartPeriod').onchange=e=>{period=e.target.value;void renderHistory();};
 $('weatherCustomApply').onclick=()=>{customStart=$('weatherCustomFrom').value;customEnd=$('weatherCustomTo').value;void renderHistory();};
 const serial=++historyLoadSerial;
 try{
  let hours=Number(period),from=0,to=Date.now();
  if(custom){
   from=new Date(customStart).getTime();to=new Date(customEnd).getTime();
   if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to)throw Error('Bitte einen gültigen Zeitraum auswählen: „Von“ muss vor „Bis“ liegen.');
   if(to>Date.now()+60000)throw Error('Das Enddatum darf nicht in der Zukunft liegen.');
   if(from<Date.now()-8760*3600000)throw Error('Die Wetterhistorie kann derzeit maximal ein Jahr zurück abgefragt werden. Bitte ein neueres Startdatum wählen.');
   hours=Math.min(8760,Math.ceil((Date.now()-from)/3600000)+1);
  }
  const j=await request('/weather/history',{id:st.id,hours});
  if(serial!==historyLoadSerial)return;
  history=(j.points||[]).filter(p=>{const t=Date.parse(p.at);return Number.isFinite(t)&&(!custom||(t>=from&&t<=to));});
  $('weatherChart').innerHTML=graph(history);
  $('weatherRangeInfo').textContent=(custom?`${new Date(from).toLocaleString('de-DE')} bis ${new Date(to).toLocaleString('de-DE')} · `:'')+`${history.length} Messwerte`+(j.partial?' · Achtung: Server hat nur einen Teil der Messwerte geliefert.':'');
 }catch(e){if(serial!==historyLoadSerial)return;$('weatherChart').textContent=e.message;$('weatherRangeInfo').textContent='';}
}
let latestRefreshing=null;
async function refreshReadings(){
 if(latestRefreshing)return latestRefreshing;
 latestRefreshing=(async()=>{try{
  const data=await request('/weather/latest');
  for(const row of data.readings||[]){const st=stations.find(s=>s.id===row.id);if(st)st.latest=row.latest;}
  renderOverview();
  document.querySelectorAll('.weather-station-card').forEach(card=>{
   const st=stations.find(s=>s.id===card.dataset.station);
   const small=card.querySelector('summary small');
   if(st&&small)small.textContent=st.id+' · '+(st.enabled?'Aktiv':'Inaktiv')+' · Letzte Messung: '+date(st.latest?.at);
  });
 }catch(e){showError('Messwerte: '+e.message);}finally{latestRefreshing=null;}})();
 return latestRefreshing;
}
async function refresh(){if(refreshing)return refreshing;refreshing=(async()=>{try{const j=await request('/weather/list');stations=j.stations||[];if(!stations.some(s=>s.id===selected))selected=stations[0]?.id||'';renderOverview();renderStationSettings();if($('weatherView')?.classList.contains('active'))await renderHistory();showError('Stand: '+date(new Date().toISOString()));}catch(e){showError(e.message);if(/Zugangscode|401|Unauthorized/i.test(e.message)){sessionStorage.removeItem('weatherAdminKey');localStorage.removeItem(STORED_KEY);}}finally{refreshing=null;}})();return refreshing;}
window.weatherViewOpened=view=>{if(view==='weatherView')void renderHistory();if(view==='weatherSettingsView'){renderSettings();if(key())void refresh();}};
document.addEventListener('DOMContentLoaded',()=>{renderSettings();if(key())void refresh();
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&key()&&!document.querySelector('.weather-station-card[data-unsaved="true"]'))void refresh();});
window.addEventListener('pageshow',()=>{if(key()&&!document.querySelector('.weather-station-card[data-unsaved="true"]'))void refresh();});
rotateTimer=setInterval(rotate,8000);loadTimer=setInterval(()=>{if(key()&&!document.hidden)void refreshReadings();},300000);});
})();
