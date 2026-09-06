from pathlib import Path
from lxml import html

p = Path('public/index.html')
before = p.read_text(encoding='utf-8')
start = before.index('        <!-- Case 1: SPAQ CORE -->')
end = before.index('        <!-- Case 2: 補助金AIプラグイン -->', start)
block = before[start:end]
replacements = {
 'エネルギーマネジメント・制御クラウド': '産業用蓄電池・エネルギーマネジメント',
 '制御設計・開発統括</span>': '予測制御を実装・実機動作を確認</span>',
 'SPAQ CORE クラウド</h3>': 'SPAQ CORE</h3>',
 '蓄電池や電力設備をまとめて管理・制御し、施設の電力コスト最適化を支援するクラウド': '事業構想から、予測充放電制御の設計・実装、実設備での検証まで。',
 '施設の電力コストを最適化するには、蓄電池や電力設備の状況を把握し、運用に応じて管理・制御できる仕組みが必要です。': '工場の電力需要が目標を超えないよう、必要な時点で蓄電池を放電し、次の需要増に備えて充電する。充電自体も受電電力を増やすため、放電と充電を一体で設計する必要がありました。',
 '設備ごとの仕様や運用条件を踏まえ、どの情報を集め、どこで制御を行うかを整理する必要があります。通信や障害時の扱いも、設計上の確認事項です。': '蓄電池や空調の動作によって、観測される電力需要も変わります。予測の不確実性、設備の出力上限、残容量に加え、既存装置との制御権限や障害時の動作を整理しました。',
 '設備とクラウドをつなぐ制御設計を担当。': '30分の電力量予算と需要予測から、放電量と充電余力を判断。',
 'AI Orchestrationは、SPAQ COREの制御設計と開発統括に携わっています。設備の管理・制御を実現するため、要件とシステム構成を整理し、開発を支援します。': '制御で変化した観測値を補正し、設備の制約内で充放電を行うロジックを設計・実装。商品コンセプトと要件の整理から、設備接続、現地検証、障害分析、運用設計まで担当しました。',
 'ARCHITECTURE OVERVIEW': 'CONTROL OVERVIEW',
 'SERVICE CONCEPT': '制御概念図',
 '>蓄電池・電力設備<': '>蓄電池・EMS<',
 '>設備の管理・制御<': '>計測・充放電指令<',
 '設備とクラウドの関係を示す概念図': '制御権限・障害時の動作を整理',
 'SPAQ CORE CLOUD': 'SPAQ CORE',
 '設備データの管理': '需要予測・電力量予算',
 '>制御機能<': '>制約内で充放電を判断<',
 '電力コスト最適化を支援': '判断根拠の記録・予測性能の評価',
 '制御アーキテクチャ設計': '事業・商品設計／要件定義',
 '開発統括（PM / Tech Lead）': '制御設計・実装／設備連携',
 '販売戦略': '実機検証・障害分析／運用設計',
 '<strong>当社の関与：</strong>SPAQ株式会社が提供する、蓄電池・電力設備の管理・制御クラウドの設計と開発統括。': '<strong>成果と現在地：</strong>実設備で自動放電指令の書き込みと充放電動作を確認。予測制御・精度評価機能を実装しました。長期的なピーク低減量・料金削減額は、今後の評価対象です。',
}
for old, new in replacements.items():
    assert block.count(old) == 1, (old, block.count(old))
    block = block.replace(old, new)
after = before[:start] + block + before[end:]
def signature(source):
    return [(e.tag, dict(e.attrib)) for e in html.fromstring(source).iter() if isinstance(e.tag, str)]
assert signature(before) == signature(after), 'Structure changed'
assert after[:start] == before[:start]
assert after[after.index('        <!-- Case 2: 補助金AIプラグイン -->'):] == before[end:]
p.write_text(after, encoding='utf-8')
print('PASS: SPAQ summary updated; DOM, attributes, diagram geometry and all other sections unchanged.')
