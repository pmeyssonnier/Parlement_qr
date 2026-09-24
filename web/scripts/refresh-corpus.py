"""Refresh the corpus and add PRB written questions, most recent first. Standard library."""
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

# An answer usually arrives within a few months (197 days at most in the
# corpus): unanswered questions are rechecked for this long. An answered
# question is rechecked only shortly after its answer, for late corrections.
UNANSWERED_DAYS = 240
RECENT_ANSWER_DAYS = 14

def code_of(row):
    return re.search(r'moncode=(\d+)', row[2])[1]

def index_rows(index_text):
    """PRB written questions of the index, most recent first."""
    rows = [r for r in json.loads(index_text)['data'] if r[0] == 'PRB' and r[15] == '1' and iso(r[5])]
    rows.sort(key=lambda r: (iso(r[5]), int(code_of(r))), reverse=True)
    return rows

def needs_recheck(question, today, unanswered_days=UNANSWERED_DAYS, recent_answer_days=RECENT_ANSWER_DAYS):
    if not (question.get('reponse') or '').strip():
        return dt.date.fromisoformat(question['date_reception']) >= today - dt.timedelta(days=unanswered_days)
    answered = question.get('date_reponse')
    return answered is not None and dt.date.fromisoformat(answered) >= today - dt.timedelta(days=recent_answer_days)

def plan(rows, current_questions, today, full=False):
    """Split the work: current questions to download again, current questions
    kept as they are, and index rows absent from the corpus (candidates to add,
    most recent first)."""
    by_code = {code_of(r): r for r in rows}
    if any(q['moncode'] not in by_code for q in current_questions):
        raise ValueError('Certaines fiches précédemment collectées sont absentes de l’index : vérification manuelle requise.')
    recheck = {q['moncode'] for q in current_questions if full or needs_recheck(q, today)}
    kept = [q for q in current_questions if q['moncode'] not in recheck]
    present = {q['moncode'] for q in current_questions}
    return ([r for r in rows if code_of(r) in recheck], kept, [r for r in rows if code_of(r) not in present])

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', default='data/corpus.json')
    parser.add_argument('--output', default='data/corpus-refreshed.json')
    parser.add_argument('--expand', type=int, default=0,
                        help='Add up to this many questions absent from the corpus, most recent first (maximum 500 per run)')
    parser.add_argument('--full', action='store_true', help='Download every current question again')
    parser.add_argument('--max-records', type=int, default=6000, help='Maximum corpus size, checked before any page download')
    parser.add_argument('--max-downloads', type=int, default=900, help='Maximum question pages downloaded in this run')
    args = parser.parse_args()
    if not 0 <= args.expand <= 500:
        parser.error('--expand must be between 0 and 500')
    if args.max_records < 1 or args.max_downloads < 1:
        parser.error('--max-records and --max-downloads must be positive')
    current = json.loads(Path(args.file).read_text(encoding='utf-8'))
    index_text = download(INDEX)
    rows = index_rows(index_text)
    if len(current['questions']) > args.max_records:
        raise ValueError('Plafond de collecte dépassé ; aucune fiche téléchargée ou supprimée.')
    room = args.max_records - len(current['questions'])
    if args.expand > room:
        print(f'Plafond de {args.max_records} fiches : ajout limité à {room} fiche(s).')
    to_add = min(args.expand, room)
    recheck, kept, candidates = plan(rows, current['questions'], dt.date.today(), args.full)
    if len(recheck) > args.max_downloads:
        raise ValueError(f'{len(recheck)} fiches à revérifier pour un plafond de {args.max_downloads} téléchargements ; corpus non remplacé.')
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    snapshot = output.parent / 'source-snapshots' / dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    snapshot.mkdir(parents=True)
    (snapshot / 'index.json').write_text(index_text, encoding='utf-8')
    downloads = 0

    def fetch(row):
        nonlocal downloads
        code = code_of(row)
        raw = download(BASE+'/weblex-quest-det/?moncode='+code+'&base=1')
        downloads += 1
        (snapshot / (code+'.html')).write_text(raw, encoding='utf-8')
        return parse_record(row, raw)

    questions = list(kept)
    for row in recheck:
        try:
            questions.append(fetch(row))
        except MissingQuestionText:
            raise ValueError('Texte vide pour une fiche existante : ' + code_of(row) + '. Corpus non remplacé.')
        print('Revérifiée', code_of(row))
    added = 0
    skipped = []
    for row in candidates:
        if added >= to_add or downloads >= args.max_downloads:
            break
        try:
            questions.append(fetch(row))
        except MissingQuestionText:
            code = code_of(row)
            skipped.append(dict(moncode=code, reason='question_text_empty',
                                url_source=BASE+'/weblex-quest-det/?moncode='+code+'&base=1'))
            print('Écartée (texte de question vide sur le site) :', code)
            continue
        added += 1
        print('Ajoutée', code_of(row))
    (snapshot / 'excluded.json').write_text(json.dumps(skipped, ensure_ascii=False, indent=2), encoding='utf-8')
    if not questions:
        raise ValueError('Aucune fiche exploitable : corpus non remplacé.')
    order = {code_of(r): i for i, r in enumerate(rows)}
    questions.sort(key=lambda q: order[q['moncode']])
    result = dict(schema_version='1.0', extrait_le=dt.datetime.now(dt.timezone.utc).isoformat(), source_index=INDEX,
                  nombre_elements=len(questions), questions=questions, fiches_ecartees=skipped,
                  methode_echantillonnage=f"Questions écrites PRB de la législature 2024-2029 : {len(questions)} fiches sur "
                  f"{len(rows)} dans l’index officiel, collectées des plus récentes aux plus anciennes. Les fiches dont le "
                  "texte de question n’est pas encore publié sont écartées. Français uniquement ; sans garantie d’exhaustivité.")
    temp = output.with_suffix('.tmp')
    temp.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(output)
    missing = len(candidates) - added
    print(f'Validated collection: {len(questions)} records → {output}')
    print(f'Revérifiées : {len(recheck)} ; conservées sans téléchargement : {len(kept)} ; ajoutées : {added} ; '
          f'écartées : {len(skipped)} ; encore absentes du corpus : {missing} ; pages téléchargées : {downloads}')

if __name__ == '__main__':
    main()
