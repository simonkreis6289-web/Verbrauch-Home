(() => {
  const root = document.getElementById('waste-list');
  const status = document.getElementById('waste-status');
  const types = [['bio','Braune Tonne'],['rest','Schwarze Tonne'],['yellow','Gelbe Tonne / Sack'],['paper','Grüne Tonne']];
  const dayFormat = new Intl.DateTimeFormat('de-DE', {timeZone:'Europe/Berlin',weekday:'short',day:'2-digit',month:'2-digit'});
  const iso = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'});
  let cached = null;
  function render(data) {
    const p = iso.formatToParts(new Date());
    const today = ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');
    const cutoff = new Date(today+'T12:00:00Z'); cutoff.setUTCDate(cutoff.getUTCDate()+14);
    const end = cutoff.toISOString().slice(0,10);
    const tomorrow = new Date(today+'T12:00:00Z'); tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
    const nextDay = tomorrow.toISOString().slice(0,10);
    const events = (data ? data.events : []).filter(e=>e.date>=today).sort((a,b)=>a.date.localeCompare(b.date));
    const rows = types.map(([kind,label])=>({kind,label,date:(events.find(e=>e.kind===kind)||{}).date}));
    const special = new Map();
    events.filter(e=>e.kind==='special' && e.date<=end).forEach(e=>{if(!special.has(e.label)) special.set(e.label,e);});
    rows.push(...special.values());
    rows.sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999'));
    root.textContent='';
    rows.forEach(e=>{
      const row=document.createElement('div'); row.className='waste-row'; row.dataset.kind=e.kind; row.dataset.when=e.date===today?'today':e.date===nextDay?'tomorrow':'later'; if(e.date===today || e.date===nextDay) row.classList.add('waste-urgent');
      const icon=document.createElement('span'); icon.className='waste-bin waste-'+e.kind; icon.setAttribute('aria-hidden','true');
      if(e.kind==='special') icon.textContent=/holz/i.test(e.label)?'🪵':/elektro|metall/i.test(e.label)?'🔌':/sperr/i.test(e.label)?'🛋️':'♻️';
      const label=document.createElement('span'); label.className='waste-label'; label.textContent=e.label;
      const time=document.createElement('strong'); time.textContent=e.date ? dayFormat.format(new Date(e.date+'T12:00:00Z')) : '–'; const badge=document.createElement('small'); badge.className='waste-day'; badge.textContent=e.date===today?'HEUTE':e.date===nextDay?'MORGEN':''; badge.hidden=!badge.textContent;
      row.append(icon,label,time,badge); root.append(row);
    });
    const age=data ? Date.now()-Date.parse(data.updatedAt) : Infinity;
    status.textContent=!data?'Keine Kalenderdaten':(!events.length?'Keine aktuellen Termine': age>3*86400000?'Datenstand älter als 3 Tage':'Alperscheid · Stand '+dayFormat.format(new Date(data.updatedAt)));
  }
  render(null);
  setInterval(()=>{if(cached) render(cached);},60000);
  refreshDashboardData(async()=>{
    try {const data=await readDashboardJson('waste-calendar.json'); if(!Array.isArray(data.events)) throw Error('Invalid data'); cached=data; render(data);}
    catch(e){render(cached); status.textContent+=' · Abruf fehlgeschlagen';}
  });
})();
