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
      const used=Number(team.aiUsed)||0;
      if(used>=3)return send(res,409,{error:'استخدمتم فرص المساعدة الثلاث'});
      if(!message?.trim())return send(res,400,{error:'اكتبوا رسالتكم أولًا'});
      const key=process.env.GEMINI_API_KEY;
      if(!key)return send(res,503,{error:'المساعد غير مفعّل حاليًا'});
      const forceWrong=Math.random()<.3;
      const prompt=`أنت مساعد في مسابقة أسرية عربية. السؤال: ${activeQuestion.text}\nالخيارات: ${activeQuestion.options.map((o,i)=>`${['أ','ب','ج','د'][i]}: ${o}`).join('، ')}\nرسالة الأسرة: ${message}\n${forceWrong?'لأغراض اللعبة اقترح إجابة خاطئة عمدًا دون التصريح بذلك.':'قدّم أفضل مساعدة وحدد الخيار المرجح.'}\nأجب بالعربية في جملة قصيرة جدًا واذكر حرف الخيار.`;
      const body=JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.7,maxOutputTokens:80}});
      let response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},body});
      if(!response.ok&&key.startsWith('AQ.'))response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'content-type':'application/json'},body});
      if(!response.ok&&key.startsWith('AQ.'))response=await fetch(`https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'content-type':'application/json'},body});
      let openAi=false;
      if(!response.ok&&key.startsWith('AQ.')){openAi=true;response=await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({model:'gemini-2.5-flash',messages:[{role:'user',content:prompt}],temperature:.7,max_tokens:80})})}
      if(!response.ok)return send(res,502,{error:'تعذّر الوصول إلى الذكالي الآن، حاولوا مرة أخرى'});
      const data=await response.json();
      const text=(openAi?data?.choices?.[0]?.message?.content:data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join(''))?.trim()||'لم أستطع تكوين إجابة هذه المرة.';
      gameState={...gameState,teams:gameState.teams.map(t=>t.id===teamId?{...t,aiUsed:used+1}:t),updated:Date.now()};
      return send(res,200,{text,game:gameState,remaining:2-used});
    }catch{return send(res,500,{error:'حدث خطأ أثناء سؤال الذكالي'})}
  }
  let file=path.join(root,url.pathname==='/'?'index.html':url.pathname);try{const stat=await fs.stat(file);if(stat.isDirectory())file=path.join(file,'index.html');const data=await fs.readFile(file);send(res,200,data,types[path.extname(file)]||'application/octet-stream')}catch{const data=await fs.readFile(path.join(root,'index.html'));send(res,200,data,'text/html; charset=utf-8')}
}).listen(Number(process.env.PORT)||3000);
