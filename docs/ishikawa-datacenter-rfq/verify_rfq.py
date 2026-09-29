from pathlib import Path
import json
import hashlib
import pypdfium2 as pdfium
from pypdf import PdfReader
from PIL import Image, ImageChops

ROOT=Path(__file__).resolve().parents[2]
path=ROOT/'output/pdf/AIOrchestration_石川県AIデータセンター概算見積依頼書_20260928.pdf'
reader=PdfReader(path)
pdf=pdfium.PdfDocument(path)
out=ROOT/'tmp/pdfs/ishikawa-rfq-review/final'
counts=[]
changed=[]
assert len(pdf)==9
for i in range(len(pdf)):
    imagepath=out/f'page-{i+1:02}.png'
    rendered=pdf[i].render(scale=1.5).to_pil().convert('RGB')
    old=Image.open(imagepath).convert('RGB')
    if ImageChops.difference(rendered,old).getbbox():
        changed.append(i+1)
    rendered.save(imagepath)
    counts.append(len(reader.pages[i].extract_text()))
assert min(counts)>500
assert 'ご紹介いただきたい企業' in reader.pages[8].extract_text()
links=[a.get_object().get('/A',{}).get('/URI') for a in reader.pages[7].get('/Annots',[])]
assert len(set(x for x in links if x))==4
report={'pages':len(pdf),'characters_per_page':counts,'changed_pages':changed,'source_links':links,'pdf_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'render':'Microsoft Word and PDFium'}
(Path(__file__).parent/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
