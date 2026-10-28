/** Rule-based hooks: which actions an event allows, how a rule matches an input, and the JSON it returns. */
import type { HookAction, HookRule } from './types';

export const ACTION_INFO: Record<HookAction, { label: string; text: string }> = {
  allow: { label: '允许（不再弹审批）', text: '原因（可选）' },
  deny: { label: '拒绝并说明原因', text: '告诉 Claude 的原因' },
  ask: { label: '一定要问我', text: '显示给你的原因' },
  defer: { label: '延后决定', text: '原因' },
  rewrite: { label: '改写工具输入', text: '新的输入（JSON）' },
  context: { label: '给 Claude 补充上下文', text: '要补充的内容' },
  block: { label: '拦截', text: '原因' },
  title: { label: '设置会话标题', text: '标题' },
  rewriteOutput: { label: '改写工具输出', text: '新的输出' },
  log: { label: '记录到日志文件', text: '日志文件路径' },
  notify: { label: '发送通知', text: '通知内容' },
  webhook: { label: '调用 Webhook', text: 'URL（POST 事件 JSON，响应 JSON 作为钩子输出）' },
};

const TOOL_EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied'];

export function isToolEvent(event: string) {
  return TOOL_EVENTS.includes(event);
}

export function actionsFor(event: string): HookAction[] {
  const side: HookAction[] = ['log', 'notify', 'webhook'];
  switch (event) {
    case 'PreToolUse': return ['deny', 'ask', 'allow', 'defer', 'rewrite', ...side];
    case 'PermissionRequest': return ['allow', 'deny', ...side];
    case 'UserPromptSubmit': return ['context', 'block', 'title', ...side];
    case 'PostToolUse': return ['context', 'rewriteOutput', ...side];
    case 'SessionStart': return ['context', ...side];
    case 'Stop': case 'SubagentStop': return ['block', ...side];
    default: return side;
  }
}

/** Label for an action, with event-specific wording where it differs. */
export function actionLabel(event: string, action: HookAction): string {
  if (action === 'block' && (event === 'Stop' || event === 'SubagentStop')) return '不让它结束，要求继续';
  if (action === 'block' && event === 'UserPromptSubmit') return '拦截这条消息';
  return ACTION_INFO[action].label;
}

export function condFieldsFor(event: string): string[] {
  if (isToolEvent(event)) return ['tool_input.command', 'tool_input.file_path', 'tool_input.url', 'tool_name'];
  if (event === 'UserPromptSubmit') return ['prompt'];
  return [];
}

function glob(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') { re += '.*'; i++; }
    else if (c === '*') re += '.*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

function get(input: Record<string, unknown>, path: string): string {
  const v = path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), input);
  return v === undefined || v === null ? '' : String(v);
}

/** Does the rule fire for this event input? Matchers follow settings files: exact name, A|B, or a regex. */
export function ruleMatches(rule: HookRule, input: Record<string, unknown>): boolean {
  if (!rule.enabled) return false;
  if (rule.matcher && rule.matcher !== '*' && isToolEvent(rule.event)) {
    let re: RegExp;
    try { re = new RegExp(`^(?:${rule.matcher})$`); } catch { return false; }
    if (!re.test(String(input.tool_name ?? ''))) return false;
  }
  if (!rule.cond || !rule.cond.value) return true;
  const v = get(input, rule.cond.field).replace(/\\/g, '/');
  const want = rule.cond.value;
  switch (rule.cond.op) {
    case 'eq': return v === want;
    case 'contains': return v.includes(want);
    case 'regex': try { return new RegExp(want).test(v); } catch { return false; }
    default: return glob(want).test(v) || glob(want).test(v.split('/').slice(-1)[0] ?? '');
  }
}

/** The hook output the rule produces, as the SDK expects it from a hook callback. */
export function hookOutput(rule: HookRule): Record<string, unknown> {
  const hookEventName = rule.event;
  switch (rule.action) {
    case 'allow': case 'deny': case 'ask': case 'defer':
      return { hookSpecificOutput: { hookEventName, permissionDecision: rule.action, ...(rule.text ? { permissionDecisionReason: rule.text } : {}) } };
    case 'rewrite': {
      let updatedInput: unknown = rule.text;
      try { updatedInput = JSON.parse(rule.text); } catch { /* keep text */ }
      return { hookSpecificOutput: { hookEventName, permissionDecision: 'allow', updatedInput } };
    }
    case 'context': return { hookSpecificOutput: { hookEventName, additionalContext: rule.text } };
    case 'block': return { decision: 'block', reason: rule.text };
    case 'title': return { hookSpecificOutput: { hookEventName, sessionTitle: rule.text } };
    case 'rewriteOutput': return { hookSpecificOutput: { hookEventName, updatedToolOutput: rule.text } };
    default: return rule.async ? { async: true } : {};
  }
}

export function sampleInput(event: string): Record<string, unknown> {
  if (event === 'PreToolUse' || event === 'PermissionRequest') return { hook_event_name: event, tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } };
  if (isToolEvent(event)) return { hook_event_name: event, tool_name: 'Edit', tool_input: { file_path: 'src/cart/timer.ts' } };
  if (event === 'UserPromptSubmit') return { hook_event_name: event, prompt: '把限流改成令牌桶' };
  return { hook_event_name: event };
}
