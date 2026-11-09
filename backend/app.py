import hashlib, io, json, os, re, sqlite3, uuid
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.request import Request, urlopen
from fastapi import FastAPI, File, HTTPException, UploadFile, Request as FastAPIRequest
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from pypdf import PdfReader

DB = os.environ.get('NODALY_DB', str(Path(__file__).with_name('nodaly.sqlite3')))
app = FastAPI()

@app.exception_handler(RequestValidationError)
async def validation_error(request: FastAPIRequest, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={'detail': jsonable_encoder([{**error, 'msg': 'Valor no válido'} for error in exc.errors()])})

class Connection(sqlite3.Connection):
    def __exit__(self, *args):
        try: return super().__exit__(*args)
        finally: self.close()

def db():
    c=sqlite3.connect(DB, timeout=10, factory=Connection); c.row_factory=sqlite3.Row
    c.executescript('''CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,name TEXT NOT NULL,pages TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY,name TEXT NOT NULL,nodes TEXT NOT NULL,edges TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,date TEXT NOT NULL,concept TEXT NOT NULL,category TEXT NOT NULL,amount TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS confirmations(run_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,preview TEXT NOT NULL,committed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY);''')
    c.execute('BEGIN IMMEDIATE')
    if c.execute("INSERT OR IGNORE INTO metadata VALUES('seeded')").rowcount:
        today=date.today().isoformat()
        c.executemany('INSERT INTO records VALUES(?,?,?,?,?)',[(str(uuid.uuid4()),today,'Almuerzo ficticio','food','12.50'),(str(uuid.uuid4()),today,'Cuadernos ficticios','supplies','23.75')])
    c.commit()
    return c

def mode(): return 'live' if all(os.environ.get(k) for k in ('NODALY_AI_URL','NODALY_AI_KEY','NODALY_AI_MODEL')) else 'demo'
def fail(msg): raise HTTPException(422,detail=msg)

def node(kind,x,config=None): return {'id':kind,'type':kind,'position':{'x':x,'y':80 if kind!='knowledge' else 250},'data':{'label':{'message':'Recibir mensaje','knowledge':'Base de conocimiento','agent':'Agente de IA','reply':'Respuesta','register':'Registrar información','query':'Consultar registros','report':'Generar informe'}[kind],'config':config or {}}}
def template(tid,name,description,kinds,configs,message):
    nodes=[node(k,80+i*220,configs.get(k)) for i,k in enumerate(kinds)]
    actions=[k for k in kinds if k!='knowledge']; edges=[{'id':f'{a}-{b}','source':a,'target':b} for a,b in zip(actions,actions[1:])]
    if 'knowledge' in kinds: edges.append({'id':'knowledge-agent','source':'knowledge','target':'agent'})
    return dict(id=tid,name=name,description=description,nodes=nodes,edges=edges,message=message)
TEMPLATES=[
 template('assistant','Asistente de documentos','Responde con información de tu base de conocimiento.', ['message','knowledge','agent','reply'],{'knowledge':{'text':'Nodaly es una herramienta visual de flujos de trabajo para demostraciones en clase.','document_ids':[]},'agent':{'mode':'answer','instructions':''},'reply':{'template':''}},'¿Qué es Nodaly?'),
 template('capture','Registro de gastos','Revisa un gasto antes de guardarlo.', ['message','agent','register','reply'],{'agent':{'mode':'extract','instructions':''},'register':{'collection':'expenses'},'reply':{'template':''}},'Hoy gasté 12.50 en almuerzo (comida).'),
 template('report','Informe de gastos','Filtra y resume los gastos.', ['message','agent','query','report','reply'],{'agent':{'mode':'query','instructions':''},'query':{'collection':'expenses','period':'all','category':''},'report':{'amount_field':'amount','group_by':'category','title':'Gastos'},'reply':{'template':''}},'Muestra todos los gastos.')]

class Graph(BaseModel):
    name:str='Flujo de trabajo'; nodes:list[dict]; edges:list[dict]
class Run(BaseModel):
    nodes:list[dict]; edges:list[dict]; message:str=Field(max_length=12000); run_id:str=Field(min_length=1,max_length=100); confirm:bool=False

@app.get('/api/health')
def health(): return {'status':'ok','mode':mode()}
@app.get('/api/templates')
def templates(): return TEMPLATES
@app.get('/api/workflows')
def workflows():
    with db() as c: return [dict(id=r['id'],name=r['name'],nodes=json.loads(r['nodes']),edges=json.loads(r['edges'])) for r in c.execute('SELECT * FROM workflows ORDER BY name')]
@app.put('/api/workflows/{wid}')
def save_workflow(wid:str,g:Graph):
    if len(wid)>100 or len(g.name)>200: fail('El identificador o el nombre del flujo de trabajo es demasiado largo')
    with db() as c: c.execute('INSERT OR REPLACE INTO workflows VALUES(?,?,?,?)',(wid,g.name,json.dumps(g.nodes),json.dumps(g.edges)))
    return dict(id=wid,**g.model_dump())
@app.get('/api/documents')
def documents():
    with db() as c: return [dict(id=r['id'],name=r['name'],text_length=sum(len(p) for p in json.loads(r['pages']))) for r in c.execute('SELECT * FROM documents ORDER BY name')]
@app.post('/api/documents')
async def upload(file:UploadFile=File(...)):
    name=Path((file.filename or '').replace('\\','/')).name
    if len(name)>200 or Path(name).suffix.lower() not in ('.txt','.pdf'): fail('Solo se admiten archivos PDF y TXT')
    data=await file.read(5*1024*1024+1)
    if len(data)>5*1024*1024: fail('El archivo supera los 5 MB')
    try:
        if name.lower().endswith('.txt'): pages=[data.decode('utf-8-sig')]
        else:
            reader=PdfReader(io.BytesIO(data)); pages=[page.extract_text() or '' for page in reader.pages]
    except Exception: fail('No se pudo leer el archivo; usa un TXT UTF-8 válido o un PDF con texto')
    if not any(p.strip() for p in pages): fail('El archivo no contiene texto extraíble; no se admiten PDF escaneados')
    if sum(map(len,pages))>24000: fail('El documento supera los 24000 caracteres')
    ident=str(uuid.uuid4())
    with db() as c: c.execute('INSERT INTO documents VALUES(?,?,?)',(ident,name,json.dumps(pages)))
    return {'id':ident,'name':name,'text_length':sum(map(len,pages))}
@app.delete('/api/documents/{did}')
def delete_document(did:str):
    with db() as c:
        if not c.execute('DELETE FROM documents WHERE id=?',(did,)).rowcount: raise HTTPException(404,'Documento no encontrado')
    return {'deleted':True}
@app.get('/api/records')
def records():
    with db() as c: return [dict(r) for r in c.execute('SELECT * FROM records ORDER BY date DESC,id')]

def validate(nodes,edges):
    if not nodes or len(nodes)>30 or len(edges)>60: fail('El grafo debe contener entre 1 y 30 nodos y hasta 60 conexiones')
    if any(not isinstance(n,dict) or not isinstance(n.get('id'),str) or not n['id'] or n.get('type') not in ('message','knowledge','agent','reply','register','query','report') or not isinstance(n.get('data',{}),dict) or not isinstance(n.get('data',{}).get('config',{}),dict) for n in nodes): fail('Nodo no válido')
    for n in nodes:
        typ=n['type']; cfg=n.get('data',{}).get('config',{})
        for key,limit in {'instructions':4000,'template':4000,'category':100,'title':200,'text':24000}.items():
            if key in cfg and (not isinstance(cfg[key],str) or len(cfg[key])>limit): fail('Configuración no válida: '+key)
        if typ=='knowledge' and (not isinstance(cfg.get('document_ids',[]),list) or len(cfg.get('document_ids',[]))>3 or any(not isinstance(d,str) or len(d)>100 for d in cfg.get('document_ids',[]))): fail('La base de conocimiento admite hasta tres documentos')
        if typ=='register' and cfg.get('field_map',{}) != {}: fail('No se admiten asignaciones de campos personalizadas')
    by={n['id']:n for n in nodes}
    if len(by)!=len(nodes): fail('Identificador de nodo duplicado')
    actions=[n for n in nodes if n['type']!='knowledge'];
    if sum(n['type']=='register' for n in actions)>1: fail('Solo se admite un registro por ejecución')
    starts=[n for n in actions if n['type']=='message']
    if len(starts)!=1: fail('El grafo necesita exactamente un nodo Recibir mensaje')
    out={n['id']:[] for n in actions}; incoming={n['id']:[] for n in actions}; contexts={n['id']:[] for n in actions}; seen=set()
    for e in edges:
        if not isinstance(e,dict) or not isinstance(e.get('source'),str) or not isinstance(e.get('target'),str) or e['source'] not in by or e['target'] not in by: fail('Una conexión hace referencia a un nodo inexistente')
        s,t=e['source'],e['target']
        if (s,t) in seen or s==t: fail('Conexión duplicada o cíclica')
        seen.add((s,t))
        if by[s]['type']=='knowledge':
            if by[t]['type']!='agent': fail('La base de conocimiento solo puede conectarse a un agente de IA')
            contexts[t].append(s)
        else:
            if by[t]['type'] in ('knowledge','message') or by[s]['type']=='reply': fail('Conexión incompatible')
            out[s].append(t); incoming[t].append(s)
    if any(len(v)>1 for v in out.values()) or any(len(v)>1 for v in incoming.values()): fail('La ejecución debe seguir una sola ruta conectada')
    if any(not any(n['id'] in cs for cs in contexts.values()) for n in nodes if n['type']=='knowledge'): fail('Nodo de conocimiento desconectado')
    order=[]; current=starts[0]['id']
    while current:
        if current in order: fail('El grafo contiene un ciclo')
        order.append(current); current=out[current][0] if out[current] else None
    if len(order)!=len(actions) or by[order[-1]]['type']!='reply': fail('Conecta todas las acciones desde Recibir mensaje hasta Respuesta')
    for i,ident in enumerate(order):
        typ=by[ident]['type']; cfg=by[ident].get('data',{}).get('config',{})
        if typ=='agent' and cfg.get('mode') not in ('answer','extract','query'): fail('Elige un modo válido para el agente de IA')
        if typ in ('register','query') and cfg.get('collection')!='expenses': fail('Colección no válida')
        if typ=='query' and cfg.get('period','all') not in ('all','today','week','month'): fail('Período no válido')
        if typ=='report' and (cfg.get('amount_field','amount')!='amount' or cfg.get('group_by','category') not in ('category','none')): fail('Configuración de informe no válida')
        if typ=='register' and (i==0 or by[order[i-1]]['type']!='agent' or by[order[i-1]].get('data',{}).get('config',{}).get('mode')!='extract'): fail('El registro requiere un agente de extracción inmediatamente antes')
        if typ=='report' and (i==0 or by[order[i-1]]['type']!='query'): fail('El informe requiere una consulta inmediatamente antes')
    return by,order,contexts

def knowledge(ids,by):
    sources=[]
    with db() as c:
        for ident in ids:
            cfg=by[ident].get('data',{}).get('config',{}); text=cfg.get('text',''); docs=cfg.get('document_ids',[])
            if not isinstance(text,str) or not isinstance(docs,list) or len(docs)>3 or any(not isinstance(d,str) for d in docs): fail('La base de conocimiento admite texto y hasta tres documentos')
            if text: sources.append(('Texto pegado',None,text))
            for did in docs:
                row=c.execute('SELECT * FROM documents WHERE id=?',(did,)).fetchone()
                if not row: fail('Un documento seleccionado ya no existe')
                for i,p in enumerate(json.loads(row['pages'])): sources.append((row['name'],i+1 if row['name'].lower().endswith('.pdf') else None,p))
    if sum(len(x[2]) for x in sources)>24000: fail('El contexto de conocimiento supera los 24000 caracteres')
    return sources

def answer(message,sources):
    stop={'what','when','where','which','who','the','is','are','a','an','of','to','in','and','how','does','do','que','qué','es','el','la','los','las','de','en','y','un','una','cuál','cual','cuánto','cuanto','son'}
    stop.update({'has','have','time','your','our','their','much','please','tell','me'})
    normalize=lambda x: x[:-1] if len(x)>4 and x.endswith('s') else x
    words={normalize(x) for x in re.findall(r'[^\W_]+',message.lower()) if len(x)>2 and x not in stop}
    needs_time=bool(re.search(r'\b(what time|when)\b',message.lower()))
    candidates=[]
    for name,page,text in sources:
        for sentence in re.split(r'(?<=[.!?])\s+|\n+',text):
            tokens={normalize(x) for x in re.findall(r'[^\W_]+',sentence.lower())}; score=len(words & tokens)
            time_evidence=not needs_time or bool(re.search(r'\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|morning|evening|night|noon|midnight)\b',sentence.lower()))
            if words and words <= tokens and time_evidence and sentence.strip(): candidates.append((score,sentence.strip(),name,page))
    if not candidates: return 'No encontré esa información en las fuentes proporcionadas.',[]
    candidates.sort(key=lambda x:x[0],reverse=True); _,sentence,name,page=candidates[0]
    return sentence,[{'name':name,**({'page':page} if page else {})}]

def extract(message):
    d=re.search(r'\b\d{4}-\d{2}-\d{2}\b',message); day=d.group() if d else date.today().isoformat()
    try: date.fromisoformat(day)
    except ValueError: raise ValueError('La fecha del gasto debe ser una fecha ISO válida')
    remainder=message.replace(day,'') if d else message
    numbers=list(re.finditer(r'(?<![\w.])-?\d+(?:[.,]\d+)?(?![\w.])',remainder))
    if not numbers: raise ValueError('Falta el importe del gasto')
    if len(numbers)>1:
        marked=[m for m in numbers if re.search(r'(?:\$|\b(?:mxn|usd))\s*$',remainder[:m.start()],re.I) or re.match(r'\s*(?:pesos?|dollars?|mxn|usd)\b',remainder[m.end():],re.I)]
        if len(marked)!=1: raise ValueError('El importe del gasto es ambiguo; especifica una moneda')
        amount=marked[0]
    else: amount=numbers[0]
    if re.search(r'[.,]\d{3,}$',amount.group()): raise ValueError('El importe del gasto debe tener como máximo dos decimales')
    try:
        value=Decimal(amount.group().replace(',','.'))
        if value<=0 or value>Decimal('1000000000'): raise ValueError('El importe del gasto debe ser positivo y no superar 1000000000')
    except InvalidOperation: raise ValueError('Importe del gasto no válido')
    concept=re.sub(r'\s+',' ',remainder[:amount.start()]+' '+remainder[amount.end():]).strip(' .,;:$()')
    meaningful=[w for w in re.findall(r'[^\W\d_]+',concept.lower()) if w not in {'today','i','spent','on','for','dollars','dollar','hoy','gasté','gaste','en','pesos','peso','the','a','de','un','una'}]
    if not meaningful: raise ValueError('Falta el concepto del gasto')
    low=concept.lower(); category='other'
    for cat,words in [('food',('food','lunch','dinner','comida','almuerzo','cena','restaurante')),('transport',('transport','taxi','gasolina','transporte')),('supplies',('supplies','notebook','limpieza','papelería','papeleria','material')),('utilities',('utilities','electricity','agua','luz','internet'))]:
        if any(w in low for w in words): category=cat; break
    return {'date':day,'concept':concept[:200],'category':category,'amount':f'{value:.2f}'}

def filters(message):
    low=message.lower(); period='all'
    for p,words in [('today',('today','hoy')),('week',('week','semana')),('month',('month','mes'))]:
        if any(re.search(r'\b'+w+r'\b',low) for w in words): period=p; break
    cat=next((cat for cat,words in [('food',('food','alimentación','alimentacion')),('transport',('transport','transporte')),('supplies',('supplies','insumos')),('utilities',('utilities','servicios')),('other',('other','otros'))] if any(re.search(r'\b'+w+r'\b',low) for w in words)),'')
    return {'period':period,'category':cat}
def query_records(cfg,previous):
    f=previous if isinstance(previous,dict) else {}; period=cfg.get('period','all'); period=period if period!='all' else f.get('period','all'); category=cfg.get('category','') or f.get('category','')
    if not isinstance(category,str) or len(category)>100: raise ValueError('Categoría no válida')
    today=date.today(); start={'today':today,'week':today-timedelta(days=today.weekday()),'month':today.replace(day=1)}.get(period)
    with db() as c: rows=[dict(r) for r in c.execute('SELECT * FROM records ORDER BY date,id')]
    return [r for r in rows if (not start or start.isoformat()<=r['date']<=today.isoformat()) and (not category or r['category'].lower()==category.lower())]
def report(rows,cfg):
    groups={}; total=Decimal('0')
    for r in rows:
        v=Decimal(r['amount']); total+=v; cat=r['category']; g=groups.setdefault(cat,{'category':cat,'total':Decimal('0'),'count':0}); g['total']+=v; g['count']+=1
    return {'title':cfg.get('title','Informe de gastos'), 'total':f'{total:.2f}','count':len(rows),'groups':[dict(g,total=f"{g['total']:.2f}") for g in groups.values()] if cfg.get('group_by','category')=='category' else []}

def live_answer(message,sources,instructions):
    prompt='Responde siempre en español y solo con estas fuentes. Si falta información, indícalo. Cita los nombres de las fuentes.\n'+ '\n'.join(f'[{name}{" página "+str(page) if page else ""}] {text}' for name,page,text in sources)
    payload=json.dumps({'model':os.environ['NODALY_AI_MODEL'],'messages':[{'role':'system','content':prompt+'\n'+instructions},{'role':'user','content':message}]}).encode()
    req=Request(os.environ['NODALY_AI_URL'],data=payload,headers={'Authorization':'Bearer '+os.environ['NODALY_AI_KEY'],'Content-Type':'application/json'},method='POST')
    try:
        with urlopen(req,timeout=30) as resp: result=json.load(resp)
        return result['choices'][0]['message']['content']
    except Exception: raise ValueError('Falló la solicitud al proveedor de IA configurado')

@app.post('/api/run')
def run(body:Run):
    by,order,contexts=validate(body.nodes,body.edges)
    fingerprint=hashlib.sha256(json.dumps({'nodes':body.nodes,'edges':body.edges,'message':body.message},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    pending=None; steps=[]; previous=body.message; result={'run_id':body.run_id,'status':'completed','mode':mode(),'steps':steps,'reply':''}; sources=[]
    try:
        for ident in order:
            n=by[ident]; typ=n['type']; cfg=n.get('data',{}).get('config',{}); output=previous
            if typ=='message': output=body.message
            elif typ=='agent':
                kind=cfg['mode']; sources=knowledge(contexts[ident],by)
                for context_id in contexts[ident]: steps.append({'node_id':context_id,'status':'completed','output':{'sources':len(sources)}})
                if kind=='answer':
                    output,used=answer(body.message,sources)
                    if mode()=='live': output=live_answer(body.message,sources,str(cfg.get('instructions',''))); used=[{'name':name,**({'page':p} if p else {})} for name,p,t in sources if t.strip()]
                    result['sources']=used
                elif kind=='extract': output=extract(body.message)
                else: output=filters(body.message)
            elif typ=='register':
                with db() as c:
                    c.execute('BEGIN IMMEDIATE'); saved=c.execute('SELECT * FROM confirmations WHERE run_id=?',(body.run_id,)).fetchone()
                    if saved and saved['fingerprint']!=fingerprint: raise ValueError('El identificador de ejecución pertenece a otra solicitud')
                    if not saved:
                        if body.confirm: raise ValueError('Revisa esta ejecución antes de confirmarla')
                        c.execute('INSERT INTO confirmations(run_id,fingerprint,preview) VALUES(?,?,?)',(body.run_id,fingerprint,json.dumps(previous))); output=previous
                    else: output=json.loads(saved['preview'])
                    result['preview']=output
                    if not body.confirm:
                        result['status']='awaiting_confirmation'; steps.append({'node_id':ident,'status':'awaiting_confirmation','output':output}); return result
                    pending=output
            elif typ=='query': output=query_records(cfg,previous)
            elif typ=='report': output=report(previous,cfg); result['report']=output
            elif typ=='reply':
                template=cfg.get('template','')
                if not isinstance(template,str) or len(template)>4000: raise ValueError('Plantilla de respuesta no válida')
                if template:
                    values=previous if isinstance(previous,dict) else {'output':str(previous)}
                    output=re.sub(r'\{([a-z_]+)\}',lambda m:str(values.get(m.group(1),m.group(0))),template)
                elif isinstance(previous,dict) and 'amount' in previous:
                    output=f"Gasto registrado: {previous['concept']}, importe {previous['amount']}, fecha {previous['date']}."
                elif isinstance(previous,dict) and 'groups' in previous:
                    output=f"{previous['title'] or 'Informe de gastos'}: {previous['count']} gastos, total {previous['total']}."
                elif isinstance(previous,dict): output='No hay información disponible para mostrar.'
                elif isinstance(previous,list): output=f'Se encontraron {len(previous)} registros.'
                else: output=str(previous)
                result['reply']=output
            steps.append({'node_id':ident,'status':'completed','output':output}); previous=output
        if pending is not None:
            with db() as c:
                c.execute('BEGIN IMMEDIATE')
                saved=c.execute('SELECT * FROM confirmations WHERE run_id=?',(body.run_id,)).fetchone()
                if not saved or saved['fingerprint']!=fingerprint: raise ValueError('La confirmación ya no coincide con esta solicitud')
                if not saved['committed']:
                    c.execute('INSERT INTO records VALUES(?,?,?,?,?)',(str(uuid.uuid4()),pending['date'],pending['concept'],pending['category'],pending['amount']))
                    c.execute('UPDATE confirmations SET committed=1 WHERE run_id=?',(body.run_id,))
    except (ValueError,TypeError,KeyError,sqlite3.Error) as exc:
        result['status']='error'; result['error']=str(exc); steps.append({'node_id':ident,'status':'error','output':str(exc)})
    return result

