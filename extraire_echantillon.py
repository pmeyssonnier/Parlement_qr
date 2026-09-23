"""Extraction reproductible : Python 3, bibliothèque standard uniquement."""
import collections
import datetime as dt
import html
import json
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = 'https://www.parlement.brussels'
INDEX = BASE + '/prb_includes/weblex/data/dos_qu_legis_24-29.json'

def clean(s):
    s = re.sub(r'<!--.*?-->|<script\b.*?</script>|<style\b.*?</style>', '', s, flags=re.S)
    s = re.sub(r'<(?:br\b[^>]*|/p|/li|/tr|/div)>', '\n', s, flags=re.I)
    s = html.unescape(re.sub('<[^>]+>', '', s))
    return '\n'.join(' '.join(x.split()) for x in s.splitlines() if x.strip())

def fetch(url, path):
    if not path.exists():
        with urllib.request.urlopen(url, timeout=45) as r:
            path.write_bytes(r.read())
        time.sleep(0.4)
    return path.read_text(encoding='utf-8-sig')

def date(s):
    try:
        return dt.datetime.strptime(s, '%d/%m/%Y').date().isoformat()
    except ValueError:
        return None

def main():
    rows = json.loads(fetch(INDEX, ROOT / 'index_officiel_24-29.json'))['data']
    candidates = [r for r in rows if r[0] == 'PRB' and r[15] == '1' and date(r[5]) and date(r[5]) <= '2025-06-30']
    candidates.sort(key=lambda r: (date(r[5]), int(re.search(r'moncode=(\d+)', r[2])[1])), reverse=True)
    selected, authors = [], set()
    for row in candidates:
        if row[10] not in authors:
            selected.append(row)
            authors.add(row[10])
        if len(selected) == 10:
            break
    out = []
    sources = ROOT / 'sources'
    sources.mkdir(exist_ok=True)
    for row in selected:
        code = re.search(r'moncode=(\d+)', row[2])[1]
        url = BASE + html.unescape(re.search(r'href="([^"]+)"', row[2])[1])
        raw = fetch(url, sources / (code + '.html'))
        section = re.search(r'<section id="weblex-quest-det-fr".*?</section>', raw, re.S)[0]
        section = re.sub(r'<!--.*?-->', '', section, flags=re.S)
        txt = clean(section)
        blocks = {}
        for label, body in re.findall(r'<td[^>]*>\s*<b>(Question|R(?:é|&eacute;)ponse)\s*(?:&nbsp;|\s)*</b>\s*(?:</td>)?\s*<td[^>]*>(.*?)</td>', section, re.S):
            blocks[html.unescape(label)] = clean(body)
        def field(label):
            m = re.search(re.escape(label) + r':</b>\s*([^<]+)', html.unescape(section))
            return m[1].strip() if m else None
        number = re.search(r'question n°\s*(\d+)', txt)
        docs = []
        for link, title in re.findall(r'<a[^>]+href=[\'"]([^\'"]+)[\'"][^>]*>(.*?)</a>', section, re.S):
            if '.pdf' in link:
                item = {'url': html.unescape(link), 'reference': clean(title)}
                if item not in docs:
                    docs.append(item)
        acts = []
        for tr in re.findall(r'<tr>(.*?)</tr>', section, re.S):
            cells = [clean(c) for c in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
            if len(cells) == 5 and date(cells[0]):
                acts.append({'date': date(cells[0]), 'acte': cells[1], 'acteur': cells[2] or None})
        q, a = blocks.get('Question'), blocks.get('Réponse')
        out.append({'id': 'PRB-1-' + code, 'moncode': code, 'base': 1, 'assemblee': 'PRB', 'legislature': '2024-2029', 'session': field('Session'), 'type': 'question_ecrite', 'numero': int(number[1]) if number else None, 'langue': 'fr', 'titre': html.unescape(row[8]), 'titre_nl': html.unescape(row[9]), 'auteur': html.unescape(row[10]), 'destinataire': html.unescape(row[11]), 'date_reception': date(row[5]), 'date_publication': date(field('Date de publication') or ''), 'date_reponse': date(field('Date de réponse') or ''), 'question': q, 'reponse': a, 'statut_extraction_reponse': 'texte_present' if a else 'texte_absent_de_la_fiche', 'actes': acts, 'documents': docs, 'url_source': url, 'source_locale': 'sources/' + code + '.html'})
        print(code, row[5], clean(row[10]), 'question', len(q or ''), 'reponse', len(a or ''))
    payload = {'schema_version': '1.0', 'extrait_le': dt.datetime.now(dt.timezone.utc).isoformat(), 'source_index': INDEX, 'institution': 'Parlement de la Région de Bruxelles-Capitale', 'methode_echantillonnage': 'Dix questions écrites PRB reçues au plus tard le 30 juin 2025 : tri décroissant par date et moncode, première question pour chacun de dix auteurs distincts. Échantillon exploratoire non représentatif, choisi avec recul temporel pour examiner les réponses.', 'limites': ['Le décompte porte sur l’index téléchargé, sans garantie d’exhaustivité ou de fraîcheur du site.', 'Une réponse absente de la fiche ne prouve pas une absence de réponse institutionnelle.', 'Textes HTML convertis en texte brut ; mise en forme supprimée. Annexes référencées mais non extraites.', 'La date de réponse est celle indiquée par le site, sans interprétation supplémentaire.'], 'statistiques_index': {'total_fiches': len(rows), 'par_assemblee': dict(collections.Counter(r[0] for r in rows)), 'par_type_toutes_assemblees': dict(collections.Counter(html.unescape(r[6]) for r in rows)), 'questions_ecrites_prb': sum(r[0]=='PRB' and r[15]=='1' for r in rows)}, 'nombre_elements': len(out), 'questions': out}
    (ROOT / 'echantillon_questions_reponses.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')

if __name__ == '__main__':
    main()
