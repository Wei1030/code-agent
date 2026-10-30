// Types of scenarios.mjs for shoot.ts.
export const SCENARIOS: Array<{ match: RegExp; steps: unknown[][] }>;
export function structured(schema: unknown, prompt: string, step: number): { blocks?: unknown[]; output?: unknown };
