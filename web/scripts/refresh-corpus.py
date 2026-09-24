"""Refresh current corpus; optionally add recent PRB written questions. Standard library."""
import argparse
import datetime as dt
import hashlib
import html
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = 'https://www.parlement.brussels'
INDEX = BASE + '/prb_includes/weblex/data/dos_qu_legis_24-29.json'

class MissingQuestionText(ValueError):
    """The official question cell exists but contains no published text."""

def clean(value):
    value = re.sub(r'<!--.*?-->|<script\b.*?</script>|<style\b.*?</style>', '', value, flags=re.S)
    value = re.sub(r'<(?:br\b[^>]*|/p|/li|/tr|/div)>', '\n', value, flags=re.I)
    return '\n'.join(' '.join(line.split()) for line in html.unescape(re.sub('<[^>]+>', '', value)).splitlines() if line.strip())

def iso(value):
    try:
        return dt.datetime.strptime(value.strip(), '%d/%m/%Y').date().isoformat()
    except (ValueError, AttributeError):
        return None

def download(url):
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'ParlementCitoyen/0.1 (documentary research)'})
            with urllib.request.urlopen(request, timeout=40) as response:
                data = response.read().decode('utf-8-sig')
            time.sleep(0.6)
            return data
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)

def parse_record(row, raw):
    code = re.search(r'moncode=(\d+)', row[2])[1]
    match = re.search(r'<section id="weblex-quest-det-fr".*?</section>', raw, re.S)
    if not match:
        raise ValueError('Structure de fiche inconnue : ' + code)
    section = re.sub(r'<!--.*?-->', '', match[0], flags=re.S)
    blocks = {html.unescape(label): clean(body) for label, body in re.findall(r'<td[^>]*>\s*<b>(Question|R(?:é|&eacute;)ponse)\s*(?:&nbsp;|\s)*</b>\s*(?:</td>)?\s*<td[^>]*>(.*?)</td>', section, re.S)}
    if 'Question' not in blocks:
        raise ValueError('Question manquante : ' + code)
    if not blocks['Question']:
        raise MissingQuestionText('Texte de question vide : ' + code)
    def field(label):
        found = re.search(re.escape(label) + r':</b>\s*([^<]+)', html.unescape(section))
        return found[1].strip() if found else None
    number = re.search(r'question n°\s*(\d+)', clean(section))
    return dict(id='PRB-1-'+code, moncode=code, base=1, assemblee='PRB', legislature='2024-2029', session=field('Session'),
                type='question_ecrite', numero=int(number[1]) if number else None, langue='fr', titre=html.unescape(row[8]),
                titre_nl=html.unescape(row[9]), auteur=html.unescape(row[10]), destinataire=html.unescape(row[11]),
                date_reception=iso(row[5]), date_publication=iso(field('Date de publication')), date_reponse=iso(field('Date de réponse')),
                question=blocks['Question'], reponse=blocks.get('Réponse') or None,
                url_source=BASE+'/weblex-quest-det/?moncode='+code+'&base=1',
                empreinte_contenu=hashlib.sha256(raw.encode()).hexdigest())

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', default='data/corpus.json')
    parser.add_argument('--output', default='data/corpus-refreshed.json')
    parser.add_argument('--expand', type=int, default=0, help='Add this many most recent questions, maximum 500 per run')
    args = parser.parse_args()
    if not 0 <= args.expand <= 500:
        parser.error('--expand must be between 0 and 500')
    current = json.loads(Path(args.file).read_text(encoding='utf-8'))
    index_text = download(INDEX)
    rows = [r for r in json.loads(index_text)['data'] if r[0] == 'PRB' and r[15] == '1' and iso(r[5])]
    ids = {q['moncode'] for q in current['questions']}
    previous_ids = ids.copy()
    rows.sort(key=lambda r: (iso(r[5]), int(re.search(r'moncode=(\d+)', r[2])[1])), reverse=True)
    ids.update(re.search(r'moncode=(\d+)', r[2])[1] for r in rows[:args.expand])
    selected = [r for r in rows if re.search(r'moncode=(\d+)', r[2])[1] in ids]
    if len(selected) != len(ids):
        raise ValueError('Certaines fiches précédemment collectées sont absentes de l’index : vérification manuelle requise.')
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    snapshot = output.parent / 'source-snapshots' / dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    snapshot.mkdir(parents=True)
    (snapshot / 'index.json').write_text(index_text, encoding='utf-8')
    questions = []
    skipped = []
    for row in selected:
        code = re.search(r'moncode=(\d+)', row[2])[1]
        raw = download(BASE+'/weblex-quest-det/?moncode='+code+'&base=1')
        (snapshot / (code+'.html')).write_text(raw, encoding='utf-8')
        try:
            questions.append(parse_record(row, raw))
        except MissingQuestionText:
            if code in previous_ids:
                raise ValueError('Texte vide pour une fiche existante : ' + code + '. Corpus non remplacé.')
            skipped.append(dict(moncode=code, reason='question_text_empty',
                                url_source=BASE+'/weblex-quest-det/?moncode='+code+'&base=1'))
            print('Écartée (texte de question vide sur le site) :', code)
            continue
        print('Collected', code)
    (snapshot / 'excluded.json').write_text(json.dumps(skipped, ensure_ascii=False, indent=2), encoding='utf-8')
    if not questions:
        raise ValueError('Aucune fiche exploitable : corpus non remplacé.')
    result = dict(schema_version='1.0', extrait_le=dt.datetime.now(dt.timezone.utc).isoformat(), source_index=INDEX,
                  nombre_elements=len(questions), questions=questions,
                  fiches_ecartees=skipped,
                  methode_echantillonnage=current['methode_echantillonnage'] if not args.expand else f"Corpus exploratoire : fiches précédentes et sélection parmi les {args.expand} questions écrites PRB les plus récentes de l’index ; {len(skipped)} fiches écartées car leur texte de question est vide. Sans garantie d’exhaustivité. Français uniquement.")
    temp = output.with_suffix('.tmp')
    temp.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(output)
    print(f'Validated collection: {len(questions)} records → {output}')
    print(f'{len(skipped)} fiches écartées ; rapport : {snapshot / "excluded.json"}')

if __name__ == '__main__':
    main()
