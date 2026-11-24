/* Shared TfL stop identity and presentation for Tracker and Journey searches. */
(function(root){
 'use strict';
 const cache=new Map();
 const letter=value=>/^[A-Z]{1,3}[0-9]{0,2}$/i.test(String(value??'').trim())?String(value).trim():'';
 const busOnly=stop=>stop.modes?.includes('bus')&&!stop.modes.some(mode=>mode!=='bus');
 const physical=stop=>/^490(?!G)/i.test(stop.naptanId||stop.id||'');
 const property=(stop,key)=>(stop.additionalProperties??[]).find(p=>p.key?.toLowerCase()===key.toLowerCase())?.value||'';
 function normalize(stop){
  const id=stop.naptanId||stop.id;
  return {...stop,id,name:stop.commonName||stop.name,stopLetter:letter(stop.stopLetter)||letter(String(stop.indicator||'').replace(/^stop\s+/i,'')),
   towards:stop.towards||property(stop,'Towards'),compass:property(stop,'CompassPoint'),
   lines:Array.isArray(stop.lines)?[...new Map(stop.lines.filter(line=>!line.modeName||line.modeName==='bus'||!busOnly(stop)).map(line=>[line.id,line])).values()]:undefined};
 }
 function expand(stops){
  const result=new Map();
  function visit(value){
   const stop=normalize(value);
   const children=(stop.children??[]).filter(child=>busOnly(child)&&physical(child));
   if(busOnly(stop)&&!physical(stop)&&children.length){children.forEach(visit);return;}
   if(!stop.id)return;
   const previous=result.get(stop.id);
   result.set(stop.id,previous?normalize({...previous,...stop,lines:[...(previous.lines??[]),...(stop.lines??[])]}):stop);
  }
  stops.forEach(visit);return [...result.values()];
 }
 function remember(stops){for(const stop of stops){if(stop?.id)cache.set(stop.id,stop);remember(stop?.children??[]);}}
 async function enrich(stops,signal){
  const unique=[...new Map(stops.map(stop=>[stop.id,stop])).values()];
  const missing=unique.filter(stop=>busOnly(stop)&&!cache.has(stop.id)&&!Array.isArray(stop.lines));
  if(missing.length){
   // Keep detail requests small. One unavailable stand must not hide rail results.
   const batches=[];for(let i=0;i<missing.length;i+=10)batches.push(missing.slice(i,i+10));
   await Promise.allSettled(batches.map(async batch=>{
    const response=await fetch('https://api.tfl.gov.uk/StopPoint/'+batch.map(stop=>encodeURIComponent(stop.id)).join(','),{
     signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Stop details unavailable');
    const data=await response.json();remember(Array.isArray(data)?data:[data]);
   }));
  }
  signal?.throwIfAborted();
  return expand(unique.map(stop=>({...stop,...(cache.get(stop.id)??{}),detailsLoaded:cache.has(stop.id)||Array.isArray(stop.lines)})));
 }
 function describe(stop,language='en',includeRoutes=true){
  stop=normalize(stop);const zh=language==='zh';
  const routes=(stop.lines??[]).map(line=>line.name||line.id).sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
  const direction=stop.towards||(stop.compass?({N:'Northbound',S:'Southbound',E:'Eastbound',W:'Westbound',NE:'Northeastbound',NW:'Northwestbound',SE:'Southeastbound',SW:'Southwestbound'}[stop.compass]||stop.compass):'');
  return [stop.name,stop.stopLetter?(zh?'站牌 ':'Stop ')+stop.stopLetter:busOnly(stop)&&!direction?(zh?'站碼 ':'Stop code ')+(stop.smsCode||stop.id):'',direction?(stop.towards?(zh?'往 ':'Towards '):'')+direction:'',
   includeRoutes&&routes.length?(zh?'路線 ':'Routes ')+routes.join(', '):''].filter(Boolean).join(' · ');
 }
 root.TransportStops={busOnly,physical,normalize,expand,enrich,describe,remember};
})(typeof window==='undefined'?globalThis:window);
