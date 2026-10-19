/* Eigenstaendiges Spritpreise-Modul fuer Verbrauch Zuhause.
   Daten: Tankerkoenig MTS-K, Liveabfrage nur auf Nutzeraktion.
   Verlauf: eigene Beobachtungen dieses Geraetes, keine behauptete Alt-Historie.
*/
const DEFAULT_POINT={lat:51.0428690176479,lng:7.81987132041879,label:'57489 Drolshagen / Alperscheid'};
const KEY_STORAGE='verbrauch-fuel-api-key-v1';
const HIST_STORAGE='verbrauch-fuel-price-observations-v1';
const MAX_HISTORY=12000;
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const euro=n=>Number.isFinite(Number(n))?new Intl.NumberFormat('de-DE',{minimumFractionDigits:3,maximumFractionDigits:3}).format(Number(n))+' €':'k. A.';
const viewDate=n=>new Date(n).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'});
const safeRead=(k,fallback)=>{try{return JSON.parse(localStorage.getItem(k))??fallback;}catch{return fallback;}};

export function initFuelPrices(root){
  if(!root||root.dataset.fpLoaded==='yes')return;
  root.dataset.fpLoaded='yes';
  let point={...DEFAULT_POINT},stations=[],map=null,markers=null,selected=null,lastFetch=0;
  let mode='list';
  root.innerHTML=`<div class="fp-layout">
    <section class="card wide glass"><p class="section-kicker">MTS-K · AKTUELLE TANKSTELLENPREISE</p><h2>⛽ Spritpreise in deiner Nähe</h2>
      <p class="muted">Tankstellen nach Kraftstoff, Umkreis, Preis oder Entfernung vergleichen. Der Gerätestandort wird nur nach deiner Freigabe abgefragt.</p>
      <div class="fp-controls">
        <label>Kraftstoff<select id="fpFuel"><option value="diesel">Diesel</option><option value="e5">Super E5</option><option value="e10">Super E10</option></select></label>
        <label>Umkreis<select id="fpRadius"><option value="5">5 km</option><option value="10">10 km</option><option value="15">15 km</option><option value="25">25 km</option></select></label>
        <label>Sortieren nach<select id="fpSort"><option value="price">Günstigster Preis</option><option value="dist">Entfernung</option></select></label>
        <label>Standort<input id="fpPosition" readonly value="${escapeHtml(point.label)}" /></label>
      </div>
      <div class="fp-buttons"><button class="btn secondary" type="button" id="fpGps">📍 Aktuellen Standort verwenden</button><button class="btn ghost" type="button" id="fpHome">🏠 Alperscheid</button><button class="btn primary" type="button" id="fpLoad">🔄 Preise suchen</button></div>
      <p class="fp-status" id="fpStatus" role="status">Bereit. Bitte zunächst den API-Schlüssel eingeben oder einen Standort auswählen.</p>
      <details style="margin-top:12px"><summary>API-Einstellungen</summary><div class="fp-key-row" style="margin-top:10px"><label>Tankerkönig API-Schlüssel<input id="fpKey" type="password" autocomplete="off" placeholder="Persönlichen API-Key eingeben" /></label><button class="btn ghost" id="fpSaveKey" type="button">Schlüssel speichern</button></div><p class="fp-hint">Der Schlüssel wird ausschließlich lokal auf diesem Gerät gespeichert. Die Abfrage erfolgt direkt an Tankerkönig. Keine Schlüssel in GitHub-Dateien hinterlegen. Zum Löschen Feld leeren und erneut speichern.</p><p class="fp-hint"><a href="https://creativecommons.tankerkoenig.de/" target="_blank" rel="noopener noreferrer">API-Informationen / Registrierung ↗</a></p></details>
    </section>
    <section class="card wide"><div class="card-head"><div><p class="section-kicker">ERGEBNISSE</p><h2>Tankstellen im Umkreis</h2></div><span class="badge" id="fpCount">Keine Abfrage</span></div>
      <div class="fp-buttons" style="margin:0 0 15px"><button id="fpListBtn" class="btn secondary" type="button">☷ Liste</button><button id="fpMapBtn" class="btn ghost" type="button">🗺 Karte</button></div>
      <div id="fpStations" class="fp-stations"><p class="muted">Noch keine Tankstellen geladen.</p></div><div id="fpMap" class="fp-map" hidden></div>
      <p class="fp-hint">Preisstand entspricht dem Zeitpunkt der letzten erfolgreichen Live-Abfrage. Straßenentfernung kann von der angezeigten Luftlinie abweichen.</p>
    </section>
    <section class="card wide"><div class="card-head"><div><p class="section-kicker">PREISENTWICKLUNG</p><h2>📈 Preisverlauf je Tankstelle</h2></div></div>
      <label style="max-width:400px">Zeitraum<select id="fpPeriod"><option value="1">24 Stunden</option><option value="7">7 Tage</option><option value="30" selected>30 Tage</option><option value="90">90 Tage</option><option value="365">1 Jahr</option></select></label>
      <div id="fpChart" class="fp-history" style="margin-top:14px"><p class="muted">Wähle eine Tankstelle über „Preisverlauf“ aus.</p></div>
      <p class="fp-hint">Die Historie beginnt erst mit unseren tatsächlich gespeicherten Abfragen auf diesem Gerät. Der Preisverlauf ist zunächst lokal und wird nicht zwischen Geräten synchronisiert.</p>
    </section></div>`;
  const $=id=>root.querySelector('#'+id);
  $('fpKey').value=localStorage.getItem(KEY_STORAGE)||'';
  const status=(msg,error=false)=>{const el=$('fpStatus');el.textContent=msg;el.style.borderColor=error?'var(--danger)':'var(--line)';};
  const fuel=()=>$('fpFuel').value;
  const sortList=()=>stations.sort((a,b)=>$('fpSort').value==='dist'?(a.dist??1e6)-(b.dist??1e6):(Number.isFinite(a.price)?a.price:1e6)-(Number.isFinite(b.price)?b.price:1e6));
  function display(){
    sortList();$('fpCount').textContent=stations.length+' Tankstellen';
    $('fpStations').innerHTML=stations.length?stations.map(s=>{
      const address=[s.street,s.houseNumber].filter(Boolean).join(' ')+', '+[s.postCode,s.place].filter(Boolean).join(' ');
      const query=encodeURIComponent([s.name,address].filter(Boolean).join(', '));
      return `<article class="fp-station"><div><strong>${escapeHtml(s.brand||s.name||'Tankstelle')}</strong><p>${escapeHtml(s.name||'')} · ${escapeHtml(address)}</p><p>${s.dist!=null?Number(s.dist).toFixed(1).replace('.',',')+' km Luftlinie':'Entfernung unbekannt'} · ${s.isOpen===true?'🟢 Geöffnet':s.isOpen===false?'⚪ Geschlossen':'Status unbekannt'}</p><div class="fp-station-actions"><button class="btn ghost" data-history="${escapeHtml(s.id)}" type="button">📈 Preisverlauf</button><a class="btn ghost" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&query=${query}">🧭 Navigation ↗</a></div></div><div class="fp-station-price">${Number.isFinite(s.price)&&s.price>0?euro(s.price):'k. A.'}<small>pro Liter ${escapeHtml(fuel().toUpperCase())}</small></div></article>`;
    }).join(''):'<p class="muted">Keine Tankstellen gefunden. Radius erhöhen oder neue Suche starten.</p>';
    if(mode==='map')renderMap();
  }
  function observations(){return safeRead(HIST_STORAGE,[]).filter(x=>x&&Number.isFinite(x.price));}
  function saveHistory(){
    const now=Date.now(),old=observations();
    for(const s of stations){if(!Number.isFinite(s.price)||s.price<=0)continue;
      const last=old.findLast(x=>x.station===s.id&&x.fuel===fuel());
      if(last&&last.price===s.price&&now-last.time<2*3600*1000)continue;
      old.push({station:s.id,fuel:fuel(),name:s.brand||s.name,time:now,price:s.price});
    }
    try{localStorage.setItem(HIST_STORAGE,JSON.stringify(old.slice(-MAX_HISTORY)));}catch{status('Preise geladen, aber der lokale Historien-Speicher ist voll.',true);}
  }
  function history(id){selected=id;const s=stations.find(x=>x.id===id);const cutoff=Date.now()-Number($('fpPeriod').value)*864e5;
    const arr=observations().filter(x=>x.station===id&&x.fuel===fuel()&&x.time>=cutoff).sort((a,b)=>a.time-b.time);
    const area=$('fpChart');if(!arr.length){area.innerHTML='<p class="muted">Für diesen Zeitraum liegen noch keine gespeicherten Preise vor.</p>';return;}
    const w=850,h=275,l=65,r=25,t=22,b=44,vals=arr.map(x=>x.price),lo=Math.min(...vals),hi=Math.max(...vals),pad=Math.max(.015,(hi-lo)*.25),min=Math.max(0,lo-pad),max=hi+pad;
    const first=arr[0].time,last=arr.at(-1).time;
    const x=v=>l+(last===first?.5:(v-first)/(last-first))*(w-l-r),y=v=>t+(max-v)/(max-min)*(h-t-b);
    const grid=Array.from({length:5},(_,i)=>{const v=min+(max-min)*i/4,Y=y(v);return `<line x1="${l}" x2="${w-r}" y1="${Y}" y2="${Y}" stroke="var(--line)"/><text x="${l-8}" y="${Y+4}" font-size="12" text-anchor="end" fill="var(--muted)">${v.toFixed(2)}</text>`;}).join('');
    const line=arr.map(v=>`${x(v.time)},${y(v.price)}`).join(' ');
    area.innerHTML=`<p><strong>${escapeHtml(s?.brand||arr[0].name||'Tankstelle')}</strong> · ${escapeHtml(fuel().toUpperCase())}</p><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Preisverlauf"><g>${grid}</g><polyline points="${line}" fill="none" stroke="#0ea5e9" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>${arr.map(v=>`<circle cx="${x(v.time)}" cy="${y(v.price)}" r="5" fill="#0ea5e9"><title>${escapeHtml(viewDate(v.time))}: ${escapeHtml(euro(v.price))}</title></circle>`).join('')}<text x="${l}" y="${h-10}" fill="var(--muted)" font-size="12">${escapeHtml(viewDate(first))}</text><text x="${w-r}" y="${h-10}" text-anchor="end" fill="var(--muted)" font-size="12">${escapeHtml(viewDate(last))}</text></svg><p class="fp-hint">${arr.length} gespeicherte Messpunkte, letzter Preis: ${euro(arr.at(-1).price)}</p>`;
  }
  function renderMap(){
    const mapEl=$('fpMap');if(!window.L){mapEl.textContent='Kartenbibliothek Leaflet nicht verfügbar.';return;}
    if(!map){map=window.L.map(mapEl).setView([point.lat,point.lng],12);window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:18}).addTo(map);markers=window.L.layerGroup().addTo(map);}
    markers.clearLayers();window.L.circleMarker([point.lat,point.lng],{radius:9,color:'#0284c7',fillColor:'#0284c7',fillOpacity:.7}).bindPopup('Dein Suchstandort').addTo(markers);
    for(const s of stations){if(!Number.isFinite(Number(s.lat))||!Number.isFinite(Number(s.lng)))continue;
      const marker=window.L.marker([s.lat,s.lng]).addTo(markers);
      const wrap=document.createElement('div');wrap.innerHTML=`<strong>${escapeHtml(s.brand||s.name)}</strong><p>${escapeHtml(euro(s.price))} / Liter</p>`;
      const btn=document.createElement('button');btn.textContent='Preisverlauf';btn.type='button';btn.addEventListener('click',()=>history(s.id));wrap.appendChild(btn);marker.bindPopup(wrap);
    }
    map.setView([point.lat,point.lng],Number($('fpRadius').value)<=5?12:10);setTimeout(()=>map.invalidateSize(),90);
  }
  async function load(){
    const key=$('fpKey').value.trim();if(!key){status('Bitte zunächst deinen Tankerkönig-API-Schlüssel eingeben.',true);return;}
    const elapsed=Date.now()-lastFetch;if(elapsed<65000){status('Bitte mindestens 65 Sekunden zwischen zwei API-Abfragen warten.',true);return;}
    lastFetch=Date.now();$('fpLoad').disabled=true;status('Aktuelle Tankstellenpreise werden abgefragt …');
    try{
      const qs=new URLSearchParams({lat:String(point.lat),lng:String(point.lng),rad:$('fpRadius').value,type:fuel(),sort:'dist',apikey:key});
      const resp=await fetch('https://creativecommons.tankerkoenig.de/json/list.php?'+qs.toString(),{cache:'no-store'});
      if(!resp.ok)throw new Error('HTTP '+resp.status);
      const payload=await resp.json();if(!payload.ok)throw new Error(payload.message||'Schnittstelle meldet Fehler');
      stations=(payload.stations||[]).map(s=>({...s,price:Number(s.price),dist:Number(s.dist)}));
      display();saveHistory();status(`${stations.length} Tankstellen geladen · ${viewDate(Date.now())} · Quelle: Tankerkönig / MTS-K`);
      if(selected)history(selected);
    }catch(err){status('Preisabruf fehlgeschlagen: '+String(err.message||err)+'. Vorhandene Daten bleiben angezeigt.',true);}
    finally{$('fpLoad').disabled=false;}
  }
  $('fpLoad').addEventListener('click',load);
  $('fpSaveKey').addEventListener('click',()=>{const value=$('fpKey').value.trim();if(value)localStorage.setItem(KEY_STORAGE,value);else localStorage.removeItem(KEY_STORAGE);status(value?'API-Schlüssel auf diesem Gerät gespeichert.':'API-Schlüssel lokal entfernt.');});
  $('fpGps').addEventListener('click',()=>{
    if(!navigator.geolocation){status('Geolokalisierung ist auf diesem Gerät nicht verfügbar.',true);return;}
    status('Standortfreigabe wird angefragt …');navigator.geolocation.getCurrentPosition(p=>{point={lat:p.coords.latitude,lng:p.coords.longitude,label:'Aktueller Standort (GPS)'};$('fpPosition').value=point.label;status('GPS-Standort übernommen. Jetzt „Preise suchen“ drücken.');},e=>status('Standort nicht verfügbar: '+e.message+'. Alperscheid kann als Standardort verwendet werden.',true),{enableHighAccuracy:true,timeout:15000,maximumAge:120000});
  });
  $('fpHome').addEventListener('click',()=>{point={...DEFAULT_POINT};$('fpPosition').value=point.label;status('Alperscheid als Suchstandort eingestellt.');});
  $('fpFuel').addEventListener('change',()=>{stations=[];selected=null;$('fpCount').textContent='Neue Suche nötig';$('fpStations').innerHTML='<p class="muted">Für diese Kraftstoffsorte bitte neu suchen.</p>';$('fpChart').innerHTML='<p class="muted">Preisverlauf nach neuer Suche auswählen.</p>';if(markers)markers.clearLayers();});
  $('fpSort').addEventListener('change',display);
  $('fpListBtn').addEventListener('click',()=>{mode='list';$('fpStations').hidden=false;$('fpMap').hidden=true;$('fpListBtn').className='btn secondary';$('fpMapBtn').className='btn ghost';});
  $('fpMapBtn').addEventListener('click',()=>{mode='map';$('fpStations').hidden=true;$('fpMap').hidden=false;$('fpListBtn').className='btn ghost';$('fpMapBtn').className='btn secondary';renderMap();});
  $('fpStations').addEventListener('click',e=>{const btn=e.target.closest('[data-history]');if(btn)history(btn.dataset.history);});
  $('fpPeriod').addEventListener('change',()=>{if(selected)history(selected);});
}
