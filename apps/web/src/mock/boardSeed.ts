/** Seed board items for the mock workspaces. */
import type { BoardItem } from '../api/types';

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function item(p: Partial<BoardItem> & Pick<BoardItem, 'id' | 'workspaceId' | 'kind' | 'title' | 'status'>): BoardItem {
  return {
    body: '', priority: 'normal', tasks: [], decisions: [], source: { kind: 'manual' }, sessions: [], log: [],
    createdAt: now - 3 * DAY, updatedAt: now - DAY, ...p,
  };
}

export const BOARD_ITEMS: BoardItem[] = [
  // shop-api
  item({
    id: 'F-1', workspaceId: 'ws-shop-api', kind: 'feature', title: '鉴权中间件拆成独立模块', status: 'doing', priority: 'high',
    body: '把散在路由里的鉴权逻辑拆到 src/auth/，对外只暴露 verifyToken 和 requireRole，方便以后给 shop-web 复用。',
    tasks: [
      { id: 't1', text: '拆出 src/auth 模块', done: true },
      { id: 't2', text: '补单元测试', done: true },
      { id: 't3', text: '迁移所有调用方到新接口', done: false },
    ],
    decisions: [{ id: 'd1', text: 'verifyToken 改成异步吗？', outcome: '改成 async，返回 Promise<Claims>' }],
    source: { kind: 'auto', sessionId: 's-auth' }, sessions: ['s-auth'],
    log: [{ ts: now - 40 * 60_000, text: '从对话中记录：拆分完成，测试通过', sessionId: 's-auth', auto: true }],
    createdAt: now - 40 * 60_000, updatedAt: now - 30 * 60_000,
  }),
  item({
    id: 'F-2', workspaceId: 'ws-shop-api', kind: 'feature', title: '订单接口限流', status: 'doing', priority: 'high',
    body: 'POST /orders 按调用方限流，超限返回 429 和 Retry-After。',
    tasks: [{ id: 't1', text: '实现 RateLimiter 中间件', done: true }, { id: 't2', text: '只挂在 POST /orders 上', done: true }, { id: 't3', text: '文档补充 429 说明', done: false }],
    decisions: [
      { id: 'd1', text: '计数器存在哪里？', outcome: 'Redis，多实例共享' },
      { id: 'd2', text: '按什么维度计数？' },
      { id: 'd3', text: '滑动窗口还是令牌桶？' },
    ],
    sessions: ['s-rate', 's-rate-tb', 's-docs'],
    log: [{ ts: now - 2 * HOUR, text: '决定：计数器放在 Redis', sessionId: 's-rate', auto: true }],
    createdAt: now - 3 * HOUR, updatedAt: now - HOUR,
  }),
  item({
    id: 'F-3', workspaceId: 'ws-shop-api', kind: 'feature', title: '发票 PDF 导出', status: 'todo', priority: 'low',
    body: '客户要能下载每月的发票 PDF。还没开始，等计费模块的重构。',
  }),
  item({
    id: 'I-1', workspaceId: 'ws-shop-api', kind: 'issue', title: '结账测试在 CI 上偶发失败', status: 'open', priority: 'high',
    body: 'CI 日志里 cart.timer 超时，本地很难复现，大约每 10 次失败 1 次。',
    source: { kind: 'auto', sessionId: 's-flaky' }, sessions: ['s-flaky'],
    log: [{ ts: now - 25 * 60_000, text: '从对话中记录：CI 日志显示 cart.timer 超时', sessionId: 's-flaky', auto: true }],
    createdAt: now - 25 * 60_000, updatedAt: now - 25 * 60_000, unconfirmed: true,
  }),
  item({
    id: 'I-2', workspaceId: 'ws-shop-api', kind: 'issue', title: '购物车过期时 GET /checkout/:id 偶尔返回 500', status: 'confirmed',
    body: '应该返回 410。日志里是 AlreadyDisposedError。', source: { kind: 'import', ref: 'GitHub #311', url: 'https://github.com/acme/shop-api/issues/311' },
    log: [{ ts: now - 2 * DAY, text: '从 GitHub #311 导入' }],
  }),
  item({
    id: 'I-3', workspaceId: 'ws-shop-api', kind: 'issue', title: '/payments 没有幂等键，客户端重试会重复扣款', status: 'fixing', priority: 'high',
    body: '支付网关超时后客户端会重试，服务端没有按幂等键去重。', sessions: ['s-billing'],
  }),
  item({
    id: 'N-1', workspaceId: 'ws-shop-api', kind: 'note', title: '发布流程', status: 'active',
    body: '合并到 main 后由 CI 打 tag 并发布到 npm 私服。不要在本机发布。预发环境每晚 2 点重置。',
  }),
  item({
    id: 'N-2', workspaceId: 'ws-shop-api', kind: 'note', title: '发票怎么生成', status: 'active',
    body: '每月 1 日 03:00 的定时任务 invoices:monthly 汇总上月订单生成发票，失败会重试 3 次，之后发告警。', sessions: ['s-billing'],
    source: { kind: 'auto', sessionId: 's-billing' },
  }),
  item({
    id: 'N-3', workspaceId: 'ws-shop-api', kind: 'note', title: '限流算法的比较', status: 'outdated',
    body: '令牌桶允许突发，滑动窗口更平滑。已经决定先用滑动窗口，这条留作参考。', sessions: ['s-rate-tb'],
  }),
  // shop-web
  item({ id: 'F-1', workspaceId: 'ws-shop-web', kind: 'feature', title: '结账页改版', status: 'doing', body: '按新的设计稿重做结账页，支持优惠券和分期。', tasks: [{ id: 't1', text: '优惠券输入', done: true }, { id: 't2', text: '分期选项', done: false }] }),
  item({ id: 'I-1', workspaceId: 'ws-shop-web', kind: 'issue', title: 'Safari 下优惠券输入框错位', status: 'open', body: '只在 Safari 17 上出现，宽度小于 400px 时。' }),
  // infra
  item({ id: 'I-1', workspaceId: 'ws-infra', kind: 'issue', title: 'worker-3 的堆每小时增长 40 MB', status: 'confirmed', priority: 'high', sessions: ['s-leak'], body: '重启后恢复，怀疑是任务队列的回调没有释放。' }),
];
