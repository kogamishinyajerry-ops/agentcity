// Entity-extraction tests: the kanban (the AUTHORITATIVE task-state source) and
// subagent attribution. These pin the §6 task-source resolution and §8 subagent
// model that the city's crews + work-orders panel depend on.
import { describe, it, expect } from 'vitest';
import { parseTranscript } from './parse.ts';
import { jsonl, userPrompt, assistant, toolUse, toolResult } from './_testkit.ts';

describe('kanban — TodoWrite path (§6b, content-keyed, deterministic diff)', () => {
  it('creates cards and moves a lane on the next snapshot', () => {
    const text = jsonl(
      userPrompt('plan work'),
      assistant([toolUse('TodoWrite', { todos: [
        { content: 'Add login endpoint', status: 'pending', activeForm: 'Adding login' },
        { content: 'Write auth tests', status: 'in_progress', activeForm: 'Writing tests' },
      ] }, 'td1')], { id: 'm1' }),
      toolResult('td1'),
      assistant([toolUse('TodoWrite', { todos: [
        { content: 'Add login endpoint', status: 'completed', activeForm: 'Adding login' },
        { content: 'Write auth tests', status: 'in_progress', activeForm: 'Writing tests' },
      ] }, 'td2')], { id: 'm2' }),
      toolResult('td2')
    );
    const s = parseTranscript(text, 'main');
    expect(s.meta.taskSource).toBe('todowrite');
    expect(s.kanban.length).toBe(2);
    const login = s.kanban.find((c) => c.subject === 'Add login endpoint');
    const tests = s.kanban.find((c) => c.subject === 'Write auth tests');
    expect(login?.lane).toBe('completed');
    expect(login?.history.map((h) => h.lane)).toEqual(['pending', 'completed']);
    expect(tests?.lane).toBe('in_progress');
    expect(tests?.history.length).toBe(1); // never moved
  });
});

describe('kanban — TaskCreate/TaskUpdate path (§6a, primary, id-keyed)', () => {
  it('TaskCreate makes a pending card; TaskUpdate moves its lane', () => {
    const text = jsonl(
      userPrompt('do task'),
      assistant([toolUse('TaskCreate', { subject: 'Add login endpoint', activeForm: 'Adding login' }, 'tc1')], { id: 'm1' }),
      toolResult('tc1', { toolUseResult: { task: { id: 'T1', subject: 'Add login endpoint' } } }),
      assistant([toolUse('TaskUpdate', { taskId: 'T1' }, 'tu1')], { id: 'm2' }),
      toolResult('tu1', { toolUseResult: { statusChange: { taskId: 'T1', to: 'completed' } } })
    );
    const s = parseTranscript(text, 'main');
    expect(s.meta.taskSource).toBe('task-star');
    const card = s.kanban.find((c) => c.id === 'T1');
    expect(card).toBeDefined();
    expect(card?.lane).toBe('completed');
    expect(card?.history.map((h) => h.lane)).toEqual(['pending', 'completed']);
    expect(card?.truth).toBe('observed'); // Task* is observed, not derived
  });

  it('prefers Task* over TodoWrite when both appear', () => {
    const text = jsonl(
      userPrompt('mixed'),
      assistant([toolUse('TaskCreate', { subject: 'Real task' }, 'tc1')], { id: 'm1' }),
      toolResult('tc1', { toolUseResult: { task: { id: 'T1', subject: 'Real task' } } }),
      assistant([toolUse('TodoWrite', { todos: [{ content: 'todo item', status: 'pending' }] }, 'td1')], { id: 'm2' }),
      toolResult('td1')
    );
    const s = parseTranscript(text, 'main');
    expect(s.meta.taskSource).toBe('task-star');
    expect(s.kanban.every((c) => c.id === 'T1')).toBe(true); // todo cards not used
  });
});

describe('subagents — spawn + result attribution (§8)', () => {
  it('attributes a returning subagent to its own actor with type + tokens', () => {
    const text = jsonl(
      userPrompt('explore'),
      assistant([toolUse('Agent', { description: 'map the routes', subagent_type: 'Explore' }, 'ag1')], { id: 'm1' }),
      toolResult('ag1', {
        toolUseResult: { agentId: 'sub-a', agentType: 'Explore', status: 'completed', toolCount: 2, usage: { output_tokens: 1400, cache_read_input_tokens: 41000 } },
      })
    );
    const s = parseTranscript(text, 'main');
    const sub = s.actors.find((a) => a.id === 'sub-a');
    expect(sub).toBeDefined();
    expect(sub?.kind).toBe('subagent');
    expect(sub?.agentType).toBe('Explore');
    expect(sub?.tokens.cacheRead).toBe(41000);
    // the result event is attributed to the subagent, not main
    const result = s.events.find((e) => e.kind === 'SUBAGENT_RESULT');
    expect(result?.actorId).toBe('sub-a');
    // subagent token rollup IS in totals (byActor sum) but NOT main pressure
    expect(s.signals.byActor['sub-a']?.cacheRead).toBe(41000);
  });
});
