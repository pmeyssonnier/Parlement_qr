"""Refresh the corpus and add PRB written questions, most recent first. Standard library."""
import argparse
import datetime as dt
import hashlib
import html
import http.client
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = 'https://www.parlement.brussels'
CURRENT_LEGISLATURE = '24-29'

def index_url(legislature):
    return BASE + '/prb_includes/weblex/data/dos_qu_legis_' + legislature + '.json'

INDEX = index_url(CURRENT_LEGISLATURE)
SELECTIONS = Path(__file__).with_name('title-selections.json')

def full_legislature(short):
    """'19-24' → '2019-2024', '89-95' → '1989-1995'."""
    return '-'.join(str((2000 if int(y) < 50 else 1900) + int(y)) for y in short.split('-'))

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

# Unreachable site, timeout, reset connection or HTTP error (URLError and
# TimeoutError are OSError subclasses).
NETWORK_ERRORS = (OSError, http.client.HTTPException)

def download(url, attempts=3, first_wait=2):
    """Waits first_wait seconds before the second attempt, then twice as long each time."""
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'ParlementCitoyen/0.1 (documentary research)'})
            with urllib.request.urlopen(request, timeout=40) as response:
                data = response.read().decode('utf-8-sig')
            time.sleep(0.6)
            return data
        except NETWORK_ERRORS:
            if attempt == attempts - 1:
                raise
            time.sleep(first_wait * 2 ** attempt)

def parse_record(row, raw, legislature='2024-2029'):
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
    return dict(id='PRB-1-'+code, moncode=code, base=1, assemblee='PRB', legislature=legislature, session=field('Session'),
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
# Answers can still arrive later: older unanswered questions are rechecked in
# rotation, each one every OLD_UNANSWERED_PERIOD_WEEKS weeks. The rotation only
# depends on the question number and the current week, so nothing is stored
# (a check date in the document would change its hash and its embeddings).
OLD_UNANSWERED_PERIOD_WEEKS = 4
# A page that stays unreachable is postponed to a later run instead of failing
# the whole run. This many postponements in a row mean the site is down: stop.
CONSECUTIVE_NETWORK_FAILURES = 3

def code_of(row):
    return re.search(r'moncode=(\d+)', row[2])[1]

def missing_from_index(index_text, rows, current_questions):
    """Current questions absent from the usable index rows, with the reason."""
    usable = {code_of(r) for r in rows}
    listed = {m[1] for r in json.loads(index_text)['data'] if r[0] == 'PRB'
              for m in [re.search(r'moncode=(\d+)', r[2])] if m}
    return [dict(moncode=q['moncode'], reason='incomplete_row' if q['moncode'] in listed else 'not_listed')
            for q in current_questions if q['moncode'] not in usable]

def index_rows(index_text):
    """PRB written questions of the index, most recent first."""
    rows = [r for r in json.loads(index_text)['data'] if r[0] == 'PRB' and r[15] == '1' and iso(r[5])]
    rows.sort(key=lambda r: (iso(r[5]), int(code_of(r))), reverse=True)
    return rows

def in_rotation(moncode, today, period_weeks=OLD_UNANSWERED_PERIOD_WEEKS):
    return int(moncode) % period_weeks == (today.toordinal() // 7) % period_weeks

def needs_recheck(question, today, unanswered_days=UNANSWERED_DAYS, recent_answer_days=RECENT_ANSWER_DAYS):
    if not (question.get('reponse') or '').strip():
        recent = dt.date.fromisoformat(question['date_reception']) >= today - dt.timedelta(days=unanswered_days)
        return recent or in_rotation(question['moncode'], today)
    answered = question.get('date_reponse')
    return answered is not None and dt.date.fromisoformat(answered) >= today - dt.timedelta(days=recent_answer_days)

def plan(rows, current_questions, today, full=False):
    """Split the work: current questions to download again, current questions
    kept as they are, and index rows absent from the corpus (candidates to add,
    most recent first)."""
    by_code = {code_of(r): r for r in rows}
    # A question missing from the index cannot be downloaded again: it is kept as is.
    recheck = {q['moncode'] for q in current_questions
               if q['moncode'] in by_code and (full or needs_recheck(q, today))}
    kept = [q for q in current_questions if q['moncode'] not in recheck]
    present = {q['moncode'] for q in current_questions}
    return ([r for r in rows if code_of(r) in recheck], kept, [r for r in rows if code_of(r) not in present])

def title_matches(row, pattern):
    return bool(pattern.search(html.unescape(row[8] or '')) or pattern.search(html.unescape(row[9] or '')))

LEGISLATURE_SENTENCE = re.compile(r'Législature (\d{4}-\d{4}) : [^.]*\.')

def method_text(previous_method, questions, legislature, sentence):
    """One sentence per legislature: the collected one is rewritten, the others are
    kept from the previous corpus (they are not collected in this run)."""
    sentences = {m[1]: m[0] for m in LEGISLATURE_SENTENCE.finditer(previous_method or '')}
    sentences[legislature] = f'Législature {legislature} : {sentence}.'
    counts = {}
    for q in questions:
        counts[q.get('legislature', '2024-2029')] = counts.get(q.get('legislature', '2024-2029'), 0) + 1
    for other, count in counts.items():
        sentences.setdefault(other, f'Législature {other} : {count} fiches.')
    ordered = [sentences[k] for k in sorted(sentences, reverse=True) if k in counts]
    return ('Questions écrites PRB. ' + ' '.join(ordered) + ' Les fiches dont le texte de question n’est pas encore '
            'publié sont écartées. Français uniquement ; sans garantie d’exhaustivité.')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', default='data/corpus.json')
    parser.add_argument('--output', default='data/corpus-refreshed.json')
    parser.add_argument('--expand', type=int, default=0,
                        help='Add up to this many questions absent from the corpus, most recent first (maximum 500 per run)')
    parser.add_argument('--full', action='store_true', help='Download every current question again')
    parser.add_argument('--max-records', type=int, default=6000, help='Maximum corpus size, checked before any page download')
    parser.add_argument('--max-downloads', type=int, default=900, help='Maximum question pages downloaded in this run')
    parser.add_argument('--max-network-failures', type=int, default=10,
                        help='Maximum question pages postponed after network errors before the run stops')
    parser.add_argument('--max-empty-texts', type=int, default=10,
                        help='Maximum current questions whose text is now empty on the site (previous version kept) before the run stops')
    parser.add_argument('--max-missing-from-index', type=int, default=10,
                        help='Maximum current questions missing from the index (previous version kept) before the run stops')
    parser.add_argument('--legislature', default=CURRENT_LEGISLATURE,
                        help='Legislature to collect, as in the index file name (24-29, 19-24…). Questions of other '
                             'legislatures already in the corpus are kept as they are.')
    parser.add_argument('--title-filter', default='',
                        help='Only add questions whose French or Dutch title matches this regular expression '
                             '(case-insensitive), e.g. "Schaerbeek|Schaarbeek|Meiser|Josaphat"')
    parser.add_argument('--selection', default='',
                        help='Named thematic selection from title-selections.json (sets --legislature, --title-filter '
                             'and --title-filter-label), e.g. "schaerbeek"')
    parser.add_argument('--title-filter-label', default='',
                        help='Readable description of --title-filter for the method text, e.g. "Schaerbeek ou une de ses '
                             'voiries régionales" (default: the alternatives of the filter)')
    args = parser.parse_args()
    if args.selection:
        selections = json.loads(SELECTIONS.read_text(encoding='utf-8'))
        if args.selection not in selections:
            parser.error(f'--selection must be one of: {", ".join(sorted(selections))}')
        chosen = selections[args.selection]
        args.legislature, args.title_filter = chosen['legislature'], chosen['title_filter']
        args.title_filter_label = chosen.get('title_filter_label', '')
    if not 0 <= args.expand <= 500:
        parser.error('--expand must be between 0 and 500')
    if args.max_records < 1 or args.max_downloads < 1 or args.max_network_failures < 0 or args.max_empty_texts < 0 \
            or args.max_missing_from_index < 0:
        parser.error('--max-records and --max-downloads must be positive, the other --max-* options at least 0')
    if not re.fullmatch(r'\d{2}-\d{2}', args.legislature):
        parser.error('--legislature must look like 24-29')
    try:
        title_filter = re.compile(args.title_filter, re.I) if args.title_filter else None
    except re.error as error:
        parser.error(f'--title-filter is not a valid regular expression: {error}')
    legislature = full_legislature(args.legislature)
    source_index = index_url(args.legislature)
    current = json.loads(Path(args.file).read_text(encoding='utf-8'))
    # Nothing can be done without the index: more patience than for a page.
    index_text = download(source_index, attempts=5, first_wait=5)
    rows = index_rows(index_text)
    if len(current['questions']) > args.max_records:
        raise ValueError('Plafond de collecte dépassé ; aucune fiche téléchargée ou supprimée.')
    room = args.max_records - len(current['questions'])
    if args.expand > room:
        print(f'Plafond de {args.max_records} fiches : ajout limité à {room} fiche(s).')
    to_add = min(args.expand, room)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    snapshot = output.parent / 'source-snapshots' / dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    snapshot.mkdir(parents=True)
    (snapshot / 'index.json').write_text(index_text, encoding='utf-8')
    # Questions of other legislatures are neither rechecked nor looked up in this index.
    collected = [q for q in current['questions'] if q.get('legislature', '2024-2029') == legislature]
    frozen = [q for q in current['questions'] if q.get('legislature', '2024-2029') != legislature]
    missing = missing_from_index(index_text, rows, collected)
    (snapshot / 'missing-from-index.json').write_text(json.dumps(missing, ensure_ascii=False, indent=2), encoding='utf-8')
    for item in missing:
        reason = 'ligne incomplète dans l’index' if item['reason'] == 'incomplete_row' else 'absente de l’index'
        print(f'Conservée ({reason}) :', item['moncode'])
    if len(missing) > args.max_missing_from_index:
        raise ValueError(f'{len(missing)} fiches du corpus absentes de l’index ({len(rows)} lignes utilisables) : '
                         'index tronqué ou modifié ? Corpus non remplacé ; vérification manuelle requise.')
    recheck, kept, candidates = plan(rows, collected, dt.date.today(), args.full)
    present = {q['moncode'] for q in frozen}
    candidates = [r for r in candidates if code_of(r) not in present]
    if title_filter:
        candidates = [r for r in candidates if title_matches(r, title_filter)]
        print(f'Filtre de titre « {args.title_filter} » : {len(candidates)} question(s) à ajouter.')
    if len(recheck) > args.max_downloads:
        raise ValueError(f'{len(recheck)} fiches à revérifier pour un plafond de {args.max_downloads} téléchargements ; corpus non remplacé.')
    downloads = 0

    def fetch(row):
        nonlocal downloads
        code = code_of(row)
        raw = download(BASE+'/weblex-quest-det/?moncode='+code+'&base=1')
        downloads += 1
        (snapshot / (code+'.html')).write_text(raw, encoding='utf-8')
        return parse_record(row, raw, legislature)

    postponed = []
    in_a_row = 0

    def postpone(row, error):
        nonlocal in_a_row
        postponed.append(code_of(row))
        in_a_row += 1
        print(f'Reportée (site injoignable, {type(error).__name__}) :', code_of(row))
        if len(postponed) > args.max_network_failures or in_a_row >= CONSECUTIVE_NETWORK_FAILURES:
            raise ValueError(f'{len(postponed)} fiche(s) injoignable(s), dont {in_a_row} de suite : site du Parlement '
                             'indisponible ? Corpus non remplacé ; relancez plus tard.') from error

    previous = {q['moncode']: q for q in collected}
    questions = frozen + kept
    emptied = []
    for row in recheck:
        try:
            questions.append(fetch(row))
        except MissingQuestionText:
            # The site answered but the text vanished: keep the previous version and
            # recheck next run. Many at once suggests a change in the page layout.
            questions.append(previous[code_of(row)])
            emptied.append(code_of(row))
            in_a_row = 0
            print('Conservée (texte vide sur le site) :', code_of(row))
            if len(emptied) > args.max_empty_texts:
                raise ValueError(f'{len(emptied)} fiches existantes ont désormais un texte vide sur le site : '
                                 'structure des pages modifiée ? Corpus non remplacé.')
            continue
        except NETWORK_ERRORS as error:
            # The previous version stays; the question is rechecked next run.
            questions.append(previous[code_of(row)])
            postpone(row, error)
            continue
        in_a_row = 0
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
            in_a_row = 0
            continue
        except NETWORK_ERRORS as error:
            postpone(row, error)
            continue
        in_a_row = 0
        added += 1
        print('Ajoutée', code_of(row))
    (snapshot / 'excluded.json').write_text(json.dumps(skipped, ensure_ascii=False, indent=2), encoding='utf-8')
    (snapshot / 'postponed.json').write_text(json.dumps(postponed), encoding='utf-8')
    (snapshot / 'emptied.json').write_text(json.dumps(emptied), encoding='utf-8')
    if not questions:
        raise ValueError('Aucune fiche exploitable : corpus non remplacé.')
    # Index order (most recent first), which also places questions missing from the index.
    questions.sort(key=lambda q: (q['date_reception'], int(q['moncode'])), reverse=True)
    count = sum(q.get('legislature', '2024-2029') == legislature for q in questions)
    if title_filter:
        words = [w for w in re.split(r'\|', args.title_filter) if w]
        label = (args.title_filter_label or
                 (', '.join(words[:-1]) + ' ou ' + words[-1] if len(words) > 1 else args.title_filter)).replace('.', '')
        sentence = (f'sélection thématique, et non la législature complète : {count} questions dont le titre cite '
                    f'{label}')
    else:
        sentence = (f'{count} fiches sur {len(rows)} dans l’index officiel, collectées des plus récentes aux plus '
                    'anciennes')
    result = dict(schema_version='1.0', extrait_le=dt.datetime.now(dt.timezone.utc).isoformat(), source_index=source_index,
                  nombre_elements=len(questions), questions=questions, fiches_ecartees=skipped,
                  methode_echantillonnage=method_text(current.get('methode_echantillonnage'), questions, legislature, sentence))
    temp = output.with_suffix('.tmp')
    temp.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(output)
    absent = len(candidates) - added
    print(f'Validated collection: {len(questions)} records → {output}')
    print(f'Législature {legislature} ; autres législatures conservées telles quelles : {len(frozen)}')
    print(f'Revérifiées : {len(recheck)} ; conservées sans téléchargement : {len(kept)} ; ajoutées : {added} ; '
          f'écartées : {len(skipped)} ; conservées (texte vide sur le site) : {len(emptied)} ; '
          f'reportées (site injoignable) : {len(postponed)} ; absentes de l’index : {len(missing)} ; '
          f'encore absentes du corpus : {absent} ; pages téléchargées : {downloads}')

if __name__ == '__main__':
    main()
