const http=require('http');
const fs=require('fs');
const path=require('path');

const root=__dirname;
loadEnv(path.join(root,'.env'));

const server=http.createServer(async (req,res)=>{
  if(req.method==='POST'&&req.url==='/api/analyze'){
    let body='';
    req.on('data',chunk=>{body+=chunk});
    req.on('end',async ()=>{
      try{
        const result=await analyze(JSON.parse(body||'{}'));
        sendJson(res,200,result);
      }catch(err){
        sendJson(res,err.status||500,{error:err.message||'Analysis failed.'});
      }
    });
    return;
  }

  const urlPath=req.url==='/'?'/index.html':req.url.split('?')[0];
  const filePath=path.normalize(path.join(root,urlPath));
  if(!filePath.startsWith(root)){
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath,(err,data)=>{
    if(err){
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200,{'Content-Type':contentType(filePath)});
    res.end(data);
  });
});

server.listen(process.env.PORT||3000,()=>{
  console.log(`ContractScan running at http://localhost:${process.env.PORT||3000}`);
});

async function analyze(payload){
  const key=process.env.GROQ_API_KEY;
  const {text='',contractType='auto',perspective='recipient'}=payload||{};
  const contractText=String(text).trim();
  if(contractText.length<100)throw httpError(400,'Please paste a contract with at least 100 characters.');

  if(!key)return fallbackAnalyze(contractText,contractType,perspective);

  const systemPrompt=`You are ContractScan AI, an expert legal contract risk analyzer. You must respond ONLY with a valid JSON object. No markdown, no code fences, no explanation — pure JSON only.

Return this exact structure:
{
  "score": <integer 0-100, where 0=extremely risky, 100=very favorable>,
  "verdict": "<short decisive verdict phrase>",
  "summary": "<2-3 sentence plain-English summary of what this contract does and who it favors>",
  "contract_type": "<detected contract type>",
  "tags": ["<tag1>","<tag2>","<tag3>"],
  "flags": [
    {
      "severity": "high|medium|low|info",
      "title": "<concise flag title>",
      "clause": "<e.g. Section 3>",
      "description": "<1-2 sentences explaining the risk>",
      "action": "<what to request, remove, or change>"
    }
  ],
  "negotiate": ["<negotiation point as a concrete action>"]
}

Give 4-7 flags and 4-5 negotiation points. Perspective: ${perspective==='recipient'?'analyze risks for the person RECEIVING/signing this contract':'analyze risks from the perspective of the person SENDING/issuing this contract'}.`;

  const userMsg=`Contract type: ${contractType==='auto'?'auto-detect':contractType}

CONTRACT TEXT:
${contractText.substring(0,6000)}`;

  const groqRes=await fetch('https://api.groq.com/openai/v1/chat/completions',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':'Bearer '+key
    },
    body:JSON.stringify({
      model:'llama-3.3-70b-versatile',
      temperature:0.1,
      max_tokens:1500,
      messages:[
        {role:'system',content:systemPrompt},
        {role:'user',content:userMsg}
      ]
    })
  });

  const data=await groqRes.json();
  if(!groqRes.ok||data.error)throw httpError(groqRes.status||500,data.error?.message||'Groq API error');

  const raw=data.choices?.[0]?.message?.content||'';
  const clean=raw.replace(/```json|```/g,'').trim();
  return JSON.parse(clean);
}

function fallbackAnalyze(text,contractType,perspective){
  const lower=text.toLowerCase();
  const rules=[
    {
      severity:'high',
      title:'One-sided payment discretion',
      clause:'Payment',
      terms:['withhold payment','sole discretion','deemed unsatisfactory'],
      description:'Payment can be delayed or withheld based on broad subjective standards, which may make collection difficult.',
      action:'Request objective acceptance criteria, a shorter payment period, and a clear dispute process for withheld amounts.'
    },
    {
      severity:'high',
      title:'Overbroad IP assignment',
      clause:'Intellectual Property',
      terms:['pre-existing ip','all work product','in perpetuity','exclusive property'],
      description:'The IP language may transfer more than the work created specifically for this contract, including prior tools or background materials.',
      action:'Carve out pre-existing IP, reusable know-how, open-source components, and materials not created for the client.'
    },
    {
      severity:'high',
      title:'Restrictive non-compete',
      clause:'Non-compete',
      terms:['non-compete','competitor','not to work'],
      description:'The contract may restrict future work after the relationship ends, which can limit earning ability or business flexibility.',
      action:'Remove the non-compete or narrow it by geography, duration, role, customer list, and applicable law.'
    },
    {
      severity:'medium',
      title:'Unbalanced termination rights',
      clause:'Termination',
      terms:['terminate with','for any reason','only terminate','client approval'],
      description:'One party appears to have easier termination rights than the other, creating leverage and continuity risk.',
      action:'Ask for mutual termination rights, matching notice periods, and payment for completed work on termination.'
    },
    {
      severity:'medium',
      title:'Long confidentiality period',
      clause:'Confidentiality',
      terms:['10 years','confidentiality','post-termination'],
      description:'Confidentiality duties may last for a long period after the contract ends, which can be hard to administer.',
      action:'Limit ordinary confidentiality to a reasonable period while preserving trade secret protection as required by law.'
    },
    {
      severity:'medium',
      title:'One-sided liability cap',
      clause:'Liability',
      terms:['liability capped','unlimited','total liability'],
      description:'The liability allocation may cap one party while leaving the other exposed to much larger losses.',
      action:'Make liability caps mutual and add exclusions only for clearly defined high-risk conduct.'
    },
    {
      severity:'medium',
      title:'Unilateral modification right',
      clause:'Modification',
      terms:['modify this agreement','at any time','24 hours notice'],
      description:'One party may be able to change the deal after signing with limited notice.',
      action:'Require written mutual consent for amendments and reject automatic changes without acceptance.'
    },
    {
      severity:'low',
      title:'Missing dispute process',
      clause:'General',
      terms:['agreement'],
      description:'The contract text should be checked for governing law, venue, escalation, and dispute resolution mechanics.',
      action:'Add clear governing law, venue, notice, cure periods, and dispute escalation language.'
    }
  ];

  const flags=rules.filter(rule=>rule.terms.some(term=>lower.includes(term))).slice(0,7);
  while(flags.length<4){
    const next=rules.find(rule=>!flags.includes(rule));
    if(!next)break;
    flags.push(next);
  }

  const penalty={high:18,medium:10,low:4,info:2};
  const score=Math.max(8,Math.min(92,86-flags.reduce((sum,flag)=>sum+penalty[flag.severity],0)));
  const type=detectType(lower,contractType);
  const highCount=flags.filter(flag=>flag.severity==='high').length;
  const verdict=score<40?'High-risk terms need negotiation':score<70?'Proceed only after targeted edits':'Generally workable with review';
  const favors=perspective==='recipient'?'the issuing party':'the receiving party';

  return {
    score,
    verdict,
    summary:`This appears to be a ${type} with several terms that may favor ${favors}. The main issues are ${flags.slice(0,3).map(flag=>flag.title.toLowerCase()).join(', ')}, so review and negotiate those points before signing.`,
    contract_type:type,
    tags:[`${highCount} high risk`,type,'local scan'],
    flags,
    negotiate:flags.slice(0,5).map(flag=>flag.action)
  };
}

function detectType(lower,contractType){
  if(contractType&&contractType!=='auto')return contractType.replace(/\b\w/g,char=>char.toUpperCase());
  if(lower.includes('non-disclosure')||lower.includes('nda'))return 'NDA';
  if(lower.includes('employment')||lower.includes('employee'))return 'Employment Agreement';
  if(lower.includes('software')||lower.includes('subscription')||lower.includes('saas'))return 'SaaS / Software Agreement';
  if(lower.includes('lease')||lower.includes('tenant')||lower.includes('landlord'))return 'Lease';
  if(lower.includes('vendor'))return 'Vendor Agreement';
  if(lower.includes('service'))return 'Service Agreement';
  return 'Contract';
}

function sendJson(res,status,data){
  res.writeHead(status,{'Content-Type':'application/json'});
  res.end(JSON.stringify(data));
}

function httpError(status,message){
  const err=new Error(message);
  err.status=status;
  return err;
}

function contentType(filePath){
  const ext=path.extname(filePath).toLowerCase();
  if(ext==='.html')return 'text/html; charset=utf-8';
  if(ext==='.css')return 'text/css; charset=utf-8';
  if(ext==='.js')return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

function loadEnv(filePath){
  if(!fs.existsSync(filePath))return;
  const lines=fs.readFileSync(filePath,'utf8').split(/\r?\n/);
  for(const line of lines){
    const match=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if(match&&!process.env[match[1]])process.env[match[1]]=match[2].replace(/^["']|["']$/g,'');
  }
}
