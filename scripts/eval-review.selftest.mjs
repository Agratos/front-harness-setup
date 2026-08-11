#!/usr/bin/env node
// eval-review.selftest.mjs — 격리 채점 리뷰(세션 분리 1단계) 자가검증.
//
// 실행: node scripts/eval-review.selftest.mjs
//
// 왜 필요한가: eval-review.mjs 는 주관 채점 반영의 **유일한 경로**이자 스탬프의 유일한 발급자다.
// 여기가 회귀하면 ① 리뷰 없이 병합되거나(격리 무력화) ② 일하고도 스탬프가 인정되지 않는
// 두 종류의 실패가 되는데, 실제 claude 세션을 띄우면 결정적이지 않으므로
// HARNESS_REVIEW_CMD(가짜 리뷰어 — 우회 노출 지점이자 테스트 환경 조건)로 검증한다.
//
// 네트워크·실제 claude CLI 미사용. 임시 cwd 에서만 동작하며 실제 repo 를 오염시키지 않는다.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { applyVerdict, canonicalize, extractVerdict, integrityOf, reviewContractActive, verifyEvalReview } from './eval-review.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptsDir);
const cli = path.join(scriptsDir, 'eval-review.mjs');
const loopCli = path.join(scriptsDir, 'loop.mjs');

const failures = [];
function check(label, cond, extra) {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
		failures.push(label);
	}
}

/** CLI 를 임시 cwd 에서 실행 → {code, out}. PATH 의존을 없애기 위해 process.execPath 를 쓴다. */
function run(cwd, args, env = {}) {
	try {
		const out = execFileSync(process.execPath, [cli, ...args], {
			cwd,
			encoding: 'utf8',
			stdio: 'pipe',
			env: { ...process.env, ...env },
		});
		return { code: 0, out };
	} catch (err) {
		return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
	}
}

/** 베이스라인 평가 JSON (코드 계측 결과와 같은 형태 — 전 차원 100점). */
function baselineEval(id) {
	return {
		id,
		stepId: 'step-0',
		cycleId: 'step-0#0',
		createdAt: '2026-08-11T00:00:00.000Z',
		mode: 'stub',
		score: 100,
		majorComplaints: 0,
		injected: false,
		dimensions: {
			ui: { score: 100, weight: 0.25, label: 'UI' },
			ux: { score: 100, weight: 0.2, label: 'UX' },
			fn: { score: 100, weight: 0.35, label: '기능' },
			quality: { score: 100, weight: 0.2, label: '품질' },
		},
		complaints: [],
		observations: {},
	};
}

function writeEval(cwd, id, obj = baselineEval(id)) {
	const dir = path.join(cwd, 'harness', 'evaluations');
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(obj, null, 2) + '\n', 'utf8');
	writeFileSync(path.join(dir, `${id}.md`), `# 평가 로그 — ${id}\n`, 'utf8');
}

function readEval(cwd, id) {
	return JSON.parse(readFileSync(path.join(cwd, 'harness', 'evaluations', `${id}.json`), 'utf8'));
}

/** 가짜 리뷰어 스크립트 작성 → HARNESS_REVIEW_CMD 값 반환. stdin(프롬프트)을 끝까지 읽고 verdict 를 출력한다. */
function fakeReviewer(cwd, name, body) {
	const p = path.join(cwd, name);
	writeFileSync(
		p,
		[
			`let d = '';`,
			`process.stdin.setEncoding('utf8');`,
			`process.stdin.on('data', (c) => (d += c));`,
			`process.stdin.on('end', () => {`,
			`  if (!d.includes('격리 채점 리뷰')) { console.error('프롬프트 미수신'); process.exit(9); }`,
			body,
			`});`,
		].join('\n'),
		'utf8',
	);
	return `"${process.execPath}" "${p}"`;
}

// ── [A] 순수 함수 — 해시·verdict 추출·하향 단조 반영 ─────────────────────────
console.log('[A] canonicalize / integrityOf / extractVerdict / applyVerdict');
{
	const a = { score: 96, majorComplaints: 0, dimensions: { ui: { score: 100, weight: 0.25 } }, complaints: [] };
	const b = { complaints: [], dimensions: { ui: { weight: 0.25, score: 100 } }, majorComplaints: 0, score: 96 };
	check('[A] 키 순서가 달라도 같은 해시(정규화)', integrityOf(a) === integrityOf(b));
	check('[A] 판정 필드가 바뀌면 해시가 바뀜', integrityOf(a) !== integrityOf({ ...a, score: 95 }));
	check('[A] canonicalize 는 배열 순서를 보존', canonicalize([1, 2]) !== canonicalize([2, 1]));

	const fenced = extractVerdict('사설...\n```json\n{"complaints": [], "summary": "ok"}\n```\n');
	check('[A] ```json 펜스에서 verdict 추출', fenced.ok && fenced.verdict.summary === 'ok');
	const bare = extractVerdict('결론입니다 {"complaints": [], "summary": "bare"}');
	check('[A] 펜스 없는 마지막 JSON 도 추출', bare.ok && bare.verdict.summary === 'bare');
	const twoFences = extractVerdict('```json\n{"summary":"first"}\n```\n중간\n```json\n{"summary":"last"}\n```');
	check('[A] 펜스가 여럿이면 마지막 것', twoFences.ok && twoFences.verdict.summary === 'last');
	check('[A] JSON 없음 → 실패', extractVerdict('그냥 텍스트').ok === false);
	check('[A] 배열/비객체 → 실패', extractVerdict('```json\n[1,2]\n```').ok === false);
	check('[A] dimensionScores 비객체 → 실패', extractVerdict('```json\n{"dimensionScores": 5}\n```').ok === false);

	const base = baselineEval('eval-x');
	const r1 = applyVerdict(base, {
		dimensionScores: { quality: 80, ui: 120, ghost: 10 },
		complaints: [
			{ dimension: 'ui', item: 'review.pad', severity: 'minor', reason: 'r' },
			{ dimension: 'ui', item: 'review.pad', severity: 'minor', reason: '중복' },
			{ dimension: 'ux', item: 'review.bad-sev', severity: 'critical', reason: '심각도 오류' },
		],
	});
	check('[A] 하향만 반영(quality 100→80) → 종합 96 재계산', r1.evalObj.score === 96 && r1.loweredDimensions.join(',') === 'quality');
	check('[A] 상향(ui 120)·미지 차원(ghost) 무시', r1.evalObj.dimensions.ui.score === 100 && r1.ignored.length >= 2);
	check('[A] 불만 추가 1건(중복·잘못된 severity 제외) + source=review', r1.addedComplaints === 1 && r1.evalObj.complaints[0].source === 'review');
	check('[A] major 재계산(minor 만 → 0 유지)', r1.evalObj.majorComplaints === 0);
	const r2 = applyVerdict(base, { complaints: [{ dimension: 'fn', item: 'review.ac-missing', severity: 'major', reason: 'AC 미확인' }] });
	check('[A] major 불만 추가 → majorComplaints 1', r2.evalObj.majorComplaints === 1);
	check('[A] 원본 evalObj 불변(사본 반영)', base.complaints.length === 0 && base.score === 100);
}

// ── [B] CLI — 가짜 리뷰어로 반영·스탬프·멱등·변조 탐지 ──────────────────────
console.log('');
console.log('[B] CLI (HARNESS_REVIEW_CMD 가짜 리뷰어)');
const tmpB = mkdtempSync(path.join(os.tmpdir(), 'evrev-selftest-'));
try {
	const lowerCmd = fakeReviewer(
		tmpB,
		'fake-lower.mjs',
		`  console.log('사설\\n\\u0060\\u0060\\u0060json\\n' + JSON.stringify({ dimensionScores: { quality: 80 }, complaints: [{ dimension: 'ui', item: 'review.side-padding', severity: 'minor', reason: '여백 없음' }], summary: '양호' }) + '\\n\\u0060\\u0060\\u0060');`,
	);

	// B1: 반영 + 스탬프 + 산출물
	writeEval(tmpB, 'eval-0001');
	const b1 = run(tmpB, ['--id=eval-0001'], { HARNESS_REVIEW_CMD: lowerCmd });
	const e1 = readEval(tmpB, 'eval-0001');
	check('[B1] exit 0 + 반영 로그', b1.code === 0 && /격리 리뷰 반영/.test(b1.out), b1.out.slice(-300));
	check('[B1] 하향 반영 100→96 / minor 불만 +1', e1.score === 96 && e1.majorComplaints === 0 && e1.complaints.length === 1);
	check('[B1] 스탬프 mode=isolated + cmd 노출(custom)', e1.review?.mode === 'isolated' && /custom\(/.test(e1.review?.cmd ?? ''));
	check('[B1] integrity 해시 일치(무변조)', e1.review?.integrity === integrityOf(e1));
	check(
		'[B1] 감사 산출물(review-prompt.md / review.json) 보존',
		existsSync(path.join(tmpB, 'harness', 'evaluations', 'eval-0001', 'review-prompt.md')) &&
			existsSync(path.join(tmpB, 'harness', 'evaluations', 'eval-0001', 'review.json')),
	);
	check('[B1] 사람용 md 에 리뷰 절 append', readFileSync(path.join(tmpB, 'harness', 'evaluations', 'eval-0001.md'), 'utf8').includes('격리 리뷰'));
	check('[B1] verifyEvalReview ok', verifyEvalReview(tmpB, 'eval-0001').ok === true);

	// B2: 멱등 — 유효한 리뷰가 있으면 재실행하지 않는다
	const b2 = run(tmpB, ['--id=eval-0001'], { HARNESS_REVIEW_CMD: lowerCmd });
	check('[B2] 재실행은 no-op(이미 리뷰됨)', b2.code === 0 && /이미 리뷰됨/.test(b2.out) && readEval(tmpB, 'eval-0001').score === 96);

	// B3: 리뷰 이후 변조 → 해시 불일치 탐지 (done-gate 가 이 판정으로 FAIL 한다)
	const tampered = { ...readEval(tmpB, 'eval-0001'), score: 100 };
	writeFileSync(path.join(tmpB, 'harness', 'evaluations', 'eval-0001.json'), JSON.stringify(tampered, null, 2) + '\n', 'utf8');
	const v3 = verifyEvalReview(tmpB, 'eval-0001');
	check('[B3] 리뷰 후 점수 변조 → 검증 실패(변조)', v3.ok === false && /변조/.test(v3.reason), v3.reason);

	// B4: 상향 시도는 무시된다
	writeEval(tmpB, 'eval-0002');
	const raiseCmd = fakeReviewer(
		tmpB,
		'fake-raise.mjs',
		`  console.log(JSON.stringify({ dimensionScores: { ui: 120, quality: 150 }, complaints: [], summary: '점수 인플레 시도' }));`,
	);
	const b4 = run(tmpB, ['--id=eval-0002'], { HARNESS_REVIEW_CMD: raiseCmd });
	check('[B4] 상향 시도 → 전부 무시(100 유지)', b4.code === 0 && readEval(tmpB, 'eval-0002').score === 100 && /상향은 무시/.test(b4.out));

	// B5: major 불만 → done-gate 를 막는 숫자로 반영
	writeEval(tmpB, 'eval-0003');
	const majorCmd = fakeReviewer(
		tmpB,
		'fake-major.mjs',
		`  console.log(JSON.stringify({ complaints: [{ dimension: 'fn', item: 'review.ac-1-missing', severity: 'major', reason: 'AC-1 이 화면에서 확인 불가' }], summary: '결함' }));`,
	);
	run(tmpB, ['--id=eval-0003'], { HARNESS_REVIEW_CMD: majorCmd });
	check('[B5] 리뷰어 major → majorComplaints 1', readEval(tmpB, 'eval-0003').majorComplaints === 1);

	// B6: verdict 파싱 실패 → exit 1 + 평가 무변경(스탬프 없음)
	writeEval(tmpB, 'eval-0004');
	const garbageCmd = fakeReviewer(tmpB, 'fake-garbage.mjs', `  console.log('JSON 이 아닌 출력');`);
	const b6 = run(tmpB, ['--id=eval-0004'], { HARNESS_REVIEW_CMD: garbageCmd });
	check('[B6] 파싱 실패 → exit 1 + 스탬프 미발급', b6.code === 1 && readEval(tmpB, 'eval-0004').review === undefined);

	// B7: 대상 평가 없음 → exit 2
	const b7 = run(tmpB, ['--id=eval-9999'], { HARNESS_REVIEW_CMD: lowerCmd });
	check('[B7] 대상 없음 → exit 2', b7.code === 2);

	// B8: 환경 부재(claude CLI 없음 + 오버라이드 없음) → 기록된 skip (침묵의 통과 없음)
	writeEval(tmpB, 'eval-0005');
	const envNoTool = { ...process.env, PATH: '', Path: '' };
	delete envNoTool.HARNESS_REVIEW_CMD;
	let b8;
	try {
		const out = execFileSync(process.execPath, [cli, '--id=eval-0005'], { cwd: tmpB, encoding: 'utf8', stdio: 'pipe', env: envNoTool });
		b8 = { code: 0, out };
	} catch (err) {
		b8 = { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
	}
	const e8 = readEval(tmpB, 'eval-0005');
	check('[B8] claude 부재 → exit 0 + skipped-no-tool 스탬프', b8.code === 0 && e8.review?.mode === 'skipped-no-tool', b8.out.slice(-300));
	// skip 스탬프는 검증 시점의 도구 가용성과 대조된다 — 도구가 없을 때만 인정, 있으면 위조/낡은 skip.
	check(
		'[B8] verifyEvalReview 가 기록된 환경 부재를 인정(도구 부재)',
		verifyEvalReview(tmpB, 'eval-0005', { probeTool: () => false }).ok === true,
	);
	const vSkipForged = verifyEvalReview(tmpB, 'eval-0005', { probeTool: () => true });
	check(
		'[B8] 리뷰 도구 가용인데 skip 스탬프 → 무효(수기 skip 위조 차단)',
		vSkipForged.ok === false && /skip 스탬프 무효/.test(vSkipForged.reason),
		vSkipForged.reason,
	);

	// injected 평가는 리뷰 요구에서 제외(이미 노출된 bypass — 사양 §4.3)
	writeEval(tmpB, 'eval-0006', { ...baselineEval('eval-0006'), injected: true });
	const vInj = verifyEvalReview(tmpB, 'eval-0006');
	check('[B9] injected 평가 → 리뷰 요구 제외(mode=injected-bypass)', vInj.ok === true && vInj.mode === 'injected-bypass');

	// 리뷰 스탬프가 이미 있는 평가에 injected 를 **뒤늦게 붙이는** 것은 bypass 가 아니라 변조다.
	// (eval-0001 은 B3 에서 점수를 변조해 둔 상태 — injected 한 줄을 얹어도 해시 검증을 피할 수 없어야 한다)
	const tamperedPlus = { ...readEval(tmpB, 'eval-0001'), injected: true };
	writeFileSync(path.join(tmpB, 'harness', 'evaluations', 'eval-0001.json'), JSON.stringify(tamperedPlus, null, 2) + '\n', 'utf8');
	const vLate = verifyEvalReview(tmpB, 'eval-0001');
	check('[B9] 리뷰 스탬프 있는 평가에 injected 부착 → bypass 미적용(변조 탐지 유지)', vLate.ok === false && /변조/.test(vLate.reason), vLate.reason);

	check('[B10] reviewContractActive: 실제 repo=활성 / 임시 cwd=비활성', reviewContractActive(repoRoot) === true && reviewContractActive(tmpB) === false);
} finally {
	rmSync(tmpB, { recursive: true, force: true });
}

// ── [C] loop 배선 — 스탬프 없으면 전진 차단, 있으면 debate 로 전진 ────────────
console.log('');
console.log('[C] loop.mjs evaluate 배선 (스텁 eval-playwright + 스텁 eval-review)');
const tmpC = mkdtempSync(path.join(os.tmpdir(), 'evrev-loop-'));
try {
	const setupLoopCwd = (cwd, { stamp }) => {
		mkdirSync(path.join(cwd, 'scripts'), { recursive: true });
		mkdirSync(path.join(cwd, 'harness'), { recursive: true });
		// 스텁 eval-playwright: 이번 사이클(step-0#0) 베이스라인 평가를 남긴다
		writeFileSync(
			path.join(cwd, 'scripts', 'eval-playwright.mjs'),
			[
				`import { mkdirSync, writeFileSync } from 'node:fs';`,
				`mkdirSync('harness/evaluations', { recursive: true });`,
				`writeFileSync('harness/evaluations/eval-0001.json', JSON.stringify(${JSON.stringify(baselineEval('eval-0001'))}) + '\\n', 'utf8');`,
			].join('\n'),
			'utf8',
		);
		// 스텁 eval-review: stamp=false 면 아무것도 안 찍고 exit 0(스탬프 검증이 잡아야 함),
		// stamp=true 면 실제 integrityOf 로 유효 스탬프를 찍는다(정상 경로).
		const realUrl = pathToFileURL(cli).href;
		writeFileSync(
			path.join(cwd, 'scripts', 'eval-review.mjs'),
			stamp
				? [
						`import { readFileSync, writeFileSync } from 'node:fs';`,
						`import { integrityOf } from '${realUrl}';`,
						`const p = 'harness/evaluations/eval-0001.json';`,
						`const e = JSON.parse(readFileSync(p, 'utf8'));`,
						`e.review = { mode: 'isolated', cmd: 'stub', at: new Date().toISOString(), added: { complaints: 0, loweredDimensions: [] }, integrity: integrityOf(e) };`,
						`writeFileSync(p, JSON.stringify(e, null, 2) + '\\n', 'utf8');`,
					].join('\n')
				: `process.exit(0); // 스탬프를 찍지 않는 불량 리뷰어`,
			'utf8',
		);
		writeFileSync(
			path.join(cwd, 'harness', 'state.json'),
			JSON.stringify({
				planSteps: ['01-x'],
				currentStepIdx: 0,
				phase: 'evaluate',
				phaseSeq: 5,
				lastExecutedPhaseSeq: 4,
				status: 'running',
				committed: false,
				reworkCount: 0,
				failures: {},
				escalations: 0,
				scores: {},
			}) + '\n',
			'utf8',
		);
	};
	const runLoop = (cwd) => {
		try {
			const out = execFileSync(process.execPath, [loopCli], { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env } });
			return { code: 0, out };
		} catch (err) {
			return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
		}
	};

	const cwd1 = path.join(tmpC, 'no-stamp');
	setupLoopCwd(cwd1, { stamp: false });
	const c1 = runLoop(cwd1);
	const s1 = JSON.parse(readFileSync(path.join(cwd1, 'harness', 'state.json'), 'utf8'));
	check('[C1] 스탬프 없음 → evaluate 에 머무름(전진 차단) + 실패 카운트', s1.phase === 'evaluate' && (s1.failures?.evaluate ?? 0) === 1, c1.out.slice(-400));
	check('[C1] 로그에 격리 리뷰 사유 명시', /격리 리뷰/.test(c1.out));

	const cwd2 = path.join(tmpC, 'stamped');
	setupLoopCwd(cwd2, { stamp: true });
	const c2 = runLoop(cwd2);
	const s2 = JSON.parse(readFileSync(path.join(cwd2, 'harness', 'state.json'), 'utf8'));
	check('[C2] 유효 스탬프 → debate 로 전진', s2.phase === 'debate', c2.out.slice(-400));
	check('[C2] 로그에 격리 리뷰 isolated 표기', /격리 리뷰 isolated/.test(c2.out));
} finally {
	rmSync(tmpC, { recursive: true, force: true });
}

// ── 결과 ─────────────────────────────────────────────────────────────────────
console.log('');
if (failures.length) {
	console.log(`EVAL-REVIEW SELFTEST: FAIL (${failures.length}건)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
console.log('EVAL-REVIEW SELFTEST: PASS');
