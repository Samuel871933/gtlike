/* Cité continue : navigation dans les couloirs aériens et services aux quais. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
const world=$('sky-world'),ship=$('airship'),sprite=$('airship-sprite');
const asset=name=>`zeppelin/assets/districts/${name}.webp`;
const names=['alliage','condensat','éther'],icons=['⬡','◈','◇'];
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const cities=[
 {id:'hautes',name:'QUARTIER DU MÉRIDIEN',x:605,y:230,theme:'ivory',price:[6,7,13]},
 {id:'forges',name:'LES FORGES DE CENDRE',x:920,y:535,theme:'copper',price:[4,9,15]},
 {id:'azur',name:'LES TERRASSES D’AZUR',x:290,y:215,theme:'cyan',price:[8,4,14]},
 {id:'ether',name:'L’ACADÉMIE SUSPENDUE',x:870,y:280,theme:'violet',price:[8,8,9]}
];
// Coordonnées relevées sur l’illustration 1536 × 1024, normalisées en 1200 × 800.
const ports={
 port:[625,235,'north'],marche:[420,415,'west'],atelier:[330,565,'southwest'],
 cuivre:[825,475,'east'], 'forge-marche':[870,500,'east'], 'forge-douane':[850,490,'east'],
 sources:[320,265,'water'], 'azur-marche':[345,270,'water'], 'azur-atelier':[335,185,'waterNorth'],
 violet:[855,335,'academy'], 'ether-marche':[890,330,'academy'], 'ether-douane':[835,320,'academy']
};
const lanes={
 waterNorth:{x:420,y:195},water:{x:420,y:285},north:{x:580,y:290},
 west:{x:510,y:390},center:{x:630,y:405},academy:{x:765,y:335},
 east:{x:755,y:465},south:{x:615,y:515},southwest:{x:450,y:575},southeast:{x:765,y:585}
};
const laneEdges=[['waterNorth','water'],['water','north'],['water','west'],['north','center'],['west','center'],['center','academy'],['center','east'],['center','south'],['south','southwest'],['south','southeast'],['east','southeast']];
const navigation=window.CityNavigation.create(lanes,laneEdges);
function route(from,to,berth=0,fromBerth=0){return [dock(from,fromBerth),...navigation.path(from.lane,to.lane),dock(to,berth)]}
function routePath(points){return points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ')}
const definitions=[
 ['hautes','port','Douanes impériales','customs','security',-1,'Scellez les compartiments de votre cale. Les scellés protègent deux trajets contre une interception simulée.'],
 ['hautes','marche','Halles des Trois-Vents','market','market',-1,'Achetez ou vendez au cours local. Le marché est accessible uniquement depuis son propre quai.'],
 ['hautes','atelier','Chantier du Méridien','shipyard','workshop',-1,'Réparez la coque et consultez les équipements du zeppelin. Un port indépendant dessert l’atelier.'],
 ['forges','cuivre','Fonderie des Braises','foundry','production',0,'Chargez l’alliage produit dans ces fourneaux suspendus. Les ponts métalliques relient ce quartier aux halles.'],
 ['forges','forge-marche','Bourse du Cuivre','market','market',-1,'L’alliage coûte moins cher près des fonderies. Comparez les marchés des autres villes pour vos expéditions.'],
 ['forges','forge-douane','Poste des Sentinelles','customs','security',-1,'Faites poser des scellés avant de quitter les voies industrielles et leurs capitaines rivaux.'],
 ['azur','sources','Condenseurs du Levant','waterworks','production',1,'Les dômes captent la brume et chargent votre cale en condensat. Ce quartier possède ses propres pontons.'],
 ['azur','azur-marche','Marché des Sources','market','market',-1,'Le condensat est abondant ici. Achetez localement ou vendez les cargaisons amenées des autres cités.'],
 ['azur','azur-atelier','Ateliers hydrauliques','shipyard','workshop',-1,'Les mécaniciens entretiennent coques, turbines et circuits de refroidissement. Amarrez-vous à leur quai.'],
 ['ether','violet','Distillerie de l’Académie','refinery','production',2,'Les réacteurs transforment l’éther en combustible. Récupérez une cargaison puis rejoignez un marché.'],
 ['ether','ether-marche','Comptoir des Arcanistes','market','market',-1,'Le cours de l’éther est bas au pied des distilleries. Le négoce finance les réparations et la protection de la cale.'],
 ['ether','ether-douane','Chambre des Sceaux','customs','security',-1,'Scellez vos ressources précieuses avant le retour. Chaque quartier de la cité dispose d’un amarrage distinct.']
];
const portGroups={'forge-marche':'cuivre','forge-douane':'cuivre','azur-marche':'sources','azur-atelier':'sources','ether-marche':'violet','ether-douane':'violet'};
function portId(d){return portGroups[d.id]||d.id}
function samePort(a,b){return portId(a)===portId(b)}
const districts=definitions.map(([cityId,id,name,art,kind,resource,description])=>{
 const city=cities.find(c=>c.id===cityId),[x,y,lane]=ports[portGroups[id]||id];
 return {id,name,art,kind,resource,description,city,x,y,lane,reserve:resource<0?0:2400};
});
const players=[
 {name:'Lyra',ship:'Le Méridien',district:'marche',berth:1,relation:'ally',angle:4},
 {name:'Viktor',ship:'L’Orage',district:'port',berth:1,relation:'neutral',angle:0},
 {name:'Nox',ship:'La Cendre',district:'cuivre',berth:1,relation:'rival',angle:6},
 {name:'Iris',ship:'L’Aurore',district:'sources',berth:1,relation:'ally',angle:3}
];
const berthOffsets=[{x:0,y:0},{x:8,y:14}];
let current=districts[0],chosen=districts[1],myBerth=0,busy=null,credits=1800,hull=100,sealTrips=0,raidArmed=false;
let zoom=matchMedia('(max-width: 560px)').matches?1.35:1,pan={x:0,y:0},firstOpen=true,drag=null,suppressClick=false,lastStatus='',manifest=[0,0,0];
let shipPos=dock(current);
const kindLabels={market:'Marché · achat / vente',production:'Production · collecte',workshop:'Chantier · entretien',security:'Douanes · protection'};
for(let n=0;n<8;n++){const image=new Image();image.src=`zeppelin/assets/map/zeppelin-angle-${n}.webp`}
function svg(tag,attrs={}){const el=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);return el}
function coords(d){return [260+Math.floor(d.x/50),90+Math.floor(d.y/40)]}
function dock(d,n=myBerth){return {x:d.x+berthOffsets[n].x,y:d.y+berthOffsets[n].y}}
function freeBerth(d){return [0,1].find(n=>!players.some(p=>portId({id:p.district})===portId(d)&&p.berth===n))}
function canAct(kind){return !busy&&samePort(current,chosen)&&chosen.kind===kind}
function capacity(){return 22000+(modules.find(m=>m.id==='cale').level-8)*1000}
function usedCargo(){return stock.reduce((sum,n)=>sum+n,0)}
function availableSpace(r){return Math.max(0,Math.min(capacity()-usedCargo(),12000-stock[r]))}
function announce(text){if(text!==lastStatus){$('map-status').textContent=text;lastStatus=text}}
function journal(text){$('journal').textContent=text}
function transactionMessage(text){announce(text);journal(text)}
function orient(el,dx,dy){const n=(Math.round(Math.atan2(dy,dx)/(Math.PI/4))+8)%8;el.style.backgroundImage=`url('zeppelin/assets/map/zeppelin-angle-${n}.webp')`;el.dataset.angle=n}
function duration(d){return Math.round(1600+navigation.length(route(current,d,freeBerth(d)??0,myBerth))*14+($('guarded-route').checked?1800:0))}
function place(p){ship.style.left=p.x/12+'%';ship.style.top=p.y/8+'%';$('mini-ship').setAttribute('transform',`translate(${p.x} ${p.y})`)}
function syncStock(){['alloy','water','ether'].forEach((id,i)=>$(id).textContent=fmt(stock[i]));select(selected)}
function showView(map){$('map-view').hidden=!map;$('deck-view').hidden=map;for(const id of ['map','deck']){const active=(id==='map')===map;$(id+'-tab').setAttribute('aria-selected',active);$(id+'-tab').tabIndex=active?0:-1}if(map){if(firstOpen){centerOn({x:600,y:400});firstOpen=false}else transform();update()}}
function choose(d){chosen=d;update()}
function progress(n){$('map-progress').style.width=n+'%';document.querySelector('.travel-progress').setAttribute('aria-valuenow',Math.round(n))}

// Fond unique et points interactifs posés sur ses quais.
const background=document.createElement('img');background.className='city-background';background.src='zeppelin/assets/map/ville-celeste-equilibree.webp';background.alt='Cité continue sombre traversée de couloirs aériens et de ports en hauteur';background.draggable=false;world.prepend(background);
const connections=svg('svg',{viewBox:'0 0 1200 800',preserveAspectRatio:'none',class:'city-connections','aria-hidden':'true'});
for(const [a,b] of laneEdges)connections.append(svg('line',{x1:lanes[a].x,y1:lanes[a].y,x2:lanes[b].x,y2:lanes[b].y}));world.append(connections);
$('minimap').prepend(svg('image',{href:'zeppelin/assets/map/ville-celeste-equilibree.webp',width:1200,height:800}));
const moorings=svg('svg',{viewBox:'0 0 1200 800',preserveAspectRatio:'none',class:'mooring-overlay','aria-hidden':'true'});world.append(moorings);
for(const d of districts.filter(d=>!portGroups[d.id])){
 const button=document.createElement('button');button.className='sky-island district';button.dataset.island=d.id;button.dataset.district=d.id;button.style.cssText=`--ix:${d.x/12};--iy:${d.y/8};--district-depth:${Math.round(d.y)}`;
 button.setAttribute('aria-label',`${d.name}, ${kindLabels[d.kind]}, ${d.city.name}, coordonnées ${coords(d).join(', ')}`);
 button.innerHTML=`<span class="district-caption"><span class="district-symbol">${{market:'⚖',production:'◇',workshop:'⚙',security:'⬡'}[d.kind]}</span>${({market:'Marché',production:d.resource===0?'Fonderie':d.resource===1?'Condenseurs':'Raffinerie',workshop:'Chantier',security:'Douanes'})[d.kind]}</span><span class="district-port">Ⅱ Quai</span>`;
 button.addEventListener('click',()=>{if(!suppressClick)choose(d)});world.append(button);
 const dot=svg('circle',{cx:d.x,cy:d.y,r:9,tabindex:0,role:'button','aria-label':d.name});dot.setAttribute('fill',({market:'#dfc68c',production:'#85c8c8',workshop:'#adbbbd',security:'#a2d5b0'})[d.kind]);dot.append(svg('title'));dot.firstChild.textContent=d.name;
 const pick=()=>{choose(d);centerOn(d)};dot.addEventListener('click',pick);dot.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();pick()}});$('minimap').insertBefore(dot,$('mini-ship'));
}
for(const p of players){const d=districts.find(d=>d.id===p.district),pos=dock(d,p.berth);const b=document.createElement('button');b.className=`other-airship ${p.relation}`;b.dataset.player=p.name;b.style.left=pos.x/12+'%';b.style.top=pos.y/8+'%';b.setAttribute('aria-label',`${p.name}, ${p.ship}, amarré au quartier ${d.name}`);b.innerHTML=`<span class="other-sprite" style="background-image:url('zeppelin/assets/map/zeppelin-angle-${p.angle}.webp')"></span><span class="player-flag">${p.name}</span>`;p.element=b;p.pos=pos;p.current=d;p.nextDeparture=performance.now()+5000+players.indexOf(p)*2200;b.addEventListener('click',()=>{choose(p.current);announce(`${p.name} · ${p.ship} · ${p.action?'En circulation':'À quai'}.`)});world.append(b)}

// Panneaux de quartier et économie.
const side=document.querySelector('.map-side');
const service=document.createElement('section');service.className='card district-service';service.innerHTML=`<div class="eyebrow">Services du quartier</div><div id="district-services"></div>`;
side.insertBefore(service,side.children[1]);
const security=document.createElement('section');security.className='card cargo-card';security.innerHTML=`<div class="eyebrow">Votre cargaison</div><h2>Traverser sans perdre</h2><div class="stat"><span>Crédits</span><strong id="credits"></strong></div><div class="stat"><span>Cale occupée</span><strong id="cargo-capacity"></strong></div><div class="cargo-meter"><span id="cargo-fill"></span></div><div class="stat"><span>Coque</span><strong id="hull"></strong></div><div class="stat"><span>Scellés</span><strong id="seals"></strong></div><label class="route-option"><input type="checkbox" id="guarded-route" checked> Couloir surveillé <small>+1,8 s · interception évitée</small></label><button class="map-secondary" id="arm-raid">Préparer une interception (démo)</button><p id="risk-status" class="map-help"></p>`;side.insertBefore(security,service.nextSibling);
const harbor=document.createElement('section');harbor.className='card harbor-card';harbor.innerHTML='<div class="eyebrow">Port propre au quartier</div><h2>Capitainerie</h2><div id="harbor-berths"></div>';side.insertBefore(harbor,security.nextSibling);
const wallet=document.createElement('div');wallet.className='economy-strip';wallet.innerHTML='<span>◉ <b id="wallet-credits">1 800</b> crédits</span><span id="wallet-cargo"></span><span id="wallet-protection"></span>';document.querySelector('.view-tabs').after(wallet);
const navigator=document.createElement('nav');navigator.className='city-switcher';navigator.setAttribute('aria-label','Choisir un quartier de la cité');for(const city of cities){const b=document.createElement('button');b.textContent=({hautes:'Hautes-Cités',forges:'Forges',azur:'Terrasses',ether:'Académie'})[city.id];b.dataset.city=city.id;b.addEventListener('click',()=>{choose(districts.find(d=>d.city===city));centerOn(city)});navigator.append(b)}document.querySelector('.sky-frame .toolbar').after(navigator);
const atlas=document.createElement('details');atlas.className='card model-sheet';atlas.innerHTML='<summary>Planche du zeppelin · 8 angles</summary><a href="zeppelin/assets/map/zeppelin-directions.webp" target="_blank" rel="noopener"><img src="zeppelin/assets/map/zeppelin-directions.webp" alt="Huit orientations du zeppelin"></a>';side.append(atlas);
$('map-collect').hidden=true;document.querySelector('#map-view .toolbar>div').innerHTML='VOIES CÉLESTES <span> / 1 cité · 6 ports</span>';
side.querySelectorAll('.stat').forEach(row=>{if(row.querySelector('strong')?.id==='island-stock')row.querySelector('span').textContent='Ressource / service'});
$('map-goto').closest('.card').querySelector('.map-help').textContent='Choisissez un quartier et rejoignez son port pour accéder au marché, à la collecte ou aux services. Les trajets suivent les couloirs aériens entre les bâtiments.';
document.querySelector('.map-nav-hint').textContent='Voies aériennes des Hautes-Cités';
 document.querySelector('.sky-corner').firstChild.textContent='LES HAUTES-CITÉS';
 document.querySelector('.map-legend').innerHTML='<span style="--legend:#dfc68c">Marché</span><span style="--legend:#85c8c8">Production</span><span style="--legend:#a2d5b0">Services</span>';
$('map-goto').querySelector('button').title='Sélectionner le quartier le plus proche';

function renderServices(){
 const active=samePort(current,chosen)&&!busy;
 const root=$('district-services'),quantity=root.querySelector('#trade-quantity')?.value??'100';
 if(chosen.kind==='market'){
  root.innerHTML=`<h2>Comptoir de négoce</h2><p class="service-hint">${active?'Amarré · transactions disponibles':'Rejoignez ce quai pour commercer'}</p><label class="trade-label" for="trade-quantity">Quantité par transaction</label><input id="trade-quantity" type="number" min="1" max="1000" step="1" value="100"><div id="trade-rows"></div><p class="map-help">Prix par unité. Vente au cours affiché ; achat avec une marge de 2 crédits. Les cours diffèrent selon la cité.</p>`;
  for(let r=0;r<3;r++){const sell=chosen.city.price[r],buy=sell+2,row=document.createElement('div');row.className='trade-row';row.innerHTML=`<div>${icons[r]} ${names[r]}<small>Vente ${sell} ◉ · achat ${buy} ◉</small></div><button data-trade="sell" data-resource="${r}" ${active?'':'disabled'}>Vendre</button><button data-trade="buy" data-resource="${r}" ${active?'':'disabled'}>Acheter</button>`;root.querySelector('#trade-rows').append(row)}
  root.querySelector('#trade-quantity').value=quantity;
  root.querySelectorAll('[data-trade]').forEach(b=>b.addEventListener('click',()=>trade(b.dataset.trade,Number(b.dataset.resource))));
 }else if(chosen.kind==='production'){
  root.innerHTML=`<h2>Charger la cale</h2><p class="service-hint">${icons[chosen.resource]} ${names[chosen.resource]} · ${fmt(chosen.reserve)} disponibles</p><button id="district-collect" class="primary" ${active&&chosen.reserve>0&&availableSpace(chosen.resource)>0?'':'disabled'}>Collecter jusqu’à 240 unités</button><p class="map-help">Collecte en 3 secondes. La cale et le stock du quartier limitent le chargement.</p>`;root.querySelector('button').addEventListener('click',collect);
 }else if(chosen.kind==='security'){
  root.innerHTML=`<h2>Sceller les compartiments</h2><p class="service-hint">${sealTrips?`${sealTrips} trajet(s) protégé(s) restant(s)`:'Votre cargaison n’est pas scellée'}</p><button id="seal-cargo" class="primary" ${active&&credits>=60&&sealTrips<2?'':'disabled'}>Poser les scellés · 60 crédits</button><p class="map-help">Empêche le vol simulé durant les deux prochains voyages. La surveillance des couloirs reste gratuite.</p>`;root.querySelector('button').addEventListener('click',()=>{if(!canAct('security')||credits<60||sealTrips>=2)return;credits-=60;sealTrips=2;transactionMessage('Compartiments scellés : les deux prochains trajets sont protégés.');update()});
 }else{
  root.innerHTML=`<h2>Atelier de coque</h2><p class="service-hint">Intégrité ${hull} % · entretien du vaisseau</p><button id="repair-hull" class="primary" ${active&&hull<100&&credits>=40?'':'disabled'}>Réparer la coque · 40 crédits</button><button class="map-secondary" id="open-shipyard">Gérer les bâtiments du zeppelin</button><p class="map-help">Les équipements sont améliorés depuis le pont. La réparation remet la coque à 100 %.</p>`;root.querySelector('#repair-hull').addEventListener('click',()=>{if(!canAct('workshop')||hull>=100||credits<40)return;credits-=40;hull=100;transactionMessage('Coque réparée. Votre zeppelin est prêt à reprendre les airs.');update()});root.querySelector('#open-shipyard').addEventListener('click',()=>{select('atelier');showView(false)});
 }

 const services=districts.filter(d=>samePort(d,chosen));
 if(services.length>1){
  const tabs=document.createElement('div');tabs.className='port-services';tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Services de ce port');
  for(const d of services){const b=document.createElement('button');b.textContent=kindLabels[d.kind].split(' · ')[0];b.dataset.service=d.id;b.setAttribute('aria-pressed',d===chosen);b.addEventListener('click',()=>choose(d));tabs.append(b)}
  root.prepend(tabs);
 }
}
function trade(direction,r){
 if(!canAct('market'))return;
 const amount=Number($('trade-quantity').value);if(!Number.isInteger(amount)||amount<1||amount>1000){announce('Choisissez une quantité entière entre 1 et 1 000.');return}
 const unit=chosen.city.price[r]+(direction==='buy'?2:0),total=amount*unit;
 if(direction==='buy'){
  if(credits<total){announce('Crédits insuffisants pour cet achat.');return}if(availableSpace(r)<amount){announce('Capacité de cale insuffisante pour cet achat.');return}credits-=total;stock[r]+=amount;
 }else{if(stock[r]<amount){announce('La cale ne contient pas cette quantité.');return}stock[r]-=amount;credits+=total}
 syncStock();transactionMessage(`${direction==='buy'?'Achat':'Vente'} : ${fmt(amount)} ${names[r]} pour ${fmt(total)} crédits à ${chosen.name}.`);update();
}
function renderHarbor(){
 $('harbor-berths').innerHTML=[0,1].map(n=>{const npc=players.find(p=>portId({id:p.district})===portId(chosen)&&p.berth===n),mine=samePort(chosen,current)&&myBerth===n&&(!busy||busy.kind!=='travel'),reserved=busy?.kind==='travel'&&samePort(busy.target,chosen)&&busy.berth===n;return `<div class="berth-row ${mine?'mine':npc?.relation||''}"><span class="berth-number">0${n+1}</span><span>${mine?'L’Audacieux':npc?npc.ship:reserved?'L’Audacieux en approche':'Poste libre'}<small>${mine?'Vous · amarré':npc?npc.name+(npc.action?' · en approche':' · amarré'):reserved?'Réservé':'Disponible'}</small></span><i>${mine||npc?'●':'○'}</i></div>`}).join('');
}
function drawMoorings(){moorings.replaceChildren();for(const d of districts.filter(d=>!portGroups[d.id])){if(!samePort(d,chosen)&&!samePort(d,current)&&!players.some(p=>portId({id:p.district})===portId(d)))continue;for(let n=0;n<2;n++){const p=dock(d,n),used=players.some(v=>v.district===d.id&&v.berth===n)||(samePort(d,current)&&n===myBerth&&busy?.kind!=='travel');moorings.append(svg('line',{x1:d.x,y1:d.y,x2:p.x,y2:p.y+4,class:used?'occupied':'available'}),svg('circle',{cx:p.x,cy:p.y+4,r:2,class:used?'occupied':'available'}))}}}
function update(){
 $('island-type').textContent=chosen.city.name+' / '+kindLabels[chosen.kind];$('island-name').textContent=chosen.name;$('island-detail').src=asset(chosen.art);$('island-detail').alt=chosen.name;$('island-description').textContent=chosen.description;
 $('island-coordinates').textContent=coords(chosen).join(' | ');$('island-stock').textContent=chosen.resource<0?kindLabels[chosen.kind]:`${fmt(chosen.reserve)} ${names[chosen.resource]}`;
 $('island-duration').textContent=samePort(chosen,current)?'Amarré dans ce quartier':`${(duration(chosen)/1000).toFixed(1)} s · démo`;
 $('map-travel').disabled=!!busy||samePort(current,chosen)||freeBerth(chosen)===undefined;$('map-travel').textContent=busy?'Manœuvre en cours':samePort(chosen,current)?'Vous êtes à quai':'Rejoindre le port du quartier →';
 for(const b of world.querySelectorAll('.district')){const selected=b.dataset.district===portId(chosen);b.classList.toggle('chosen',selected);b.classList.toggle('stationed',b.dataset.district===portId(current)&&busy?.kind!=='travel');b.setAttribute('aria-pressed',selected)}
 $('route-preview').setAttribute('d',!busy&&!samePort(chosen,current)?routePath(route(current,chosen,freeBerth(chosen)??0,myBerth)):'');
 $('map-location').textContent=(busy?.kind==='travel'?'En vol vers '+busy.target.name:current.name)+' · '+coords(current).join(' | ');
 $('map-x').value=coords(chosen)[0];$('map-y').value=coords(chosen)[1];
 $('map-manifest').textContent='Collecté : '+manifest.map((n,i)=>icons[i]+' '+fmt(n)).join(' · ');
 $('credits').textContent=fmt(credits)+' ◉';$('wallet-credits').textContent=fmt(credits);$('cargo-capacity').textContent=fmt(usedCargo())+' / '+fmt(capacity());$('wallet-cargo').textContent='Cale '+fmt(usedCargo())+' / '+fmt(capacity());$('cargo-fill').style.width=Math.min(100,usedCargo()/capacity()*100)+'%';$('hull').textContent=hull+' %';$('seals').textContent=sealTrips?sealTrips+' trajet(s)':'Aucun';$('wallet-protection').textContent=sealTrips?'⬡ Cale scellée · '+sealTrips+' vols':'⬡ Cale non scellée';
 $('arm-raid').disabled=!!busy;$('arm-raid').textContent=raidArmed?'Interception prévue · annuler':'Préparer une interception (démo)';$('risk-status').textContent=raidArmed?'Prochain vol : tentative de vol simulée. Un couloir surveillé ou des scellés empêchent la perte.':'Aucun vol aléatoire. Déclenchez une interception pour tester la protection de la cargaison.';
 document.querySelector('.flight').innerHTML=`<span class="dot">●</span> ${busy?.kind==='travel'?'En route · '+busy.target.name:busy?'Chargement de la cale':'Amarré · '+current.name}<br>${current.city.name}`;
 document.querySelector('.heading .eyebrow').textContent='Votre vaisseau · '+coords(current).join(' | ');
 $('map-view').dataset.phase=busy?.kind||'idle';$('map-view').dataset.current=current.id;$('map-view').dataset.credits=credits;$('map-view').dataset.seals=sealTrips;$('map-view').dataset.hull=hull;
 renderServices();renderHarbor();drawMoorings();
}
function travel(){
 if(busy||samePort(chosen,current))return;const berth=freeBerth(chosen);if(berth===undefined)return;
 const end=dock(chosen,berth),points=route(current,chosen,berth,myBerth);busy={points,kind:'travel',target:chosen,berth,start:performance.now(),duration:duration(chosen),from:{...shipPos},end,guarded:$('guarded-route').checked,sealed:sealTrips>0,raid:raidArmed};raidArmed=false;
 orient(sprite,points[1].x-shipPos.x,points[1].y-shipPos.y);sprite.classList.add('propelling');$('route-live').setAttribute('d',routePath(points));journal('Départ vers '+chosen.name+'.');update();
}
function collect(){if(!canAct('production')||chosen.reserve<=0||availableSpace(chosen.resource)<=0)return;busy={kind:'collect',target:chosen,start:performance.now(),duration:3000};ship.classList.add('collecting');update()}
function resolveInterception(action){
 if(action.sealed)sealTrips=Math.max(0,sealTrips-1);
 if(!action.raid)return '';
 if(action.guarded)return ' Interception simulée évitée par le couloir surveillé.';
 if(action.sealed)return ' Interception simulée : les scellés ont protégé la cale.';
 const r=stock.indexOf(Math.max(...stock)),loss=Math.min(120,stock[r]);stock[r]-=loss;hull=Math.max(0,hull-10);syncStock();return ` Interception simulée : −${loss} ${names[r]}, coque −10 %.`;
}
function animate(now){if(!busy)return;const action=busy,elapsed=now-action.start,p=Math.min(1,elapsed/action.duration);progress(p*100);
 if(action.kind==='travel'){const t=Math.max(0,Math.min(1,(elapsed-500)/(action.duration-1000)));const sample=navigation.sample(action.points,t);shipPos=sample.point;orient(sprite,sample.dx,sample.dy);place(shipPos);if(!reduced)sprite.style.setProperty('--bank',Math.sin(t*Math.PI*2)*3+'deg');announce(`${elapsed<500?'Décollage':elapsed>action.duration-500?'Amarrage':'En vol'} · ${action.target.name} · ${Math.max(0,Math.ceil((action.duration-elapsed)/1000))} s`)}else announce('Collecte · '+Math.max(0,Math.ceil((action.duration-elapsed)/1000))+' s');
 if(p<1)return;busy=null;sprite.classList.remove('propelling');sprite.style.setProperty('--bank','0deg');ship.classList.remove('collecting');
 if(action.kind==='travel'){current=action.target;chosen=current;myBerth=action.berth;shipPos=dock(current);place(shipPos);$('route-live').setAttribute('d','');const result=resolveInterception(action);transactionMessage('Amarré au port de '+current.name+'.'+result);centerOn({x:600,y:400})}else{const r=action.target.resource,n=Math.max(0,Math.min(240,action.target.reserve,availableSpace(r)));stock[r]+=n;action.target.reserve-=n;manifest[r]+=n;syncStock();transactionMessage(`Collecte terminée : +${fmt(n)} ${names[r]} dans la cale.`)}update();
}

// Les autres capitaines réservent un quai, suivent les mêmes voies et marquent une pause.
function animateTraffic(now){
 for(const p of players){
  if(!p.action&&now>=p.nextDeparture){
   const candidates=districts.filter(d=>!samePort(d,p.current)&&!players.some(q=>q!==p&&portId({id:q.district})===portId(d)&&q.berth===1)&&!(samePort(current,d)&&myBerth===1)&&!(busy?.kind==='travel'&&samePort(busy.target,d)&&busy.berth===1));
   if(!candidates.length){p.nextDeparture=now+2000;continue}
   const target=candidates[(p.trip||0)%candidates.length],points=route(p.current,target,1,1);
   p.trip=(p.trip||0)+1;p.district=target.id;p.action={target,points,start:now,duration:2000+navigation.length(points)*22};
   p.element.querySelector('.other-sprite').classList.add('propelling');update();
  }
  if(p.action){
   const action=p.action,t=Math.min(1,(now-action.start)/action.duration),sample=navigation.sample(action.points,t);
   p.pos=sample.point;p.element.style.left=p.pos.x/12+'%';p.element.style.top=p.pos.y/8+'%';orient(p.element.querySelector('.other-sprite'),sample.dx,sample.dy);
   p.element.setAttribute('aria-label',`${p.name}, ${p.ship}, en vol vers ${action.target.name}`);
   if(t===1){p.current=action.target;p.action=null;p.nextDeparture=now+6000+players.indexOf(p)*1100;p.element.querySelector('.other-sprite').classList.remove('propelling');p.element.setAttribute('aria-label',`${p.name}, ${p.ship}, amarré à ${p.current.name}`);update()}
  }
 }
}
// Navigation commune au pont et à la carte.
$('map-tab').addEventListener('click',()=>showView(true));$('deck-tab').addEventListener('click',()=>showView(false));$('map-tab').tabIndex=-1;
for(const tab of [$('map-tab'),$('deck-tab')])tab.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const map=e.key==='End'||(e.key!=='Home'&&tab.id==='deck-tab');showView(map);$(map?'map-tab':'deck-tab').focus()}});
function transform(){world.style.transform=`translate(${pan.x}px,${pan.y}px) scale(${zoom})`;const r=$('sky-viewport').getBoundingClientRect(),w=world.getBoundingClientRect();if(!r.width)return;const x=Math.max(0,(r.left-w.left)/w.width*1200),y=Math.max(0,(r.top-w.top)/w.height*800);for(const [key,v]of Object.entries({x,y,width:Math.min(1200-x,r.width/w.width*1200),height:Math.min(800-y,r.height/w.height*800)}))$('mini-window').setAttribute(key,Math.max(0,v))}
function centerOn(p){const width=world.offsetWidth*zoom,height=world.offsetHeight*zoom;pan={x:(600-p.x)/1200*width,y:(400-p.y)/800*height};transform()}
function setZoom(z){zoom=Math.max(.8,Math.min(3,z));transform()}
$('map-plus').addEventListener('click',()=>setZoom(zoom+.25));$('map-minus').addEventListener('click',()=>setZoom(zoom-.25));$('map-center').addEventListener('click',()=>centerOn({x:600,y:400}));$('map-travel').addEventListener('click',travel);$('guarded-route').addEventListener('change',update);
$('arm-raid').addEventListener('click',()=>{if(busy)return;raidArmed=!raidArmed;update()});
$('map-reset').textContent='Réinitialiser la maquette';$('map-reset').addEventListener('click',()=>location.reload());
const viewport=$('sky-viewport');viewport.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,pan:{...pan}};suppressClick=false});viewport.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5){suppressClick=true;viewport.setPointerCapture(e.pointerId);pan={x:Math.max(-1600,Math.min(1600,drag.pan.x+dx)),y:Math.max(-1200,Math.min(1200,drag.pan.y+dy))};transform()}});const endDrag=()=>{drag=null;setTimeout(()=>suppressClick=false,0)};viewport.addEventListener('pointerup',endDrag);viewport.addEventListener('pointercancel',endDrag);window.addEventListener('pointerup',()=>drag=null);viewport.addEventListener('wheel',e=>{e.preventDefault();setZoom(zoom+(e.deltaY<0?.1:-.1))},{passive:false});window.addEventListener('resize',transform);
$('map-goto').addEventListener('submit',e=>{e.preventDefault();const x=Number($('map-x').value),y=Number($('map-y').value),nearest=districts.filter(d=>!portGroups[d.id]).sort((a,b)=>Math.hypot(coords(a)[0]-x,coords(a)[1]-y)-Math.hypot(coords(b)[0]-x,coords(b)[1]-y))[0];choose(nearest);centerOn(nearest.city)});
// Les bâtiments du pont dépensent aussi les ressources de la cale.
$('upgrade').addEventListener('click',()=>update());
place(shipPos);orient(sprite,1,0);announce('Amarré aux douanes. Choisissez un quartier : marché, atelier ou collecte.');update();
function frame(now){animate(now);if(!reduced)animateTraffic(now);requestAnimationFrame(frame)}requestAnimationFrame(frame);setInterval(()=>{const now=performance.now();if(busy)animate(now);if(!reduced)animateTraffic(now)},100);
})();
