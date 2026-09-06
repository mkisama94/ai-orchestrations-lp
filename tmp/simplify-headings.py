from pathlib import Path
import re
from lxml import html

changes = {
 'AIオーケストレーションの全体像': '設計・開発の全体像',
 'このような具体的な技術判断の場面でご相談ください': '相談できること',
 '上記のような状況に心当たりはございませんか？': '初回診断で、課題と進め方を整理',
 '最初の判断を、50,000円で明確にする': '初回技術診断',
 '透明な料金体系と、段階的な支援メニュー': 'サービス・料金',
 '有料の技術判断と無料相談の境界について': '料金に含まれる範囲',
 '年次レビューとメンバー更新について': '年次レビュー・会員更新',
 '技術の現場と経営の間をつなぐ、判断体制': '私たちについて',
 '協業パートナーとの柔軟な実行体制': '開発・協業体制',
 'NAVIGATION': 'サイト案内',
 'SERVICES': 'サービス・事例',
 'CONTACT': 'お問い合わせ',
 'プライバシーポリシー（個人情報保護方針）': 'プライバシーポリシー',
 'マーケティングから仕様を決め、現場で予測制御へ進化させる。': '商品企画から予測充放電制御の実装まで',
 'SPAQ COREは、AIから始まったプロダクトではありません。': '開発の背景',
 '「AIで電気代を削減する」から、仕様を考える。': '商品コンセプトと要件定義',
 'AIという言葉に、実際の機能で応える。': '追加した機能と製品構成',
 '工場にPCを持ち込み、その場で分析し、実装する。': '現地調査とAIを活用した開発',
 '需要の変化を先読みし、充電と放電を一体で決める。': '予測充放電の設計',
 '30分の電力量予算から、充放電を決める': '30分の電力量予算に基づく充放電',
 '制御で変化した観測値を補正する': '制御による観測値の変化を補正',
 '予測の要求を、設備の制約内に収める': '設備の制約と安全制御',
 '実装し、動かし、確かめられる仕組みまでつくる。': '実機検証と確認できた成果',
 '工場への展開から、次のエネルギーマネジメントへ。': '導入提案と今後の開発計画',
 '大手上場企業との提携による工場導入提案': '工場への導入提案',
 'AIデータセンター向けマネジメント（産学連携）': 'AIデータセンター向けの開発計画',
 '伝える価値から、動くプロダクトまで。': '商品企画・設計のご相談',
}
used = set()
for path in (Path('public/index.html'), Path('public/spaq-core.html')):
    before = path.read_text(encoding='utf-8')
    count = [0]
    def update(match):
        block = match.group()
        for old, new in changes.items():
            if old in block:
                block = block.replace(old, new)
                used.add(old)
                count[0] += 1
        return block
    after = re.sub(r'<h([1-6])\b[^>]*>.*?</h\1>', update, before, flags=re.S)
    # Validate this edit is confined to heading text, preserving all markup.
    def structure(source):
        return [(e.tag, dict(e.attrib)) for e in html.fromstring(source).iter() if isinstance(e.tag, str)]
    assert structure(before) == structure(after)
    assert re.sub(r'<h([1-6])\b[^>]*>.*?</h\1>', '', before, flags=re.S) == re.sub(r'<h([1-6])\b[^>]*>.*?</h\1>', '', after, flags=re.S)
    path.write_text(after, encoding='utf-8')
    print(f'{path}: {count[0]} headings updated; body and structure unchanged.')
assert used == set(changes), set(changes)-used
