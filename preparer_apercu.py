import json
import html
from pathlib import Path
from extraire_echantillon import ROOT, clean

d = json.loads((ROOT / 'echantillon_questions_reponses.json').read_text(encoding='utf-8'))
parts = []
for q in d['questions']:
    assert q['question'] and q['reponse'] and q['date_reponse'] and q['numero']
    source = (ROOT / q['source_locale']).read_text(encoding='utf-8')
    normalized_source = ' '.join(clean(source).split())
    for field in ['question', 'reponse']:
        assert ' '.join(q[field].split()) in normalized_source, (q['id'], field)
    esc = html.escape
    title = q['titre'].removeprefix('Question écrite concernant ')
    parts.append(f'''<details>
<summary>{esc(title[0].upper() + title[1:])} <span class="text-small">— {esc(q['auteur'])}</span></summary>
<div class="contenu">
<div class="text-small">Question n° {q['numero']} · Réponse : {q['date_reponse']} · {esc(q['destinataire'])}</div>
<h4>Question</h4><div class="texte">{esc(q['question'])}</div>
<h4>Réponse</h4><div class="texte">{esc(q['reponse'])}</div>
<p><a href="{esc(q['url_source'], quote=True)}" target="_blank" rel="noopener noreferrer">Fiche officielle</a></p>
</div></details>''')
template = (ROOT / 'apercu-template.html').read_text(encoding='utf-8')
dest = Path('C:/Users/pmeys/.codex/visualizations/2026/09/23/01a0ce1d-4190-78b1-a84c-1dbab0363745/echantillon-parlement.html')
dest.write_text(template.replace('<!-- QUESTIONS -->', '\n'.join(parts)), encoding='utf-8')
assert len({q['id'] for q in d['questions']}) == 10
assert '\\"' not in dest.read_text(encoding='utf-8')
print('Vérifié : 10 identifiants uniques, 20 textes présents dans les sources, dates et numéros renseignés.')
print('JSON :', (ROOT / 'echantillon_questions_reponses.json').stat().st_size, 'octets')
print('Aperçu :', dest.stat().st_size, 'octets')
