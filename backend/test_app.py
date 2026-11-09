import os, tempfile, unittest
from datetime import date
from unittest.mock import patch
from decimal import Decimal
from fastapi.testclient import TestClient
os.environ['NODALY_DB'] = os.path.join(tempfile.mkdtemp(prefix='nodaly-test-'), 'test.sqlite')
import app as application
from app import app

class API(unittest.TestCase):
    def setUp(self):
        environment=patch.dict(os.environ, {'NODALY_AI_URL':'','NODALY_AI_KEY':'','NODALY_AI_MODEL':''}); environment.start(); self.addCleanup(environment.stop)
        application.DB = os.path.join(tempfile.mkdtemp(prefix='nodaly-test-'), 'test.sqlite'); print('SCRATCH:',os.path.dirname(application.DB))
        self.c = TestClient(app)
    def test_spanish_public_templates_and_answers(self):
        templates=self.c.get('/api/templates').json()
        self.assertEqual(templates[0]['name'], 'Asistente de documentos')
        result=self.c.post('/api/run',json={**templates[0],'run_id':'es-answer'}).json()
        self.assertEqual(result['reply'], 'Nodaly es una herramienta visual de flujos de trabajo para demostraciones en clase.')
        self.assertEqual(result['sources'][0]['name'], 'Texto pegado')
        missing=self.c.post('/api/run',json={**templates[0],'message':'¿Cuál es el secreto de las cebras?','run_id':'es-missing'}).json()
        self.assertIn('No encontré', missing['reply'])
        report=self.c.post('/api/run',json={**templates[2],'message':'Muestra los gastos de alimentación de hoy','run_id':'es-report'}).json()
        self.assertEqual(report['report']['total'], '12.50')
        self.assertEqual(report['report']['count'], 1)
        self.assertIn('12.50', report['reply'])
        self.assertNotIn('"total"', report['reply'])
        capture={**templates[1],'run_id':'es-capture'}
        self.assertEqual(self.c.post('/api/run',json=capture).json()['status'],'awaiting_confirmation')
        capture['confirm']=True
        self.assertIn('Gasto', self.c.post('/api/run',json=capture).json()['reply'])

    def test_spanish_natural_questions_remain_grounded(self):
        t=self.c.get('/api/templates').json()[0]
        cfg=next(n for n in t['nodes'] if n['type']=='knowledge')['data']['config']
        cfg['text']='El horario de apertura es de lunes a viernes de 6:00 a 22:00. La membresía mensual cuesta 450 MXN.'
        for question, found in [('¿Cuál es el horario de apertura?',True),('¿Cuánto cuesta la membresía mensual?',True),('¿De qué color son los casilleros?',False)]:
            result=self.c.post('/api/run',json={**t,'message':question,'run_id':'es-natural'}).json()
            self.assertEqual(bool(result['sources']),found)

    def test_templates_and_graph_validation(self):
        templates = self.c.get('/api/templates').json(); self.assertEqual(len(templates),3)
        a=templates[0]; self.assertEqual(self.c.post('/api/run',json={**a,'run_id':'x','confirm':False}).status_code,200)
        self.assertEqual(self.c.post('/api/run',json={'nodes':a['nodes'],'edges':[], 'message':'x','run_id':'bad','confirm':False}).status_code,422)
    def test_upload_and_persistence(self):
        self.assertEqual(self.c.post('/api/documents',files={'file':('bad.exe',b'x')}).status_code,422)
        d=self.c.post('/api/documents',files={'file':('test.txt',b'The moon is blue.')}).json(); self.assertIn(d,self.c.get('/api/documents').json())
        t=self.c.get('/api/templates').json()[0]; self.c.put('/api/workflows/test',json={'name':'Test','nodes':t['nodes'],'edges':t['edges']}); self.assertEqual(self.c.get('/api/workflows').json()[0]['name'],'Test')
    def test_confirm_once(self):
        t=self.c.get('/api/templates').json()[1]; data={**t,'message':'2026-11-01 lunch food 12.50','run_id':'capture-test','confirm':False}
        before=len(self.c.get('/api/records').json()); self.assertEqual(self.c.post('/api/run',json=data).json()['status'],'awaiting_confirmation')
        data['confirm']=True; self.assertEqual(self.c.post('/api/run',json=data).json()['status'],'completed'); self.c.post('/api/run',json=data); self.assertEqual(len(self.c.get('/api/records').json()),before+1)
    def test_confirmation_rejects_tampering_and_unpreviewed(self):
        t=self.c.get('/api/templates').json()[1]; data={**t,'message':'Hoy gasté 350 pesos en productos de limpieza','run_id':'spanish','confirm':False}
        r=self.c.post('/api/run',json=data).json(); self.assertEqual(r['preview']['amount'],'350.00'); self.assertEqual(r['preview']['category'],'supplies')
        before=len(self.c.get('/api/records').json()); data['confirm']=True; data['message']='Today I spent 15 on lunch'; self.assertEqual(self.c.post('/api/run',json=data).json()['status'],'error'); self.assertEqual(len(self.c.get('/api/records').json()),before)
        data['run_id']='unpreviewed'; self.assertEqual(self.c.post('/api/run',json=data).json()['status'],'error')
    def test_context_and_invalid_graphs(self):
        t=self.c.get('/api/templates').json()[0]; data={**t,'run_id':'badctx','confirm':False}
        next(n for n in data['nodes'] if n['type']=='knowledge')['data']['config']['text']='x'*24001
        self.assertEqual(self.c.post('/api/run',json=data).status_code,422)
        t=self.c.get('/api/templates').json()[1]; t['edges'].append({'id':'cycle','source':'register','target':'agent'})
        self.assertEqual(self.c.post('/api/run',json={**t,'run_id':'cycle','confirm':False}).status_code,422)
        self.assertEqual(self.c.post('/api/documents',files={'file':('bad.pdf',b'not pdf')}).status_code,422)
        self.assertEqual(self.c.post('/api/documents',files={'file':('large.txt',b'a'*(5*1024*1024+1))}).status_code,422)
    def test_grounded_answer_and_filtered_exact_total(self):
        t=self.c.get('/api/templates').json()[0]; t['nodes'][1]['data']['config']['text']='Jupiter has many moons.'
        r=self.c.post('/api/run',json={**t,'message':'What has many moons?','run_id':'ground','confirm':False}).json(); self.assertEqual(r['reply'],'Jupiter has many moons.'); self.assertEqual(r['sources'][0]['name'],'Texto pegado')
        t=self.c.get('/api/templates').json()[2]; cfg=next(n for n in t['nodes'] if n['type']=='query')['data']['config']; cfg['period']='today'; cfg['category']='food'
        r=self.c.post('/api/run',json={**t,'run_id':'filtered','confirm':False}).json(); self.assertEqual(r['report']['total'],'12.50'); self.assertEqual(r['report']['count'],1)
    def test_date_category_money_and_no_invalid_write(self):
        class FixedDate(date):
            @classmethod
            def today(cls): return cls(2026, 11, 18)
        with patch.object(application,'date',FixedDate):
            with application.db() as c:
                c.execute('DELETE FROM records')
                c.executemany('INSERT INTO records VALUES(?,?,?,?,?)', [('1','2026-11-18','Lunch','food','0.10'),('2','2026-11-16','Dinner','food','0.20'),('3','2026-11-02','Old lunch','food','5.00'),('4','2026-11-18','Taxi','transport','8.00')])
            t=self.c.get('/api/templates').json()[2]; cfg=next(n for n in t['nodes'] if n['type']=='query')['data']['config']; cfg.update(period='week',category='food')
            r=self.c.post('/api/run',json={**t,'run_id':'week','confirm':False}).json(); self.assertEqual(r['report']['total'],'0.30'); self.assertEqual(r['report']['count'],2)
            cfg['period']='month'; r=self.c.post('/api/run',json={**t,'run_id':'month','confirm':False}).json(); self.assertEqual(r['report']['total'],'5.30'); self.assertEqual(r['report']['count'],3)
            capture=self.c.get('/api/templates').json()[1]; before=len(self.c.get('/api/records').json())
            for message in ['Today I spent -5 on lunch', 'Today I spent 0 on lunch', 'Today I spent 12 dollars']:
                self.assertEqual(self.c.post('/api/run',json={**capture,'message':message,'run_id':message,'confirm':False}).json()['status'],'error')
            capture['edges']=[]; self.assertEqual(self.c.post('/api/run',json={**capture,'run_id':'invalid','confirm':True}).status_code,422); self.assertEqual(len(self.c.get('/api/records').json()),before)
    def test_document_count_and_fake_live_provider(self):
        t=self.c.get('/api/templates').json()[0]; cfg=next(n for n in t['nodes'] if n['type']=='knowledge')['data']['config']; cfg['document_ids']=['a','b','c','d']
        self.assertEqual(self.c.post('/api/run',json={**t,'run_id':'docs','confirm':False}).status_code,422)
        cfg['document_ids']=[]
        class Response:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def read(self): return b'{"choices":[{"message":{"content":"Grounded fake response"}}]}'
        with patch.dict(os.environ,{'NODALY_AI_URL':'https://example.invalid/chat','NODALY_AI_KEY':'fake','NODALY_AI_MODEL':'fake'}), patch.object(application,'urlopen',return_value=Response()) as call:
            result=self.c.post('/api/run',json={**t,'run_id':'live','confirm':False}).json(); self.assertEqual(result['reply'],'Grounded fake response'); self.assertEqual(result['mode'],'live'); call.assert_called_once()
    def test_downstream_failure_does_not_save_confirmed_expense(self):
        t=self.c.get('/api/templates').json()[1]
        t['nodes'].insert(-1,{'id':'query','type':'query','position':{'x':0,'y':0},'data':{'config':{'collection':'expenses','period':'all','category':''}}})
        t['edges']=[{'id':'a','source':'message','target':'agent'},{'id':'b','source':'agent','target':'register'},{'id':'c','source':'register','target':'query'},{'id':'d','source':'query','target':'reply'}]
        data={**t,'run_id':'failure','confirm':False}; self.assertEqual(self.c.post('/api/run',json=data).json()['status'],'awaiting_confirmation'); before=len(self.c.get('/api/records').json()); data['confirm']=True
        with patch.object(application,'query_records',side_effect=ValueError('Query failed')):
            self.assertEqual(self.c.post('/api/run',json=data).json()['status'],'error')
        self.assertEqual(len(self.c.get('/api/records').json()),before)
        self.assertEqual(self.c.post('/api/run',json=data).json()['status'],'completed'); self.c.post('/api/run',json=data); self.assertEqual(len(self.c.get('/api/records').json()),before+1)
    def test_invalid_downstream_configuration_is_rejected_before_preview(self):
        t=self.c.get('/api/templates').json()[1]; next(n for n in t['nodes'] if n['type']=='reply')['data']['config']['template']='x'*4001
        before=len(self.c.get('/api/records').json()); data={**t,'run_id':'badreply','confirm':False}; self.assertEqual(self.c.post('/api/run',json=data).status_code,422); data['confirm']=True; self.assertEqual(self.c.post('/api/run',json=data).status_code,422); self.assertEqual(len(self.c.get('/api/records').json()),before)
    def test_spanish_validation_preserves_error_fields(self):
        response=self.c.post('/api/run',json={'nodes':[],'edges':[],'message':{},'run_id':'invalid'})
        self.assertEqual(response.status_code,422)
        error=response.json()['detail'][0]
        self.assertEqual(error['msg'],'Valor no válido')
        self.assertIn('input',error); self.assertIn('loc',error); self.assertIn('type',error)

    def test_valid_pdf_upload_and_sourced_answer(self):
        import io
        from pypdf import PdfWriter
        from pypdf.generic import NameObject, DictionaryObject, DecodedStreamObject
        writer=PdfWriter(); page=writer.add_blank_page(width=300,height=300)
        font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
        page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font})})
        stream=DecodedStreamObject(); stream.set_data(b'BT /F1 12 Tf 20 250 Td (Membership costs 450 MXN.) Tj ET')
        page[NameObject('/Contents')]=stream
        data=io.BytesIO(); writer.write(data)
        upload=self.c.post('/api/documents',files={'file':('policy.pdf',data.getvalue(),'application/pdf')})
        self.assertEqual(upload.status_code,200)
        t=self.c.get('/api/templates').json()[0]
        next(n for n in t['nodes'] if n['type']=='knowledge')['data']['config'].update(text='',document_ids=[upload.json()['id']])
        result=self.c.post('/api/run',json={**t,'message':'What does membership cost?','run_id':'pdf','confirm':False}).json()
        self.assertIn('450',result['reply']); self.assertEqual(result['sources'],[{'name':'policy.pdf','page':1}])

    def test_document_demo_natural_questions(self):
        t=self.c.get('/api/templates').json()[0]
        content='Opening hours: Monday to Friday from 6:00 AM to 10:00 PM. Monthly membership costs 450 MXN.'
        doc=self.c.post('/api/documents',files={'file':('gym.txt',content.encode())}).json()
        cfg=next(n for n in t['nodes'] if n['type']=='knowledge')['data']['config']
        cfg.update(text='',document_ids=[doc['id']])
        for question in ('What are your opening hours?', 'How much does monthly membership cost?'):
            response=self.c.post('/api/run',json={**t,'message':question,'run_id':'natural','confirm':False}).json()
            self.assertEqual(response['sources'][0]['name'],'gym.txt')

    def test_conservative_answer_matching(self):
        t=self.c.get('/api/templates').json()[0]; data={**t,'run_id':'answer','confirm':False}
        for question,found in [('What is Nodaly?',True),('What color is Nodaly?',False),('What is the zebra habitat?',False)]:
            data['message']=question; result=self.c.post('/api/run',json=data).json(); self.assertEqual(bool(result['sources']),found)
        next(n for n in t['nodes'] if n['type']=='knowledge')['data']['config']['text']='The office opens at 9 AM.'; data['message']='What time does the office open?'; self.assertTrue(self.c.post('/api/run',json=data).json()['sources'])
    def test_invalid_config_is_rejected(self):
        for typ,key,value in [('agent','instructions',[]),('reply','template',[]),('register','field_map',{'amount':'other'}),('report','title',[])]:
            t=self.c.get('/api/templates').json()[2 if typ=='report' else 1]; next(n for n in t['nodes'] if n['type']==typ)['data']['config'][key]=value
            self.assertEqual(self.c.post('/api/run',json={**t,'run_id':'badcfg','confirm':False}).status_code,422)
    def test_amount_ambiguity_and_precision(self):
        t=self.c.get('/api/templates').json()[1]
        for message in ['Bought 2 notebooks for 350','Spent 1.234 on lunch']:
            self.assertEqual(self.c.post('/api/run',json={**t,'message':message,'run_id':message,'confirm':False}).json()['status'],'error')
        result=self.c.post('/api/run',json={**t,'message':'Bought 2 notebooks for 350 pesos','run_id':'currency','confirm':False}).json()
        self.assertEqual(result['preview']['amount'],'350.00')
    def test_report_and_missing_info(self):
        t=self.c.get('/api/templates').json()[2]; r=self.c.post('/api/run',json={**t,'run_id':'report-test','confirm':False}).json(); self.assertEqual(r['status'],'completed'); self.assertIn('total',r['report'])
        t=self.c.get('/api/templates').json()[0]; r=self.c.post('/api/run',json={**t,'message':'What is the secret of zebras?','run_id':'missing','confirm':False}).json(); self.assertIn('información',r['reply'].lower())

if __name__ == '__main__': unittest.main()
