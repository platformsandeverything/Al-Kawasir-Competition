import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
let gameState=null;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
const send=(res,status,data,type='application/json; charset=utf-8')=>{res.writeHead(status,{'content-type':type});res.end(typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data))};
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/game'&&req.method==='GET')return send(res,200,gameState||{});
  if(url.pathname==='/api/game'&&req.method==='POST'){
    try{
      let raw='';for await(const chunk of req)raw+=chunk;const incoming=JSON.parse(raw);
      const serverTeams=gameState?.teams||[];
      const preserveTeams=()=>((incoming.teams||[]).map(team=>{const saved=serverTeams.find(t=>t.id===team.id);return saved?{...team,score:saved.score,aiUsed:Number(saved.aiUsed)||0,answer:saved.answer,correct:saved.correct,answeredAt:saved.answeredAt,fastest:saved.fastest}:{...team,aiUsed:Number(team.aiUsed)||0}}));
      if(incoming.phase==='reveal'){
        if(!gameState)gameState={...incoming,updated:Date.now()};
        else if(gameState.phase==='question'){
          const q=incoming.questions[incoming.index];
          const multiplier=incoming.double?2:1;
          const correct=(gameState.teams||[]).filter(team=>team.answer===q.correct&&team.answeredAt).map(team=>team.answeredAt);
          const fastestAt=correct.length?Math.min(...correct):null;
          const scored=(gameState.teams||[]).map(team=>{const ok=team.answer===q.correct;const fastest=ok&&fastestAt!==null&&team.answeredAt===fastestAt;return {...team,correct:ok,fastest,score:team.score+(ok?multiplier:0)+(fastest?multiplier:0)}});
          gameState={...gameState,...incoming,teams:scored,updated:Date.now()};
        }
      }else if(incoming.phase==='lobby'&&(gameState?.phase==='idle'||gameState?.phase==='finished'))gameState={...incoming,teams:(incoming.teams||[]).map(t=>({...t,score:0,aiUsed:0,answer:undefined,correct:undefined,answeredAt:undefined,fastest:undefined})),updated:Date.now()};
      else if(incoming.phase==='question'&&(gameState?.phase!=='question'||gameState?.index!==incoming.index))gameState={...incoming,teams:preserveTeams().map(t=>({...t,answer:undefined,correct:undefined,answeredAt:undefined,fastest:undefined})),updated:Date.now()};
      else if(incoming.phase==='question')gameState={...gameState,...incoming,teams:preserveTeams(),updated:Date.now()};
      else gameState={...incoming,teams:preserveTeams(),updated:Date.now()};
      return send(res,200,gameState)
    }catch{return send(res,400,{error:'بيانات غير صالحة'})}
  }
  if(url.pathname==='/api/game/join'&&req.method==='POST'){
    try{let raw='';for await(const chunk of req)raw+=chunk;const {team,initial}=JSON.parse(raw);if(!team?.id||!team?.name)return send(res,400,{error:'اسم الأسرة مطلوب'});if(!gameState)gameState={...initial,teams:[],updated:Date.now()};const existing=gameState.teams.find(t=>t.name.trim()===team.name.trim());if(existing)return send(res,200,{game:gameState,team:existing});const joined={...team,aiUsed:0};gameState={...gameState,teams:[...gameState.teams,joined],updated:Date.now()};return send(res,200,{game:gameState,team:joined})}catch{return send(res,400,{error:'تعذّر الانضمام'})}
  }
  if(url.pathname==='/api/game/answer'&&req.method==='POST'){
    try{let raw='';for await(const chunk of req)raw+=chunk;const {teamId,answer}=JSON.parse(raw);if(!gameState||gameState.phase!=='question')return send(res,409,{error:'السؤال غير متاح'});const answeredAt=Date.now();gameState={...gameState,teams:gameState.teams.map(t=>t.id===teamId&&t.answer===undefined?{...t,answer,answeredAt}:t),updated:answeredAt};return send(res,200,gameState)}catch{return send(res,400,{error:'تعذّر تسجيل الإجابة'})}
  }
  if((url.pathname==='/api/help'||url.pathname==='/api/gemini')&&req.method==='POST'){
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const {teamId}=JSON.parse(raw);
      const activeQuestion=gameState?.questions?.[gameState?.index];
      if(!activeQuestion)return send(res,409,{error:'لا يوجد سؤال متاح الآن'});
      const team=gameState.teams.find(t=>t.id===teamId);
      if(!team)return send(res,404,{error:'تعذّر العثور على الأسرة'});
      // المساعدة مشتركة بين جميع الأسر: أي استخدام يخصم فرصة من الكل.
      const used=Math.max(Number(gameState.aiUsed)||0,...gameState.teams.map(t=>Number(t.aiUsed)||0));
      if(used>=3)return send(res,409,{error:'استخدمتم فرص المساعدة الثلاث'});
      const wrongOptions=activeQuestion.options.map((_,i)=>i).filter(i=>i!==activeQuestion.correct);
      const answerCorrectly=Math.random()<.4;
      const selected=answerCorrectly||wrongOptions.length===0?activeQuestion.correct:wrongOptions[Math.floor(Math.random()*wrongOptions.length)];
      const selectedLetter=['أ','ب','ج','د'][selected];
      const text=`اختيار الذكالي: ${selectedLetter}`;
      gameState={...gameState,aiUsed:used+1,teams:gameState.teams.map(t=>({...t,aiUsed:used+1})),updated:Date.now()};
      return send(res,200,{text,game:gameState,remaining:2-used});
    }catch{return send(res,500,{error:'تعذّر استخدام المساعدة'})}
  }
  let file=path.join(root,url.pathname==='/'?'index.html':url.pathname);try{const stat=await fs.stat(file);if(stat.isDirectory())file=path.join(file,'index.html');const data=await fs.readFile(file);send(res,200,data,types[path.extname(file)]||'application/octet-stream')}catch{const data=await fs.readFile(path.join(root,'index.html'));send(res,200,data,'text/html; charset=utf-8')}
}).listen(Number(process.env.PORT)||3000);
