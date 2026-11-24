import csv, hashlib, io, json, os, re, sqlite3, uuid
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.request import Request, urlopen
from fastapi import FastAPI, File, HTTPException, UploadFile, Request as FastAPIRequest
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from openpyxl import load_workbook
from pydantic import BaseModel, Field
from pypdf import PdfReader

DB = os.environ.get('NODALY_DB', str(Path(__file__).with_name('nodaly.sqlite3')))
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)

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
    CREATE TABLE IF NOT EXISTS record_meta(id TEXT PRIMARY KEY,collection TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS telegram_bots(workflow_id TEXT PRIMARY KEY,token TEXT NOT NULL,bot_username TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS confirmations(run_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,preview TEXT NOT NULL,committed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY);''')
    c.execute('BEGIN IMMEDIATE')
    if c.execute("INSERT OR IGNORE INTO metadata VALUES('seeded')").rowcount:
        today=date.today().isoformat()
        c.executemany('INSERT INTO records VALUES(?,?,?,?,?)',[(str(uuid.uuid4()),today,'Almuerzo ficticio','food','12.50'),(str(uuid.uuid4()),today,'Cuadernos ficticios','supplies','23.75')])
    if c.execute("INSERT OR IGNORE INTO metadata VALUES('seeded_fepi_v1')").rowcount:
        fepi_flows=[
            template('fepi-1-cotizaciones','1. Cotizador Mesas de Dulces (Sandra)','Cotiza mesas de dulces y exhibidores con precios actualizados.',['message','knowledge','agent','reply'],{'knowledge':{'text':'LISTA DE PRECIOS - MESAS DE DULCES SANDRA\nMesa clásica (30 invitados): $1,800 MXN.\nMesa premium (60 invitados): $3,200 MXN.\nRenta de exhibidores acrílicos (set de 5): $450 MXN.\nBolsa de dulces personalizada: $35 MXN c/u.\nEnvío y montaje en CDMX: $250 MXN.','document_ids':[]},'agent':{'mode':'answer','instructions':'Atiende como asistente de Sandra Díaz (Mesas de Dulces). Responde con precios actualizados y arma cotizaciones claras.'},'reply':{'template':''}},'¿Cuánto cuesta una mesa premium con renta de exhibidores?'),
            template('fepi-2-gastos-obra','2. Control de Obra y Gastos (Julio)','Registra gastos de materiales, obra e insumos desde WhatsApp.',['message','agent','register','reply'],{'agent':{'mode':'extract','instructions':'Extrae concepto, categoría y monto de gastos de obra o administración.'},'register':{'collection':'expenses'},'reply':{'template':''}},'Hoy gasté 850 en insumos de soldadura.'),
            template('fepi-3-reportes-evogym','3. Cortes y Reportes EvoGym (Gimnasio)','Genera cortes de caja y reportes de gastos filtrados.',['message','agent','query','report','reply'],{'agent':{'mode':'query','instructions':'Interpreta el período y categoría para el corte administrativo del gimnasio.'},'query':{'collection':'expenses','period':'all','category':''},'report':{'amount_field':'amount','group_by':'category','title':'Corte administrativo EvoGym'},'reply':{'template':''}},'Muestra todos los gastos del gimnasio.'),
            template('fepi-4-soporte-cursos','4. Soporte y Cursos en Línea (Fernando)','Clasifica solicitudes de soporte y responde dudas de la plataforma.',['message','knowledge','agent','reply'],{'knowledge':{'text':'SOPORTE PLATAFORMA DE CAPACITACIÓN\nInscripciones: Entra a Mis Cursos > Catálogo y haz clic en Inscribirme.\nConstancias: Se descargan automáticamente en PDF al completar el 100% del curso.\nRecuperar contraseña: Usa el enlace ¿Olvidaste tu contraseña? en el inicio de sesión.\nIncidencias de pago o acceso empresarial: Se escalan al equipo de soporte técnico con correo y número de matrícula.\nHorario de soporte humano: Lunes a Viernes de 9:00 AM a 6:00 PM.','document_ids':[]},'agent':{'mode':'answer','instructions':'Atiende como mesa de soporte de la plataforma de capacitación. Clasifica si la solicitud es duda general o incidencia técnica y responde con pasos claros.'},'reply':{'template':''}},'¿Cómo descargo mi constancia si ya terminé el curso?'),
        ]
        c.executemany('INSERT OR IGNORE INTO workflows VALUES(?,?,?,?)',[(f['id'],f['name'],json.dumps(f['nodes']),json.dumps(f['edges'])) for f in fepi_flows])
    if c.execute("INSERT OR IGNORE INTO metadata VALUES('seeded_fepi_v2')").rowcount:
        sandra_pages=[
            '[Hoja: Precios]\n'
            'Paquete: Mesa clásica (30 invitados) | Categoría: Mesas | Precio: $1800 MXN | Incluye: Mantel, 15 bases y letrero\n'
            'Paquete: Mesa premium (60 invitados) | Categoría: Mesas | Precio: $3200 MXN | Incluye: Decoración temática y 30 bases\n'
            'Paquete: Set de 5 exhibidores acrílicos | Categoría: Renta | Precio: $450 MXN | Incluye: Alquiler por evento (24h)\n'
            'Paquete: Bolsa de dulces personalizada | Categoría: Extras | Precio: $35 MXN | Incluye: Etiqueta con nombre del evento\n'
            'Paquete: Envío y montaje CDMX | Categoría: Logística | Precio: $250 MXN | Incluye: Traslado e instalación en sitio'
        ]
        soporte_pages=[
            'GUÍA DE SOPORTE - PLATAFORMA DE CAPACITACIÓN\n'
            'Inscripciones: Entra a Mis Cursos > Catálogo y haz clic en Inscribirme.\n'
            'Constancias: Se descargan en PDF desde Mi Progreso al completar el 100% del curso.\n'
            'Recuperar contraseña: Haz clic en ¿Olvidaste tu contraseña? en la pantalla de inicio de sesión.\n'
            'Incidencia de pago o acceso empresarial: Clasificar como Soporte Técnico y escalar con correo y número de matrícula.\n'
            'Horario de atención humana: Lunes a Viernes de 9:00 AM a 6:00 PM.'
        ]
        evogym_pages=[
            '[Hoja: Movimientos]\n'
            'Hora: 07:15 | Concepto: Suscripción Mensual Plan Black | Tipo: Ingreso | Categoría: Suscripción | Cliente: Carlos Méndez | MétodoPago: Tarjeta | Monto: $899\n'
            'Hora: 08:30 | Concepto: Inscripción + Mensualidad Básica | Tipo: Ingreso | Categoría: Suscripción | Cliente: Ana López | MétodoPago: Transferencia | Monto: $1150\n'
            'Hora: 10:05 | Concepto: Pase Diario Visitante | Tipo: Ingreso | Categoría: Pase Diario | Cliente: Luis Torres | MétodoPago: Efectivo | Monto: $120\n'
            'Hora: 11:40 | Concepto: Proteína Whey + Agua | Tipo: Ingreso | Categoría: Tienda | Cliente: Mostrador | MétodoPago: Efectivo | Monto: $185\n'
            'Hora: 13:20 | Concepto: Suscripción Mensual Plan Básico | Tipo: Ingreso | Categoría: Suscripción | Cliente: Sofía Ramírez | MétodoPago: Tarjeta | Monto: $599\n'
            'Hora: 14:10 | Concepto: Reposición toallas y limpieza | Tipo: Egreso | Categoría: Operación | Cliente: Proveedor Limpieza | MétodoPago: Efectivo | Monto: $420\n'
            'Hora: 16:00 | Concepto: Mantenimiento caminadora #3 | Tipo: Egreso | Categoría: Mantenimiento | Cliente: Técnico GymFix | MétodoPago: Transferencia | Monto: $650'
        ]
        c.executemany('INSERT OR REPLACE INTO documents VALUES(?,?,?)',[
            ('sample-sandra-xlsx','Catalogo_Mesas_Sandra.xlsx',json.dumps(sandra_pages)),
            ('sample-soporte-pdf','Guia_Soporte_Cursos.pdf',json.dumps(soporte_pages)),
            ('sample-evogym-xlsx','Movimientos_EvoGym_Dia.xlsx',json.dumps(evogym_pages)),
        ])
        fepi_v2=[
            template('fepi-1-cotizaciones','1. Cotizador Mesas de Dulces (Sandra)','Cotiza mesas de dulces pidiendo el nombre del cliente y generando copia.',['message','knowledge','agent','reply'],{'knowledge':{'text':'Notas: Precios sujetos a disponibilidad de fecha. Anticipo del 50% para apartar.','document_ids':['sample-sandra-xlsx']},'agent':{'mode':'answer','model':'openai/gpt-4o-mini','instructions':'Atiende como asistente de Sandra Díaz (Mesas de Dulces). ANTES de entregar una cotización final, si el cliente aún no ha dicho su nombre en la conversación, pregúntale su nombre amablemente. Cuando ya tengas su nombre y lo que desea, genera la cotización desglosada con el total y despídete indicando que se generó una copia para el cliente y un reporte para Sandra.'},'reply':{'template':''}},'¿Cuánto cuesta una mesa premium con exhibidores?'),
            template('fepi-2-gastos-obra','2. Control de Obra y Gastos (Julio)','Registra gastos de materiales, obra e insumos desde WhatsApp.',['message','agent','register','reply'],{'agent':{'mode':'extract','instructions':'Extrae concepto, categoría y monto de gastos de obra o administración.'},'register':{'collection':'expenses'},'reply':{'template':''}},'Hoy gasté 850 en soldadura.'),
            template('fepi-3-reportes-evogym','3. Movimientos e Ingresos EvoGym (Gimnasio)','Analiza el Excel diario de suscripciones, ingresos y egresos de EvoGym.',['message','knowledge','agent','reply'],{'knowledge':{'text':'Regla: Suma correctamente Ingresos, Egresos, Suscripciones y Corte Neto (Ingresos - Egresos).','document_ids':['sample-evogym-xlsx']},'agent':{'mode':'answer','model':'openai/gpt-4o-mini','instructions':'Eres el asistente financiero de EvoGym. Responde preguntas sobre ingresos del día, suscripciones vendidas, egresos, métodos de pago y corte neto usando el Excel de movimientos.'},'reply':{'template':''}},'¿Cuánto ingresó hoy en total?'),
            template('fepi-4-soporte-cursos','4. Soporte y Cursos en Línea (Fernando)','Clasifica solicitudes de soporte y responde dudas de la plataforma.',['message','knowledge','agent','reply'],{'knowledge':{'text':'Regla: Si es problema de pago o acceso empresarial, indicar escalamiento a Soporte Técnico.','document_ids':['sample-soporte-pdf']},'agent':{'mode':'answer','model':'openai/gpt-4o-mini','instructions':'Atiende como mesa de soporte de la plataforma de capacitación. Clasifica si la solicitud es duda general o incidencia técnica y responde con pasos claros.'},'reply':{'template':''}},'¿Cómo descargo mi constancia si ya terminé el curso?'),
        ]
        c.executemany('INSERT OR REPLACE INTO workflows VALUES(?,?,?,?)',[(f['id'],f['name'],json.dumps(f['nodes']),json.dumps(f['edges'])) for f in fepi_v2])
    if c.execute("INSERT OR IGNORE INTO metadata VALUES('seeded_fepi_v3')").rowcount:
        fepi_v3=[
            template('fepi-1-cotizaciones','1. Cotizador Mesas de Dulces (Sandra)','Cotiza mesas de dulces y genera copia descargable en PDF.',['message','knowledge','agent','export','reply'],{'knowledge':{'text':'Notas: Precios sujetos a disponibilidad de fecha. Anticipo del 50% para apartar.','document_ids':['sample-sandra-xlsx']},'agent':{'mode':'answer','model':'openai/gpt-4o-mini','instructions':'Atiende como asistente de Sandra Díaz (Mesas de Dulces). ANTES de entregar una cotización final, si el cliente aún no ha dicho su nombre en la conversación, pregúntale su nombre amablemente. Cuando ya tengas su nombre y lo que desea, genera la cotización desglosada con el total y despídete indicando que puede descargar su copia en PDF.'},'export':{'format':'pdf','filename':'cotizacion-sandra','title':'Cotización — Mesas de Dulces Sandra'},'reply':{'template':''}},'Soy Laura, cotízame 1 mesa clásica + exhibidores + envío'),
            template('fepi-2-gastos-obra','2. Control de Obra y Gastos (Julio)','Registra gastos de obra en tabla SQLite y exporta comprobante en Excel.',['message','agent','register','export','reply'],{'agent':{'mode':'extract','instructions':'Extrae concepto, categoría y monto de gastos de obra o administración.'},'register':{'collection':'expenses'},'export':{'format':'xlsx','filename':'gasto-obra-julio','title':'Comprobante de Gasto de Obra'},'reply':{'template':''}},'Hoy gasté 850 en soldadura.'),
            template('fepi-3-reportes-evogym','3. Cortes y Reportes EvoGym (Gimnasio)','Consulta los registros guardados, calcula totales y exporta el corte a Excel.',['message','agent','query','report','export','reply'],{'agent':{'mode':'query','instructions':'Interpreta el período y categoría para el corte administrativo del gimnasio.'},'query':{'collection':'expenses','period':'all','category':''},'report':{'amount_field':'amount','group_by':'category','title':'Corte administrativo EvoGym'},'export':{'format':'xlsx','filename':'corte-evogym','title':'Corte administrativo EvoGym'},'reply':{'template':''}},'Muestra todos los gastos'),
            template('fepi-4-soporte-cursos','4. Soporte y Consulta de Registros (Fernando)','Cruza la guía PDF con la tabla de registros guardados usando el Agente IA.',['message','query','knowledge','agent','reply'],{'query':{'collection':'expenses','period':'all','category':''},'knowledge':{'text':'Regla: Si es problema de pago o acceso empresarial, indicar escalamiento a Soporte Técnico.','document_ids':['sample-soporte-pdf']},'agent':{'mode':'answer','model':'openai/gpt-4o-mini','instructions':'Atiende como mesa de soporte y asistente administrativo. Tienes acceso tanto a la guía de soporte como a la tabla de registros guardados. Responde dudas de la plataforma o preguntas sobre los registros guardados con pasos y datos claros.'},'reply':{'template':''}},'¿Qué gastos tenemos registrados en la tabla?'),
        ]
        c.executemany('INSERT OR REPLACE INTO workflows VALUES(?,?,?,?)',[(f['id'],f['name'],json.dumps(f['nodes']),json.dumps(f['edges'])) for f in fepi_v3])
    c.commit()
    return c

def mode():
    if os.environ.get('OPENROUTER_API_KEY'): return 'live'
    return 'live' if all(os.environ.get(k) for k in ('NODALY_AI_URL','NODALY_AI_KEY','NODALY_AI_MODEL')) else 'demo'
def fail(msg): raise HTTPException(422,detail=msg)

def node(kind,x,config=None): return {'id':kind,'type':kind,'position':{'x':x,'y':80 if kind!='knowledge' else 250},'data':{'label':{'message':'Recibir mensaje','knowledge':'Base de conocimiento','agent':'Agente de IA','reply':'Respuesta','register':'Registrar información','query':'Consultar registros','report':'Generar informe','export':'Exportar archivo'}[kind],'config':config or {}}}
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
    nodes:list[dict]; edges:list[dict]; message:str=Field(max_length=12000); run_id:str=Field(min_length=1,max_length=100); confirm:bool=False; history:list[dict]=[]

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
@app.get('/api/documents/{did}')
def get_document(did:str):
    with db() as c:
        row=c.execute('SELECT * FROM documents WHERE id=?',(did,)).fetchone()
        if not row: raise HTTPException(404,'Documento no encontrado')
        pages=json.loads(row['pages'])
        kind='pdf' if row['name'].lower().endswith('.pdf') else 'excel' if row['name'].lower().endswith(('.xlsx','.csv')) else 'text'
        return {'id':row['id'],'name':row['name'],'kind':kind,'text_length':sum(len(p) for p in pages),'sections':[{'label':f"{row['name']}, pág. {i+1}" if kind=='pdf' else row['name'],**({'page':i+1} if kind=='pdf' else {}), 'text':p} for i,p in enumerate(pages)]}
@app.post('/api/documents')
async def upload(file:UploadFile=File(...)):
    name=Path((file.filename or '').replace('\\','/')).name
    suffix=Path(name).suffix.lower()
    if len(name)>200 or suffix not in ('.txt','.md','.markdown','.pdf','.xlsx','.csv'): fail('Solo se admiten archivos PDF, Excel (.xlsx), CSV, TXT y Markdown (.md)')
    data=await file.read(5*1024*1024+1)
    if len(data)>5*1024*1024: fail('El archivo supera los 5 MB')
    try:
        if suffix=='.txt': pages=[data.decode('utf-8-sig')]
        elif suffix in ('.md','.markdown'):
            text_data=data.decode('utf-8-sig').strip()
            parts=[p.strip() for p in re.split(r'\n(?=#{1,3}\s+)',text_data) if p.strip()]
            pages=parts if parts else [text_data]
        elif suffix=='.csv':
            text_data=data.decode('utf-8-sig')
            rows=list(csv.reader(io.StringIO(text_data)))
            headers=rows[0] if rows else []
            formatted=[' | '.join(f'{headers[i] if i<len(headers) else f"Col{i+1}"}: {cell}' for i,cell in enumerate(r) if cell.strip()) for r in rows[1:]] if len(rows)>1 else [', '.join(r) for r in rows]
            pages=['\n'.join(line for line in formatted if line)]
        elif suffix=='.xlsx':
            wb=load_workbook(io.BytesIO(data),read_only=True,data_only=True)
            pages=[]
            for sheet_name in wb.sheetnames:
                ws=wb[sheet_name]
                rows=list(ws.iter_rows(values_only=True))
                if not rows: continue
                headers=[str(h or f'Col{i+1}').strip() for i,h in enumerate(rows[0])]
                lines=[]
                for r in rows[1:]:
                    pairs=[f'{headers[i]}: {str(v).strip()}' for i,v in enumerate(r) if i<len(headers) and v is not None and str(v).strip()!='']
                    if pairs: lines.append(' | '.join(pairs))
                if lines: pages.append(f'[Hoja: {sheet_name}]\n'+'\n'.join(lines))
        else:
            reader=PdfReader(io.BytesIO(data)); pages=[page.extract_text() or '' for page in reader.pages]
    except Exception: fail('No se pudo leer el archivo; usa un PDF, Excel (.xlsx), CSV o TXT válido')
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
def get_all_records(collection:str=''):
    with db() as c:
        rows=c.execute('SELECT r.id,r.date,r.concept,r.category,r.amount,m.collection AS meta_collection,m.data AS meta_data FROM records r LEFT JOIN record_meta m ON r.id=m.id ORDER BY r.date DESC,r.id').fetchall()
    items=[]
    target=(collection or '').strip()
    for r in rows:
        col=r['meta_collection'] or 'expenses'
        if target and target!='all' and col.lower()!=target.lower(): continue
        if r['meta_data']:
            parsed=json.loads(r['meta_data'])
            item={'id':r['id'],'collection':col,'date':r['date'],**parsed,'data':parsed}
        else:
            item={'id':r['id'],'date':r['date'],'concept':r['concept'],'category':r['category'],'amount':r['amount']}
        items.append(item)
    return items

@app.get('/api/records')
def records(collection:str=''):
    return get_all_records(collection)

def parse_fields_spec(raw):
    if isinstance(raw,list): items=[str(x).strip() for x in raw if str(x).strip()]
    elif isinstance(raw,str): items=[x.strip() for x in re.split(r'[,;\n]+',raw) if x.strip()]
    else: items=[]
    seen=set(); out=[]
    for item in items:
        k=item.lower()
        if k not in seen: seen.add(k); out.append(item)
    return out

def format_record_line(r):
    data=r.get('data') if isinstance(r.get('data'),dict) else None
    if data:
        col=r.get('collection','registro')
        parts=[f"{k}: {v}" for k,v in data.items() if v is not None and str(v).strip()!='']
        return f"[{col}] " + ' | '.join(parts)
    return f"Fecha: {r.get('date','')} | Concepto: {r.get('concept','')} | Categoría: {r.get('category','')} | Importe: ${r.get('amount','')}"

def validate(nodes,edges):
    if not nodes or len(nodes)>30 or len(edges)>60: fail('El grafo debe contener entre 1 y 30 nodos y hasta 60 conexiones')
    if any(not isinstance(n,dict) or not isinstance(n.get('id'),str) or not n['id'] or n.get('type') not in ('message','knowledge','agent','reply','register','query','report','export') or not isinstance(n.get('data',{}),dict) or not isinstance(n.get('data',{}).get('config',{}),dict) for n in nodes): fail('Nodo no válido')
    for n in nodes:
        typ=n['type']; cfg=n.get('data',{}).get('config',{})
        for key,limit in {'instructions':4000,'template':4000,'category':100,'title':200,'text':24000,'filename':120,'fields':1000,'collection':100,'telegram_token':200,'telegram_chat_id':100,'include_collection':100,'amount_field':100,'group_by':100}.items():
            if key in cfg and (not isinstance(cfg[key],str) or len(cfg[key])>limit): fail('Configuración no válida: '+key)
        if typ=='export' and cfg.get('format','xlsx') not in ('xlsx','pdf'): fail('Formato de exportación no válido')
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
        if typ in ('register','query'):
            col=str(cfg.get('collection','expenses')).strip()
            if not col or len(col)>100 or not re.match(r'^[\w\s\-áéíóúÁÉÍÓÚñÑ]+$',col): fail('Colección no válida')
        if typ=='query' and cfg.get('period','all') not in ('all','today','week','month'): fail('Período no válido')
        if typ=='report':
            af=str(cfg.get('amount_field','amount')).strip(); gb=str(cfg.get('group_by','category')).strip()
            if not af or len(af)>100 or not gb or len(gb)>100: fail('Configuración de informe no válida')
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
            inc_col=str(cfg.get('include_collection','') or '').strip()
            if inc_col:
                recs=get_all_records('' if inc_col=='all' else inc_col)
                lines=[format_record_line(r) for r in recs]
                sources.append(('Registros guardados',None,'[Tabla: Registros guardados]\n'+('\n'.join(lines) if lines else 'No hay registros guardados en esta tabla.')))
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

def extract_custom_fields(message,field_names):
    text=(message or '').strip()
    if not text: raise ValueError('El mensaje está vacío para extraer datos')
    d=re.search(r'\b\d{4}-\d{2}-\d{2}\b',text); day=d.group() if d else date.today().isoformat()
    result={}
    kv_pairs=re.findall(r'([\wáéíóúÁÉÍÓÚñÑ\s]{1,40}?)\s*[:=]\s*([^,;\n]+)',text)
    kv_map={k.strip().lower():v.strip() for k,v in kv_pairs if k.strip() and v.strip()}
    parts=[p.strip() for p in re.split(r'[,;\n]+',text) if p.strip()]
    nums=re.findall(r'(?<![\w.])\d+(?:[.,]\d{1,2})?(?![\w.])',text)
    used_positional=0
    for fname in field_names:
        low=fname.lower()
        if low in kv_map:
            result[fname]=kv_map[low]
        elif low in ('fecha','date'):
            result[fname]=day
        elif any(w in low for w in ('monto','importe','precio','total','cantidad','valor','amount','cost','costo')) and nums:
            result[fname]=nums[0].replace(',','.')
        elif len(parts)>=len(field_names) and used_positional<len(parts):
            seg=re.sub(r'^[\wáéíóúÁÉÍÓÚñÑ\s]{1,30}\s*[:=]\s*','',parts[used_positional]).strip()
            result[fname]=seg
            used_positional+=1
        elif used_positional==0:
            result[fname]=text[:300]
            used_positional+=1
        else:
            result[fname]=''
    if 'date' not in result and 'fecha' not in {k.lower() for k in result}:
        result['date']=day
    if not any(str(v).strip() for k,v in result.items() if k not in ('date','fecha')):
        raise ValueError('No se encontraron datos válidos para registrar en el mensaje')
    return result

def live_extract(message,field_names,instructions='',collection='registros',model_override=''):
    or_key=os.environ.get('OPENROUTER_API_KEY')
    ai_url=os.environ.get('NODALY_AI_URL') or ('https://openrouter.ai/api/v1/chat/completions' if or_key else '')
    ai_key=os.environ.get('NODALY_AI_KEY') or or_key or ''
    ai_model=model_override or os.environ.get('NODALY_AI_MODEL') or os.environ.get('OPENROUTER_MODEL','openai/gpt-4o-mini')
    schema_hint=', '.join(field_names)
    sys_prompt=(f"Eres un extractor de datos estructurados para la tabla '{collection}'. "
        f"Extrae del mensaje del usuario exactamente estos campos: {schema_hint}. "
        "Responde ÚNICAMENTE con un objeto JSON válido (sin markdown ni texto adicional) donde las claves sean exactamente esos nombres de campo y 'date' en formato YYYY-MM-DD (usa hoy si no se menciona fecha). "
        + (f"Instrucciones adicionales: {instructions}" if instructions else ""))
    msgs=[{'role':'system','content':sys_prompt},{'role':'user','content':message}]
    payload=json.dumps({'model':ai_model,'messages':msgs}).encode()
    headers={'Authorization':'Bearer '+ai_key,'Content-Type':'application/json'}
    if 'openrouter.ai' in ai_url:
        headers['HTTP-Referer']='https://nodaly.vercel.app'; headers['X-Title']='Nodaly Flow Studio'
    req=Request(ai_url,data=payload,headers=headers,method='POST')
    with urlopen(req,timeout=30) as resp: res_data=json.load(resp)
    raw=res_data['choices'][0]['message']['content'].strip()
    m=re.search(r'\{[\s\S]*\}',raw)
    if not m: raise ValueError('La IA no devolvió un JSON válido')
    parsed=json.loads(m.group(0))
    if not isinstance(parsed,dict): raise ValueError('La IA no devolvió un objeto JSON')
    out={f:str(parsed.get(f,'')) for f in field_names}
    out['date']=str(parsed.get('date') or date.today().isoformat())[:10]
    return out, ai_model

def filters(message):
    low=message.lower(); period='all'
    for p,words in [('today',('today','hoy')),('week',('week','semana')),('month',('month','mes'))]:
        if any(re.search(r'\b'+w+r'\b',low) for w in words): period=p; break
    cat=next((cat for cat,words in [('food',('food','alimentación','alimentacion')),('transport',('transport','transporte')),('supplies',('supplies','insumos')),('utilities',('utilities','servicios')),('other',('other','otros'))] if any(re.search(r'\b'+w+r'\b',low) for w in words)),'')
    return {'period':period,'category':cat}
def query_records(cfg,previous):
    f=previous if isinstance(previous,dict) else {}; period=cfg.get('period','all'); period=period if period!='all' else f.get('period','all'); category=cfg.get('category','') or f.get('category','')
    if not isinstance(category,str) or len(category)>100: raise ValueError('Categoría no válida')
    collection=str(cfg.get('collection','expenses') or 'expenses').strip()
    today=date.today(); start={'today':today,'week':today-timedelta(days=today.weekday()),'month':today.replace(day=1)}.get(period)
    rows=get_all_records(collection)
    cat_low=category.strip().lower()
    out=[]
    for r in rows:
        r_date=str(r.get('date',''))
        if start and not (start.isoformat()<=r_date<=today.isoformat()): continue
        if cat_low:
            r_cat=str(r.get('category','')).lower()
            if r_cat!=cat_low and not any(cat_low in str(v).lower() for k,v in r.items() if k not in ('id','data')):
                continue
        out.append(r)
    return out

def _safe_decimal(val):
    if val is None: return Decimal('0')
    s=re.sub(r'[^\d.,-]','',str(val).replace(',',''))
    if not s or s=='-': return Decimal('0')
    try: return Decimal(s)
    except InvalidOperation: return Decimal('0')

def report(rows,cfg):
    groups={}; total=Decimal('0')
    amount_field=str(cfg.get('amount_field','amount') or 'amount')
    group_by=str(cfg.get('group_by','category') or 'category')
    for r in rows:
        v=_safe_decimal(r.get(amount_field,r.get('amount',0)))
        total+=v
        cat=str(r.get(group_by) or r.get('category') or 'General')
        g=groups.setdefault(cat,{'category':cat,'total':Decimal('0'),'count':0}); g['total']+=v; g['count']+=1
    return {'title':cfg.get('title','Informe de gastos'), 'total':f'{total:.2f}','count':len(rows),'groups':[dict(g,total=f"{g['total']:.2f}") for g in groups.values()] if group_by!='none' else []}

def live_answer(message,sources,instructions,model_override='',history=None):
    or_key=os.environ.get('OPENROUTER_API_KEY')
    ai_url=os.environ.get('NODALY_AI_URL') or ('https://openrouter.ai/api/v1/chat/completions' if or_key else '')
    ai_key=os.environ.get('NODALY_AI_KEY') or or_key or ''
    ai_model=model_override or os.environ.get('NODALY_AI_MODEL') or os.environ.get('OPENROUTER_MODEL','openai/gpt-4o-mini')
    prompt='Responde siempre en español y solo con estas fuentes. Si falta información, indícalo. Cita los nombres de las fuentes.\n'+ '\n'.join(f'[{name}{" página "+str(page) if page else ""}] {text}' for name,page,text in sources)
    msgs=[{'role':'system','content':prompt+'\n'+instructions}]
    if history:
        for h in history[-8:]:
            if isinstance(h,dict) and h.get('role') in ('user','assistant') and h.get('content'):
                msgs.append({'role':h['role'],'content':str(h['content'])})
    msgs.append({'role':'user','content':message})
    payload=json.dumps({'model':ai_model,'messages':msgs}).encode()
    headers={'Authorization':'Bearer '+ai_key,'Content-Type':'application/json'}
    if 'openrouter.ai' in ai_url:
        headers['HTTP-Referer']='https://nodaly.vercel.app'
        headers['X-Title']='Nodaly Flow Studio'
    req=Request(ai_url,data=payload,headers=headers,method='POST')
    try:
        with urlopen(req,timeout=30) as resp: result=json.load(resp)
        return result['choices'][0]['message']['content'], ai_model
    except Exception: raise ValueError('Falló la solicitud al proveedor de IA configurado')

def _row_to_export_dict(r):
    if isinstance(r.get('data'),dict):
        return {'Tabla':r.get('collection','registro'),'Fecha':r.get('date',''),**{k:v for k,v in r['data'].items() if k not in ('date','fecha')}}
    return {'Fecha':r.get('date',''),'Concepto':r.get('concept',''),'Categoría':r.get('category',''),'Importe':r.get('amount','')}

@app.post('/api/run')
def run(body:Run):
    by,order,contexts=validate(body.nodes,body.edges)
    fingerprint=hashlib.sha256(json.dumps({'nodes':body.nodes,'edges':body.edges,'message':body.message},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    pending=None; pending_collection='expenses'; steps=[]; previous=body.message; last_rows=None; result={'run_id':body.run_id,'status':'completed','mode':mode(),'steps':steps,'reply':''}; sources=[]
    try:
        for idx,ident in enumerate(order):
            n=by[ident]; typ=n['type']; cfg=n.get('data',{}).get('config',{}); output=previous
            if typ=='message': output=body.message
            elif typ=='agent':
                kind=cfg['mode']; sources=knowledge(contexts[ident],by)
                for context_id in contexts[ident]: steps.append({'node_id':context_id,'status':'completed','output':{'sources':len(sources)}})
                if kind=='answer':
                    if isinstance(previous,list):
                        table_lines=[format_record_line(r) for r in previous if isinstance(r,dict)]
                        sources.append(('Registros guardados',None,'[Tabla: Registros guardados]\n'+('\n'.join(table_lines) if table_lines else 'No hay registros guardados en este período.')))
                    output,used=answer(body.message,sources)
                    if mode()=='live':
                        output,used_model=live_answer(body.message,sources,str(cfg.get('instructions','')),str(cfg.get('model','')),body.history)
                        used=[{'name':name,**({'page':p} if p else {})} for name,p,t in sources if t.strip()]
                        result['used_llm']=True
                        result['llm_model']=used_model
                    result['sources']=used
                elif kind=='extract':
                    next_reg=by[order[idx+1]] if idx+1<len(order) and by[order[idx+1]]['type']=='register' else None
                    reg_cfg=next_reg.get('data',{}).get('config',{}) if next_reg else {}
                    target_col=str(reg_cfg.get('collection','expenses') or 'expenses').strip()
                    fields_spec=cfg.get('fields') or reg_cfg.get('fields') or ''
                    field_names=parse_fields_spec(fields_spec)
                    if target_col=='expenses' and not field_names:
                        output=extract(body.message)
                    else:
                        if not field_names: field_names=['fecha','concepto','categoria','valor']
                        if mode()=='live':
                            output,used_model=live_extract(body.message,field_names,str(cfg.get('instructions','')),target_col,str(cfg.get('model','')))
                            result['used_llm']=True; result['llm_model']=used_model
                        else:
                            output=extract_custom_fields(body.message,field_names)
                else: output=filters(body.message)
            elif typ=='register':
                pending_collection=str(cfg.get('collection','expenses') or 'expenses').strip()
                with db() as c:
                    c.execute('BEGIN IMMEDIATE'); saved=c.execute('SELECT * FROM confirmations WHERE run_id=?',(body.run_id,)).fetchone()
                    if saved and saved['fingerprint']!=fingerprint: raise ValueError('El identificador de ejecución pertenece a otra solicitud')
                    if not saved:
                        if body.confirm: raise ValueError('Revisa esta ejecución antes de confirmarla')
                        c.execute('INSERT INTO confirmations(run_id,fingerprint,preview) VALUES(?,?,?)',(body.run_id,fingerprint,json.dumps(previous,ensure_ascii=False))); output=previous
                    else: output=json.loads(saved['preview'])
                    result['preview']=output
                    if not body.confirm:
                        result['status']='awaiting_confirmation'; steps.append({'node_id':ident,'status':'awaiting_confirmation','output':output}); return result
                    pending=output
            elif typ=='query': output=query_records(cfg,previous); last_rows=output
            elif typ=='report': output=report(previous,cfg); result['report']=output
            elif typ=='export':
                fmt=cfg.get('format','xlsx'); fname=(cfg.get('filename') or 'reporte-nodaly').strip() or 'reporte-nodaly'
                if isinstance(previous,list):
                    exp_rows=[_row_to_export_dict(r) for r in previous if isinstance(r,dict)]
                    exp_title=cfg.get('title') or 'Tabla de registros'
                    exp_summary=f"Se exportaron {len(exp_rows)} registros."
                elif last_rows is not None and isinstance(previous,dict) and 'groups' in previous:
                    exp_rows=[_row_to_export_dict(r) for r in last_rows if isinstance(r,dict)]
                    exp_title=previous.get('title') or cfg.get('title') or 'Informe de gastos'
                    exp_summary=f"{exp_title}: {previous['count']} registros, total ${previous['total']}."
                elif isinstance(previous,dict) and 'amount' in previous:
                    exp_rows=[{'Fecha':previous.get('date',''),'Concepto':previous.get('concept',''),'Categoría':previous.get('category',''),'Importe':previous.get('amount','')}]
                    exp_title=cfg.get('title') or 'Comprobante de registro'
                    exp_summary=f"Gasto registrado: {previous['concept']}, importe ${previous['amount']}, fecha {previous['date']}."
                elif isinstance(previous,dict):
                    exp_rows=[{k:str(v) for k,v in previous.items()}]
                    exp_title=cfg.get('title') or 'Comprobante de registro'
                    exp_summary='Registro guardado: '+', '.join(f"{k}: {v}" for k,v in previous.items())+'.'
                else:
                    exp_rows=[{'Fecha':date.today().isoformat(),'Pregunta':body.message,'Respuesta':str(previous)}]
                    exp_title=cfg.get('title') or 'Documento generado'
                    exp_summary=str(previous)
                result['export_file']={'format':fmt,'filename':fname,'title':exp_title,'rows':exp_rows,'summary':exp_summary}
                steps.append({'node_id':ident,'status':'completed','output':{'format':fmt,'filename':fname,'rows':len(exp_rows)}})
                continue
            elif typ=='reply':
                template=cfg.get('template','')
                if not isinstance(template,str) or len(template)>4000: raise ValueError('Plantilla de respuesta no válida')
                if template:
                    values=previous if isinstance(previous,dict) else {'output':str(previous)}
                    output=re.sub(r'\{([a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]+)\}',lambda m:str(values.get(m.group(1),m.group(0))),template)
                elif isinstance(previous,dict) and 'amount' in previous and 'concept' in previous:
                    output=f"Gasto registrado: {previous['concept']}, importe {previous['amount']}, fecha {previous['date']}."
                elif isinstance(previous,dict) and 'groups' in previous:
                    output=f"{previous['title'] or 'Informe de gastos'}: {previous['count']} gastos, total {previous['total']}."
                elif isinstance(previous,dict):
                    summary_parts=[f"{k}: {v}" for k,v in previous.items() if k not in ('id','data') and str(v).strip()!='']
                    output=('Registro guardado: '+', '.join(summary_parts)+'.') if summary_parts else 'No hay información disponible para mostrar.'
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
                    r_id=str(uuid.uuid4())
                    r_date=str(pending.get('date') or pending.get('fecha') or date.today().isoformat())[:10]
                    r_concept=str(pending.get('concept') or pending.get('concepto') or pending.get('nombre') or next((v for k,v in pending.items() if k not in ('date','fecha','amount','monto','importe','category','categoria') and v),'') or body.message)[:200]
                    r_category=str(pending.get('category') or pending.get('categoria') or pending_collection)[:100]
                    r_amount=str(pending.get('amount') or pending.get('monto') or pending.get('importe') or pending.get('precio') or pending.get('total') or '0.00')
                    c.execute('INSERT INTO records VALUES(?,?,?,?,?)',(r_id,r_date,r_concept,r_category,r_amount))
                    if pending_collection!='expenses' or set(pending.keys())!={'date','concept','category','amount'}:
                        c.execute('INSERT OR REPLACE INTO record_meta VALUES(?,?,?)',(r_id,pending_collection,json.dumps(pending,ensure_ascii=False)))
                    c.execute('UPDATE confirmations SET committed=1 WHERE run_id=?',(body.run_id,))
    except (ValueError,TypeError,KeyError,sqlite3.Error) as exc:
        result['status']='error'; result['error']=str(exc); steps.append({'node_id':ident,'status':'error','output':str(exc)})
    return result

def _tg_call(token:str,method:str,payload:dict=None):
    url=f'https://api.telegram.org/bot{token}/{method}'
    data=json.dumps(payload).encode() if payload is not None else None
    headers={'Content-Type':'application/json'} if data is not None else {}
    req=Request(url,data=data,headers=headers,method='POST' if data is not None else 'GET')
    try:
        with urlopen(req,timeout=15) as resp: res=json.load(resp)
    except Exception as exc:
        raise HTTPException(422,detail=f'No se pudo conectar con Telegram: {exc}')
    if not res.get('ok'):
        raise HTTPException(422,detail=res.get('description','Token o solicitud de Telegram no válida'))
    return res.get('result')

class TgVerify(BaseModel):
    token:str=Field(min_length=10,max_length=200)

class TgPoll(BaseModel):
    token:str=Field(min_length=10,max_length=200); offset:int=0; nodes:list[dict]; edges:list[dict]; auto_confirm:bool=True

class TgWebhook(BaseModel):
    token:str=Field(min_length=10,max_length=200); webhook_url:str=Field(min_length=10,max_length=500); workflow_id:str='default'; nodes:list[dict]; edges:list[dict]

@app.post('/api/telegram/verify')
def telegram_verify(body:TgVerify):
    bot=_tg_call(body.token.strip(),'getMe')
    return {'ok':True,'bot':bot}

@app.post('/api/telegram/poll')
def telegram_poll(body:TgPoll):
    token=body.token.strip()
    updates=_tg_call(token,'getUpdates',{'offset':body.offset,'timeout':1,'allowed_updates':['message']})
    processed=[]; next_offset=body.offset
    for u in updates or []:
        uid=u.get('update_id',0)
        if uid>=next_offset: next_offset=uid+1
        msg=u.get('message') or {}
        text=str(msg.get('text') or '').strip()
        chat_id=(msg.get('chat') or {}).get('id')
        if not text or chat_id is None: continue
        from_user=(msg.get('from') or {}).get('username') or (msg.get('from') or {}).get('first_name') or 'Usuario'
        rid=f'tg-{uid}'
        res=run(Run(nodes=body.nodes,edges=body.edges,message=text,run_id=rid,confirm=False,history=[]))
        if res.get('status')=='awaiting_confirmation' and body.auto_confirm:
            res=run(Run(nodes=body.nodes,edges=body.edges,message=text,run_id=rid,confirm=True,history=[]))
        reply_text=res.get('reply') or res.get('error') or ('Registro pendiente de confirmación.' if res.get('status')=='awaiting_confirmation' else 'Flujo ejecutado.')
        _tg_call(token,'sendMessage',{'chat_id':chat_id,'text':reply_text})
        processed.append({'update_id':uid,'chat_id':chat_id,'from_user':from_user,'text':text,'reply':reply_text,'run':res})
    return {'processed':processed,'next_offset':next_offset}

@app.post('/api/telegram/webhook')
def telegram_webhook(body:TgWebhook):
    token=body.token.strip()
    bot=_tg_call(token,'getMe')
    target=body.webhook_url.rstrip('/')+f'/api/telegram/incoming/{body.workflow_id}'
    _tg_call(token,'setWebhook',{'url':target})
    with db() as c:
        c.execute('INSERT OR REPLACE INTO workflows VALUES(?,?,?,?)',(body.workflow_id,f'Telegram Bot ({bot.get("username","bot")})',json.dumps(body.nodes),json.dumps(body.edges)))
        c.execute('INSERT OR REPLACE INTO telegram_bots VALUES(?,?,?,?)',(body.workflow_id,token,bot.get('username',''),date.today().isoformat()))
    return {'ok':True,'webhook_url':target,'bot':bot}

@app.post('/api/telegram/incoming/{workflow_id}')
async def telegram_incoming(workflow_id:str,request:FastAPIRequest):
    payload=await request.json()
    msg=payload.get('message') or {}
    text=str(msg.get('text') or '').strip()
    chat_id=(msg.get('chat') or {}).get('id')
    if not text or chat_id is None: return {'ok':True,'ignored':True}
    with db() as c:
        wf=c.execute('SELECT * FROM workflows WHERE id=?',(workflow_id,)).fetchone()
        bot=c.execute('SELECT * FROM telegram_bots WHERE workflow_id=?',(workflow_id,)).fetchone()
    if not wf or not bot: raise HTTPException(404,'Flujo o bot de Telegram no encontrado')
    rid=f'tg-wh-{payload.get("update_id",uuid.uuid4())}'
    nodes=json.loads(wf['nodes']); edges=json.loads(wf['edges'])
    res=run(Run(nodes=nodes,edges=edges,message=text,run_id=rid,confirm=False,history=[]))
    if res.get('status')=='awaiting_confirmation':
        res=run(Run(nodes=nodes,edges=edges,message=text,run_id=rid,confirm=True,history=[]))
    reply_text=res.get('reply') or res.get('error') or 'Flujo ejecutado.'
    _tg_call(bot['token'],'sendMessage',{'chat_id':chat_id,'text':reply_text})
    return {'ok':True,'reply':reply_text}

