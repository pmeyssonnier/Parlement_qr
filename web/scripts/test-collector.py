import importlib.util
import json
import re
import unittest
from unittest.mock import patch
import tempfile
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('collector',HERE/'refresh-corpus.py')
collector=importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def fake_row(code, received):
    row=['']*16
    row[0]='PRB'; row[15]='1'
    row[2]='<a href="/weblex-quest-det/?moncode=%s&base=1">fiche</a>' % code
    row[5]=received
    row[8]='Question écrite concernant le sujet %s' % code; row[9]='Onderwerp %s' % code
    row[10]='Auteur %s' % code; row[11]='Ministre'
    return row

def fake_page(question='Texte de la question.', answer='Texte de la réponse.'):
    cells='<tr><td><b>Question</b></td><td>%s</td></tr>' % question
    if answer:
        cells+='<tr><td><b>Réponse</b></td><td>%s</td></tr>' % answer
    return '<section id="weblex-quest-det-fr"><table>%s</table></section>' % cells

def current_question(code, received, answer=None, answered=None):
    return dict(id='PRB-1-'+code, moncode=code, date_reception=received, reponse=answer, date_reponse=answered)

class CollectorTests(unittest.TestCase):
    def test_collection_cap_prevents_page_downloads(self):
        root=HERE.parent.parent
        source=json.loads((root/'echantillon_questions_reponses.json').read_text(encoding='utf-8'))
        index=(root/'index_officiel_24-29.json').read_text(encoding='utf-8')
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'input.json'
            path.write_text(json.dumps(source),encoding='utf-8')
            with patch('sys.argv',['refresh','--file',str(path),'--max-records','1']), patch.object(collector,'download',return_value=index) as download:
                with self.assertRaisesRegex(ValueError,'Plafond de collecte'):
                    collector.main()
                self.assertEqual(download.call_count,1)  # index only, no document pages
    def test_original_ten_sources(self):
        root=HERE.parent.parent
        index=json.loads((root/'index_officiel_24-29.json').read_text(encoding='utf-8'))['data']
        corpus=json.loads((root/'echantillon_questions_reponses.json').read_text(encoding='utf-8'))
        for original in corpus['questions']:
            row=next(r for r in index if re.search(r'moncode=(\d+)',r[2])[1]==original['moncode'] and r[0]=='PRB')
            parsed=collector.parse_record(row,(root/original['source_locale']).read_text(encoding='utf-8'))
            for field in ['question','reponse','auteur','date_reception','date_reponse','numero']:
                self.assertEqual(parsed[field],original[field],(original['id'],field))
    def test_bad_markup_fails_closed(self):
        row=['']*16
        row[2]='<a href="/?moncode=123">fiche</a>'
        with self.assertRaises(ValueError):
            collector.parse_record(row,'<html>unexpected</html>')

    def test_empty_official_question_cell(self):
        row=['']*16
        row[2]='<a href="/?moncode=170644">fiche</a>'
        raw='<section id="weblex-quest-det-fr"><table><tr><td><b>Question &nbsp;&nbsp;</b><td valign="top"></td></tr></table></section>'
        with self.assertRaises(collector.MissingQuestionText):
            collector.parse_record(row,raw)

    def test_missing_cell_is_not_treated_as_empty(self):
        row=['']*16
        row[2]='<a href="/?moncode=123">fiche</a>'
        with self.assertRaises(ValueError) as error:
            collector.parse_record(row,'<section id="weblex-quest-det-fr">Structure modifiée</section>')
        self.assertNotIsInstance(error.exception,collector.MissingQuestionText)

    def test_plan_rechecks_only_questions_that_may_still_change(self):
        today=collector.dt.date(2026,9,24)
        old=next(c for c in ('2','3','4','5','6','7','8','9') if not collector.in_rotation(c,today))
        rows=[fake_row(c,d) for c,d in [('16','20/09/2026'),('15','01/07/2026'),('14','01/06/2026'),('13','01/01/2025'),(old,'01/12/2024'),('11','01/10/2024')]]
        current=[current_question('15','2026-07-01'),                         # unanswered, recent: recheck
                 current_question('14','2026-06-01','Réponse','2026-09-20'),  # answered 4 days ago: recheck
                 current_question('13','2025-01-01','Réponse','2025-03-01'),  # answered long ago: kept
                 current_question(old,'2024-12-01')]                          # unanswered for 21 months, not this week: kept
        recheck,kept,candidates=collector.plan(rows,current,today)
        self.assertEqual([collector.code_of(r) for r in recheck],['15','14'])
        self.assertEqual([q['moncode'] for q in kept],['13',old])
        self.assertEqual([collector.code_of(r) for r in candidates],['16','11'])  # absent ones, most recent first
        recheck,kept,_=collector.plan(rows,current,today,full=True)
        self.assertEqual((len(recheck),kept),(4,[]))

    def test_old_unanswered_questions_are_rechecked_in_rotation(self):
        start=collector.dt.date(2026,9,21)
        weeks=[start+collector.dt.timedelta(weeks=w) for w in range(8)]
        old=[current_question(str(code),'2024-12-01') for code in range(170000,170040)]
        for question in old:
            # Every old unanswered question is rechecked exactly once every 4 weeks...
            checked=[w for w,day in enumerate(weeks) if collector.needs_recheck(question,day)]
            self.assertEqual(len(checked),2,question['moncode'])
            self.assertEqual(checked[1]-checked[0],4)
        # ...and the load is spread: a quarter of them each week.
        self.assertEqual({sum(collector.needs_recheck(q,day) for q in old) for day in weeks},{10})
        answered=current_question('170000','2024-12-01','Réponse','2025-01-15')
        self.assertFalse(any(collector.needs_recheck(answered,day) for day in weeks))

    def test_questions_missing_from_index_keep_their_previous_version(self):
        today=collector.dt.date.today()
        recent=(today-collector.dt.timedelta(days=10)).strftime('%d/%m/%Y')
        rows=[fake_row(c,recent) for c in ('9','7','5')]
        incomplete=fake_row('8',''); incomplete[5]=''  # listed, but without a reception date
        current=[current_question(c,(today-collector.dt.timedelta(days=d)).isoformat()) for c,d in (('9',10),('8',12),('6',20))]
        index=json.dumps(dict(data=rows+[incomplete]))
        self.assertEqual(collector.missing_from_index(index,collector.index_rows(index),current),
                         [dict(moncode='8',reason='incomplete_row'),dict(moncode='6',reason='not_listed')])
        pages={'9':fake_page(),'7':fake_page(),'5':fake_page()}
        result,downloaded=self.run_collector(current,rows+[incomplete],pages,'--expand','2')
        # 8 and 6 are kept without download, in date order (most recent first).
        self.assertEqual([q['moncode'] for q in result['questions']],['9','7','5','8','6'])
        self.assertEqual(sorted(re.search(r'moncode=(\d+)',u)[1] for u in downloaded),['5','7','9'])
        with self.assertRaisesRegex(ValueError,'2 fiches du corpus absentes'):
            self.run_collector(current,rows+[incomplete],pages,'--max-missing-from-index','1')

    def run_collector(self,current,rows,pages,*args):
        index=json.dumps(dict(data=rows))
        def download(url,**_):
            if url==collector.INDEX:
                return index
            page=pages[re.search(r'moncode=(\d+)',url)[1]]
            if isinstance(page,Exception):
                raise page
            return page
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'active.json'
            output=Path(directory)/'refreshed.json'
            source.write_text(json.dumps(dict(methode_echantillonnage='m',questions=current)),encoding='utf-8')
            with patch('sys.argv',['refresh','--file',str(source),'--output',str(output),*args]), \
                 patch.object(collector,'download',side_effect=download) as mock:
                collector.main()
            result=json.loads(output.read_text(encoding='utf-8'))
            return result,[c.args[0] for c in mock.call_args_list[1:]]

    def test_expand_adds_absent_questions_newest_first_and_skips_empty_text(self):
        rows=[fake_row(c,d) for c,d in [('9','20/09/2026'),('8','10/09/2026'),('7','01/09/2026'),('6','01/08/2026'),('3','01/01/2025')]]
        pages={'9':fake_page(question=''),'8':fake_page(),'7':fake_page(answer=None),'6':fake_page()}
        kept=current_question('3','2025-01-01','Réponse','2025-03-01')
        result,downloaded=self.run_collector([kept],rows,pages,'--expand','2')
        self.assertEqual([q['moncode'] for q in result['questions']],['8','7','3'])  # index order
        self.assertEqual([f['moncode'] for f in result['fiches_ecartees']],['9'])
        self.assertEqual([re.search(r'moncode=(\d+)',u)[1] for u in downloaded],['9','8','7'])  # 3 is not downloaded again
        self.assertIn('3 fiches sur 5',result['methode_echantillonnage'])

    def test_download_cap_and_record_cap_bound_a_run(self):
        rows=[fake_row(str(c),'0%d/09/2026' % c) for c in range(9,0,-1)]
        pages={str(c):fake_page() for c in range(1,10)}
        result,downloaded=self.run_collector([],rows,pages,'--expand','8','--max-downloads','3')
        self.assertEqual((len(result['questions']),len(downloaded)),(3,3))
        result,downloaded=self.run_collector([],rows,pages,'--expand','8','--max-records','2')
        self.assertEqual((len(result['questions']),len(downloaded)),(2,2))

    def test_unreachable_pages_are_postponed_not_fatal(self):
        today=collector.dt.date.today()
        recent=(today-collector.dt.timedelta(days=10)).strftime('%d/%m/%Y')
        rows=[fake_row(c,recent) for c in ('9','8','7','6','5')]
        timeout=collector.urllib.error.URLError(TimeoutError('timed out'))
        pages={'9':fake_page(),'8':timeout,'7':fake_page(),'6':TimeoutError('read'),'5':fake_page()}
        previous=current_question('9',today.isoformat())  # unanswered and recent: rechecked
        previous['reponse']=None
        pages['9']=collector.http.client.RemoteDisconnected('closed')
        result,downloaded=self.run_collector([previous],rows,pages,'--expand','3')
        # 9 keeps its previous version; 8 and 6 are postponed; 7 and 5 are added.
        self.assertEqual([q['moncode'] for q in result['questions']],['9','7','5'])
        self.assertIs(result['questions'][0]['reponse'],None)
        self.assertEqual(result['fiches_ecartees'],[])
        self.assertEqual(len(downloaded),5)

    def test_existing_question_emptied_on_the_site_keeps_its_previous_version(self):
        today=collector.dt.date.today()
        recent=(today-collector.dt.timedelta(days=10)).strftime('%d/%m/%Y')
        rows=[fake_row(c,recent) for c in ('9','8','7')]
        current=[current_question(c,today.isoformat()) for c in ('9','8')]  # recent, unanswered: rechecked
        for question in current:
            question['question']='Texte connu %s.' % question['moncode']
        pages={'9':fake_page(question=''),'8':fake_page(),'7':fake_page()}
        result,downloaded=self.run_collector(current,rows,pages,'--expand','1')
        self.assertEqual([q['moncode'] for q in result['questions']],['9','8','7'])
        self.assertEqual(result['questions'][0]['question'],'Texte connu 9.')  # previous version
        self.assertEqual(result['questions'][1]['question'],'Texte de la question.')
        self.assertEqual(result['fiches_ecartees'],[])
        self.assertEqual(len(downloaded),3)
        # Too many emptied at once: the page layout probably changed.
        with self.assertRaisesRegex(ValueError,'2 fiches existantes'):
            self.run_collector(current,rows,{c:fake_page(question='') for c in pages},'--max-empty-texts','1')

    def test_run_stops_when_the_site_is_down(self):
        rows=[fake_row(str(c),'0%d/09/2026' % c) for c in range(9,0,-1)]
        down=TimeoutError('timed out')
        pages={str(c):down for c in range(1,10)}
        with self.assertRaisesRegex(ValueError,'3 de suite'):
            self.run_collector([],rows,pages,'--expand','8')
        # Scattered failures: stop once more than --max-network-failures pages failed.
        pages={str(c):(down if c%2 else fake_page()) for c in range(1,10)}
        with self.assertRaisesRegex(ValueError,'3 fiche'):
            self.run_collector([],rows,pages,'--expand','8','--max-network-failures','2')
        result,_=self.run_collector([],rows,pages,'--expand','8','--max-network-failures','5')
        self.assertEqual([q['moncode'] for q in result['questions']],['8','6','4','2'])

    def test_download_retries_with_growing_waits(self):
        error=collector.urllib.error.URLError(TimeoutError('timed out'))
        with patch.object(collector.urllib.request,'urlopen',side_effect=error) as urlopen, \
             patch.object(collector.time,'sleep') as sleep:
            with self.assertRaises(collector.urllib.error.URLError):
                collector.download(collector.INDEX,attempts=5,first_wait=5)
            self.assertEqual(urlopen.call_count,5)
            self.assertEqual([c.args[0] for c in sleep.call_args_list],[5,10,20,40])
            sleep.reset_mock(); urlopen.reset_mock()
            urlopen.side_effect=[TimeoutError('read'),error,self.response('ok')]
            self.assertEqual(collector.download('https://example.test/page'),'ok')
            self.assertEqual([c.args[0] for c in sleep.call_args_list],[2,4,0.6])

    @staticmethod
    def response(text):
        class Response:
            def __enter__(self): return self
            def __exit__(self,*_): return False
            def read(self): return text.encode()
        return Response()

if __name__=='__main__':
    unittest.main()
