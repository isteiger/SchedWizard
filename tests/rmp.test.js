// Run with: node tests/rmp.test.js
const assert = require('node:assert');
const { rmpMatches, rmpNorm } = require('../background.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const node = (firstName, lastName) => ({ firstName, lastName });

test('rmpNorm strips accents, hyphens, punctuation', () => {
  assert.strictEqual(rmpNorm("  José O'Neil-Smith "), 'jose oneil smith');
});

test('exact, prefix-first-name and swapped matches', () => {
  assert.ok(rmpMatches('David Naylor', node('David', 'Naylor')));
  assert.ok(rmpMatches('Dave Naylor', node('David', 'Naylor')));
  assert.ok(rmpMatches('Naylor David', node('David', 'Naylor')));
});

test('substring last names no longer match: Xingjie Li vs Xin Liu', () => {
  assert.strictEqual(rmpMatches('Xingjie Li', node('Xin', 'Liu')), false);
  assert.strictEqual(rmpMatches('Xin Li', node('Xin', 'Liu')), false);
});

test('compound / hyphenated surnames match on whole token', () => {
  assert.ok(rmpMatches('Maria Garcia', node('Maria', 'Garcia-Lopez')));
  assert.ok(rmpMatches('Maria Lopez', node('Maria', 'Garcia Lopez')));
  assert.strictEqual(rmpMatches('Maria Gar', node('Maria', 'Garcia-Lopez')), false);
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
