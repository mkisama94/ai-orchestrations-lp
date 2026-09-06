from pathlib import Path
from collections import Counter
from urllib.parse import urlparse
from lxml import html
import re

root = Path('public')
source = (root / 'index.html').read_text(encoding='utf-8')
doc = html.fromstring(source)
ids = [e.get('id') for e in doc.xpath('//*[@id]')]
assert len(ids) == len(set(ids)), 'Duplicate IDs'
assert len(doc.xpath('//h1')) == 1
for e in doc.xpath('//*[@href or @src]'):
    target = e.get('href') or e.get('src')
    if target.startswith('#'):
        # Privacy links open a native dialog through JavaScript.
        assert target[1:] in ids or target == '#privacy', target
    elif target.startswith('/'):
        assert (root / target.lstrip('/')).exists(), target
for label in doc.xpath('//label[@for]'):
    assert label.get('for') in ids
for key in ['AI Orchestration Inc.', '企業AIの設計事務所', 'AIプロダクト', '設計専業', 'yamamoto@ai-orchestration.jp']:
    assert key in source, key
assert 'href="#"' not in source
assert 'staging.' not in source
assert doc.xpath('//html')[0].get('lang') == 'ja'
css = (root / 'styles.css').read_text(encoding='utf-8')
assert css.count('{') == css.count('}')
assert '@media(max-width:640px)' in css
assert 'prefers-reduced-motion' in css
assert ':focus-visible' in css
print(f'PASS: {len(ids)} unique IDs, internal links/assets, form labels, brand copy, responsive rules, reduced motion, focus styles.')
