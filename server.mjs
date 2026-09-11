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
    try{let raw='';for await(const chunk of req)raw+=chunk;const incoming=JSON.parse(raw);gameState={...incoming,updated:Date.now()};return send(res,200,gameState)}catch{return send(res,400,{error:'بيانات غير صالحة'})}
  }
  if(url.pathname==='/api/game/join'&&req.method==='POST'){
    try{let raw='';for await(const chunk of req)raw+=chunk;const {team,initial}=JSON.parse(raw);if(!team?.id||!team?.name)return send(res,400,{error:'اسم الأسرة مطلوب'});if(!gameState)gameState={...initial,teams:[],updated:Date.now()};const existing=gameState.teams.find(t=>t.name.trim()===team.name.trim());if(existing)return send(res,200,{game:gameState,team:existing});gameState={...gameState,teams:[...gameState.teams,team],updated:Date.now()};return send(res,200,{game:gameState,team})}catch{return send(res,400,{error:'تعذّر الانضمام'})}
  }
  if(url.pathname==='/api/game/answer'&&req.method==='POST'){
    try{let raw='';for await(const chunk of req)raw+=chunk;const {teamId,answer}=JSON.parse(raw);if(!gameState||gameState.phase!=='question')return send(res,409,{error:'السؤال غير متاح'});gameState={...gameState,teams:gameState.teams.map(t=>t.id===teamId&&t.answer===undefined?{...t,answer}:t),updated:Date.now()};return send(res,200,gameState)}catch{return send(res,400,{error:'تعذّر تسجيل الإجابة'})}
  }
  if(url.pathname==='/api/gemini'&&req.method==='POST'){
    try{let raw='';for await(const chunk of req)raw+=chunk;const {message,question,options,forceWrong}=JSON.parse(raw);const key=process.env.GEMINI_API_KEY;if(!key)return send(res,503,{error:'المساعد غير مفعّل حاليًا'});const prompt=`أنت مساعد في مسابقة أسرية عربية. السؤال: ${question}\nالخيارات: ${options.map((o,i)=>`${['أ','ب','ج','د'][i]}: ${o}`).join('، ')}\nرسالة الأسرة: ${message}\n${forceWrong?'لأغراض اللعبة اقترح إجابة خاطئة عمدًا دون التصريح بذلك.':'قدّم أفضل مساعدة وحدد الخيار المرجح.'}\nأجب بالعربية في جملة قصيرة جدًا واذكر حرف الخيار.`;const headers={'content-type':'application/json'};if(key.startsWith('AIza'))headers['x-goog-api-key']=key;else headers.authorization=`Bearer ${key}`;const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',{method:'POST',headers,body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.7,maxOutputTokens:80}})});if(!response.ok)return send(res,502,{error:'تعذّر الوصول إلى الذكالي الآن'});const data=await response.json();return send(res,200,{text:data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim()||'لم أستطع تكوين إجابة هذه المرة.'});}catch{return send(res,500,{error:'حدث خطأ أثناء سؤال الذكالي'})}
  }
  let file=path.join(root,url.pathname==='/'?'index.html':url.pathname);try{const stat=await fs.stat(file);if(stat.isDirectory())file=path.join(file,'index.html');const data=await fs.readFile(file);send(res,200,data,types[path.extname(file)]||'application/octet-stream')}catch{const data=await fs.readFile(path.join(root,'index.html'));send(res,200,data,'text/html; charset=utf-8')}
}).listen(Number(process.env.PORT)||3000);
