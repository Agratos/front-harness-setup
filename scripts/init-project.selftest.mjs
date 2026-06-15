#!/usr/bin/env node
// init-project.selftest.mjs — init-project 의 순수 로직(Notion page id 추출) 자가검증.
//
// 실행: node scripts/init-project.selftest.mjs
// 네트워크 확인(git ls-remote / Notion REST)은 환경 의존이라 테스트하지 않고,
// URL → page id 추출/정규화 같은 결정적 로직만 검증합니다.
// 성공 시 'INIT-PROJECT SELFTEST: PASS' + exit 0.
import { extractNotionPageId, toDashedId } from './init-project.mjs';

const failures = [];
function check(label, cond) {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		console.log(`  ✗ ${label}`);
		failures.push(label);
	}
}

console.log('=== init-project selftest (Notion page id 추출) ===');

const ID32 = '37305d7cde4780ecabfeda0bddebf85b';
const DASHED = '37305d7c-de47-80ec-abfe-da0bddebf85b';

check('toDashedId: 32hex → 8-4-4-4-12', toDashedId(ID32) === DASHED);

// 1) URL slug 끝의 undashed id
check(
	'URL(undashed slug) → dashed id',
	extractNotionPageId(`https://www.notion.so/myws/Harness-Inc-${ID32}`) === DASHED,
);
// 2) URL 에 dashed uuid 포함
check('URL(dashed uuid) → 그대로', extractNotionPageId(`https://notion.so/${DASHED}`) === DASHED);
// 3) 원시 32hex
check('raw 32hex → dashed', extractNotionPageId(ID32) === DASHED);
// 4) 원시 dashed
check('raw dashed → 그대로', extractNotionPageId(DASHED) === DASHED);
// 5) query string·물음표 뒤 잡음 무시
check('URL + ?query → id 추출', extractNotionPageId(`https://www.notion.so/p/Title-${ID32}?pvs=4`) === DASHED);
// 6) 대문자 hex 정규화
check('대문자 hex 소문자화', extractNotionPageId(ID32.toUpperCase()) === DASHED);
// 7) id 없음 → null
check('id 없는 URL → null', extractNotionPageId('https://www.notion.so/myworkspace') === null);
check('빈 입력 → null', extractNotionPageId('') === null);
check('null 입력 → null', extractNotionPageId(null) === null);

console.log('');
if (failures.length === 0) {
	console.log('INIT-PROJECT SELFTEST: PASS');
	process.exit(0);
} else {
	console.log(`INIT-PROJECT SELFTEST: FAIL (${failures.length}개 실패)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
