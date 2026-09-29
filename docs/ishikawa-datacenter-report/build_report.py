from pathlib import Path
import json, math, re, html
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
import pypdfium2 as pdfium
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/pdf'
TMP = ROOT / 'tmp/pdfs/ishikawa-client-review'
OUT.mkdir(parents=True, exist_ok=True)
TMP.mkdir(parents=True, exist_ok=True)
DEST = OUT / 'AIOrchestration_石川県AIデータセンター立地レポート_20260928.pdf'
DATA = json.loads((ROOT / 'docs/ishikawa-datacenter-lp/data/seismic-comparison.json').read_text(encoding='utf-8'))
pdfmetrics.registerFont(TTFont('JP', 'C:/Windows/Fonts/meiryo.ttc', subfontIndex=0))
pdfmetrics.registerFont(TTFont('JPB', 'C:/Windows/Fonts/meiryob.ttc', subfontIndex=0))
pdfmetrics.registerFontFamily('JP',normal='JP',bold='JPB',italic='JP',boldItalic='JPB')
W,H = A4
M=46
CW=W-2*M
NAVY=HexColor('#102D4D'); BLUE=HexColor('#1767A2'); TEAL=HexColor('#008E98')
INK=HexColor('#273A4C'); MUTED=HexColor('#526678'); LINE=HexColor('#D9E3EA'); PALE=HexColor('#F0F5F8')
C=canvas.Canvas(str(DEST), pagesize=A4, pageCompression=1)
C.setTitle('石川県のAIデータセンター建設立地レポート')
C.setAuthor('AI Orchestration')
C.setSubject('50MW級の開発を検討する需要家・投資家向け限定共有資料')
Y=0; PAGE=0; PAGES=12; FLOW=[]

SOURCES=[
('北陸電力送配電','石川県の企業用地およびウェルカムゾーン','https://www.rikuden.co.jp/nw_youchi/ishikawa.html','4変電所の供給力、企業用地の公表面積。'),
('北陸電力送配電','南金沢変電所の公表条件','https://www.rikuden.co.jp/nw_youchi/ishikawa_ss01.html','200MW、受電点条件、契約後の最短連系工期。'),
('北陸電力送配電','新能登変電所の公表条件','https://www.rikuden.co.jp/nw_youchi/ishikawa_ss02.html','300MW、154kV引出、工期・用地条件。'),
('北陸電力送配電','中能登変電所の公表条件','https://www.rikuden.co.jp/nw_youchi/ishikawa_ss03.html','300MW、154kV引出、工期・用地条件。'),
('北陸電力送配電','北金沢変電所の公表条件','https://www.rikuden.co.jp/nw_youchi/ishikawa_ss04.html','50MW、154kV引出、工期・用地条件。'),
('石川コンピュータ・センター','白山データセンター ネットワークサービス','https://www.icc-idc.jp/products/datacenter/network.html','東京100Gbps・大阪50Gbps、主要IX・上位接続。'),
('BBIX・HTNet','金沢西センターへのOCX接続拠点開設の発表','https://www.bbix.net/information/press/2025-05-28/','2025年5月28日発表。6月1日の開設予定を記載。'),
('BBIX・ICC','白山データセンターでのOCF提供開始','https://www.bbix.net/information/press/2026-06-30/','2026年6月の接続拠点開設・提供開始。'),
('NTTドコモビジネス','GPU over APN Testbedの提供開始','https://www.ntt.com/about-us/press-releases/news/article/2026/0706.html','2026年7月6日発表。金沢を含む8拠点、100Gbps級。'),
('ハイレゾ','志賀町第2データセンター開設','https://highreso.jp/press/722/','2022年8月29日発表。2019年の運営開始と再エネメニュー採用。'),
('JAIST','AI・HPC基盤 HAKUSANの運用開始','https://www.jaist.ac.jp/whatsnew/press/2026/07/24-1.html','2026年3月運用開始。ラックスケール液冷・高速接続。'),
('JAIST・PFN・IIJ','直接水冷方式によるAI計算基盤の研究開発','https://www.jaist.ac.jp/whatsnew/press/2026/03/23-1.html','研究主体にJAIST。実証設備の場所は千葉県白井。'),
('北陸電力','再エネ電気料金メニュー','https://www.rikuden.co.jp/jiyuka/saiene_denkiryokin.html','再エネ・環境価値・トラッキングの契約選択肢。'),
('石川県企業立地ガイド','データセンター立地促進補助金','https://www.ishikawa-ritchi.com/subsidy-datacenter/','地域別補助率、通常上限、特認、投資・雇用の要件。'),
('防災科学技術研究所 J-SHIS','2024年基準の地震動予測地図の公表説明','https://www.j-shis.bosai.go.jp/news-20240719','2020年版モデルの確率基準日を2024年1月に更新。'),
('防災科学技術研究所 J-SHIS','地震ハザードカルテの見方','https://www.j-shis.bosai.go.jp/karte-manual','震度超過確率、評価基準日、地盤増幅率等の定義。'),
('防災科学技術研究所 J-SHIS','地震ハザード情報提供API','https://www.j-shis.bosai.go.jp/api-pshm-meshinfo','22代表地点と周辺点の数値取得。各地点のカルテは10頁から参照。'),
('地震調査研究推進本部','日本海中南部の海域活断層の長期評価のポイント','https://www.jishin.go.jp/main/chousa/25jun_cs_sea_of_japan/cs_sea_of_japan_gaiyo1.pdf','2025年6月公表。J-SHIS比較モデルとは別に確認する知見。'),
('東京海上ディーアール','地震リスク定量評価と地震PML評価','https://www.tokio-dr.jp/service/due_dili/eq_pml/','物的損害の定量評価、地震動・地盤・建物特性の考え方。'),
('ハイレゾ','能登半島地震の影響とサービス復旧に関する発表','https://highreso.jp/information/6782/','2024年1月11日発表。一時停止と1月3日15:05の復旧。'),
('AI Orchestration','SPAQ COREへの事業・技術面での関与','https://ai-orchestration.jp/spaq-core.html','電力需要予測、蓄電池制御等の自社公表担当領域。')
]

def style(size=10.2,leading=None,color=INK,bold=False,align=TA_LEFT):
    return ParagraphStyle('x',fontName='JPB' if bold else 'JP',fontSize=size,leading=leading or size*1.65,textColor=color,wordWrap='CJK',alignment=align,splitLongWords=True,spaceAfter=0)

def para(text,x,y,w,size=10.2,leading=None,color=INK,bold=False,align=TA_LEFT):
    p=Paragraph(text,style(size,leading,color,bold,align))
    _,h=p.wrap(w,1000)
    p.drawOn(C,x,y-h)
    return h

def write(text,size=10.2,gap=12,color=INK,bold=False):
    global Y
    h=para(text,M,Y,CW,size,color=color,bold=bold)
    Y-=h+gap
    FLOW.append((PAGE,text))
    if Y<49: raise RuntimeError(f'Page {PAGE} overflow: {Y:.1f} after {text[:55]}')

def sub(text):
    global Y
    Y-=5
    write(text,size=13.2,gap=8,color=NAVY,bold=True)

def note(text): write(text,size=8.5,gap=10,color=MUTED)

def rule():
    global Y
    C.setStrokeColor(LINE);C.setLineWidth(.6);C.line(M,Y,W-M,Y);Y-=16

def new_page(section,title,deck):
    global PAGE,Y
    if PAGE: C.showPage()
    PAGE+=1
    C.setFillColor(NAVY);C.rect(0,H-7,W,7,fill=1,stroke=0)
    C.setFont('JPB',9);C.drawString(M,H-33,'AI Orchestration')
    C.setFont('JP',8);C.setFillColor(MUTED);C.drawRightString(W-M,H-33,'お客様向け限定共有資料  |  2026.09.28')
    C.setStrokeColor(LINE);C.line(M,45,W-M,45)
    C.setFont('JP',7.5);C.drawString(M,30,'石川県 AIデータセンター建設立地レポート')
    C.drawRightString(W-M,30,f'{PAGE:02d} / {PAGES:02d}')
    C.bookmarkPage(f'p{PAGE}')
    C.addOutlineEntry(title,f'p{PAGE}',level=0)
    Y=H-62
    write(section,size=8.3,gap=8,color=TEAL,bold=True)
    write(title,size=22,gap=12,color=NAVY,bold=True)
    if deck:write(deck,size=11,gap=19,color=MUTED)

def table(headers,rows,widths,size=9.3,pad=8,highlight=()):
    global Y
    def cell(v,head=False):return Paragraph(str(v),style(size if not head else size-.1,leading=size*1.45,color=white if head else INK,bold=head))
    data=[[cell(x,True) for x in headers]]+[[cell(x) for x in row] for row in rows]
    t=Table(data,colWidths=widths,hAlign='LEFT')
    cmds=[('BACKGROUND',(0,0),(-1,0),NAVY),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),pad),('RIGHTPADDING',(0,0),(-1,-1),pad),('TOPPADDING',(0,0),(-1,-1),pad),('BOTTOMPADDING',(0,0),(-1,-1),pad),('GRID',(0,0),(-1,-1),.4,LINE)]
    for i in range(1,len(data)):
        cmds.append(('BACKGROUND',(0,i),(-1,i),HexColor('#E4F2F3') if i-1 in highlight else (white if i%2 else PALE)))
    t.setStyle(TableStyle(cmds))
    _,h=t.wrap(CW,1000)
    if Y-h<55:raise RuntimeError(f'Table page {PAGE} overflows at {Y-h:.1f}, height {h:.1f}')
    t.drawOn(C,M,Y-h);Y-=h+15

def emphasis(title,text):
    global Y
    C.setFillColor(TEAL);C.rect(M,Y-4,25,3,fill=1,stroke=0);Y-=15
    write(title,size=13,gap=8,color=NAVY,bold=True)
    write(text,size=10.2,gap=14)

def stats(items):
    global Y
    col=CW/len(items)
    for i,(num,label,detail) in enumerate(items):
        x=M+i*col
        C.setFillColor(PALE);C.roundRect(x,Y-97,col-9,97,5,fill=1,stroke=0)
        para(num,x+12,Y-10,col-32,25,color=BLUE,bold=True)
        para(label,x+12,Y-49,col-31,10,bold=True)
        para(detail,x+12,Y-69,col-31,8,color=MUTED)
    Y-=114

def network_diagram():
    global Y
    top=Y
    C.setFillColor(PALE);C.roundRect(M,top-136,CW,136,5,fill=1,stroke=0)
    boxes=[(M+18,top-84,126,49,'東京','100Gbps'),(M+187,top-84,130,49,'ICC 白山DC','既存の商用接続'),(M+360,top-84,125,49,'大阪','50Gbps')]
    C.setStrokeColor(TEAL);C.setLineWidth(2)
    C.line(M+144,top-60,M+187,top-60);C.line(M+317,top-60,M+360,top-60)
    for x,y,w,h,a,b in boxes:
        C.setFillColor(white);C.roundRect(x,y,w,h,4,fill=1,stroke=0)
        para(a,x+8,y+h-7,w-16,11,color=NAVY,bold=True,align=TA_CENTER)
        para(b,x+8,y+h-28,w-16,9.3,color=BLUE,align=TA_CENTER)
    para('ICC公表のネットワーク構成を簡略化した概念図 [6]',M+14,top-105,CW-28,8.5,color=MUTED,align=TA_CENTER)
    Y-=151

new_page('CLIENT REPORT  /  EXECUTIVE VIEW','石川県のAIデータセンター\n建設立地レポート'.replace('\n','<br/>'),'50MW級の開発を検討する需要家・投資家の皆さまへ')
write('大容量電力を起点に、石川県を建設候補へ。',size=17,gap=15,color=NAVY,bold=True)
write('私たちは、石川県を50MW級AIデータセンターの候補地として、具体的な比較検討に加えることを提案します。県内には大口受電の公表情報、広域通信、GPUデータセンターの開設実績、AI・高性能計算の研究基盤があります。これらを貴社の要件に合わせて組み合わせることが、立地検討の出発点になります。 [1][6][10][11]')
stats([('50〜300','MWの公表供給可能量','4変電所の公表値 [1]'),('100 / 50','Gbpsの東京・大阪接続','ICC白山DCの既存回線 [6]'),('2019年','志賀町でGPU DC運営開始','2022年には第2DC開設 [10]')])
sub('AI Orchestrationからの提案')
write('単一敷地での50MW級開発を軸に、電力・土地・通信・防災・採算を同じ条件で比較します。一棟集約のご要望を優先して確認し、必要に応じて同一敷地での段階整備も検討します。小規模分散は用途に応じた補完案です。')
rule()
note('本書の構成：電力と用地 2〜3頁 ／ 通信と技術基盤 4〜5頁 ／ 地震と事業継続 6頁 ／ 電力調達・投資条件 7〜8頁 ／ ご相談の進め方 9頁 ／ 全国比較と出典 10〜12頁')
note('AI Orchestration作成。情報確認日：2026年9月28日。限られたお客様との検討用として共有する資料です。公表情報と当社の提案を整理したもので、特定敷地の販売資料、電力枠の確保、行政の認定を示すものではありません。')

new_page('01  /  POWER','大口受電の検討を<br/>具体的な設備から始められる','必要な電力を起点に土地を探す。そのための公表情報があります。')
write('北陸電力送配電のウェルカムゾーンには、石川県内の4変電所について50MW以上の供給可能量が示されています。200MW・300MWの公表地点もあり、初期規模に加え将来拡張を照会するための材料になります。 [1]')
table(['検討の起点となる設備','公表供給可能量','契約後の最短連系工期'],[['南金沢変電所 [2]','200MW','約2年半'],['新能登変電所 [3]','300MW','約2年半'],['中能登変電所 [4]','300MW','約2年半'],['北金沢変電所 [5]','50MW','約2年半']],[210,123,CW-333],size=10)
note('4変電所の公表条件は、変電所敷地から約100mの範囲に受電点を設けること等。154kV引出を対象とし、工事負担金は個別照会。アクセス線の用地事情も別途確認します。供給可能量は予約済み容量ではなく、設備間で単純に合算できません。 [2]〜[5]')
sub('公表工期があることで、全体工程を組み立てやすくなる')
write('約2年半は契約締結から連系までの最短工期です。申込みから契約までの期間や、DC建設・統合試験・顧客受入れは含みません。電力側の工程を起点に、建築、回線、機器調達を並行して進められるかを照合し、案件固有の稼働時期を具体化します。 [2]')
sub('最初に確認するのは、50MWの意味')
write('公表供給可能量と、GPUなどが使用するIT負荷は異なります。IT負荷に冷却・電源損失・補機等を加え、必要な受電容量とピーク時の条件を定義します。IT負荷50MWを希望する場合、供給可能量50MWだけで足りるとは限りません。')
emphasis('貴社にとっての価値','地域名だけの候補比較から、設備名・容量・工程をそろえた接続検討へ進めます。')

new_page('02  /  LAND','土地と電力を照合して<br/>建設候補を絞り込む','企業用地の情報と、大口受電の情報を組み合わせて検討できます。')
write('石川県には、工業団地や研究開発地区の用地情報が公開されています。重要なのは、分譲面積の大きさだけで選ぶことではなく、まとまった敷地、受電点、アクセス線、回線引込、冷却設備を一体で成立させることです。 [1]')
table(['公表されている企業用地','所在地','公表分譲可能面積'],[['輪島市臨空産業団地','輪島市','7.5ha'],['能登中核工業団地','志賀町','3.2ha'],['七尾港大田工業用地','七尾市','2.0ha'],['羽咋北部工業団地','羽咋市','1.0ha'],['いしかわサイエンスパーク','能美市','26.9ha']],[238,90,CW-328],size=9.7,pad=7)
note('北陸電力送配電の企業用地一覧の掲載値。現時点の残区画、連続した敷地面積、造成・用途条件は個別確認が必要です。上記の用地に前頁の公表容量がそのまま供給できるという対応関係は確認していません。 [1]')
sub('一つの候補地情報として、6つの条件をそろえる')
table(['土地・建築','受電・通信','事業・運用'],[['地番、利用可能面積、権利<br/>用途、造成、増設余地','接続回答、引込用地、費用<br/>回線経路、帯域、開通時期','地盤・災害、冷却・水<br/>保守動線、総費用、工程']],[CW/3]*3,size=9.4,pad=9)
write('当社は、電力設備を起点にした探索と、既存の用地情報からの探索を並行し、同じ評価軸で候補を比較する進め方を提案します。候補地が具体化した段階で、図面・権利・接続条件を確認し、現地調査につなげます。')
emphasis('貴社にとっての価値','用地情報を、建設・運用の判断に使える「土地・受電・通信・費用・工期」の組へ整理できます。')

new_page('03  /  CONNECTIVITY','広域通信とクラウド接続の<br/>既存基盤がある','新設拠点の通信要件を、具体的な事業者・サービスから照会できます。')
network_diagram()
write('ICC白山データセンターは、東京100Gbps・大阪50Gbpsのインターネット接続と、主要IX・複数の上位接続を公表しています。県内には広域接続を伴うDCサービスの実績があります。 [6]')
table(['県内の接点','公表されている内容','区分'],[['HTNet 金沢西センター','BBIXがOCX接続拠点の開設を発表。2025年6月1日の開設予定を記載。 [7]','接続拠点'],['ICC 白山DC','2026年6月、BBIXとICCが地域分散型クラウドOCFの提供を開始。 [8]','商用サービス'],['金沢を含む全国8拠点','NTTドコモビジネスが100Gbps級のGPU over APN Testbedを提供。 [9]','AI通信実証']],[139,287,CW-426],size=9.2,pad=7)
sub('50MW級の仕様は、用途から決める')
write('必要帯域は電力容量だけでは決まりません。GPU間の構内ネットワークと、データ搬入・外部クラウド接続・利用者応答の通信を分け、通常時と障害時の性能、物理経路の独立性、開通費用を確認します。')
note('既存施設の帯域や実証環境は、新設50MW施設への提供確約ではありません。記載企業の本プロジェクトへの参画・提携を示すものでもありません。')
emphasis('貴社にとっての価値','「通信があるか」という入口から、必要な仕様・価格・時期を満たす接続設計の協議へ進めます。')

new_page('04  /  OPERATIONS AND RESEARCH','GPU運営とAI研究の<br/>経験が蓄積されている','設備の設置先に加え、運用・研究の接点を持つ地域として検討できます。')
sub('志賀町にはGPUデータセンターの開設実績')
write('ハイレゾは2019年に志賀町でGPU専用DCの運営を開始し、2022年には第2DCを開設したと公表しています。石川県でGPU計算サービスを事業化してきた実績があり、再エネ電気メニューの採用例も示されています。 [10]')
sub('JAISTには液冷を用いた高性能計算基盤')
write('北陸先端科学技術大学院大学（JAIST、能美市）は、AI・高性能計算基盤「HAKUSAN」を2026年3月から運用しています。124台の計算ノードを高速ネットワークで接続し、ラックスケール液冷を採用した研究基盤です。 [11]')
write('JAISTはPFN・IIJと直接水冷方式のAI計算基盤の研究開発にも参加しています。この実証設備は千葉県の白井データセンターキャンパスに設置されており、県内設備の実績と、県内研究機関が持つ知見を分けて評価できます。 [12]')
table(['貴社の検討テーマ','地域資源との接点'],[['運用体制','県内DC・通信事業者の経験を照会し、全国の専門事業者と組み合わせる'],['液冷・高密度化','冷却方式、保守、電力効率について、研究・実証の論点を共有する'],['人材・研究協力','共同研究、育成、実習等の可能性を、相手方との個別協議で具体化する']],[123,CW-123],size=9.5,pad=8)
note('既存実績は、50MW級施設の建設・運営能力や要員確保をそのまま証明するものではありません。共同研究・委託・採用等は個別合意に基づきます。')
emphasis('貴社にとっての価値','GPU計算、通信、液冷・研究の具体例を持つ地域で、運用計画や協業可能性を検討できます。')

new_page('05  /  SEISMIC RISK AND CONTINUITY','地震リスクを<br/>地点と設備仕様で比較する','全国共通の公開モデルには、能登の選定地点が低い側に位置する結果があります。')
write('今回選定した能登4地点では、2024年基準の30年間に震度6弱以上となる確率は1.4〜2.4%でした。印西などより低い値がある一方、松江・広島にはさらに低い代表点もあります。地域名による一括判断を避け、候補敷地を調べる意味があります。全22地点は10頁に掲載しました。 [15]〜[17]')
table(['代表地点','30年・震度6弱以上','比較の範囲'],[['能登の選定4地点','1.4〜2.4%','志賀・輪島・七尾・中能登'],['石狩・新港中央1丁目','2.6%','町名代表点'],['北九州・ひびきの北','2.4%','町名代表点'],['印西・大塚2丁目','59.2%','町名代表点'],['松江・北陵町／広島・伴南1丁目','1.3%／1.1%','町名代表点']],[247,109,CW-356],size=9.2,pad=7,highlight=(0,))
note('表は2020年版モデルの基準日を2024年1月に更新したJ-SHISデータです。2026年からの30年予測ではなく、2025年の海域活断層評価等を織り込んだ再計算でもありません。町名代表点は建設敷地とは限らず、PML・停止確率・安全性の順位を示しません。 [15][18]')
sub('投資家と需要家では、次に見る指標が異なる')
table(['投資家の確認','需要家の確認'],[['建物・設備の物的損害、修復費、保険<br/>事業中断損失と追加対策費','電源・冷却・通信の継続性<br/>燃料補給、道路、保守、復旧時間']],[CW/2,CW/2],size=9.6,pad=8)
write('候補敷地と建物・設備仕様をそろえ、第三者PMLと停止・復旧シナリオを評価することを提案します。PMLは一定の地震条件における物的損害を再調達価格に対する割合等で示す指標で、停止日数とは異なります。免震に加え、地盤、浸水、電源・通信経路、冬季の保守動線まで確認します。 [19]')
note('志賀町の既存GPUサービスは能登半島地震で一時停止し、2024年1月3日15:05に復旧したと運営者が公表しています。この経験は、建物の耐震性だけでなく事業継続を検討する必要性を示します。 [20]')

new_page('06  /  ENERGY AND EFFICIENCY','電力調達と冷却設計を<br/>運用コストの競争力につなげる','立地比較では、初期投資に加えて、稼働後の電力・設備費を重視します。')
write('北陸電力は再エネ由来電力や環境価値を組み合わせるメニューを公表しています。発電所情報を特定できる仕組みもあり、価格だけでなく貴社の脱炭素要件を含めて契約条件を協議する入口になります。 [13]')
sub('環境価値は契約で、効率は設備で具体化する')
table(['論点','比較する条件'],[['電力契約','供給量、契約期間、基本料金・従量料金・調整条件、冗長受電'],['脱炭素条件','電源・証書の由来、数量、時間帯の整合、追加性等の顧客要件'],['冷却・水','ラック密度、液冷方式、外気条件、水使用、保守方法、部分負荷効率']],[118,CW-118],size=9.6,pad=9)
write('再エネメニューの存在が、新設50MW施設に必要な量・価格の確保を意味するわけではありません。年間の環境価値調達と、全時間帯の脱炭素電力供給も区別します。本提案では、原子力の再稼働時期を稼働計画の前提に置きません。')
sub('1円/kWhの差が、年間費用に与える影響')
table(['施設全体の年間平均需要','年間電力量','1円/kWhの価格差'],[['30MW','262.8GWh','年間2.63億円'],['40MW','350.4GWh','年間3.50億円'],['50MW','438.0GWh','年間4.38億円']],[CW/3]*3,size=10,pad=8)
note('当社の算式例：年間平均需要×8,760時間×価格差。平均需要は契約容量・IT容量とは異なります。基本料金、税、割引率等を含めず、石川県の価格優位や実案件の費用を示すものではありません。')
emphasis('貴社にとっての価値','土地価格や補助額だけでなく、電力調達・冷却効率・回線費を含む運用期間全体の条件で比較できます。')

new_page('07  /  INVESTMENT CONDITIONS','DC向け支援制度を<br/>案件の採算条件に組み込む','対象事業としての制度が公表されており、投資計画と照合できます。')
write('石川県はデータセンター立地促進補助金を公表し、地域別の率、対象経費、投資・雇用条件、相談窓口を示しています。制度が明文化されていることは、事前協議と資金計画を進めるための材料です。 [14]')
table(['新設時の対象地域','公表補助率'],[['宝達志水町以北の能登地域、加賀市の旧山中町、白山市の白山麓旧5村','25%'],['かほく市・河北郡','15%'],['金沢市以南のうち、上記の旧山中町・旧5村を除く地域','10%']],[CW-100,100],size=10,pad=9)
write('新設の主な要件は投資額5,000万円以上、常時雇用者数の純増5人以上。県の通常上限は5億円です。土地・建物・機械設備や電気施設設置の負担金等が対象経費として挙げられています。 [14]')
note('特認は投資額100億円以上、市町の同等助成等を条件に県上限10億円、市町分合わせて20億円。県補助額は市町助成額を超えません。旧5村は河内・吉野谷・鳥越・白峰・尾口。採択、対象経費、申請時期、併用条件は個別確認が必要です。 [14]')
sub('50MW級を本線に、投資の段階を選ぶ')
table(['開発の選択肢','顧客側の判断軸'],[['単一敷地・一棟集約','計算基盤と運用を集約したい。必要容量と一棟での整備条件を優先確認'],['同一敷地で段階整備','需要契約と設備導入に合わせて増設。初期投資と拡張余地を両立'],['小規模拠点の分散','独立した推論・バッチ等の用途に応じた補完案。回線・運用費を個別評価']],[159,CW-159],size=9.4,pad=8)
note('県内複数拠点の容量合計は、単一の50MW学習クラスタと同じ性能を意味しません。補助制度の上限額を全案件の受給見込額として織り込まず、需要契約、接続費、造成、冷却、回線、運用費まで含めて事業性を判断します。')

new_page('08  /  OUR PROPOSAL','貴社の条件から<br/>石川県での建設可能性を具体化する','AI Orchestrationが、事業と技術の検討をつなぐ相談窓口を担います。')
write('石川県の魅力は、電力、通信、GPU運営、研究、立地支援の資源を、貴社の計画に合わせて組み合わせられる可能性にあります。当社は、これらの情報を建設・投資判断に使える候補地比較へ整理することを提案します。')
table(['進め方','当社が支援する内容','具体化する成果'],[['1 要件をそろえる','IT負荷と受電容量、用途、希望時期、冗長性、投資条件を整理','要件整理と調査方針'],['2 候補を比較する','土地・受電・通信・地盤防災・費用・工程を共通の項目で比較','候補地比較資料'],['3 個別条件を詰める','必要な専門事業者との検討事項、担当、見積条件を整理','事業化に向けた確認計画']],[104,254,CW-358],size=9.4,pad=9)
sub('最初のご相談で伺いたいこと')
write('① 必要なIT負荷・受電容量　② 学習・推論などの用途　③ 希望稼働時期と段階整備の可否　④ 通信・冷却・可用性の必須条件。未定の項目があっても、検討の優先順位から整理できます。')
write('当社はSPAQ COREで、電力需要予測や蓄電池制御等の設計・実装に関与しています。その経験も踏まえ、供給容量だけでなく運用時の電力・設備費に着目し、事業側の意思決定を支援します。 [21]')
note('土地の取引、接続契約、専門設計・施工、第三者評価は、それぞれの関係者・専門事業者と進めます。詳細調査の範囲・成果物・費用・日程は個別に合意します。本書に挙げる企業・大学の当社との提携を表すものではありません。')
rule()
write('50MW級の建設・利用計画を、石川県という選択肢から。',size=14,gap=11,color=NAVY,bold=True)
write('AI Orchestration  代表 山本 匡紀',size=11,gap=7,bold=True)
write('<link href="https://ai-orchestration.jp/projects/ishikawa-datacenter/" color="#1767A2">プロジェクト概要を開く</link>　／　<link href="https://ai-orchestration.jp/#contact" color="#1767A2">ご相談フォームを開く</link>',size=10,gap=7)
note('ai-orchestration.jp/projects/ishikawa-datacenter/  |  ご相談は本資料の送付元にもお寄せください。')

new_page('APPENDIX A  /  SEISMIC COMPARISON','全国22代表地点の地震ハザード比較','同一モデルの参考比較。具体的な建設用地の安全性・供給条件の評価ではありません。')
labels=['志賀・若葉台','輪島・三井町三洲穂','七尾・西三階町','中能登・井田','能美・旭台2丁目','石狩・新港中央1丁目','苫小牧・柏原','仙台・泉区明通2丁目','印西・大塚2丁目','白井・復（小室町境）','多摩・唐木田3丁目（町田境）','相模原・宮下1丁目','名古屋・中区栄2丁目','茨木・彩都あかね','箕面・彩都粟生北2丁目','堺・匠町','精華・精華台7丁目（木津川台境）','神戸・高塚台1丁目','松江・北陵町','広島・伴南1丁目','福岡・百道浜2丁目','北九州・ひびきの北']
rows=[]
mesh_order=['5536469012','5536776621','5536472142','5536374333','5436543743','6441621341','6441061024','5740462741','5340506934','5340504512','5339333211','5339320842','5236579233','5235243224','5235242044','5135731441','5235069241','5235008211','5333109444','5132533043','5030321814','5030656644']
by_mesh={p['meshCode']:p for p in DATA['points']}
assert len(by_mesh)==22 and set(mesh_order)==set(by_mesh)
for label,mesh in zip(labels,mesh_order):
    p=by_mesh[mesh]
    pct=lambda x:f'{x*100:.1f}%'
    rows.append([f'<link href="{p["karteUrl"]}" color="#1767A2">{label}</link>',pct(p['probability6Weak30Years']),pct(p['probability6Strong30Years']),f'{p["nearby"]["minProbability6Weak30Years"]*100:.1f}〜{p["nearby"]["maxProbability6Weak30Years"]*100:.1f}%',f'{p["pgvSurface50Year10PercentCms"]:.1f}',f'{p["amplification"]:.2f}'])
table(['代表地点／出典リンク','30年<br/>6弱以上','30年<br/>6強以上','周辺の<br/>6弱以上','地表PGV<br/>cm/s','地盤<br/>増幅率'],rows,[190,54,54,82,63,CW-443],size=8.4,pad=4.2,highlight=(0,1,2,3))
note('J-SHIS 2024年基準・平均ケース・全地震・250mメッシュ。取得日2026年9月28日。町名代表点であり、実DC敷地・供給設備の所在地とは一致しない場合があります。名古屋は都心の参考地点。地点名のリンクから個別カルテを確認できます。 [15]〜[17]')
note('周辺幅：東西・南北約500m間隔の9点の最小〜最大。堺は8点、福岡は6点。全198照会中194有効点で、欠測は0にしていません。地表PGV：50年超過確率10%の最大地動速度（約475年相当）。増幅率は既に反映されているため再乗算しません。6強以上は6弱以上に含まれ、確率を足しません。')

for start,end,subtitle in [(0,11,'電力・用地・通信・GPU運営・計算基盤'),(11,21,'研究・電力調達・支援制度・地震評価・当社の担当領域')]:
    new_page('APPENDIX B  /  SOURCES','出典と確認資料',subtitle)
    note('本文の番号に対応。各資料名は一次資料へのリンクです。公表情報の確認日：2026年9月28日。')
    for i in range(start,end):
        org,title,url,why=SOURCES[i]
        write(f'<b>[{i+1:02d}] {html.escape(org)}</b>　<link href="{html.escape(url,quote=True)}" color="#1767A2">{html.escape(title)}</link>',size=9.2,gap=3)
        write(why,size=8.5,gap=13,color=MUTED)
    if start==11:
        rule()
        note('本書の編集方針：地域の公表資源を、顧客の建設・利用・投資条件へ読み替えて整理しました。AI Orchestrationの見解・進め方案を含みます。既存の「石川県のAIデータセンター立地資源」レポートと関連検討を参照し、顧客向けに再構成しています。')
        note('個別案件の判断では、最新の敷地情報、各事業者の接続回答・見積、専門家による評価を照合します。地震比較の基準年は情報確認日とは異なります。')

assert PAGE==PAGES,(PAGE,PAGES)
C.save()
reader=PdfReader(str(DEST))
assert len(reader.pages)==PAGES
full='\n'.join(p.extract_text() or '' for p in reader.pages)
assert '\ufffd' not in full
for s in ['AI Orchestration','石川県','300MW','438.0GWh','4.38億円','59.2%','2024','限定共有']:
    assert s in full,repr(s)
for i,p in enumerate(reader.pages):
    assert len(p.extract_text() or '')>250,(i,'too little text')
doc=pdfium.PdfDocument(str(DEST))
for i in range(len(doc)):
    page=doc[i]
    image=page.render(scale=1.5).to_pil()
    image.save(TMP/f'page-{i+1:02d}.png')
(TMP/'extracted.txt').write_text(full,encoding='utf-8')
(TMP/'qa.json').write_text(json.dumps({'pages':len(reader.pages),'bytes':DEST.stat().st_size,'links':sum(len(p.get('/Annots',[])) for p in reader.pages),'textCharacters':len(full)},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'pdf':str(DEST),'pages':PAGES,'bytes':DEST.stat().st_size,'renderDir':str(TMP)},ensure_ascii=False))
