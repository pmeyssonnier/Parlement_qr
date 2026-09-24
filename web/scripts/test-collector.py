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
        rows=[fake_row(c,d) for c,d in [('6','20/09/2026'),('5','01/07/2026'),('4','01/06/2026'),('3','01/01/2025'),('2','01/12/2024'),('1','01/10/2024')]]
        current=[current_question('5','2026-07-01'),                         # unanswered, recent: recheck
                 current_question('4','2026-06-01','Réponse','2026-09-20'),  # answered 4 days ago: recheck
                 current_question('3','2025-01-01','Réponse','2025-03-01'),  # answered long ago: kept
                 current_question('2','2024-12-01')]                         # unanswered for 21 months: kept
        recheck,kept,candidates=collector.plan(rows,current,today)
        self.assertEqual([collector.code_of(r) for r in recheck],['5','4'])
        self.assertEqual([q['moncode'] for q in kept],['3','2'])
        self.assertEqual([collector.code_of(r) for r in candidates],['6','1'])  # absent ones, most recent first
        recheck,kept,_=collector.plan(rows,current,today,full=True)
        self.assertEqual((len(recheck),kept),(4,[]))

    def test_plan_refuses_questions_missing_from_index(self):
        with self.assertRaisesRegex(ValueError,'absentes de l’index'):
            collector.plan([fake_row('1','01/01/2026')],[current_question('9','2026-01-01')],collector.dt.date(2026,9,24))

    def run_collector(self,current,rows,pages,*args):
        index=json.dumps(dict(data=rows))
        def download(url):
            if url==collector.INDEX:
                return index
            return pages[re.search(r'moncode=(\d+)',url)[1]]
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

if __name__=='__main__':
    unittest.main()
