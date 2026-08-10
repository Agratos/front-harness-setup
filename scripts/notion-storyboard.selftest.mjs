#!/usr/bin/env node
// notion-storyboard.selftest.mjs — 스토리보드 업로드/첨부의 순수 로직 자가검증.
//
// 실제 네트워크(File Upload API)는 호출하지 않고, 네트워크가 필요 없는 분기만 검증한다:
//   - storyboardCaption / storyboardItems / imageBlocks / storyboardMarker (순수 빌더)
//   - attachStoryboard 의 조기 반환(pageId 없음 / token 없음) — fetch 미발생
//   - run() 의 skip 게이트(useMcp!=true / --row 없음 / 스펙 없음) — fetch 미발생
// 성공 시 'NOTION-STORYBOARD SELFTEST: PASS' + exit 0.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { attachStoryboard, imageBlocks, storyboardCaption, storyboardItems, storyboardMarker } from './lib/notion-api.mjs';
import { run } from './notion-storyboard.mjs';

const failures = [];
function check(label, cond) {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		console.log(`  ✗ ${label}`);
		failures.push(label);
	}
}

console.log('=== notion-storyboard selftest (순수 로직 — 네트워크 미사용) ===');

// (1) storyboardCaption
check('caption: 인덱스 0패딩 + kind/detail', storyboardCaption({ kind: 'click', detail: '추가', ok: true }, 2) === '02 · click — 추가 [ok]');
check('caption: ok=false → FAIL', storyboardCaption({ kind: 'assert.checked', detail: 'x', ok: false }, 11).endsWith('[FAIL]'));

// (2) storyboardItems — initial + 단계, basename 으로 shotsDir 결합, shot 없는 단계 skip
const scenario = {
	initialShot: 'harness/evaluations/story-demo/s1-00-initial.png',
	storyboard: [
		{ kind: 'fill', detail: '이름=물', ok: true, shot: 'harness/evaluations/story-demo/s1-01.png' },
		{ kind: 'click', detail: '추가', ok: true, shot: 'harness/evaluations/story-demo/s1-02.png' },
		{ kind: 'noshot', detail: 'x', ok: true }, // shot 없음 → 제외
	],
};
const items = storyboardItems(scenario, '/shots');
check('items: initial + 단계 2개(=3, shot 없는 건 제외)', items.length === 3);
check('items: 첫 항목은 초기 상태', items[0].caption === '00 · 초기 상태');
check('items: shotsDir + basename 결합', items[1].file === path.join('/shots', 's1-01.png'));
check('items: 마지막 캡션 인덱스 2', items[2].caption.startsWith('02 · click'));

// (3) imageBlocks
const blocks = imageBlocks([{ id: 'fu-1', caption: 'c1' }, { id: 'fu-2', caption: 'c2' }]);
check('imageBlocks: 개수/타입', blocks.length === 2 && blocks[0].type === 'image');
check('imageBlocks: file_upload id 연결', blocks[0].image.file_upload.id === 'fu-1');
check('imageBlocks: 캡션 rich_text', blocks[1].image.caption[0].text.content === 'c2');

// (4) storyboardMarker
check('marker: id 포함', storyboardMarker('scen-1').includes('scen-1'));
check('marker: title 결합', storyboardMarker('scen-1', '추가flow') === '🧪 스토리보드:scen-1 — 추가flow');

// (5) attachStoryboard 조기 반환 (fetch 미발생)
const a1 = await attachStoryboard(null, [], 'tok', {});
check('attachStoryboard: pageId 없으면 ok=false', a1.ok === false && /pageId/.test(a1.reason));
const a2 = await attachStoryboard('page-1', [], '', {});
check('attachStoryboard: token 없으면 ok=false', a2.ok === false && /token/.test(a2.reason));

// (6) run() skip 게이트 — useMcp=false (fetch 미발생)
const tmp1 = mkdtempSync(path.join(os.tmpdir(), 'storyboard-skip-'));
try {
	mkdirSync(path.join(tmp1, 'harness'), { recursive: true });
	writeFileSync(path.join(tmp1, 'harness', 'config.json'), JSON.stringify({ useMcp: false }) + '\n', 'utf8');
	const r = await run({ repo: tmp1, row: 'page-1', id: 'scenario' });
	check('run: useMcp=false → skipped', r.skipped === true && /useMcp/.test(r.reason));
} finally {
	rmSync(tmp1, { recursive: true, force: true });
}

// (7) run() skip — useMcp=true 이지만 --row 없음 (fetch 미발생)
const tmp2 = mkdtempSync(path.join(os.tmpdir(), 'storyboard-norow-'));
try {
	mkdirSync(path.join(tmp2, 'harness'), { recursive: true });
	writeFileSync(path.join(tmp2, 'harness', 'config.json'), JSON.stringify({ useMcp: true }) + '\n', 'utf8');
	const r = await run({ repo: tmp2, row: null, id: 'scenario' });
	check('run: --row 없으면 skipped', r.skipped === true && /row/.test(r.reason));
} finally {
	rmSync(tmp2, { recursive: true, force: true });
}

console.log('');
if (failures.length === 0) {
	console.log('NOTION-STORYBOARD SELFTEST: PASS');
	process.exit(0);
} else {
	console.log(`NOTION-STORYBOARD SELFTEST: FAIL (${failures.length}개 실패)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
