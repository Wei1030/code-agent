/** Seed jobs, their past runs and the structured results the mock returns. */
import type { JobRun, JobSchedule, JobTemplate } from '../api/types';

const now = Date.now();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const manual: JobSchedule = { kind: 'manual', time: '09:00', weekdays: [1, 2, 3, 4, 5], everyHours: 6, cron: '0 9 * * 1-5', enabled: true, vars: {}, missed: 'runOnce' };

const ENDPOINTS_SCHEMA = `{
  "type": "object",
  "required": ["endpoints"],
  "properties": {
    "endpoints": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["method", "path"],
        "properties": {
          "method": { "enum": ["GET", "POST", "PUT", "DELETE"] },
          "path": { "type": "string" },
          "auth": { "type": "boolean" }
        }
      }
    }
  }
}`;

const AUDIT_SCHEMA = `{
  "type": "object",
  "required": ["packages"],
  "properties": {
    "packages": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "current", "severity"],
        "properties": {
          "name": { "type": "string" },
          "current": { "type": "string" },
          "latest": { "type": "string" },
          "severity": { "enum": ["low", "moderate", "high", "critical"] },
          "advice": { "type": "string" }
        }
      }
    }
  }
}`;

const NOTES_SCHEMA = `{
  "type": "object",
  "required": ["notes"],
  "properties": {
    "notes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["file", "summary"],
        "properties": { "file": { "type": "string" }, "summary": { "type": "string" } }
      }
    }
  }
}`;

const TRIAGE_SCHEMA = `{
  "type": "object",
  "required": ["type", "priority", "labels"],
  "properties": {
    "type": { "enum": ["bug", "feature", "question"] },
    "priority": { "enum": ["P0", "P1", "P2", "P3"] },
    "labels": { "type": "array", "items": { "type": "string" } }
  }
}`;

export const JOBS: JobTemplate[] = [
  {
    id: 'job-endpoints', name: '提取 API 接口', workspaceId: 'ws-shop-api', model: 'sonnet', effort: 'max', mode: 'dontAsk',
    prompt: '列出 {{dir}} 下定义的所有 HTTP 接口，包括方法、路径以及是否需要鉴权。', schema: ENDPOINTS_SCHEMA,
    schedule: { ...manual, vars: { dir: 'src/routes' } }, notify: 'failure',
  },
  {
    id: 'job-audit', name: '依赖审计', workspaceId: 'ws-shop-api', model: 'opus', effort: 'max', mode: 'dontAsk',
    prompt: '检查 package.json 里的依赖，列出有已知漏洞或落后两个大版本以上的包，并给出升级建议。', schema: AUDIT_SCHEMA,
    schedule: { ...manual, kind: 'weekly', time: '09:00', weekdays: [1], enabled: true }, notify: 'always', missedRuns: 1,
  },
  {
    id: 'job-notes', name: '每日笔记摘要', workspaceId: 'ws-notes', model: 'haiku', effort: 'high', mode: 'dontAsk',
    prompt: '汇总 {{date}} 修改过的笔记，每篇用一句话概括。', schema: NOTES_SCHEMA,
    schedule: { ...manual, kind: 'daily', time: '21:00', enabled: true }, notify: 'never',
  },
  {
    id: 'job-triage', name: '分拣新 Issue', workspaceId: 'ws-shop-web', model: 'sonnet', effort: 'max', mode: 'dontAsk',
    prompt: '读取 Issue {{issue}} 的内容，判断它的类型和优先级，并给出标签。', schema: TRIAGE_SCHEMA,
    schedule: { ...manual, kind: 'cron', cron: '0 */2 * * 1-5', enabled: false, vars: { issue: '最新一条' } }, notify: 'failure',
  },
];

export const JOB_OUTPUTS: Record<string, unknown> = {
  'job-endpoints': { endpoints: [
    { method: 'GET', path: '/orders', auth: true },
    { method: 'POST', path: '/orders', auth: true },
    { method: 'GET', path: '/orders/:id', auth: true },
    { method: 'POST', path: '/payments', auth: true },
    { method: 'GET', path: '/health', auth: false },
  ] },
  'job-audit': { packages: [
    { name: 'express', current: '4.18.2', latest: '5.1.0', severity: 'moderate', advice: '升级到 5.x，注意 req.query 解析行为的变化' },
    { name: 'jsonwebtoken', current: '8.5.1', latest: '9.0.2', severity: 'high', advice: '8.x 有签名校验绕过问题，尽快升级' },
    { name: 'lodash', current: '4.17.20', latest: '4.17.21', severity: 'high', advice: '原型污染漏洞，补丁版本即可修复' },
  ] },
  'job-notes': { notes: [
    { file: '工作/周会.md', summary: '定了下周发布 3.2，限流方案改用令牌桶。' },
    { file: '读书/重构.md', summary: '摘录了「以查询取代临时变量」的两个例子。' },
  ] },
};

export const JOB_RUNS: JobRun[] = [
  { id: 'run-1', jobId: 'job-endpoints', trigger: 'manual', startedAt: now - 12 * MIN, endedAt: now - 11 * MIN, vars: { dir: 'src/routes' }, status: 'success', output: JOB_OUTPUTS['job-endpoints'], turns: 14, tokens: 86_000 },
  { id: 'run-2', jobId: 'job-endpoints', trigger: 'manual', startedAt: now - DAY - 3 * 60 * MIN, endedAt: now - DAY - 3 * 60 * MIN + 2 * MIN, vars: { dir: 'src/' }, status: 'invalid', error: '重试 3 次后仍没有符合结构的输出（error_max_structured_output_retries）', turns: 22, tokens: 210_000 },
  { id: 'run-3', jobId: 'job-audit', trigger: 'schedule', startedAt: now - 8 * DAY, endedAt: now - 8 * DAY + 3 * MIN, vars: {}, status: 'success', output: JOB_OUTPUTS['job-audit'], turns: 18, tokens: 240_000 },
  { id: 'run-4', jobId: 'job-notes', trigger: 'schedule', startedAt: now - DAY + 30 * MIN, endedAt: now - DAY + 31 * MIN, vars: {}, status: 'success', output: JOB_OUTPUTS['job-notes'], turns: 6, tokens: 21_000 },
  { id: 'run-5', jobId: 'job-triage', trigger: 'manual', startedAt: now - 3 * DAY, endedAt: now - 3 * DAY + MIN, vars: { issue: '#311' }, status: 'invalid', error: '重试 3 次后仍没有符合结构的输出（error_max_structured_output_retries）', turns: 9, tokens: 54_000 },
];

export const NEW_JOB_SCHEMA = `{
  "type": "object",
  "required": ["summary"],
  "properties": {
    "summary": { "type": "string" }
  }
}`;
