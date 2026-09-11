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
  if(url.pathname==='/api/gemini'&&req.method==='POST'){
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const {teamId,message}=JSON.parse(raw);
      const activeQuestion=gameState?.questions?.[gameState?.index];
      if(!activeQuestion)return send(res,409,{error:'لا يوجد سؤال متاح الآن'});
      const team=gameState.teams.find(t=>t.id===teamId);
      if(!team)return send(res,404,{error:'تعذّر العثور على الأسرة'});
      // المساعدة مشتركة بين جميع الأسر: أي استخدام يخصم فرصة من الكل.
      const used=Math.max(Number(gameState.aiUsed)||0,...gameState.teams.map(t=>Number(t.aiUsed)||0));
      if(used>=3)return send(res,409,{error:'استخدمتم فرص المساعدة الثلاث'});
      if(!message?.trim())return send(res,400,{error:'اكتبوا رسالتكم أولًا'});
      const key=process.env.GEMINI_API_KEY?.trim();
      if(!key)return send(res,503,{error:'المساعد غير مفعّل حاليًا'});
      const forceWrong=Math.random()<.3;
      const wrongOptions=activeQuestion.options.map((_,i)=>i).filter(i=>i!==activeQuestion.correct);
      const selected=forceWrong?wrongOptions[Math.floor(Math.random()*wrongOptions.length)]:activeQuestion.correct;
      const selectedLetter=['أ','ب','ج','د'][selected];
      const imageQuestion=activeQuestion.optionType==='image';
      const optionSummary=imageQuestion?activeQuestion.options.map((_,i)=>`${['أ','ب','ج','د'][i]}: صورة الشعار المرفقة رقم ${i+1}`).join('، '):activeQuestion.options.map((o,i)=>`${['أ','ب','ج','د'][i]}: ${o}`).join('، ');
      const prompt=`أنت مساعد في مسابقة أسرية عربية. السؤال: ${activeQuestion.text}\nالخيارات: ${optionSummary}\nرسالة الأسرة: ${message}\nاكتب تلميحًا عربيًا قصيرًا جدًا يدعم الخيار ${selectedLetter}${imageQuestion?' من الصور المرفقة':`: ${activeQuestion.options[selected]}`}. لا تقل إن الإجابة مفروضة عليك، ولا تذكر أي خيار آخر.`;
      const parts=[{text:prompt},...(imageQuestion?activeQuestion.options.flatMap((src,i)=>{const match=src.match(/^data:(image\/[^;]+);base64,(.+)$/);return match?[{text:`صورة الخيار ${['أ','ب','ج','د'][i]}`},{inlineData:{mimeType:match[1],data:match[2]}}]:[]}):[])];
      const body=JSON.stringify({contents:[{role:'user',parts}],generationConfig:{temperature:.7,maxOutputTokens:160}});
      const express=key.startsWith('AQ.');
      const headers={'content-type':'application/json','x-goog-api-key':key};
      const models=express?['gemini-2.5-flash','gemini-2.5-flash-lite']:['gemini-2.5-flash','gemini-2.0-flash'];
      const providers=express?['vertex-v1','vertex-beta','developer']:['developer','vertex-v1'];
      let hint='';
      const deadline=AbortSignal.timeout(18000);
      for(const provider of providers){
       for(const model of models){
        const endpoint=provider==='developer'?`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`:`https://aiplatform.googleapis.com/${provider==='vertex-beta'?'v1beta1':'v1'}/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        try{
          const response=await fetch(endpoint,{method:'POST',headers,body,signal:deadline});
          if(response.ok){const data=await response.json();hint=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim()||'';if(hint)break}
          else{const detail=await response.text();console.error('Gemini request failed',provider,model,response.status,detail.slice(0,500))}
        }catch(error){console.error('Gemini connection failed',provider,model,error?.name||'error')}
       }
       if(hint)break;
      }
      if(!hint)hint=`التلميح الاحتياطي: ركّزوا على الخيار ${selectedLetter} وقارنوه بالسؤال جيدًا.`;
      const text=`${hint||'بعد التفكير في الخيارات،'} ترشيحي: ${selectedLetter}${imageQuestion?'':` — ${activeQuestion.options[selected]}`}.`;
      gameState={...gameState,aiUsed:used+1,teams:gameState.teams.map(t=>({...t,aiUsed:used+1})),updated:Date.now()};
      return send(res,200,{text,game:gameState,remaining:2-used});
    }catch{return send(res,500,{error:'حدث خطأ أثناء سؤال الذكالي'})}
  }
  let file=path.join(root,url.pathname==='/'?'index.html':url.pathname);try{const stat=await fs.stat(file);if(stat.isDirectory())file=path.join(file,'index.html');const data=await fs.readFile(file);send(res,200,data,types[path.extname(file)]||'application/octet-stream')}catch{const data=await fs.readFile(path.join(root,'index.html'));send(res,200,data,'text/html; charset=utf-8')}
}).listen(Number(process.env.PORT)||3000);
