import { describe, it, expect, beforeEach } from 'vitest';
import { NodeValueComputer } from '../src/core/preview/NodeValueComputer.js';

// Count and Hold keep state across frames that no shader — and no pure function of the node's
// inputs/params — can reproduce: CountNodeProcessor and HoldNodeProcessor advance them on the CPU
// every frame and stash the result on the node. NodeValueComputer had no case for either, so both
// fell through to `default: 0`. That is the computer the Fragment Texture renderer and the Field
// Mapper use to resolve `=node_<id>` references, so those references read a constant 0 regardless
// of what the node was counting or holding.

function makeComputer() {
  return new NodeValueComputer({ graph: { nodes: [], connections: [] } });
}

describe('NodeValueComputer stateful input nodes', () => {
  let computer;
  beforeEach(() => {
    computer = makeComputer();
  });

  it('reads the Count node running counter advanced by CountNodeProcessor', () => {
    const node = { id: '12', kind: 'Count', params: {}, inputs: [], __countValue: 4 };

    expect(computer.computeNodeValue(node)).toBe(4);
  });

  it('tracks the counter as it advances instead of caching the first value', () => {
    const node = { id: '12', kind: 'Count', params: {}, inputs: [], __countValue: 0 };

    expect(computer.computeNodeValue(node)).toBe(0);
    node.__countValue = 3;
    expect(computer.computeNodeValue(node)).toBe(3);
  });

  it('falls back to 0 before the processor has run', () => {
    const node = { id: '12', kind: 'Count', params: {}, inputs: [] };

    expect(computer.computeNodeValue(node)).toBe(0);
  });

  it('reads the Hold node latched value, and tracks it as it changes', () => {
    const node = { id: '9', kind: 'Hold', params: {}, inputs: [], __holdValue: 0.75 };

    expect(computer.computeNodeValue(node)).toBe(0.75);
    node.__holdValue = 0.25;
    expect(computer.computeNodeValue(node)).toBe(0.25);
  });
});
