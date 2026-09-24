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

if __name__=='__main__':
    unittest.main()
