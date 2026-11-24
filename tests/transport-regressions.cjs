const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const tracker=fs.readFileSync(path.join(root,'index.html'),'utf8');
const shared=fs.readFileSync(path.join(root,'stop-search.js'),'utf8');
function source(name){
 const start=tracker.indexOf('function '+name+'(');assert(start>=0,name);
 const line=tracker.slice(start).split('\n')[0];
 return line.trim().endsWith('}')?line:tracker.slice(start,tracker.indexOf('\n}',start)+2);
}
function node(){return {hidden:false,disabled:false,children:[],attributes:{},textContent:'',replaceChildren(...items){this.children=items},append(item){this.children.push(item)},setAttribute(k,v){this.attributes[k]=v}}}
const stand={id:'490012293N',naptanId:'490012293N',commonName:'Footscray Road / Southend Crescent',modes:['bus'],stopLetter:'FG',lines:[{id:'160',name:'160'},{id:'233',name:'233'}],additionalProperties:[{key:'Towards',value:'Catford, Eltham Station Or Lee Green'}]};
const group={id:'490G00012293',naptanId:'490G00012293',commonName:stand.commonName,modes:['bus'],lines:stand.lines,children:[stand]};
test('SMS parent groups resolve to physical stands and retain distinct directions',()=>{
 const c=vm.createContext({});vm.runInContext(shared,c);const api=c.TransportStops;
 const opposite={...stand,id:'490012293S',naptanId:'490012293S',stopLetter:'FH'};
 const stops=api.expand([group,stand,opposite]);assert.equal(stops.length,2);assert.equal(stops[0].id,stand.id);
 assert.match(api.describe(stops[0]),/Stop FG.*Towards Catford.*Routes 160, 233/);
 assert(!api.describe({...stand,stopLetter:'->N'}).includes('->N'));
});
test('stop details are batched and reused without another fetch on selection',async()=>{
 let requests=0;
 const c=vm.createContext({AbortSignal,fetch:async()=>{requests++;return {ok:true,json:async()=>[stand]}}});vm.runInContext(shared,c);
 const matches=[{id:stand.id,name:stand.commonName,modes:['bus']},{id:stand.id,name:stand.commonName,modes:['bus']}];
 const stops=await c.TransportStops.enrich(matches);assert.equal(stops.length,1);await c.TransportStops.enrich(stops);assert.equal(requests,1);
});
function directionContext(saved,rail=false){
 const elements=new Map();const by=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id)};
 const station={options:[],replaceChildren(...items){this.options=items},add(item){this.options.push(item)}};
 const calls=[];
 const c=vm.createContext({line:'71',direction:'outbound',directions:['outbound','inbound'],routes:{outbound:[[stand.id,stand.commonName,'FG']],inbound:[]},nodes:{},stops:[],selected:0,rail,chosen:null,station,
 by,document:{createElement:node},Option:function(text,value){this.text=text;this.value=value},localStorage:{getItem:()=>saved},
 tr:(a,b)=>b,updateStopMap(){},drawDestinationDisplay(){},render(){},renderFavourites(){},renderTraffic(){},choose(index){calls.push(index)}});
 vm.runInContext(source('setDirection'),c);return {c,calls,station,by};
}
test('fresh bus route asks for boarding stop instead of choosing the first',()=>{
 const {c,calls,station}=directionContext(null);c.setDirection();assert.equal(c.selected,-1);assert.equal(station.value,'');assert.equal(calls.length,0);
});
test('saved or linked physical stops are restored; unmatched links never fall back',()=>{
 let state=directionContext(stand.id);state.c.setDirection();assert.deepEqual(state.calls,[0]);
 state=directionContext(null);state.c.setDirection(false,stand.id);assert.deepEqual(state.calls,[0]);
 state=directionContext(stand.id);state.c.setDirection(false,group.id);assert.deepEqual(state.calls,[]);assert.match(state.by('boardingNote').textContent,/could not be matched/);
});
test('rail retains its initial station selection',()=>{const {c,calls}=directionContext(null,true);c.setDirection();assert.deepEqual(calls,[0])});
test('favourite controls stay hidden and unstarred while loading or on an error',()=>{
 const elements=new Map();const by=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id)};const controls=node();
 const c=vm.createContext({routeReady:false,stops:[['stop','Saved stop']],selected:0,stopsFailed:false,nationalRail:false,mode:'bus',line:'71',direction:'outbound',favourites:[{mode:'bus',route:'71',direction:'outbound',stop:'stop'}],
 by,tr:(a,b)=>b,document:{querySelector:()=>controls,createElement:node}});
 vm.runInContext(['favouriteKey','currentFavourite','renderFavourites'].map(source).join('\n'),c);
 c.renderFavourites();assert.equal(controls.hidden,true);assert.equal(by('starStop').attributes['aria-pressed'],'false');
 c.routeReady=true;c.renderFavourites();assert.equal(controls.hidden,false);assert.equal(by('starStop').attributes['aria-pressed'],'true');
 c.stopsFailed=true;c.renderFavourites();assert.equal(controls.hidden,true);assert.equal(by('starStop').attributes['aria-pressed'],'false');
});
test('bus ETA says Due for 0–59 seconds and minutes from 60 seconds',()=>{
 const now=Date.parse('2026-11-24T14:00:00Z');const c=vm.createContext({language:'en',Date:{now:()=>now,parse:Date.parse}});vm.runInContext(source('eta'),c);
 for(const seconds of [0,1,45,59])assert.equal(c.eta({expectedArrival:new Date(now+seconds*1000).toISOString()}),'Due');
 assert.equal(c.eta({expectedArrival:new Date(now+60000).toISOString()}),'1 min');
});
test('route sequence cache shares in-flight work and survives page navigation',async()=>{
 const values=new Map();let requests=0;
 const c=vm.createContext({line:'160',sequenceRequests:new Map(),Date,AbortSignal,sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},fetch:async()=>{requests++;return {ok:true,status:200,json:async()=>({stopPointSequences:[{stopPoint:[stand]}]})}}});
 vm.runInContext('async '+source('routeSequence'),c);await Promise.all([c.routeSequence('inbound'),c.routeSequence('inbound')]);assert.equal(requests,1);
 c.sequenceRequests=new Map();await c.routeSequence('inbound');assert.equal(requests,1);
});
test('all page scripts parse and load the shared stop helper',()=>{
 for(const name of ['index.html','quick-journey.html','journeys.html']){
  const html=fs.readFileSync(path.join(root,name),'utf8');assert(html.includes('src="./stop-search.js"'));
  for(const match of html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g))new Function(match[1]);
 }
});

test('rail matches still request full station details for line badges',async()=>{
 const c=vm.createContext({AbortSignal,fetch:()=>{throw Error('No bus detail request expected')}});vm.runInContext(shared,c);
 const stops=await c.TransportStops.enrich([{id:'940GZZLURMD',name:'Richmond Underground Station',modes:['tube']}]);
 assert.equal(stops[0].detailsLoaded,false);assert.equal(stops[0].lines,undefined);
});

test('large searches use small batches and unavailable bus details do not hide rail results',async()=>{
 const sizes=[];const c=vm.createContext({AbortSignal,fetch:async url=>{sizes.push(url.split('/').at(-1).split(',').length);return {ok:false,status:503}}});vm.runInContext(shared,c);
 const matches=Array.from({length:21},(_,i)=>({id:'490TEST'+i,name:'Bus stop '+i,modes:['bus']}));
 matches.push({id:'940GZZLURMD',name:'Richmond',modes:['tube']});
 const stops=await c.TransportStops.enrich(matches);
 assert.deepEqual(sizes,[10,10,1]);assert.equal(stops.length,22);assert.equal(stops.at(-1).name,'Richmond');
});
