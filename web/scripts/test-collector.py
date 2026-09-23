import importlib.util
import json
import re
import unittest
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('collector',HERE/'refresh-corpus.py')
collector=importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

class CollectorTests(unittest.TestCase):
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

if __name__=='__main__':
    unittest.main()
