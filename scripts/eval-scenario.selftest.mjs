#!/usr/bin/env node
// eval-scenario.selftest.mjs — runStep 의 액션/단언 로직을 브라우저 없이 검증(가짜 page)
// + **exit code 계약**(skip 과 pass 의 분리) 검증. 네트워크/Playwright 미사용 — CI self-test 에 포함.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { EXIT_PASS, EXIT_UNVERIFIABLE, runScenarios, runStep } from './eval-scenario.mjs';

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

// ── [4] exit code 계약 — 증거 부재는 통과가 아니다 (2차 자기진단 F15·F16) ─────────────
//
// 예전에는 스펙 없음 / 스펙 깨짐 / 서버 미기동이 전부 `{passed:true}` + exit 0 이었다.
// 그래서 스펙 파일을 만들지 않으면 verify 의 E2E 강제가 아무 것도 검사하지 않고 통과했다(실측).
console.log('[4] exit code 계약 (skip ≠ pass)');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'scenario-exit-'));
try {
	mkdirSync(path.join(tmp, 'harness'), { recursive: true });
	const specPath = path.join(tmp, 'harness', 'eval-scenario.json');
	const outcomePath = (id) => path.join(tmp, 'harness', 'evaluations', id, 'scenario.json');

	// (4-1) 스펙 없음 → 검증 불가(exit 2), 통과 아님
	const noSpec = await runScenarios({ port: 5399, spec: null, id: 'x-nospec', noServer: true }, tmp);
	ok(noSpec.exitCode === EXIT_UNVERIFIABLE, '스펙 없음 → exit 2(검증 불가)');
	ok(noSpec.passed === false, '스펙 없음 → passed=false (예전엔 true 였다)');
	ok(noSpec.unverifiable === 'no-spec', '원인 태그 no-spec');
	ok(existsSync(outcomePath('x-nospec')), '스펙 없음도 산출물을 남긴다(검증했는지 추적 가능)');

	// (4-2) 스펙 JSON 깨짐 → 검증 불가
	writeFileSync(specPath, '{ "scenarios": [ this is not json', 'utf8');
	const badSpec = await runScenarios({ port: 5399, spec: null, id: 'x-badspec', noServer: true }, tmp);
	ok(badSpec.exitCode === EXIT_UNVERIFIABLE, '스펙 파싱 실패 → exit 2');
	ok(badSpec.unverifiable === 'bad-spec', '원인 태그 bad-spec');

	// (4-3) 시나리오 0개 + 사유 없음 → 검증 불가 ("빈 스펙 두기" 우회 차단)
	writeFileSync(specPath, JSON.stringify({ scenarios: [] }), 'utf8');
	const emptySpec = await runScenarios({ port: 5399, spec: null, id: 'x-empty', noServer: true }, tmp);
	ok(emptySpec.exitCode === EXIT_UNVERIFIABLE, '시나리오 0개 + 사유 없음 → exit 2');
	ok(emptySpec.unverifiable === 'empty-spec', '원인 태그 empty-spec');

	// (4-4) 명시적 면제(skipReason) → 통과(exit 0) + 사유 기록
	writeFileSync(specPath, JSON.stringify({ scenarios: [], skipReason: '순수 타입 리팩터 step' }), 'utf8');
	const exempt = await runScenarios({ port: 5399, spec: null, id: 'x-exempt', noServer: true }, tmp);
	ok(exempt.exitCode === EXIT_PASS, '명시적 면제 → exit 0');
	ok(exempt.exempt === true && exempt.reason === '순수 타입 리팩터 step', '면제 사유가 산출물에 기록됨');
	ok(JSON.parse(readFileSync(outcomePath('x-exempt'), 'utf8')).exempt === true, '면제 산출물 파일 확인');

	// (4-5) 시나리오는 있는데 dev 서버가 뜨지 않음 → 검증 불가(앱이 아예 안 뜨는 게 통과이던 역전 교정)
	writeFileSync(specPath, JSON.stringify({ scenarios: [{ name: 's', steps: [{ assert: 'textVisible', text: 'x' }] }] }), 'utf8');
	const noServer = await runScenarios({ port: 5399, spec: null, id: 'x-noserver', noServer: true }, tmp);
	ok(noServer.exitCode === EXIT_UNVERIFIABLE, 'dev 서버 미기동 → exit 2');
	ok(noServer.unverifiable === 'server-not-ready', '원인 태그 server-not-ready');
} finally {
	try {
		rmSync(tmp, { recursive: true, force: true });
	} catch {
		/* 정리 실패 무시 */
	}
}

console.log(`\nEVAL-SCENARIO SELFTEST: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
process.exit(fail ? 1 : 0);
