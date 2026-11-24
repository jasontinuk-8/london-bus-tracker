const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const pages=['index.html','journeys.html','quick-journey.html'];
const html=Object.fromEntries(pages.map(name=>[name,fs.readFileSync(path.join(root,name),'utf8')]));
const languageSource=name=>html[name].slice(html[name].indexOf("const languageKey="),html[name].indexOf('let language=readLanguage();')+'let language=readLanguage();'.length);
function store(initial={}){const values=new Map(Object.entries(initial));return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}}
test('all pages use identical migration logic and the same shared preference',()=>{
 const source=languageSource(pages[0]);for(const page of pages)assert.equal(languageSource(page),source);
 for(const initial of [{'bus65-language':'en'},{'rail-journey-language':'en'},{'bus65-language':'zh'},{'bus-tracker-language':'zh','bus65-language':'en'},{'bus-tracker-language':'en','rail-journey-language':'zh'},{}]){
  const localStorage=store(initial);for(const page of pages){const c=vm.createContext({localStorage});vm.runInContext(languageSource(page),c);assert.equal(vm.runInContext('language',c),initial['bus-tracker-language']||initial['bus65-language']||initial['rail-journey-language']||'zh');}
 }
});
test('a choice on any page takes precedence over legacy settings on subsequent pages',()=>{
 const localStorage=store({'bus65-language':'en','rail-journey-language':'en'});
 const c=vm.createContext({localStorage});vm.runInContext(languageSource('quick-journey.html'),c);c.saveLanguage('zh');
 for(const page of pages){const next=vm.createContext({localStorage});vm.runInContext(languageSource(page),next);assert.equal(vm.runInContext('language',next),'zh');}
});
test('blocked storage does not crash a page, and a readable legacy preference survives write failure',()=>{
 for(const page of pages){
  let c=vm.createContext({localStorage:{getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}}});vm.runInContext(languageSource(page),c);assert.equal(vm.runInContext('language',c),'zh');
  c=vm.createContext({localStorage:{getItem:key=>key==='rail-journey-language'?'en':null,setItem(){throw Error('blocked')}}});vm.runInContext(languageSource(page),c);assert.equal(vm.runInContext('language',c),'en');
 }
});
function quickHarness(){
 const nodes=new Map();
 function node(id=''){return {id,textContent:'',value:'',hidden:false,disabled:false,dataset:{},validity:{customError:false,valueMissing:false},children:[],attributes:{},
  append(...children){this.children.push(...children)},replaceChildren(...children){this.children=children},setAttribute(k,v){this.attributes[k]=v},focus(){},
  addEventListener(){},setCustomValidity(v){this.validity.customError=!!v},querySelector(){return this.children.find(child=>child.tag==='button')||null}}}
 const get=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id)};
 const langs=['zh','en'].map(lang=>Object.assign(node(),{dataset:{lang}}));
 const labels=[...html['quick-journey.html'].matchAll(/data-i18n="([^"]+)"/g)].map(m=>Object.assign(node(),{dataset:{i18n:m[1]}}));
 const examples=labels.filter(el=>/^example\d/.test(el.dataset.i18n));
 const placeholders=[['sentence','sentencePlaceholder'],['startPoint','startPlaceholder']].map(([id,key])=>Object.assign(get(id),{dataset:{i18nPlaceholder:key}}));
 const aria=['navigation','examples','endpoints'].map(key=>Object.assign(node(),{dataset:{i18nAria:key}}));
 const submit=node('submit');get('search-form').querySelector=()=>submit;get('stations').hidden=true;
 const events={};const localStorage=store();const doc={documentElement:{lang:''},title:'',querySelector:selector=>get(selector.slice(1)),createElement:tag=>Object.assign(node(),{tag}),querySelectorAll:selector=>({'[data-lang]':langs,'[data-i18n]':labels,'[data-i18n-placeholder]':placeholders,'[data-i18n-aria]':aria,'.examples button':examples}[selector]||[])};
 const c=vm.createContext({document:doc,window:{addEventListener:(name,fn)=>events[name]=fn},localStorage,Intl,Date,AbortController,AbortSignal,URL,URLSearchParams,
 TransportStops:{busOnly:s=>s.modes?.length===1&&s.modes[0]==='bus',describe:(s,language)=>s.name+(language==='en'?' · Stop D · Towards Kingston':' · 站牌 D · 往 Kingston')}});
 const script=html['quick-journey.html'].split('<script type="module">')[1].split('</script>')[0];vm.runInContext(script,c);
 return {c,get,langs,labels,events,localStorage,doc};
}
test('every quick-journey text key has complete Chinese and English strings',()=>{
 const {c}=quickHarness();const messages=vm.runInContext('messages',c);
 for(const [key,pair]of Object.entries(messages)){assert.equal(pair.length,2,key);assert(pair.every(value=>typeof value==='string'&&value.length),key);}
 for(const match of html['quick-journey.html'].matchAll(/data-i18n(?:-placeholder|-aria)?="([^"]+)"/g))assert(messages[match[1]],match[1]);
});
test('changing language updates errors, confirmation and selected stops without clearing input or the journey',()=>{
 const {c,get,langs}=quickHarness();get('sentence').value='由 Richmond 去 Waterloo';
 vm.runInContext("setStatus('notFound',{place:'Unknown stop'})",c);langs[1].onclick();assert.match(get('status').textContent,/Could not find.*Unknown stop/);assert.equal(get('sentence').value,'由 Richmond 去 Waterloo');
 vm.runInContext("active={parsed:{from:'Richmond',to:'Waterloo',timing:{date:'20261125',time:'0730',timeIs:'departing'}},selected:{from:{id:'a',name:'Richmond Station',modes:['bus']},to:{id:'b',name:'Waterloo',modes:['tube']}},candidates:{}};selectStations(active)",c);
 assert.match(get('timing').textContent,/Depart at 2026-11-25 · 07:30/);assert.equal(get('choices').children[0].textContent,'Confirm and open Journey');
 langs[0].onclick();assert.equal(get('choices').children[0].textContent,'確認並開啟 Journey');assert.match(get('timing').textContent,/出發時間/);assert.equal(vm.runInContext('active.selected.from.id',c),'a');
});
test('parser semantics stay the same and both languages receive translated errors',()=>{
 const {c,langs}=quickHarness();const now=new Date('2026-11-24T06:00:00Z');
 let result=c.parseJourney('聽朝七點半由 Richmond 去 Waterloo',now);assert.equal(result.from,'Richmond');assert.equal(result.to,'Waterloo');assert.equal(result.timing.time,'0730');
 assert.match(c.parseJourney('由 Richmond',now).error,/目的地/);langs[1].onclick();assert.equal(c.parseJourney('由 Richmond',now).error,'Please enter a destination.');
 for(const example of ['From Durlston Road to Waterloo','From Richmond Station to Kingston','09:00 from Richmond to Victoria']){result=c.parseJourney(example,now);assert(!result.error,example);assert(result.from);assert(result.to);}
});
test('storage events and restored pages read the shared language setting',()=>{
 const {events,localStorage,doc}=quickHarness();localStorage.setItem('bus-tracker-language','en');events.storage({key:'bus-tracker-language'});assert.equal(doc.documentElement.lang,'en');
 localStorage.setItem('bus-tracker-language','zh');events.pageshow({persisted:true});assert.equal(doc.documentElement.lang,'zh-Hant');
});
