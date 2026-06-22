#!/usr/bin/env node
// eval-scenario.selftest.mjs — runStep 의 액션/단언 로직을 브라우저 없이 검증(가짜 page).
// 네트워크/Playwright 미사용 — CI self-test 에 포함.
import { runStep } from './eval-scenario.mjs';

function fakeLocator({ inputValue = '', count = 0, checked = false } = {}) {
	const loc = {
		first: () => loc,
		fill: async () => {},
		click: async () => {},
		inputValue: async () => inputValue,
		count: async () => count,
		isChecked: async () => checked,
	};
	return loc;
}
function fakePage(map = {}) {
	return {
		getByLabel: (label) => fakeLocator(map.byLabel?.[label] ?? {}),
		getByText: (text) => fakeLocator({ count: map.byText?.[text] ?? 0 }),
		getByRole: (role, opts) => fakeLocator(role === 'checkbox' ? (map.byCheckbox?.[opts?.name] ?? {}) : {}),
		locator: (sel) => fakeLocator({ count: map.bySelector?.[sel] ?? 0 }),
		waitForTimeout: async () => {},
	};
}

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
	if (cond) { pass++; console.log('  ✓', msg); }
	else { fail++; console.log('  ✗', msg); }
};

console.log('[1] 단언 로직');
ok((await runStep(fakePage({ byLabel: { 제목: { inputValue: '' } } }), { assert: 'inputEmpty', label: '제목' })).ok === true, 'inputEmpty 빈값 → ok');
ok((await runStep(fakePage({ byLabel: { 제목: { inputValue: '클린 코드' } } }), { assert: 'inputEmpty', label: '제목' })).ok === false, 'inputEmpty 값 있음 → FAIL(폼 미초기화 버그 적발)');
ok((await runStep(fakePage({ byLabel: { 제목: { inputValue: 'A' } } }), { assert: 'inputValue', label: '제목', value: 'A' })).ok === true, 'inputValue 일치 → ok');
ok((await runStep(fakePage({ byText: { '클린 코드': 1 } }), { assert: 'textVisible', text: '클린 코드' })).ok === true, 'textVisible 보임 → ok');
ok((await runStep(fakePage({ byText: {} }), { assert: 'textVisible', text: '없음' })).ok === false, 'textVisible 없음 → FAIL');
ok((await runStep(fakePage({ byText: {} }), { assert: 'textGone', text: '없음' })).ok === true, 'textGone 없음 → ok');
ok((await runStep(fakePage({ bySelector: { '.card': 2 } }), { assert: 'minCount', selector: '.card', expect: 2 })).ok === true, 'minCount 충족 → ok');
ok((await runStep(fakePage({ bySelector: { '.card': 1 } }), { assert: 'minCount', selector: '.card', expect: 2 })).ok === false, 'minCount 미달 → FAIL');

console.log('[2] 액션 / 알 수 없는 step');
ok((await runStep(fakePage({ byLabel: { 제목: {} } }), { fill: { label: '제목', value: 'x' } })).ok === true, 'fill → ok');
ok((await runStep(fakePage(), { click: { text: '추가' } })).ok === true, 'click → ok');
ok((await runStep(fakePage(), { clickText: { text: '완료' } })).ok === true, 'clickText → ok');
ok((await runStep(fakePage(), { assert: 'nope' })).ok === false, '알 수 없는 단언 → FAIL');
ok((await runStep(fakePage(), { wat: 1 })).ok === false, '알 수 없는 step → FAIL');

console.log('[3] 체크박스 액션/단언');
ok((await runStep(fakePage({ byCheckbox: { '물 마시기': { checked: false } } }), { check: { name: '물 마시기' } })).ok === true, 'check → ok');
ok((await runStep(fakePage({ byCheckbox: { '물 마시기': { checked: true } } }), { assert: 'checked', name: '물 마시기' })).ok === true, 'assert.checked 체크됨 → ok');
ok((await runStep(fakePage({ byCheckbox: { '물 마시기': { checked: false } } }), { assert: 'checked', name: '물 마시기' })).ok === false, 'assert.checked 미체크 → FAIL(토글 미동작 적발)');
ok((await runStep(fakePage({ byCheckbox: { '물 마시기': { checked: false } } }), { assert: 'unchecked', name: '물 마시기' })).ok === true, 'assert.unchecked 미체크 → ok');

console.log(`\nEVAL-SCENARIO SELFTEST: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
process.exit(fail ? 1 : 0);
