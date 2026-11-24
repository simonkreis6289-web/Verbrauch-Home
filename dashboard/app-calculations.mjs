// Calculations mirrored from the app so the standalone dashboard never needs
// to start the app or its write-capable Firebase connection.
export function createAppCalculations(data) {
  const typeConfig = {
    strom: { unit: "kWh" },
    wasser: { unit: "m³" },
    pellets: { unit: "kg" }
  };
  const settings = Object.fromEntries(Object.keys(typeConfig).map(type => [type, {
    unitPrice: toNumber(data.settings?.[type]?.unitPrice) ?? 0,
    basePrice: toNumber(data.settings?.[type]?.basePrice) ?? 0
  }]));
  const balance = data.settings?.pelletBalance;
  settings.pelletBalance = {
    ...balance,
    adjustments: Array.isArray(balance?.adjustments) ? balance.adjustments : []
  };
  const state = { ...data, settings };

  function sortAsc(list) {
    return [...list].sort((a, b) => new Date((a.date || a.fromDate)) - new Date((b.date || b.fromDate)));
  }

  function toNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value ?? 0);
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value ?? 0);
  }

  function round2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function round4(value) {
    return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
  }

  function totalHomeChargingKwhBetween(startIso, endIso) {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();

    return round2(state.chargeEntries.reduce((sum, entry) => {
      const from = new Date(entry.fromDate || entry.date).getTime();
      const to = new Date(entry.toDate || entry.date).getTime();
               if ((entry.location || "home") !== "home") return sum;

      if (to < start || from > end) return sum;

      const entryDuration = Math.max(1, to - from);
      const overlapStart = Math.max(start, from);
      const overlapEnd = Math.min(end, to);
      const overlapDuration = Math.max(0, overlapEnd - overlapStart);

      const share = overlapDuration / entryDuration;
      return sum + ((toNumber(entry.kwh) || 0) * share);
    }, 0));
  }

  function effectiveMeterResets(type, fromTime, untilTime) {
    const readings = sortAsc(state.readings.filter(r => r.type === type));
    const resets = sortAsc(state.resets.filter(r => r.type === type &&
      Date.parse(r.date) > fromTime && Date.parse(r.date) <= untilTime));
    const result = [];
    for (const reset of resets) {
      const last = result[result.length - 1];
      const sameTransition = last &&
        Number(last.previousMeterValue) === Number(reset.previousMeterValue) &&
        Number(last.newMeterStartValue) === Number(reset.newMeterStartValue);
      const readingBetween = last && readings.some(r =>
        Date.parse(r.date) > Date.parse(last.date) &&
        Date.parse(r.date) <= Date.parse(reset.date));
      if (sameTransition && !readingBetween) continue;
      result.push(reset);
    }
    return result;
  }

  function buildComputedReadings() {
    const byType = {
      strom: sortAsc(state.readings.filter((e) => e.type === "strom")),
      wasser: sortAsc(state.readings.filter((e) => e.type === "wasser")),
      pellets: sortAsc(state.readings.filter((e) => e.type === "pellets"))
    };

    const computed = [];

    Object.entries(byType).forEach(([type, list]) => {
      list.forEach((entry, index) => {
        const previous = index > 0 ? list[index - 1] : null;
        let delta = null;
        let resetApplied = false;
        let daysBetween = null;
        let dailyDelta = null;
        let yearProjection = null;
        let cost = null;
        let priceSource = null;
        let evChargeKwh = 0;
        let netDelta = null;

        if (previous) {
          const prevTime = new Date(previous.date).getTime();
          const currentTime = new Date(entry.date).getTime();
          const rawDays = (currentTime - prevTime) / 86400000;
          daysBetween = Math.max(1 / 24, rawDays);

          const resetsBetween = effectiveMeterResets(type, prevTime, currentTime);
          if (resetsBetween.length) {
            let lastValue = previous.value;
            delta = 0;
            for (const reset of resetsBetween) {
              delta += Math.max(0, Number(reset.previousMeterValue) - Number(lastValue));
              lastValue = Number(reset.newMeterStartValue);
            }
            delta = round2(delta + Math.max(0, Number(entry.value) - Number(lastValue)));
            resetApplied = true;
          } else {
            delta = round2(entry.value - previous.value);
          }

          delta = Math.max(0, delta);
              evChargeKwh = 0;
              netDelta = delta;

              if (type === "strom") {
                evChargeKwh = totalHomeChargingKwhBetween(previous.date, entry.date);
                netDelta = Math.max(0, round2(delta - evChargeKwh));
              }
          dailyDelta = round4(delta / daysBetween);
          yearProjection = round2(dailyDelta * 365);

          const pricing = calculateCostForInterval(type, previous.date, entry.date, delta, daysBetween);
          cost = pricing.cost;
          priceSource = pricing.source;
        }

        computed.push({
          ...entry,
          type,
          previousValue: previous ? previous.value : null,
          previousDate: previous ? previous.date : null,
          delta,
          cost,
          resetApplied,
          daysBetween,
          dailyDelta,
          yearProjection,
          evChargeKwh,
          netDelta,
          priceSource
        });
      });
    });

    return computed.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function latestPelletPurchasePricePerKg() {
    const recent = [...state.purchases]
      .filter(p => Number(p.totalKg) > 0 && Number(p.totalPrice) >= 0 && Number.isFinite(Date.parse(p.date)))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
    return recent ? Number(recent.totalPrice) / Number(recent.totalKg) : null;
  }

  function pelletFifoCostForInterval(startIso,endIso,quantity){
    // FIFO nur für durch Einkaufshistorie belegte Mengen; ältere unbekannte Bestände
    // werden nicht fälschlich als kostenlos bewertet.
    const purchases=[...state.purchases].filter(p=>Number(p.totalKg)>0&&Number.isFinite(Number(p.totalPrice)))
      .sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
    if(!purchases.length)return null;
    const start=Date.parse(startIso),end=Date.parse(endIso);
    const first=Date.parse(purchases[0].date);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=first)return null;
    const lots=purchases.map(p=>({time:Date.parse(p.date),remaining:Number(p.totalKg),rate:Number(p.totalPrice)/Number(p.totalKg)}));
    // IMPORTANT: never call buildComputedReadings() from FIFO pricing.
    // buildComputedReadings -> calculateCostForInterval -> FIFO would recurse endlessly.
    // Derive historical pellet usage directly from raw meter readings and resets.
    const pelletReadings=sortAsc(state.readings.filter(r=>r.type==='pellets'));
    const pelletResets=sortAsc(state.resets.filter(r=>r.type==='pellets'));
    const readings=[];
    for(let i=1;i<pelletReadings.length;i++){
      const previous=pelletReadings[i-1],current=pelletReadings[i];
      const previousTime=Date.parse(previous.date),currentTime=Date.parse(current.date);
      if(!Number.isFinite(previousTime)||!Number.isFinite(currentTime)||currentTime<=previousTime)continue;
      const reset=pelletResets.find(r=>{const t=Date.parse(r.date);return t>previousTime&&t<=currentTime;});
      const delta=reset
        ? (Number(reset.previousMeterValue)-Number(previous.value))+(Number(current.value)-Number(reset.newMeterStartValue))
        : Number(current.value)-Number(previous.value);
      if(Number.isFinite(delta)&&delta>0&&currentTime>first&&currentTime<=start){
        readings.push({time:currentTime,qty:delta});
      }
    }
    function consume(q,time){
      let cost=0,covered=0;
      for(const lot of lots){if(lot.time>time||q<=0)continue;const used=Math.min(lot.remaining,q);if(used<=0)continue;lot.remaining-=used;q-=used;covered+=used;cost+=used*lot.rate;}
      return {cost,covered,missing:q};
    }
    for(const r of readings)consume(r.qty,r.time);
    // Wenn eine Preisperiode einen Kaufzeitpunkt überlappt, nicht rückwirkend zuordnen.
    const result=consume(quantity,end);
    if(result.missing>0.001)return null;
    return round2(result.cost);
  }

  function calculateCostForInterval(type, startIso, endIso, totalDelta, daysBetween) {
    if (!Number.isFinite(totalDelta) || totalDelta <= 0 || !Number.isFinite(daysBetween) || daysBetween <= 0) {
      return { cost: 0, source: null };
    }
    // Pellets: Einkaufshistorie statt Grundpreis/Marktpreis. FIFO soweit
    // historische Käufe die verbrauchte Menge tatsächlich abdecken.
    if (type === 'pellets') {
      const fifo=pelletFifoCostForInterval(startIso,endIso,totalDelta);
      if(fifo!==null)return {cost:fifo,source:'FIFO aus Pelletkäufen'};
      const purchaseRate=latestPelletPurchasePricePerKg();
      return purchaseRate===null?{cost:null,source:'Keine Einkaufspreise vorhanden'}:
        {cost:round2(totalDelta*purchaseRate),source:'Schätzung: letzter Einkauf (FIFO-Historie unvollständig)'};
    }

    const matchingPeriods = findMatchingPricePeriods(type, startIso, endIso);
    if (!matchingPeriods.length) {
      const fallbackCost = round2((totalDelta * (state.settings[type].unitPrice || 0)) + (state.settings[type].basePrice || 0));
      return { cost: fallbackCost, source: "Basispreis aktiv" };
    }

    const dailyConsumption = totalDelta / daysBetween;
    let totalCost = 0;
    const labels = [];

    for (const period of matchingPeriods) {
      const coveredDays = countOverlapDays(startIso, endIso, period.fromDate, period.toDate);
      if (coveredDays <= 0) continue;
      const consumptionPart = dailyConsumption * coveredDays;
      const costPart = consumptionPart * (period.unitPrice || 0) + (period.basePrice || 0);
      totalCost += costPart;
      labels.push(`${formatNumber(coveredDays)}T @ ${formatCurrency(period.unitPrice)}/${typeConfig[type].unit}`);
    }

    return {
      cost: round2(totalCost),
      source: labels.join(" · ") || null
    };
  }

  function findMatchingPricePeriods(type, startIso, endIso) {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    return state.pricePeriods
      .filter((p) => p.type === type)
      .filter((p) => {
        const from = new Date(p.fromDate).getTime();
        const to = new Date(p.toDate).getTime();
        return from <= end && to >= start;
      })
      .sort((a, b) => new Date(a.fromDate) - new Date(b.fromDate));
  }

  function countOverlapDays(startA, endA, startB, endB) {
    const start = Math.max(new Date(startA).getTime(), new Date(startB).getTime());
    const end = Math.min(new Date(endA).getTime(), new Date(endB).getTime());
    if (end < start) return 0;
    return Math.max(1 / 24, (end - start) / 86400000);
  }

  function buildMonthlyStats() {
    // Messintervalle werden nach tatsächlicher Zeitdauer auf Kalendermonate verteilt.
    // So erscheinen 14 Tage und zwei Monate im Diagramm als vergleichbare Tagesmittelwerte.
    // Da keine täglichen Messwerte vorliegen, ist die Verteilung innerhalb eines
    // Ableseintervalls eine lineare Schätzung, keine gemessene Tageslast.
    const computed = buildComputedReadings().filter((entry) =>
      entry.previousDate && Number.isFinite(entry.delta)
    );
    const result = { strom: {}, wasser: {}, pellets: {} };
    const dayMs = 86400000;

    computed.forEach((entry) => {
      const start = new Date(entry.previousDate).getTime();
      const end = new Date(entry.date).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      const intervalDays = (end - start) / dayMs;
      let cursor = start;

      while (cursor < end) {
        const date = new Date(cursor);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
        const sliceEnd = Math.min(end, nextMonth);
        const partDays = (sliceEnd - cursor) / dayMs;
        const fraction = partDays / intervalDays;
        if (!(partDays > 0)) break;

        if (!result[entry.type][monthKey]) {
          result[entry.type][monthKey] = { total: 0, cost: 0, costComplete: true };
        }
        const month = result[entry.type][monthKey];
        month.total += Math.max(0, entry.delta) * fraction;
        if (Number.isFinite(entry.cost)) month.cost += Math.max(0, entry.cost) * fraction;
        else month.costComplete = false;
        cursor = sliceEnd;
      }
    });

    Object.keys(result).forEach((type) => Object.keys(result[type]).forEach((monthKey) => {
      const item = result[type][monthKey];
      item.total = round2(item.total);
      item.cost = item.costComplete ? round2(item.cost) : null;
    }));
    return result;
  }

  function pelletBaselineDate(){
    const purchases=state.purchases.filter(p=>Number(p.totalKg)>0&&Number.isFinite(Date.parse(p.date))).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
    return purchases.length?new Date(purchases[0].date):null;
  }

  function pelletConsumptionAfter(startMs,endMs=Date.now()){
    let total=0;
    for(const e of buildComputedReadings()){
      if(e.type!=='pellets'||!e.previousDate||!Number.isFinite(e.delta)||e.delta<0)continue;
      const a=Date.parse(e.previousDate),b=Date.parse(e.date);
      if(!(b>a))continue;
      const overlap=Math.max(0,Math.min(b,endMs)-Math.max(a,startMs));
      if(overlap>0)total+=e.delta*overlap/(b-a);
    }
    return total;
  }

  function pelletDeliveriesAfter(startMs,endMs=Date.now()){
    // Käufe/Lieferungen bilden den Gesamtvorrat. Nachfüllungen sind interne
    // Umlagerungen aus dem bereits vorhandenen Sackvorrat in den Heizungsbunker.
    // Sie erhöhen den Gesamtbestand NICHT noch einmal.
    const buys=state.purchases.filter(p=>Number(p.totalKg)>0&&Date.parse(p.date)>=startMs&&Date.parse(p.date)<=endMs);
    const bought=buys.reduce((sum,p)=>sum+Number(p.totalKg),0);
    const refills=state.refills.filter(r=>Number(r.totalKg)>0&&Date.parse(r.date)>=startMs&&Date.parse(r.date)<=endMs)
      .reduce((sum,r)=>sum+Number(r.totalKg),0);
    return {bought,refill:0,internalRefill:refills,ignored:refills,total:bought};
  }

  function pelletBalanceModel(){
    const baseline=pelletBaselineDate(), config=state.settings.pelletBalance||{};
    if(!baseline)return {ready:false,stock:null,note:'Noch kein Pelletskauf mit Datum und Menge gespeichert.'};
    const start=baseline.getTime(),now=Date.now();
    const checkpoint=config.splitCheckpoint;
    if(checkpoint&&Number.isFinite(Date.parse(checkpoint.date))){
      const split=pelletCheckpointStock(checkpoint);
      const from=Date.parse(checkpoint.date);
      const deliveries={total:split.delivered};
      const consumption=split.used;
      const stock=Math.max(0,split.bags+split.bunker);
      return {ready:true,stock,baseline,from:new Date(from),opening:split.bags+split.bunker,consumption,deliveries,checkpoint,adjustments:[],split};
    }
    const adjustments=(config.adjustments||[]).filter(a=>Date.parse(a.date)>=start&&Date.parse(a.date)<=now).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
    const correction=adjustments.at(-1);
    const from=correction?Date.parse(correction.date):start;
    const opening=correction?Number(correction.stockKg):Math.max(0,Number(config.initialRestKg)||0);
    const deliveries=pelletDeliveriesAfter(from,now);
    const consumption=pelletConsumptionAfter(from,now);
    const stock=Math.max(0,opening+deliveries.total-consumption);
    return {ready:true,stock,baseline,from:new Date(from),opening,consumption,deliveries,correction,adjustments};
  }

  function pelletCheckpointStock(checkpoint){
    const capacity=Number(checkpoint.capacityKg)||967.5;
    const start=Date.parse(checkpoint.date), now=Date.now();
    let bags=Number(checkpoint.bags)*Number(checkpoint.kgPerBag), bunker=Number(checkpoint.bunkerKg);
    const events=[];
    // Ereignisse nach dem Abgleich: kein doppeltes Buchen historischer Nachfüllungen.
    for(const r of state.refills){const t=Date.parse(r.date);if(t>start&&t<=now)events.push({t,kind:'refill',kg:Number(r.totalKg)||0});}
    for(const p of state.purchases){const t=Date.parse(p.date);if(t>start&&t<=now)events.push({t,kind:'purchase',kg:Number(p.totalKg)||0});}
    // Zählerintervalle können den Abgleichzeitpunkt überlappen: Verbrauch zeitanteilig verteilen.
    for(const e of buildComputedReadings()){
      if(e.type!=='pellets'||!e.previousDate||!Number.isFinite(e.delta)||e.delta<0)continue;
      const a=Date.parse(e.previousDate),b=Date.parse(e.date);
      if(!(b>a&&b>start&&a<now))continue;
      const overlap=Math.max(0,Math.min(b,now)-Math.max(a,start));
      if(!overlap)continue;
      // A meter reading recorded after a stock checkpoint represents the newly
      // entered consumption. Do not prorate it down to a few grams just because
      // its preceding reading is dated before the checkpoint. In particular,
      // a meter reset to zero can span the checkpoint boundary.
      // Intervals fully before the checkpoint were excluded above.
      const crossesCheckpoint=a<start&&b>start;
      const kg=crossesCheckpoint?e.delta:e.delta*overlap/(b-a);
      if(kg>0)events.push({t:Math.min(b,now),kind:'consumption',kg});
    }
    // Der beim Abgleich festgehaltene Zählerstand ist der einzige
    // Verbrauchs-Startpunkt. Nur spätere Ablesungen zählen, auch wenn
    // das vorherige historische Ableseintervall über den Abgleich reicht.
    if(Number.isFinite(Number(checkpoint.meterValue))&&checkpoint.meterValue!==null&&checkpoint.meterValue!==undefined){
      for(let i=events.length-1;i>=0;i--)if(events[i].kind==='consumption')events.splice(i,1);
      const laterReadings=state.readings.filter(r=>r.type==='pellets'&&Date.parse(r.date)>start&&Date.parse(r.date)<=now&&Number.isFinite(Number(r.value)))
        .slice().sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
      const resets=effectiveMeterResets('pellets',start,now);
      let lastValue=Number(checkpoint.meterValue),lastTime=start;
      for(const r of laterReadings){
        const t=Date.parse(r.date),value=Number(r.value);
        const intervening=resets.filter(x=>Date.parse(x.date)>lastTime&&Date.parse(x.date)<=t);
        let delta=0;
        if(intervening.length){
          let prior=lastValue;
          for(const reset of intervening){
            delta+=Math.max(0,Number(reset.previousMeterValue)-prior);
            prior=Number(reset.newMeterStartValue);
          }
          delta+=Math.max(0,value-prior);
        }else delta=Math.max(0,value-lastValue);
        if(delta>0)events.push({t,kind:'consumption',kg:delta});
        lastValue=value;lastTime=t;
      }
    }else{
    // Anker: eine bestätigte Verbrauchsreferenz ersetzt die unsichere
    // Zuordnung von Ableseintervallen über die Abgleichgrenze.
    // Spätere Zählerdifferenzen werden relativ zum gespeicherten Rohwert addiert.
    const reference=checkpoint.consumptionReference;
    const meterEvents=events.filter(e=>e.kind==='consumption');
    const rawUsed=meterEvents.reduce((sum,e)=>sum+e.kg,0);
    if(reference&&Number.isFinite(Number(reference.rawUsed))&&Number.isFinite(Number(reference.actualUsed))){
      const correctedUsed=Math.max(0,Number(reference.actualUsed)+rawUsed-Number(reference.rawUsed));
      for(let i=events.length-1;i>=0;i--)if(events[i].kind==='consumption')events.splice(i,1);
      events.push({t:now,kind:'consumption',kg:correctedUsed});
    }
    } // Ende der Kompatibilitätsberechnung für ältere Abgleiche
    events.sort((a,b)=>a.t-b.t);
    let used=0,added=0,delivered=0;
    for(const e of events){
      if(e.kind==='refill'){bags-=e.kg;bunker+=e.kg;added+=e.kg;}
      else if(e.kind==='purchase'){bags+=e.kg;delivered+=e.kg;}
      else {bunker-=e.kg;used+=e.kg;}
    }
    return {bags,bunker,capacity,used,added,delivered,bagCount:bags/Number(checkpoint.kgPerBag)};
  }

  function pelletStockSplit(balance){
    if(!balance.ready)return null;
    if(balance.checkpoint){
      const s=balance.split;
      const warning=s.bags< -0.01?'Sacklager rechnerisch negativ: Nachfüllungen prüfen.':s.bunker< -0.01?'Bunker rechnerisch leer: Verbrauch oder Nachfüllung prüfen.':s.bunker>s.capacity+0.1?'Bunker über Kapazität: Nachfüllung oder Verbrauch prüfen.':'Getrennte Bestände seit dem letzten Abgleich. Nachfüllungen sind Umlagerungen; Verbrauch wird vom Bunker abgezogen.';
      return {...s,refills:s.added,purchases:s.delivered,plausible:s.bags>=0&&s.bunker>=0&&s.bunker<=s.capacity+0.1,warning};
    }
    const baseline=balance.baseline.getTime(),now=Date.now();
    const purchases=pelletDeliveriesAfter(baseline,now).total;
    const refills=state.refills.filter(r=>Number(r.totalKg)>0&&Date.parse(r.date)>=baseline&&Date.parse(r.date)<=now).reduce((sum,r)=>sum+Number(r.totalKg),0);
    const bags=Math.max(0,purchases-refills),bunker=balance.stock-bags;
    return {bags,bunker:Math.max(0,bunker),purchases,refills,plausible:bunker>=-5&&bunker<=967.5,warning:'Historische Schätzung. Bitte einmal den getrennten Bunker-/Sacklager-Abgleich speichern.'};
  }

  function buildComputedFuelEntriesForCar(carId) {
    const entries = [...state.fuelEntries]
      .filter((entry) => entry.carId === carId)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    return entries.map((entry, index) => {
      const previous = index > 0 ? entries[index - 1] : null;

      let distanceKm = null;
      let litersPer100km = null;
      let costPer100km = null;
      let calculationWarning = "";
      let suspectedMissingRefuel = false;
      let rangeUsedKm = null;
      let rangeDifferenceKm = null;

      if (previous) {
        distanceKm = round2((toNumber(entry.mileage) || 0) - (toNumber(previous.mileage) || 0));

        const previousRangeAfter = toNumber(previous.rangeAfter);
        const currentRangeBefore = toNumber(entry.rangeBefore);

        if (Number.isFinite(previousRangeAfter) && Number.isFinite(currentRangeBefore)) {
          rangeUsedKm = round2(previousRangeAfter - currentRangeBefore);
          rangeDifferenceKm = round2(distanceKm - rangeUsedKm);

          // Reichweitenangaben des Bordcomputers sind Prognosen. Besonders bei
          // frühem Nachtanken ist die Differenz zur tatsächlich gefahrenen
          // Strecke normal und KEIN Hinweis auf eine vergessene Tankung.
          // Nur bei sehr großer Abweichung einen unverbindlichen Hinweis zeigen.
          const tolerance = Math.max(120, previousRangeAfter * 0.35);
          if (previousRangeAfter > 0 && distanceKm > previousRangeAfter + tolerance) {
            calculationWarning = "Hinweis: Gefahrene Strecke übersteigt die zuvor angezeigte Reichweite deutlich. Bitte Einträge prüfen; die Reichweitenanzeige ist nur eine Schätzung.";
          }
        }

        if (!suspectedMissingRefuel && distanceKm > 0) {
          litersPer100km = round2(((toNumber(entry.liters) || 0) / distanceKm) * 100);
          costPer100km = round2(((toNumber(entry.totalPrice) || 0) / distanceKm) * 100);
        }
      }

      return {
        ...entry,
        distanceKm,
        litersPer100km,
        costPer100km,
        rangeUsedKm,
        rangeDifferenceKm,
        suspectedMissingRefuel,
        calculationWarning
      };
    });
  }

  return { buildMonthlyStats, pelletBalanceModel, pelletStockSplit, buildComputedFuelEntriesForCar };
}
