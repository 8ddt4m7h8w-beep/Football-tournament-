const KEY="football-tournament-v1";
const LEGACY_KEY="football-tournament-local-backup";
const SUPABASE_URL="https://rgjixxsagfnvylwvdpzg.supabase.co";
const SUPABASE_KEY="sb_publishable_4V3L2HoqXJMOjKiufXmL3w_xM9YppgF";
let db=null;
let isAdmin=false,authUser=null,syncTimer=null,lastSavedStamp=null,saveQueue=Promise.resolve(),pendingWrites=0;
const initial={teams:[
{id:"t1",name:"Команда 1",players:[["p1","Шевченко"],["p2","Курбанов"],["p3","Титаренко"],["p4","Буланов"]]},
{id:"t2",name:"Команда 2",players:[["p5","Сахончик"],["p6","Погорелов"],["p7","Данилов"],["p8","Умаров"]]},
{id:"t3",name:"Команда 3",players:[["p9","Базаев"],["p10","Мухтаров"],["p11","Абубикаров"],["p12","Андреев"]]},
{id:"t4",name:"Команда 4",players:[["p13","Найдёнов"],["p14","Терехов"],["p15","Мнацаканян"]]}].map(t=>({...t,players:t.players.map(([id,name])=>({id,name,goals:0}))})),
matches:[["m1","t1","t2"],["m2","t3","t4"],["m3","t2","t3"],["m4","t4","t1"],["m5","t2","t4"],["m6","t1","t3"]].map((x,i)=>({id:x[0],a:x[1],b:x[2],label:"Матч "+(i+1),day:"Среда / пятница · 7-й урок",minutes:10,scoreA:null,scoreB:null,completed:false,events:[]})),
playoff:{sf1:{scoreA:null,scoreB:null,winner:null},sf2:{scoreA:null,scoreB:null,winner:null},third:{scoreA:null,scoreB:null,winner:null},final:{scoreA:null,scoreB:null,winner:null}}};
let state=structuredClone(initial);try{state=JSON.parse(localStorage.getItem(KEY))||structuredClone(initial)}catch(e){state=structuredClone(initial)}
state.matches.forEach(m=>{if(!Array.isArray(m.events))m.events=[];if(typeof m.completed!=="boolean")m.completed=false});
async function save(msg="Изменения сохранены",immediate=false){
 try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){toast("Не удалось сохранить копию на устройстве");return false}
 if(!isAdmin){toast("Войдите как администратор, чтобы сохранить результат");return false}
 if(!db){toast("Сервис синхронизации временно недоступен");return false}
 clearTimeout(syncTimer);
 if(!immediate){syncTimer=setTimeout(()=>{save(msg,true)},450);return true}
 const task=saveQueue.then(async()=>{
  const snapshot=JSON.parse(JSON.stringify(state));
  const stamp=new Date().toISOString();
  pendingWrites++;
  try{
   const {data,error}=await db.from("tournament_state").update({state:snapshot,updated_at:stamp}).eq("id","main").select("id,updated_at").maybeSingle();
   if(error)throw error;
   if(!data||data.id!=="main")throw new Error("Сервер не подтвердил запись. Проверьте вход администратора.");
   lastSavedStamp=data.updated_at||stamp;
   try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}
   toast(msg);return true;
  }catch(error){
   lastSavedStamp=null;
   const detail=error?.message||error?.details||error?.hint||"Неизвестная ошибка";
   toast("Не удалось сохранить: "+detail);console.error("Tournament save failed:",error);return false;
  }finally{pendingWrites=Math.max(0,pendingWrites-1)}
 });
 saveQueue=task.then(()=>undefined,()=>undefined);
 return await task;
}
function restoreLocalState(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){console.error("Could not restore local backup:",e)}}
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const team=id=>state.teams.find(t=>t.id===id), name=id=>team(id)?.name||"—", done=m=>m.completed===true;
function renderMatches(){let el=document.getElementById("matchesList");el.innerHTML=state.matches.map(m=>`<article class="match-card" data-open-match="${m.id}" tabindex="0" role="button" aria-label="Открыть протокол ${esc(m.label)}"><div class="match-top"><span class="match-label">${esc(m.label)} · Среда / пятница · 7-й урок</span><span class="match-status ${done(m)?"":"pending"}">${done(m)?"ЗАВЕРШЁН":"ОЖИДАЕТСЯ"}</span></div><div class="match-row"><div class="team-side">${esc(name(m.a))}</div><div class="score-box"><input class="score-input" type="number" min="0" max="99" inputmode="numeric" placeholder="0" aria-label="Голы ${esc(name(m.a))}" value="${m.scoreA??0}" data-match="${m.id}" data-side="A" ${isAdmin?"":"disabled"}><span class="score-sep">:</span><input class="score-input" type="number" min="0" max="99" inputmode="numeric" placeholder="0" aria-label="Голы ${esc(name(m.b))}" value="${m.scoreB??0}" data-match="${m.id}" data-side="B" ${isAdmin?"":"disabled"}></div><div class="team-side right">${esc(name(m.b))}</div></div><div class="match-bottom"><span>⏱ ${m.minutes||10} минут · ${m.events?.length||0} событий</span>${isAdmin?`<button class="clear-score" data-clear="${m.id}">Сбросить матч</button><button class="clear-score finish-match" data-finish="${m.id}" ${done(m)?"disabled":""}>${done(m)?"Матч завершён ✓":"Матч завершён"}</button>`:""}</div><div class="open-protocol-hint">Нажмите, чтобы открыть протокол матча →</div></article>`).join("");
el.querySelectorAll("[data-open-match]").forEach(card=>{card.onclick=e=>{if(e.target.closest("input,button"))return;openProtocol(card.dataset.openMatch)};card.onkeydown=e=>{if((e.key==="Enter"||e.key===" ")&&e.target===card){e.preventDefault();openProtocol(card.dataset.openMatch)}}});
el.querySelectorAll("[data-match]").forEach(inp=>inp.addEventListener("change",async()=>{let m=state.matches.find(x=>x.id===inp.dataset.match);if(!m)return;const key="score"+inp.dataset.side,old=m[key],v=inp.value.trim();m[key]=v===""?null:Math.max(0,Math.min(99,parseInt(v)||0));m.completed=false;renderAll();if(!(await save("Счёт сохранён",true))){m[key]=old;renderAll()}}));
el.querySelectorAll("[data-finish]").forEach(b=>b.onclick=async()=>{let m=state.matches.find(x=>x.id===b.dataset.finish);if(!m)return;const before=structuredClone(m);m.scoreA=m.scoreA??0;m.scoreB=m.scoreB??0;m.completed=true;renderAll();if(!(await save("Матч отмечен как завершённый",true))){Object.assign(m,before);renderAll()}});
el.querySelectorAll("[data-clear]").forEach(b=>b.onclick=async()=>{let m=state.matches.find(x=>x.id===b.dataset.clear);if(!m)return;if(!confirm("Сбросить счёт и все события этого матча?"))return;const before=structuredClone(m);m.scoreA=null;m.scoreB=null;m.completed=false;m.events=[];renderAll();if(!(await save("Матч сброшен",true))){Object.assign(m,before);renderAll()}})}
function standings(){let rows=state.teams.map(t=>({id:t.id,name:t.name,I:0,V:0,N:0,P:0,ZM:0,PM:0,RM:0,O:0})),map=Object.fromEntries(rows.map(r=>[r.id,r]));state.matches.forEach(m=>{if(!done(m)||!map[m.a]||!map[m.b])return;let a=map[m.a],b=map[m.b];a.I++;b.I++;a.ZM+=m.scoreA;a.PM+=m.scoreB;b.ZM+=m.scoreB;b.PM+=m.scoreA;if(m.scoreA>m.scoreB){a.V++;b.P++;a.O+=3}else if(m.scoreA<m.scoreB){b.V++;a.P++;b.O+=3}else{a.N++;b.N++;a.O++;b.O++}});rows.forEach(r=>r.RM=r.ZM-r.PM);return rows.sort((a,b)=>b.O-a.O||b.RM-a.RM||b.ZM-a.ZM||a.name.localeCompare(b.name,"ru"))}
function renderTable(){document.getElementById("standingsBody").innerHTML=standings().map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.name)}</td><td>${r.I}</td><td>${r.V}</td><td>${r.N}</td><td>${r.P}</td><td>${r.ZM}</td><td>${r.PM}</td><td>${r.RM>0?"+"+r.RM:r.RM}</td><td>${r.O}</td></tr>`).join("")}
function seeds(){const r=standings();return r.length>=4?r.map(x=>x.id):null}
function winner(m,ids){if(m.winner&&ids.includes(m.winner))return m.winner;if(Number.isInteger(m.scoreA)&&Number.isInteger(m.scoreB)&&m.scoreA!==m.scoreB)return m.scoreA>m.scoreB?ids[0]:ids[1];return null}
function playoffData(){const s=seeds();if(!s)return null;return {final:{a:s[0],b:s[1]},third:{a:s[3],b:s[2]}}}
function playoffCard(key,label,ids){
 const m=state.playoff[key]||(state.playoff[key]={scoreA:null,scoreB:null,winner:null,notes:"",events:[]});
 if(!Array.isArray(m.events))m.events=[];
 const w=winner(m,[ids.a,ids.b]);
 const shootout=m.shootout?'<div class="playoff-shootout"><strong>Серия пенальти</strong><div>'+esc(m.shootout.scoreA??1)+':'+esc(m.shootout.scoreB??0)+(m.shootout.scorer?' '+esc(m.shootout.scorer):'')+'</div></div>':'';
 const notes=esc(m.notes||'');
 const events=m.events.map((e,i)=>{const f=findPlayer(e.playerId),symbol=e.type==='goal'?'⚽':e.type==='yellow'?'🟨':'🟥';return '<div class="playoff-event"><span>'+symbol+'</span><div><strong>'+esc(f?.player.name||'Игрок')+'</strong><small>'+esc(f?.team.name||'')+' · '+esc(e.type==='goal'?'Гол':e.type==='yellow'?'Жёлтая карточка':'Красная карточка')+(e.minute?' · '+esc(e.minute)+'′':'')+'</small></div>'+(isAdmin?'<button type="button" class="small-delete" data-play-remove="'+key+'" data-index="'+i+'" aria-label="Удалить событие">×</button>':'')+'</div>'}).join('');
 const players=state.teams.filter(t=>t.id===ids.a||t.id===ids.b).flatMap(t=>t.players.map(p=>({team:t,player:p})));
 const options=players.map(x=>'<option value="'+esc(x.player.id)+'">'+esc(x.player.name)+' · '+esc(x.team.name)+'</option>').join('');
 const winnerOptions='<option value="">Выбрать победителя при ничьей</option><option value="'+ids.a+'" '+(m.winner===ids.a?'selected':'')+'>'+esc(name(ids.a))+'</option><option value="'+ids.b+'" '+(m.winner===ids.b?'selected':'')+'>'+esc(name(ids.b))+'</option>';
 const admin=isAdmin?'<form class="playoff-event-form" data-play-event="'+key+'"><label>Событие<select name="type"><option value="goal">⚽ Гол</option><option value="yellow">🟨 Жёлтая карточка</option><option value="red">🟥 Красная карточка</option></select></label><label>Игрок<select name="player" required>'+options+'</select></label><label>Минута<input name="minute" type="number" min="1" max="120" inputmode="numeric" placeholder="Минута"></label><button class="primary-button" type="submit">＋ Добавить событие</button></form><label class="playoff-notes-label">Примечания к матчу<textarea class="playoff-notes" data-play-notes="'+key+'" rows="3" placeholder="Дополнительные детали матча...">'+notes+'</textarea></label><label class="playoff-winner-label">Победитель при ничьей<select data-play-winner="'+key+'">'+winnerOptions+'</select></label><div class="match-bottom playoff-actions"><button class="primary-button playoff-save" data-play-save="'+key+'" type="button">Сохранить результат</button><button class="finish-match-button" data-play-finish="'+key+'" type="button" '+(m.completed?'disabled':'')+'>'+(m.completed?'Матч окончен ✓':'Матч окончен')+'</button></div>':'<p class="protocol-footnote">'+(notes||'Подробности матча пока не добавлены.')+'</p>';
 return '<article class="match-card playoff-match" data-playoff-card="'+key+'"><div class="match-top"><span class="match-label">'+label+'</span><span class="match-status '+(w?'':'pending')+'">'+(w?(key==='third'?'3-Е МЕСТО ОПРЕДЕЛЕНО':'ПОБЕДИТЕЛЬ ОПРЕДЕЛЁН'):'ОЖИДАЕТСЯ')+'</span></div><div class="match-row"><div class="team-side">'+esc(name(ids.a))+'</div><div class="score-box"><input class="score-input" type="number" min="0" max="99" inputmode="numeric" placeholder="—" value="'+(m.scoreA??'')+'" data-play-score="'+key+'" data-side="A" '+(isAdmin?'':'disabled')+'><span class="score-sep">:</span><input class="score-input" type="number" min="0" max="99" inputmode="numeric" placeholder="—" value="'+(m.scoreB??'')+'" data-play-score="'+key+'" data-side="B" '+(isAdmin?'':'disabled')+'></div><div class="team-side right">'+esc(name(ids.b))+'</div></div>'+shootout+(w?'<div class="match-bottom"><strong>'+(key==='third'?'3-е место: ':'Победитель: ')+esc(name(w))+'</strong></div>':'')+(events?'<div class="playoff-events"><h3>События матча</h3>'+events+'</div>':'<p class="empty playoff-empty-events">Событий пока нет.</p>')+admin+'</article>';
}
function renderPlayoff(){
 const el=document.getElementById('playoffList'),p=playoffData();
 if(!p){el.innerHTML='<div class="match-card"><div class="empty">Для плей-офф нужны четыре команды в таблице.</div></div>';return}
 el.innerHTML=playoffCard('third','Матч за 3-е место',p.third)+playoffCard('final','ФИНАЛ',p.final);
 el.querySelectorAll('[data-play-save]').forEach(b=>b.onclick=async()=>{
  const key=b.dataset.playSave,m=state.playoff[key],before=structuredClone(m);
  const a=el.querySelector('[data-play-score="'+key+'"][data-side="A"]'),z=el.querySelector('[data-play-score="'+key+'"][data-side="B"]'),n=el.querySelector('[data-play-notes="'+key+'"]'),w=el.querySelector('[data-play-winner="'+key+'"]');
  m.scoreA=a.value.trim()===''?null:Math.max(0,Math.min(99,parseInt(a.value)||0));m.scoreB=z.value.trim()===''?null:Math.max(0,Math.min(99,parseInt(z.value)||0));m.notes=n.value;
  if(m.scoreA!==null&&m.scoreB!==null&&m.scoreA!==m.scoreB)m.winner=m.scoreA>m.scoreB?p[key].a:p[key].b;
  else if(m.scoreA!==null&&m.scoreB!==null&&m.scoreA===m.scoreB)m.winner=w.value||null;
  b.disabled=true;b.textContent='Сохраняем…';
  if(!(await save('Результат плей-офф сохранён',true))){Object.assign(m,before);restoreLocalState();renderAll();return}
  renderAll();
 });
 el.querySelectorAll('[data-play-event]').forEach(form=>form.onsubmit=async e=>{
  e.preventDefault();
  const key=form.dataset.playEvent,m=state.playoff[key],before=structuredClone(m),type=form.elements.type.value,pid=form.elements.player.value,minute=form.elements.minute.value;
  if(!pid){toast('Сначала добавьте игрока в состав');return}
  const min=minute?Number(minute):null;if(min!==null&&(!Number.isInteger(min)||min<1||min>120)){toast('Проверьте минуту события');return}
  const player=findPlayer(pid);if(!player||(player.team.id!==p[key].a&&player.team.id!==p[key].b)){toast('Игрок должен быть из одной из команд этого матча');return}
  m.events.push({id:uid('pe'),type,playerId:pid,teamId:player.team.id,minute:min});m.completed=false;
  if(type==='goal'){if(player.team.id===p[key].a)m.scoreA=(m.scoreA??0)+1;else m.scoreB=(m.scoreB??0)+1;m.winner=null}
  const submit=form.querySelector('button[type="submit"]');if(submit){submit.disabled=true;submit.textContent='Сохраняем…'}
  if(!(await save('Событие плей-офф сохранено',true))){Object.assign(m,before);restoreLocalState();renderAll();return}
  renderAll();
 });
 el.querySelectorAll('[data-play-remove]').forEach(b=>b.onclick=async()=>{
  const key=b.dataset.playRemove,m=state.playoff[key],before=structuredClone(m),index=Number(b.dataset.index),ev=m.events[index];if(!ev)return;
  if(ev.type==='goal'){if(ev.teamId===p[key].a)m.scoreA=Math.max(0,(m.scoreA??0)-1);else if(ev.teamId===p[key].b)m.scoreB=Math.max(0,(m.scoreB??0)-1);m.winner=null}
  m.events.splice(index,1);m.completed=false;
  if(!(await save('Событие удалено',true))){Object.assign(m,before);restoreLocalState();renderAll();return}
  renderAll();
 });
 el.querySelectorAll('[data-play-finish]').forEach(b=>b.onclick=async()=>{
  const key=b.dataset.playFinish,m=state.playoff[key],before=structuredClone(m);
  if(m.scoreA===null||m.scoreB===null){if(!m.winner){toast('Сначала внесите счёт или укажите победителя по серии пенальти');return}}
  else if(m.scoreA===m.scoreB&&!m.winner){toast('При ничьей выберите победителя');return}
  m.completed=true;
  if(!(await save('Матч плей-офф окончен',true))){Object.assign(m,before);restoreLocalState();renderAll();return}
  renderAll();
 });
}
function findPlayer(id){for(let t of state.teams){let p=t.players.find(p=>p.id===id);if(p)return {team:t,player:p}}return null}
function uid(prefix){return prefix+"_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6)}
function renderTeams(){let el=document.getElementById("teamsList");el.innerHTML=state.teams.map((t,i)=>`<article class="team-card"><div class="team-title-row"><span class="team-badge">${String(i+1).padStart(2,"0")}</span><input class="team-name-input" value="${esc(t.name)}" aria-label="Название команды" ${isAdmin?"":"readonly"} data-teamname="${t.id}">${isAdmin?`<button class="small-delete" data-delteam="${t.id}" title="Удалить команду">×</button>`:""}</div>${t.players.map(p=>`<div class="player-row"><input class="player-name-input" value="${esc(p.name)}" aria-label="Имя игрока" ${isAdmin?"":"readonly"} data-playername="${p.id}">${isAdmin?`<button class="small-delete" data-delplayer="${t.id}:${p.id}" title="Удалить игрока">×</button>`:""}</div>`).join("")}${isAdmin?`<button class="add-player-team" data-addplayer="${t.id}">＋ Добавить игрока в состав</button>`:""}</article>`).join("");
el.querySelectorAll("[data-teamname]").forEach(inp=>inp.onchange=()=>{team(inp.dataset.teamname).name=inp.value.trim()||"Команда";save();renderAll()});el.querySelectorAll("[data-playername]").forEach(inp=>inp.onchange=()=>{let f=findPlayer(inp.dataset.playername);if(f){f.player.name=inp.value.trim()||"Игрок";save();renderAll()}});el.querySelectorAll("[data-delplayer]").forEach(b=>b.onclick=()=>{let [tid,pid]=b.dataset.delplayer.split(":"),t=team(tid);t.players=t.players.filter(p=>p.id!==pid);save();renderAll()});el.querySelectorAll("[data-addplayer]").forEach(b=>b.onclick=()=>{team(b.dataset.addplayer).players.push({id:uid("p"),name:"Новый игрок",goals:0});save();renderAll()});el.querySelectorAll("[data-delteam]").forEach(b=>b.onclick=()=>{if(state.teams.length<=2){toast("Оставьте минимум две команды");return}if(!confirm("Удалить команду и её игроков?"))return;let id=b.dataset.delteam;state.teams=state.teams.filter(t=>t.id!==id);state.matches=state.matches.filter(m=>m.a!==id&&m.b!==id);save();renderAll()})}
function goalsFor(playerId){let fromMatches=state.matches.reduce((n,m)=>n+(m.events||[]).filter(e=>e.type==="goal"&&e.playerId===playerId).length,0);return fromMatches+(findPlayer(playerId)?.player.goals||0)}
function cardCounts(playerId,type){return state.matches.reduce((n,m)=>n+(m.events||[]).filter(e=>e.type===type&&e.playerId===playerId).length,0)}
function renderScorers(){let all=[];state.teams.forEach(t=>t.players.forEach(p=>all.push({t,p,goals:goalsFor(p.id)})));all.sort((a,b)=>b.goals-a.goals||a.p.name.localeCompare(b.p.name,"ru"));let el=document.getElementById("scorersList");el.innerHTML=all.length?all.map((x,i)=>`<div class="scorer-row"><div class="scorer-rank">${i+1}</div><div><div class="scorer-name">${esc(x.p.name)}</div><div class="scorer-team">${esc(x.t.name)}</div></div><div class="goals-control">${isAdmin?`<button class="goal-btn" data-goal="${x.p.id}" data-delta="-1" aria-label="Уменьшить голы">−</button><span class="goal-value">${x.goals}</span><button class="goal-btn" data-goal="${x.p.id}" data-delta="1" aria-label="Добавить гол">+</button>`:`<span class="goal-value">${x.goals}</span>`}</div></div>`).join(""):'<div class="empty">Добавьте игроков в составы команд.</div>';el.querySelectorAll("[data-goal]").forEach(b=>b.onclick=()=>{let f=findPlayer(b.dataset.goal);if(f){f.player.goals=Math.max(0,f.player.goals+Number(b.dataset.delta));save();renderScorers()}})}
function eventLabel(e){return e.type==="goal"?"Гол":e.type==="yellow"?"Жёлтая карточка":"Красная карточка"}
function openProtocol(matchId){let m=state.matches.find(x=>x.id===matchId);if(!m)return;document.getElementById("protocolModal").hidden=false;renderProtocol(m)}
function renderProtocol(m){
 let players=state.teams.filter(t=>t.id===m.a||t.id===m.b).flatMap(t=>t.players.map(p=>({team:t,player:p})));
 let opts=players.map(x=>'<option value="'+esc(x.player.id)+'">'+esc(x.player.name)+' · '+esc(x.team.name)+'</option>').join("");
 let events=(m.events||[]).map((e,i)=>{
  let f=findPlayer(e.playerId),symbol=e.type==="goal"?"⚽":e.type==="yellow"?"🟨":"🟥";
  return '<div class="protocol-event"><span class="event-symbol">'+symbol+'</span><div class="event-copy"><strong>'+esc(f?.player.name||"Игрок удалён")+'</strong><small>'+esc(f?.team.name||"")+' · '+esc(eventLabel(e))+(e.minute?' · '+esc(e.minute)+'′':'')+'</small></div>'+(isAdmin?'<button class="small-delete" data-remove-event="'+i+'" aria-label="Удалить событие">×</button>':'')+'</div>';
 }).join("");
 document.getElementById("protocolTitle").textContent=m.label+" · "+name(m.a)+" — "+name(m.b);
 const adminForm=isAdmin?'<form id="eventForm" class="event-form"><label>Событие<select id="eventType"><option value="goal">⚽ Гол</option><option value="yellow">🟨 Жёлтая карточка</option><option value="red">🟥 Красная карточка</option></select></label><label>Игрок<select id="eventPlayer" required>'+opts+'</select></label><label>Минута <input id="eventMinute" type="number" min="1" max="120" inputmode="numeric" placeholder="Например, 7"></label><button class="primary-button" type="submit">＋ Добавить событие</button></form>':'<p class="protocol-footnote">Протокол матча доступен только для просмотра.</p>';
 const saveButton=isAdmin?'<button class="primary-button" id="saveMatchResult" type="button">Сохранить результат</button><section class="finish-match-panel"><p>Когда все события и голы внесены, отдельно заверши матч:</p><button class="finish-match-button" id="finishMatchProtocol" type="button" '+(done(m)?"disabled":"")+'>'+(done(m)?"Матч завершён ✓":"Завершить матч")+"</button></section>":"";
 document.getElementById("protocolContent").innerHTML='<div class="protocol-score"><span>'+esc(name(m.a))+'</span><strong>'+(m.scoreA??0)+' : '+(m.scoreB??0)+'</strong><span>'+esc(name(m.b))+'</span></div><h3>События матча</h3>'+(events||'<p class="empty">Событий пока нет.</p>')+adminForm+saveButton+'<p class="protocol-footnote">Голы из протокола учитываются в бомбардирах, карточки — в дисциплинарной статистике.</p>';
 const finishButton=document.getElementById("finishMatchProtocol");
 if(finishButton){finishButton.onclick=async()=>{if(done(m))return;const before=structuredClone(m);finishButton.disabled=true;m.scoreA=m.scoreA??0;m.scoreB=m.scoreB??0;m.completed=true;if(!(await save("Матч завершён",true))){Object.assign(m,before);renderAll();renderProtocol(m);return}renderAll();renderProtocol(m)}}
 const saveButtonEl=document.getElementById("saveMatchResult");
 if(saveButtonEl)saveButtonEl.onclick=async()=>{
  saveButtonEl.disabled=true;saveButtonEl.textContent="Сохраняем…";
  const ok=await save("Результат матча сохранён",true);
  if(saveButtonEl.isConnected){saveButtonEl.disabled=false;saveButtonEl.textContent=ok?"Сохранено":"Повторить сохранение"}
 };
 const form=document.getElementById("eventForm");
 if(form)form.onsubmit=async e=>{
  e.preventDefault();
  const submit=form.querySelector('button[type="submit"]');
  if(submit?.disabled)return;
  let type=document.getElementById("eventType").value,pid=document.getElementById("eventPlayer").value,minute=document.getElementById("eventMinute").value;
  if(!pid){toast("Сначала добавьте игрока в состав");return}
  const before=structuredClone(m);
  let ev={id:uid("e"),type,playerId:pid,minute:minute?Number(minute):null};m.events.push(ev);m.completed=false;
  if(type==="goal"){let f=findPlayer(pid);if(f?.team.id===m.a)m.scoreA=(m.scoreA??0)+1;else if(f?.team.id===m.b)m.scoreB=(m.scoreB??0)+1}
  if(submit){submit.disabled=true;submit.textContent="Сохраняем событие…"}
  if(!(await save("Событие сохранено в протоколе",true))){Object.assign(m,before);renderAll();renderProtocol(m);return}
  renderAll();renderProtocol(m);
 };
 document.querySelectorAll("[data-remove-event]").forEach(b=>b.onclick=async()=>{
  const index=Number(b.dataset.removeEvent),ev=m.events[index];if(!ev)return;
  const before=structuredClone(m);
  if(ev.type==="goal"){let f=findPlayer(ev.playerId);if(f?.team.id===m.a)m.scoreA=Math.max(0,(m.scoreA??0)-1);else if(f?.team.id===m.b)m.scoreB=Math.max(0,(m.scoreB??0)-1)}
  m.events.splice(index,1);m.completed=false;
  if(!(await save("Событие удалено из протокола",true))){Object.assign(m,before);renderAll();renderProtocol(m);return}
  renderAll();renderProtocol(m);
 });
}
function renderCards(){let all=[];state.teams.forEach(t=>t.players.forEach(p=>{let yellow=cardCounts(p.id,"yellow"),red=cardCounts(p.id,"red");if(yellow||red)all.push({t,p,yellow,red})}));all.sort((a,b)=>b.red-a.red||b.yellow-a.yellow||a.p.name.localeCompare(b.p.name,"ru"));document.getElementById("yellowTotal").textContent=state.matches.reduce((n,m)=>n+(m.events||[]).filter(e=>e.type==="yellow").length,0);document.getElementById("redTotal").textContent=state.matches.reduce((n,m)=>n+(m.events||[]).filter(e=>e.type==="red").length,0);document.getElementById("cardsList").innerHTML=all.length?all.map(x=>'<div class="scorer-row"><div class="scorer-rank">▰</div><div><div class="scorer-name">'+esc(x.p.name)+'</div><div class="scorer-team">'+esc(x.t.name)+'</div></div><div class="card-counts">'+(x.yellow?'<span class="card-yellow">🟨 '+x.yellow+'</span>':'')+(x.red?'<span class="card-red">🟥 '+x.red+'</span>':'')+'</div></div>').join(""):'<div class="empty">Карточек пока нет. Добавляйте их через протокол матча.</div>'}
function renderAll(){renderMatches();renderTable();renderTeams();renderScorers();renderCards();renderPlayoff();applyAdminUI()}
function applyAdminUI(){
 const addTeam=document.getElementById("addTeamBtn"),addPlayer=document.getElementById("addPlayerBtn"),importBtn=document.getElementById("importBtn");
 if(addTeam)addTeam.hidden=!isAdmin;if(addPlayer)addPlayer.hidden=!isAdmin;if(importBtn)importBtn.hidden=!isAdmin;
 const b=document.getElementById("adminBtn");if(b)b.setAttribute("aria-label",isAdmin?"Панель администратора":"Вход администратора");
 const status=document.getElementById("syncStatus");if(status)status.textContent=isAdmin?"Вы вошли как администратор · изменения общие":"Публичный просмотр · данные синхронизируются";
}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll(".view").forEach(x=>x.classList.toggle("active",x.id==="view-"+b.dataset.tab))});
document.getElementById("addTeamBtn").onclick=()=>{state.teams.push({id:uid("t"),name:"Новая команда",players:[]});save();renderAll()};
document.getElementById("closeProtocol").onclick=()=>{document.getElementById("protocolModal").hidden=true};document.getElementById("protocolModal").onclick=e=>{if(e.target.id==="protocolModal")e.currentTarget.hidden=true};
document.getElementById("addPlayerBtn").onclick=()=>{if(!state.teams.length){toast("Сначала добавьте команду");return}let t=state.teams[0];t.players.push({id:uid("p"),name:"Новый игрок",goals:0});save();renderAll();toast("Игрок добавлен в "+t.name)};
function download(blob,filename){let url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function backup(){let saved=localStorage.getItem(LEGACY_KEY),data=saved?JSON.parse(saved):state;download(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),saved?"football-tournament-local-backup.json":"football-tournament-backup.json");toast(saved?"Старая копия с этого устройства выгружена":"Резервная копия выгружена")}
document.getElementById("backupBtn").onclick=backup;
document.getElementById("exportCsvBtn").onclick=()=>{let rows=[["Место","Команда","И","В","Н","П","Забито","Пропущено","Разница","Очки"],...standings().map((r,i)=>[i+1,r.name,r.I,r.V,r.N,r.P,r.ZM,r.PM,r.RM,r.O])],csv="\uFEFF"+rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(";")).join("\r\n");download(new Blob([csv],{type:"text/csv;charset=utf-8"}),"football-tournament-table.csv")};
document.getElementById("importBtn").onclick=()=>document.getElementById("importFile").click();
document.getElementById("importFile").onchange=async e=>{let f=e.target.files[0];if(!f)return;try{let d=JSON.parse(await f.text());if(!Array.isArray(d.teams)||!Array.isArray(d.matches))throw 0;if(!confirm("Заменить текущие данные резервной копией?"))return;state=d;state.playoff=state.playoff||structuredClone(initial.playoff);localStorage.removeItem(LEGACY_KEY);save("Копия восстановлена в общий турнир");renderAll()}catch(err){toast("Файл резервной копии не распознан")}finally{e.target.value=""}};
if("serviceWorker"in navigator&&location.protocol!=="file:")addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));

const adminModal=document.getElementById("adminModal");
document.getElementById("adminBtn").onclick=()=>{adminModal.hidden=false;document.getElementById("adminMessage").textContent=isAdmin?"Вы вошли как администратор.":"Только администратор может менять результаты и составы. Для зрителей вход не нужен.";document.getElementById("adminLogout").hidden=!isAdmin;};
document.getElementById("closeAdmin").onclick=()=>adminModal.hidden=true;
adminModal.onclick=e=>{if(e.target===adminModal)adminModal.hidden=true};
document.getElementById("adminLoginForm").onsubmit=async e=>{
 e.preventDefault();if(!db){document.getElementById("adminMessage").textContent="Сервис входа временно недоступен. Обновите страницу позже.";return}const login=document.getElementById("adminEmail").value.trim(),email=login.toLowerCase()==="alekseev"?"alexeevv663@gmail.com":login,password=document.getElementById("adminPassword").value;
 const msg=document.getElementById("adminMessage");msg.textContent="Проверяем вход…";
 const {data,error}=await db.auth.signInWithPassword({email,password});
 if(error){msg.textContent="Не удалось войти. Проверьте почту и пароль.";return}
 const user=data.user;const {data:allowed,error:checkError}=await db.from("tournament_admins").select("user_id").eq("user_id",user.id).maybeSingle();
 if(checkError||!allowed){await db.auth.signOut();msg.textContent="У этой учётной записи нет прав администратора.";return}
 authUser=user;isAdmin=true;document.getElementById("adminLogout").hidden=false;document.getElementById("adminTitle").textContent="Панель администратора";msg.textContent="Вход выполнен. Теперь можно редактировать турнир.";renderAll();toast("Вход администратора выполнен");
};
document.getElementById("adminLogout").onclick=async()=>{await db.auth.signOut();authUser=null;isAdmin=false;document.getElementById("adminPassword").value="";document.getElementById("adminTitle").textContent="Вход администратора";document.getElementById("adminLogout").hidden=true;adminModal.hidden=true;renderAll();toast("Вы вышли из панели");};
async function bootShared(){
 if(!db){document.getElementById("syncStatus").textContent="Офлайн-режим · общая база временно недоступна";renderAll();return}
 const {data,error}=await db.from("tournament_state").select("state,updated_at").eq("id","main").single();
 if(error){document.getElementById("syncStatus").textContent="Не удалось загрузить общие данные";console.error(error);renderAll();return}
 const localState=(()=>{try{return JSON.parse(localStorage.getItem(KEY))}catch(e){return null}})();
 if(localState&&JSON.stringify(localState)!==JSON.stringify(initial)&&!localStorage.getItem(LEGACY_KEY)){try{localStorage.setItem(LEGACY_KEY,JSON.stringify(localState))}catch(e){}}
 state=data.state;state.matches.forEach(m=>{if(!Array.isArray(m.events))m.events=[]});
 try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}
 if(localStorage.getItem(LEGACY_KEY))toast("Старая копия сохранена на этом устройстве — нажмите ↗, чтобы выгрузить её");
 const {data:sessionData}=await db.auth.getSession();
 if(sessionData?.session){authUser=sessionData.session.user;const {data:allowed}=await db.from("tournament_admins").select("user_id").eq("user_id",authUser.id).maybeSingle();isAdmin=!!allowed;}
 db.channel("tournament-live").on("postgres_changes",{event:"UPDATE",schema:"public",table:"tournament_state",filter:"id=eq.main"},payload=>{
  if(pendingWrites>0||payload.new.updated_at===lastSavedStamp)return;
  state=payload.new.state;state.matches.forEach(m=>{if(!Array.isArray(m.events))m.events=[]});
  try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}
  renderAll();toast("Результаты турнира обновлены");
 }).subscribe();
 renderAll();
}
function startSupabase(){
 if(window.supabase?.createClient){db=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);db.auth.onAuthStateChange((event,session)=>{if(event==="SIGNED_OUT"){isAdmin=false;authUser=null;renderAll()}});bootShared();return}
 const script=document.createElement("script");script.src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";script.async=true;
 script.onload=()=>{if(window.supabase?.createClient){db=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);db.auth.onAuthStateChange((event,session)=>{if(event==="SIGNED_OUT"){isAdmin=false;authUser=null;renderAll()}});bootShared()}else{document.getElementById("syncStatus").textContent="Общая база временно недоступна · показана копия устройства"}};
 script.onerror=()=>{document.getElementById("syncStatus").textContent="Нет связи с сервисом синхронизации · показана копия устройства"};
 document.head.appendChild(script);
}
renderAll();
startSupabase();
