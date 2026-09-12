import { describe, expect, it } from 'vitest';
import { AutoScanMachine } from './autoScanMachine';
import { scannerConfig as config } from '../config/scanner';
import type { Detection } from '../types/scanner';
const page = (): Detection => ({
  corners: [
    { x: 0.2, y: 0.1 },
    { x: 0.8, y: 0.1 },
    { x: 0.8, y: 0.9 },
    { x: 0.2, y: 0.9 },
  ],
  aligned: true,
  alignment: 1,
  sharpness: 100,
  brightness: 190,
  signature: [0.1, -0.1, 0.2, -0.2],
});
function stabilize(machine: AutoScanMachine, start = 0) {
  for (let t = start; t <= start + 1000; t += 170)
    if (machine.sample(page(), t)) return true;
  return false;
}
describe('automatic scanner state machine', () => {
  it('requires actual stable geometry for the configured duration', () => {
    const machine = new AutoScanMachine();
    expect(machine.sample({ ...page(), corners: null }, 0)).toBe(false);
    expect(machine.state).toBe('searching');
    machine.sample({ ...page(), aligned: false }, 170);
    expect(machine.state).toBe('detected');
    expect(stabilize(machine, 340)).toBe(true);
    expect(machine.state).toBe('capturing');
  });
  it('moving corners, content movement, blur, and darkness prevent captures', () => {
    const machine = new AutoScanMachine();
    for (let t = 0; t < 4000; t += 170) {
      const d = page();
      d.corners = d.corners!.map((p) => ({
        ...p,
        x: p.x + (t % 340 === 0 ? 0.06 : 0),
      })) as Detection['corners'];
      expect(machine.sample(d, t)).toBe(false);
    }
    for (let t = 4000; t < 5500; t += 170)
      expect(machine.sample({ ...page(), sharpness: 0 }, t)).toBe(false);
    expect(machine.message).toContain('blurry');
    machine.sample({ ...page(), brightness: 10 }, 6000);
    expect(machine.message).toContain('light');
  });
  it('locks a captured page until consecutive meaningful visual changes, then stabilizes again', () => {
    const machine = new AutoScanMachine();
    machine.accepted(page().signature, 0, 'Captured');
    for (let t = 0; t < 4000; t += 170)
      expect(machine.sample(page(), t)).toBe(false);
    expect(machine.state).toBe('waitingForPageChange');
    const changed = { ...page(), signature: [-0.3, 0.3, -0.3, 0.3] };
    machine.sample(changed, 4100);
    machine.sample(page(), 4270);
    expect(machine.state).toBe('waitingForPageChange');
    machine.sample(changed, 4440);
    machine.sample(changed, 4610);
    expect(machine.state).toBe('stabilizing');
    let capture = false;
    for (let t = 4780; t < 5800; t += 170)
      capture = machine.sample(changed, t) || capture;
    expect(capture).toBe(true);
  });
  it('preserves the lock across pause/backpressure and Done cannot rearm', () => {
    const machine = new AutoScanMachine();
    machine.accepted(page().signature, 0, 'Captured');
    machine.sample(page(), 1000, true);
    expect(machine.state).toBe('paused');
    expect(machine.sample(page(), 1200, false)).toBe(false);
    expect(machine.state).toBe('waitingForPageChange');
    machine.finish();
    expect(stabilize(machine, 2000)).toBe(false);
    expect(machine.state).toBe('finishing');
  });
  it('resets stability after a missing sample gap and re-locks rejected duplicates', () => {
    const machine = new AutoScanMachine();
    machine.sample(page(), 0);
    machine.sample(page(), 170);
    expect(machine.sample(page(), 170 + config.maxSampleGapMs + 1)).toBe(false);
    machine.duplicate(page().signature);
    expect(stabilize(machine, 2000)).toBe(false);
    expect(machine.state).toBe('duplicate');
  });
});

it.each([false, true])(
  'remembers a fast page turn during the flash (queue blocked: %s)',
  (blocked) => {
    const machine = new AutoScanMachine();
    machine.accepted(page().signature, 0, 'Captured');
    const turning = {
      ...page(),
      corners: null,
      signature: [-0.3, 0.3, -0.3, 0.3],
    };
    machine.sample(turning, 170, blocked);
    machine.sample(turning, 340, blocked);
    expect(machine.state).toBe('captured');
    // A new page with a similar layout returns the same coarse guide signature.
    // The observed turn must still permit a new stability window.
    machine.sample(page(), 510, blocked);
    if (blocked) expect(machine.state).toBe('paused');
    expect(stabilize(machine, 680)).toBe(true);
  },
);

it('ignores camera motion when normalized page content is unchanged', () => {
  const machine = new AutoScanMachine();
  const content = {
    gray: [0.1, -0.1],
    edges: [0.2, 0.1],
    hash: '0123456789abcdef',
    density: [0.2, 0.1],
  };
  machine.accepted(page().signature, 0, 'Captured', content);
  for (let t = 170; t < 3000; t += 170)
    expect(
      machine.sample({ ...page(), signature: [-0.4, 0.4], content }, t),
    ).toBe(false);
  expect(machine.state).toBe('waitingForPageChange');
  const changed = { ...content, gray: [-0.2, 0.2], edges: [0.1, 0.3] };
  machine.sample({ ...page(), content: changed }, 3100);
  machine.sample({ ...page(), content: changed }, 3270);
  expect(machine.state).toBe('stabilizing');
});
it('text body motion resets stability; absent body never blocks a sparse page', () => {
  const machine = new AutoScanMachine();
  for (let t = 0; t < 3000; t += 170) {
    const textBody = page().corners!.map((p) => ({
      ...p,
      x: p.x + (t % 340 === 0 ? config.textBodyMovement * 2 : 0),
    })) as Detection['corners'];
    expect(machine.sample({ ...page(), source: 'text', textBody }, t)).toBe(
      false,
    );
  }
  expect(stabilize(new AutoScanMachine())).toBe(true);
});
it('expires feedback without another camera frame and throttles duplicate notifications', () => {
  const machine = new AutoScanMachine();
  machine.accepted(page().signature, 0, 'Captured');
  machine.endFlash(config.flashMs + 1);
  expect(machine.state).toBe('waitingForPageChange');
  machine.duplicate(page().signature, 1000);
  machine.duplicate(page().signature, 1100);
  expect(machine.duplicateNotifications).toBe(1);
  machine.duplicate(page().signature, 1000 + config.duplicateMessageCooldownMs);
  expect(machine.duplicateNotifications).toBe(2);
  expect(machine.state).toBe('duplicate');
});

it('captures stable text without a page boundary and requires two samples on a slow phone', () => {
  const machine = new AutoScanMachine();
  const d: Detection = {
    ...page(),
    source: 'text',
    corners: null,
    textBody: page().corners,
  };
  expect(machine.sample(d, 0)).toBe(false);
  expect(machine.sample(d, 850)).toBe(true);
});
it('uses normalized content for stability rather than resetting for small camera translation', () => {
  const machine = new AutoScanMachine();
  const content = {
    gray: [0.1, -0.1],
    edges: [0.2, 0.1],
    hash: '0123456789abcdef',
    density: [0.2, 0.1],
  };
  let captured = false;
  for (let t = 0; t < 1100; t += 170)
    captured =
      machine.sample(
        {
          ...page(),
          content,
          signature: t % 340 === 0 ? [0.2, -0.2] : [-0.2, 0.2],
        },
        t,
      ) || captured;
  expect(captured).toBe(true);
});
it('does not interpret switching from page-edge to text detection as a page turn', () => {
  const machine = new AutoScanMachine();
  const content = {
    gray: [0.1, -0.1],
    edges: [0.2, 0.1],
    hash: '0123456789abcdef',
    density: [0.2, 0.1],
  };
  machine.accepted(page().signature, 0, 'Captured', content, 'page');
  for (let t = 170; t < 3000; t += 170)
    expect(
      machine.sample(
        {
          ...page(),
          source: 'text',
          corners: null,
          textBody: page().corners,
          content: { ...content, gray: [-0.4, 0.4], hash: 'ffffffffffffffff' },
        },
        t,
      ),
    ).toBe(false);
  expect(machine.state).toBe('waitingForPageChange');
});

it('waits for text focus and lighting, then captures without any page boundary', () => {
  const machine = new AutoScanMachine();
  const d: Detection = {
    ...page(),
    source: 'text',
    corners: null,
    textBody: page().corners,
    hint: 'textRequired',
  };
  machine.sample({ ...d, brightness: 40 }, 0);
  expect(machine.message).toContain('light');
  machine.sample({ ...d, sharpness: 2 }, 170);
  expect(machine.message).toContain('blurry');
  machine.sample({ ...d, aligned: false }, 340);
  expect(machine.message).toContain('printed text');
  let captured = false;
  for (let t = 510; t < 1300; t += 170)
    captured = machine.sample(d, t) || captured;
  expect(captured).toBe(true);
});

it('does not capture sharp text oscillating inside the overall position tolerance', () => {
  const machine = new AutoScanMachine();
  for (let i = 0; i < 15; i++) {
    const offset = i === 0 ? 0 : i % 2 === 0 ? -0.01 : 0.025;
    const textBody = page().corners!.map((p) => ({
      ...p,
      x: p.x + offset,
    })) as Detection['corners'];
    expect(
      machine.sample(
        { ...page(), source: 'text', corners: null, textBody },
        i * 170,
      ),
    ).toBe(false);
  }
});

it('resets the consecutive window on motion even with apparently perfect corners', () => {
  const machine = new AutoScanMachine();
  expect(machine.sample(page(), 0)).toBe(false);
  expect(machine.sample(page(), 170)).toBe(false);
  expect(machine.sample({ ...page(), gate: 'motion' }, 340)).toBe(false);
  expect(machine.stableSamples).toBe(0);
  expect(machine.sample(page(), 510)).toBe(false);
  expect(machine.sample(page(), 680)).toBe(false);
  expect(machine.sample(page(), 850)).toBe(true);
  expect(machine.sample(page(), 1020)).toBe(false);
  expect(machine.sample(page(), 1190)).toBe(false);
});

it('accepts a shorter steady hold with mild position drift', () => {
  const machine = new AutoScanMachine();
  expect(machine.sample(page(), 0)).toBe(false);
  const shifted = {
    ...page(),
    corners: page().corners!.map((p) => ({
      ...p,
      x: p.x + 0.03,
    })) as Detection['corners'],
  };
  expect(machine.sample(shifted, 170)).toBe(false);
  expect(machine.sample(shifted, 340)).toBe(true);
});
