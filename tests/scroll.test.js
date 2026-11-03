import test from 'node:test';
import assert from 'node:assert/strict';
import { getContentScale, getScrollState } from '../src/scroll.js';

test('the hero begins full size and the scroll stages stay in order', () => {
  assert.deepEqual(getScrollState(0), {
    progress: 0, centering: 0, retreat: 0, framing: 0, onScreen: true,
  });
  const centered = getScrollState(0.38);
  assert.equal(centered.centering, 1);
  assert.equal(centered.retreat, 0);
  assert.equal(centered.framing, 0);

  assert.equal(getScrollState(0.72).retreat, 2.8);
  assert.equal(getScrollState(0.72).framing, 0);
  assert.equal(getScrollState(1).framing, 1);
});

test('hero content scales down only during the camera retreat', () => {
  const at = (progress) => getContentScale(getScrollState(progress).retreat);
  assert.equal(at(0), 1);
  assert.equal(at(0.4), 1);
  assert.ok(at(0.56) < 1);
  assert.ok(at(0.72) < at(0.56));
  assert.ok(at(0.72) > 0.8);
  assert.equal(at(1), at(0.72));
});

test('camera retreat and framing are bounded, continuous and reversible', () => {
  assert.deepEqual(getScrollState(-10), getScrollState(0));
  assert.deepEqual(getScrollState(10), getScrollState(1));
  const samples = Array.from({ length: 1001 }, (_, index) => getScrollState(index / 1000));
  for (let index = 1; index < samples.length; index++) {
    for (const property of ['centering', 'retreat', 'framing']) {
      assert.ok(samples[index][property] >= samples[index - 1][property]);
      assert.ok(samples[index][property] - samples[index - 1][property] < 0.02);
    }
  }
  for (let index = samples.length - 1; index >= 0; index--) {
    assert.deepEqual(getScrollState(index / 1000), samples[index]);
  }
});

