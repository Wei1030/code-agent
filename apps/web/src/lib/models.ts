/** The model list the server offers (the Claude models and every compatible endpoint's) and its pickers' options. */
import type { Effort, ModelInfo } from '../api/types';
import { useApp } from '../store/app';
import { EFFORT_LABEL } from './catalog';

type T = (s: string, vars?: Record<string, string | number>) => string;

export const useModels = () => useApp((s) => s.models);

export const modelOptions = (models: ModelInfo[], t: T) => models.map((m) => ({ value: m.id, label: m.label, desc: t(m.desc) }));

/** The effort to keep after switching to model `id`: the current one if it takes it, else `pick` of its own. */
export function effortFor(models: ModelInfo[], id: string, effort: Effort, pick: 'lowest' | 'highest' = 'highest'): Effort {
  const ef = models.find((m) => m.id === id)?.efforts ?? [];
  if (!ef.length || ef.includes(effort)) return effort;
  return pick === 'lowest' ? ef[0] : ef[ef.length - 1];
}

/** A model that takes no effort (an endpoint model without it) shows one fixed, disabled entry. */
export function effortOptions(model: ModelInfo | undefined, effort: Effort, t: T) {
  const ef = model?.efforts ?? [];
  return ef.length ? ef.map((e) => ({ value: e, label: t(EFFORT_LABEL[e]) })) : [{ value: effort, label: t('不发送') }];
}

export const takesEffort = (model: ModelInfo | undefined) => !!model?.efforts.length;
