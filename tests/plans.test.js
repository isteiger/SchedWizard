// Run with: node tests/plans.test.js
const assert = require('node:assert');
const api = require('../src/api.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const plansJson = JSON.stringify([
  {
    sequenceNumber: 1, description: 'Wizard - Spring 2027 #1', comment: 'has "quotes" and ] brackets [',
    preferred: true,
    planCourses: [
      { courseReferenceNumber: '20429', subject: 'MATH', courseNumber: '2164', courseTitle: 'Matrices &amp; Linear Algebra', creditHours: 3, sequenceNumber: '001' },
      { courseReferenceNumber: '20500', subject: 'ITSC', courseNumber: '1212', courseTitle: 'Intro to {Computer} Science I', creditHours: null, creditHourLow: 4, properties: { section: '002' } },
    ],
  },
  { sequenceNumber: 2, description: 'Empty plan &amp; more', planCourses: [] },
], null, 2);

const html = `<!DOCTYPE html><html><head><script>
var other = { plans: 'not an array' };
window.bootstraps = { plans:
${plansJson},\r\n selectPlanConfig: { x: [1,2,3] } };
</script></head><body><div>You are allowed a maximum of 5 plans for this term.</div></body></html>`;

test('parsePlansFromHtml extracts plans and courses', () => {
  const plans = api.parsePlansFromHtml(html);
  assert.strictEqual(plans.length, 2);
  assert.strictEqual(plans[0].seq, 1);
  assert.strictEqual(plans[0].name, 'Wizard - Spring 2027 #1');
  assert.strictEqual(plans[0].courses.length, 2);
  assert.deepStrictEqual(plans[0].courses[0], {
    crn: '20429', subject: 'MATH', courseNumber: '2164', courseKey: 'MATH 2164', section: '001',
    title: 'Matrices & Linear Algebra', credits: 3,
  });
  assert.strictEqual(plans[0].courses[1].credits, 4);
  assert.strictEqual(plans[0].courses[1].section, '002');
  assert.strictEqual(plans[0].courses[1].title, 'Intro to {Computer} Science I');
  assert.strictEqual(plans[1].name, 'Empty plan & more');
  assert.deepStrictEqual(plans[1].courses, []);
});

test('parsePlansFromHtml tolerates missing/garbled data', () => {
  assert.deepStrictEqual(api.parsePlansFromHtml(''), []);
  assert.deepStrictEqual(api.parsePlansFromHtml('<html>no plans</html>'), []);
  assert.deepStrictEqual(api.parsePlansFromHtml('plans:\n[ {oops ]'), []);
  assert.deepStrictEqual(api.parsePlansFromHtml('plans:\n[]'), []);
});

test('parseMaxPlans', () => {
  assert.strictEqual(api.parseMaxPlans(html), 5);
  assert.strictEqual(api.parseMaxPlans('You are allowed a maximum of 3 plans for this term.'), 3);
  assert.strictEqual(api.parseMaxPlans('nothing'), 5);
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log('PASS', name); } catch (e) {
    failed++;
    console.log('FAIL', name, '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e));
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
