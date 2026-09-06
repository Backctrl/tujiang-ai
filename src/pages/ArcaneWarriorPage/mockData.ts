import type { Fact, Market, QaIssue, Source, StorySection } from './domain'

export const initialSources: Source[] = [
  { id: 'S-01', name: 'X1-DE-产品规格书.pdf', meta: '24 页 · 09:41', status: 'succeeded', facts: 68 },
  { id: 'S-02', name: 'X1-技术参数.csv', meta: '246 行 · 09:42', status: 'succeeded', facts: 97 },
  { id: 'S-03', name: 'X1-用户指南.docx', meta: '58 页 · 09:43', status: 'succeeded', facts: 112 },
]

export const initialFacts: Fact[] = [
  { id: 'F-001', claim: 'X1 支持 Wi-Fi 6 双频并发。', kind: '确认', confidence: 95, evidence: 2, confirmed: true, locked: true, freshness: 'current', severity: 'none', source: 'X1-DE-产品规格书.pdf · P12', excerpt: '基于 802.11ax 技术，支持 2.4GHz 与 5GHz 双频并发。' },
  { id: 'F-002', claim: '最高无线速率可达 3000 Mbps。', kind: '确认', confidence: 88, evidence: 2, confirmed: false, locked: false, freshness: 'current', severity: 'warning', source: 'X1-技术参数.csv · R18', excerpt: '并发无线速率理论值：3000 Mbps。' },
  { id: 'F-003', claim: '是否支持 160MHz 频宽存在冲突。', kind: '冲突', confidence: 52, evidence: 2, confirmed: false, locked: false, freshness: 'current', severity: 'blocker', source: '规格书 P14 / 参数表 R21', excerpt: '规格书标记支持；参数表标记当前固件暂不支持。' },
  { id: 'F-004', claim: '未找到 Mesh 组网节点上限证据。', kind: '缺证据', confidence: null, evidence: 0, confirmed: false, locked: false, freshness: 'current', severity: 'warning', source: '未绑定', excerpt: '当前资料无法支持该断言。' },
  { id: 'F-005', claim: '提供 1 个 2.5G WAN 端口。', kind: '确认', confidence: 90, evidence: 1, confirmed: true, locked: true, freshness: 'current', severity: 'none', source: 'X1-技术参数.csv · R32', excerpt: 'WAN：1 × 2.5GbE。' },
  { id: 'F-006', claim: '支持 WPA3 加密协议。', kind: '确认', confidence: 93, evidence: 1, confirmed: false, locked: false, freshness: 'current', severity: 'none', source: 'X1-用户指南.docx · P36', excerpt: '安全模式支持 WPA2/WPA3。' },
]

export const initialSections: StorySection[] = [
  { id: 'CH-01', title: '品牌开场', purpose: '定位产品与品牌态度', status: 'approved', locked: true, freshness: 'current' },
  { id: 'CH-02', title: '使用场景', purpose: '让用户快速进入真实需求', status: 'approved', locked: true, freshness: 'current' },
  { id: 'CH-03', title: '核心技术优势', purpose: '解释双频并发与稳定连接', status: 'draft', locked: false, freshness: 'current' },
  { id: 'CH-04', title: '参数规格', purpose: '结构化呈现可确认数据', status: 'draft', locked: false, freshness: 'current' },
  { id: 'CH-05', title: '信任证明', purpose: '引用认证、测试与用户反馈', status: 'draft', locked: false, freshness: 'current' },
  { id: 'CH-06', title: '品牌收束', purpose: '总结承诺并引导行动', status: 'draft', locked: false, freshness: 'current' },
]

export const initialMarkets: Market[] = [
  { id: 'DE-AMZ', name: '德国市场', channel: 'Amazon', language: 'DE', status: 'in_review', progress: 84 },
  { id: 'CN-TM', name: '中国市场', channel: 'Tmall', language: 'ZH', status: 'draft', progress: 62 },
  { id: 'JP-RAK', name: '日本市场', channel: 'Rakuten', language: 'JA', status: 'draft', progress: 48 },
]

export const initialQaIssues: QaIssue[] = [
  { id: 'QA-01', category: '事实与证据', title: '160MHz 频宽事实存在冲突', detail: '正式文案引用了尚未确认的产品事实 F-003。', severity: 'blocker', resolved: false, owner: '产品经理', markets: ['DE Amazon', 'CN Tmall'] },
  { id: 'QA-02', category: '图片与版式', title: '首图安全区不足', detail: '移动端裁切后，主标题距顶端仅 8%，规则要求不低于 20%。', severity: 'blocker', resolved: false, owner: '视觉设计', markets: ['DE Amazon', 'JP Rakuten'] },
  { id: 'QA-03', category: '文案与本地化', title: '德语标题超出建议长度', detail: '当前标题为 78 字符，Amazon DE 建议不超过 70 字符。', severity: 'warning', resolved: false, owner: '本地化', markets: ['DE Amazon'] },
  { id: 'QA-04', category: '渠道规则', title: '参数模块顺序需调整', detail: '关键无线规格应位于兼容性说明之前。', severity: 'warning', resolved: false, owner: '运营', markets: ['CN Tmall'] },
]

