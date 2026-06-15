#!/usr/bin/env node
// demo.mjs — 통합 스모크 데모 (US-010, AC5/AC6/통합)
//
// 목적:
//   하니스 골격(init-project → git-flow → loop 드라이버 → 협의 로그 → 평가 → 최종 보고)의
//   전체 흐름을 **실제 저장소의 git 히스토리를 오염시키지 않고** 한 번에 시연합니다.
//
// 안전 원칙 (오염 금지):
//   1) git 부분(seed-main → start-step → merge-step)은 os.tmpdir 의 **throwaway 임시 git repo**
//      안에서만 실행합니다(git-flow.selftest 와 동일 패턴). 실제 repo 는 절대 커밋하지 않습니다.
//   2) loop 드라이버 1-step 완주도 **임시 cwd(demo state)** 에서 돌려, 실제 harness/state.json
//      을 절대 덮어쓰지 않습니다(데모 종료 후 실제 state.json 이 그대로 유효함을 호출자가 검증).
//   3) logDecision 협의 결정 시연도 **임시 격리 디렉터리**에서 수행합니다. 실제 harness/decisions/ 는
//      절대 생성·삭제하지 않아 실제 결정 기록을 보존합니다(과거: 멱등성 위해 decision-*.md 를 일괄
//      삭제하다 실제 결정까지 지우던 버그를 제거). 데모가 실제 repo 에 남기는 산출물은
//      (a) harness/report.md 최종 보고서, (b) harness/cycles/ 요약 로그 — 두 가지뿐입니다.
//
// 출력: 성공 시 마지막 줄에 'DEMO: PASS'. 실패 시 'DEMO: FAIL' + exit 1.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { logCycle, logDecision } from './lib/log.mjs';
import { readState, stateFilePath } from './lib/state.mjs';

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(__filename);
const repoRoot = path.dirname(scriptsDir);

const gitFlow = path.join(scriptsDir, 'git-flow.mjs');
const loopScript = path.join(scriptsDir, 'loop.mjs');

const failures = [];
const steps = [];
function check(label, cond, detail) {
	if (cond) {
		console.log(`  ✓ ${label}`);
	} else {
		console.log(`  ✗ ${label}`);
		failures.push(label);
	}
	steps.push({ label, ok: !!cond, detail: detail ?? null });
}

function section(title) {
	console.log(`\n[demo] ${title}`);
}

// ──────────────────────────────────────────────────────────────────────────
// 0) INIT-PROJECT 확인 — init-project 가 이미 실행되어 harness/config.json 이 존재해야 함.
// ──────────────────────────────────────────────────────────────────────────
section('0) INIT-PROJECT 확인 (harness/config.json 존재 — init-project 선행)');
const configPath = path.join(repoRoot, 'harness', 'config.json');
let config = {};
const configExists = existsSync(configPath);
check('harness/config.json 존재 (init-project 선행)', configExists);
if (configExists) {
	try {
		config = JSON.parse(readFileSync(configPath, 'utf8'));
	} catch {
		config = {};
	}
	check('config 에 preflight.ranAt 기록됨', Boolean(config.preflight && config.preflight.ranAt));
}

// 데모 종료 후 실제 state.json 무손상 확인을 위해 실행 전 스냅샷.
const realStatePath = stateFilePath(repoRoot);
const realStateBefore = existsSync(realStatePath) ? readFileSync(realStatePath, 'utf8') : null;

// ──────────────────────────────────────────────────────────────────────────
// 1) GIT-FLOW 부분 — throwaway 임시 git repo 에서 seed-main → start-step → merge-step.
//    (실제 repo 의 git 히스토리는 절대 건드리지 않음)
// ──────────────────────────────────────────────────────────────────────────
section('1) GIT-FLOW (임시 throwaway git repo — 실제 repo 무커밋)');

function git(dir, args) {
	return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
}
function runGitFlow(dir, args, env = {}) {
	try {
		const stdout = execFileSync('node', [gitFlow, ...args], {
			cwd: dir,
			encoding: 'utf8',
			stdio: 'pipe',
			env: { ...process.env, ...env },
		});
		return { code: 0, stdout, stderr: '' };
	} catch (err) {
		return { code: err.status ?? 1, stdout: (err.stdout || '').toString(), stderr: (err.stderr || '').toString() };
	}
}
function commitCount(dir) {
	try {
		return Number(git(dir, ['rev-list', '--count', 'main']));
	} catch {
		return 0;
	}
}
function branchExists(dir, name) {
	try {
		git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
		return true;
	} catch {
		return false;
	}
}

const gitTmp = mkdtempSync(path.join(os.tmpdir(), 'demo-gitflow-'));
try {
	try {
		git(gitTmp, ['init', '-b', 'main']);
	} catch {
		git(gitTmp, ['init']);
		git(gitTmp, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
	}
	git(gitTmp, ['config', 'user.name', 'Harness Demo']);
	git(gitTmp, ['config', 'user.email', 'demo@harness.local']);
	git(gitTmp, ['config', 'commit.gpgsign', 'false']);
	mkdirSync(path.join(gitTmp, 'harness'), { recursive: true });
	writeFileSync(
		path.join(gitTmp, 'harness', 'config.json'),
		JSON.stringify({ useGit: true, useMcp: false, mcpServers: [], skipGitFlow: false }, null, 2) + '\n',
		'utf8',
	);
	writeFileSync(path.join(gitTmp, 'README.md'), '# demo fixture\n', 'utf8');

	// seed-main
	const seed = runGitFlow(gitTmp, ['seed-main']);
	check('git-flow seed-main exit 0', seed.code === 0);
	check('seed-main 후 main 커밋 1개', commitCount(gitTmp) === 1, `commits=${commitCount(gitTmp)}`);

	// start-step 01 demo
	const start = runGitFlow(gitTmp, ['start-step', '01', 'demo']);
	check('git-flow start-step 01 demo exit 0', start.code === 0);
	check('브랜치 step/01-demo 생성됨', branchExists(gitTmp, 'step/01-demo'));

	// step 브랜치에서 변경 + 커밋
	writeFileSync(path.join(gitTmp, 'feature.txt'), 'demo step work\n', 'utf8');
	git(gitTmp, ['add', '-A']);
	git(gitTmp, ['commit', '-m', 'feat: demo step work']);

	// merge-step — done-gate.mjs 가 임시 repo 에 없으므로 HARNESS_GATE_OK=1 폴백으로 게이트 통과 시연
	const seededCount = commitCount(gitTmp);
	const merge = runGitFlow(gitTmp, ['merge-step', '01', 'demo'], { HARNESS_GATE_OK: '1' });
	check('git-flow merge-step (gate ok) exit 0', merge.code === 0);
	check('merge-step 후 main 커밋 증가 (병합 반영)', commitCount(gitTmp) > seededCount, `commits=${commitCount(gitTmp)}`);

	logCycle(repoRoot, {
		phase: 'merge',
		note: `데모 git-flow(임시 repo): seed→start→merge 완료, main 커밋 ${commitCount(gitTmp)}개`,
		outcome: 'demo',
		stepLabel: '01-demo',
	});
} finally {
	rmSync(gitTmp, { recursive: true, force: true });
}

// ──────────────────────────────────────────────────────────────────────────
// 2) LOOP 드라이버 — 임시 cwd(demo state)에서 1-step 계획 완주(decompose→...→merge→done).
//    실제 harness/state.json 은 건드리지 않는다.
// ──────────────────────────────────────────────────────────────────────────
section('2) LOOP 드라이버 (임시 cwd demo state — 실제 state.json 무손상)');

function invokeLoop(cwd, args = []) {
	try {
		const stdout = execFileSync('node', [loopScript, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
		return { code: 0, stdout };
	} catch (err) {
		return { code: err.status ?? 1, stdout: (err.stdout || '').toString() };
	}
}

const loopTmp = mkdtempSync(path.join(os.tmpdir(), 'demo-loop-'));
let executedPhases = [];
let loopDone = false;
try {
	mkdirSync(path.join(loopTmp, 'harness'), { recursive: true });
	writeFileSync(
		path.join(loopTmp, 'harness', 'config.json'),
		JSON.stringify({ useGit: false, useMcp: false, mcpServers: [], skipGitFlow: true }, null, 2) + '\n',
		'utf8',
	);

	const demoStatePath = stateFilePath(loopTmp);
	function parseExecuted(stdout) {
		const m = /executed:\s*([a-z]+)/.exec(stdout);
		return m ? m[1] : null;
	}

	// 첫 호출: --init 으로 1-step 시드 → decompose 실행.
	const first = invokeLoop(loopTmp, ['--init', '01-demo']);
	check('loop 첫 호출 (--init 1-step) exit 0', first.code === 0);
	const firstEx = parseExecuted(first.stdout);
	if (firstEx) executedPhases.push(firstEx);

	// 페이즈마다 재호출(턴 경계 시뮬레이션) — status=done 까지.
	const maxCalls = 12;
	for (let i = 0; i < maxCalls; i++) {
		const r = invokeLoop(loopTmp);
		const ex = parseExecuted(r.stdout);
		if (ex) executedPhases.push(ex);
		const st = readState(demoStatePath);
		if (st && st.status === 'done') {
			loopDone = true;
			break;
		}
	}

	check('loop 1-step 계획 완주 → status=done', loopDone === true);
	check(
		'전 페이즈 실행됨 (decompose→design→implement→verify→evaluate→debate→merge)',
		['decompose', 'design', 'implement', 'verify', 'evaluate', 'debate', 'merge'].every((p) =>
			executedPhases.includes(p),
		),
		`executed=${executedPhases.join('>')}`,
	);

	// 임시 cwd 의 cycle 로그를 실제 repo 의 cycles 로그에 요약 1줄 append (감사 추적).
	logCycle(repoRoot, {
		phase: 'merge',
		note: `데모 loop(임시 cwd): 1-step 완주, 실행 페이즈=${executedPhases.join('>')}`,
		outcome: 'demo',
		stepLabel: '01-demo',
	});
} finally {
	rmSync(loopTmp, { recursive: true, force: true });
}

// ──────────────────────────────────────────────────────────────────────────
// 3) 협의 결정 산출 (logDecision) — 실제 repo 의 harness/decisions/<id>.md 한 건 생성.
// ──────────────────────────────────────────────────────────────────────────
section('3) 협의 결정 산출 (logDecision → 임시 격리, 실제 decisions 무오염)');
// 데모 결정은 실제 harness/decisions/ 를 오염시키지 않도록 **임시 격리 디렉터리**에 기록한다.
// (git/loop 시연과 동일한 격리 원칙. 실제 결정 기록을 절대 생성·삭제하지 않는다.)
// 과거에는 실제 repo 에 직접 쓰고 멱등성 위해 decision-*.md 를 일괄 삭제했는데,
// 그 정규식이 실제 결정(decision-0002 등)까지 지우는 데이터 손실 버그였다.
const decisionTmp = mkdtempSync(path.join(os.tmpdir(), 'demo-decision-'));
let decisionFiles = [];
let decisionBasename = '-';
try {
	const decisionPath = logDecision(decisionTmp, {
		topic: '통합 데모에서 git-flow·loop·logDecision 을 실제 repo 에 직접 적용할지, 임시 격리할지',
		raisedBy: 'architect',
		claims: [
			{
				agent: 'architect',
				claim: 'git-flow 시연은 throwaway 임시 git repo 에서만 수행해야 한다',
				reason: '실제 repo 의 main 은 "미존재 시 1회 시드" 규약이라, 데모 커밋이 들어가면 부트스트랩 히스토리를 오염시킨다',
			},
			{
				agent: 'qa',
				claim: 'loop 드라이버 완주도 임시 cwd(demo state)에서 돌려야 한다',
				reason: 'loop.mjs 는 cwd 의 harness/state.json 을 원자적으로 덮어쓰므로, 실제 state 를 건드리면 진행 상태가 손상된다',
			},
			{
				agent: 'pm',
				claim: '협의 결정 시연도 임시 격리 디렉터리에 쓰고, 실제 repo 에는 report.md + cycles 요약만 남긴다',
				reason: 'logDecision 은 기존 파일 수로 번호를 매기므로 실제 decisions 에 쓰면 반복 실행마다 누적되고, 이를 막으려 일괄 삭제하면 실제 결정 기록까지 지워진다',
			},
		],
		rebuttals: [
			'qa → architect: 임시 격리에 동의. 다만 cycle 로그 요약은 실제 repo 에 남겨야 감사 추적이 가능하다는 의견 → cycles 에 요약 1줄만 append 하기로 절충.',
		],
		compromise:
			'git/loop/logDecision 부작용은 임시 repo·임시 cwd·임시 디렉터리로 완전 격리하고, 실제 repo 에는 (1) report.md 최종 보고, (2) cycles 요약 로그만 남긴다.',
		conclusion: 'git-flow·loop·logDecision 시연을 모두 임시 격리 환경에서 수행하고, 실제 repo 에는 최소 산출물(report.md + cycles 요약)만 기록한다.',
		why: '실제 repo 의 git 히스토리·진행 상태(state.json)·결정 기록(decisions) 오염을 막으면서도 전체 골격 흐름과 투명성(감사 추적)을 동시에 시연할 수 있기 때문이다.',
		impact: 'scripts/demo.mjs 의 격리 전략 확정. 통합 스모크를 반복 실행해도 실제 repo(특히 harness/decisions/)가 안전하다.',
		linkedStep: 'US-010 (통합 데모)',
	});
	check('logDecision → decisions/*.md 생성됨 (임시 격리)', existsSync(decisionPath), decisionPath);
	const decisionsDir = path.join(decisionTmp, 'harness', 'decisions');
	decisionFiles = existsSync(decisionsDir) ? readdirSync(decisionsDir).filter((f) => f.endsWith('.md')) : [];
	decisionBasename = path.basename(decisionPath);
	check('데모 협의 결정 1건 생성됨 (임시 격리)', decisionFiles.length >= 1, `files=${decisionFiles.join(',')}`);
} finally {
	rmSync(decisionTmp, { recursive: true, force: true });
}

// ──────────────────────────────────────────────────────────────────────────
// 4) 기존 평가(eval-0001) 읽기 확인.
// ──────────────────────────────────────────────────────────────────────────
section('4) 기존 평가 읽기 (harness/evaluations/eval-0001)');
const evalJsonPath = path.join(repoRoot, 'harness', 'evaluations', 'eval-0001.json');
let evalObj = null;
const evalExists = existsSync(evalJsonPath);
check('harness/evaluations/eval-0001.json 존재', evalExists);
if (evalExists) {
	try {
		evalObj = JSON.parse(readFileSync(evalJsonPath, 'utf8'));
	} catch {
		evalObj = null;
	}
	check('eval-0001 파싱 + score/majorComplaints 필드 보유', Boolean(evalObj && typeof evalObj.score === 'number' && typeof evalObj.majorComplaints === 'number'), evalObj ? `score=${evalObj.score} major=${evalObj.majorComplaints}` : 'parse fail');
}

// ──────────────────────────────────────────────────────────────────────────
// 5) 최종 보고서 — harness/report.md 채우기 (eval-0001 + 단계 요약 + 미해결 불만 수).
// ──────────────────────────────────────────────────────────────────────────
section('5) 최종 보고서 작성 (harness/report.md)');
const reportPath = path.join(repoRoot, 'harness', 'report.md');
const report = buildReport({ config, evalObj, executedPhases, loopDone, decisionFiles, repoRoot });
writeFileSync(reportPath, report, 'utf8');
check('harness/report.md 작성됨', existsSync(reportPath));
check('report.md 가 템플릿 placeholder 를 포함하지 않음 (실값으로 채워짐)', !/\{\{[^}]+\}\}/.test(report));

// ──────────────────────────────────────────────────────────────────────────
// 6) 실제 state.json 무손상 확인.
// ──────────────────────────────────────────────────────────────────────────
section('6) 실제 harness/state.json 무손상 확인 (데모가 덮어쓰지 않음)');
const realStateAfter = existsSync(realStatePath) ? readFileSync(realStatePath, 'utf8') : null;
check('실제 state.json 이 데모로 변경되지 않음', realStateBefore === realStateAfter);

// ──────────────────────────────────────────────────────────────────────────
// 요약
// ──────────────────────────────────────────────────────────────────────────
console.log('');
console.log('=== DEMO 요약 ===');
console.log(`  git-flow(임시 repo): seed→start→merge 시연`);
console.log(`  loop(임시 cwd): 1-step 완주 = ${loopDone ? 'done' : '미완'} (${executedPhases.join('>')})`);
console.log(`  decisions: ${decisionFiles.length}건 (임시 격리 시연 — 실제 repo 무오염), 신규 = ${decisionBasename}`);
console.log(`  eval-0001: ${evalObj ? `종합 ${evalObj.score}/100, major ${evalObj.majorComplaints}건` : '읽기 실패'}`);
console.log(`  report.md: 채워짐(placeholder 없음)`);
console.log(`  실제 state.json: 무손상`);

if (failures.length === 0) {
	console.log('\nDEMO: PASS');
	process.exit(0);
} else {
	console.log(`\nDEMO: FAIL (${failures.length}개 실패)`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}

// ──────────────────────────────────────────────────────────────────────────
// 보고서 빌더 — report.md 템플릿 구조를 실값으로 채운다.
// ──────────────────────────────────────────────────────────────────────────
function buildReport({ config, evalObj, executedPhases, loopDone, decisionFiles, repoRoot }) {
	const score100 = evalObj ? evalObj.score : 0;
	const score10 = (score100 / 10).toFixed(1); // 100점 척도 → 10점 척도
	const major = evalObj ? evalObj.majorComplaints : 0;
	const complaints = evalObj && Array.isArray(evalObj.complaints) ? evalObj.complaints : [];
	const verdict = score100 >= 90 && major === 0 ? 'pass' : 'needs-rework';

	// 차원별 평점: eval-0001 의 4차원(UI/UX/기능/품질)을 10점 척도로 변환.
	const dims = (evalObj && evalObj.dimensions) || {};
	function dim10(key) {
		const d = dims[key];
		return d && typeof d.score === 'number' ? (d.score / 10).toFixed(1) : '-';
	}
	function dimLabel(key, fallback) {
		const d = dims[key];
		return d && d.label ? d.label : fallback;
	}

	// 오류 / 결정 요약.
	const errorsDir = path.join(repoRoot, 'harness', 'errors');
	const errorFiles = existsSync(errorsDir) ? readdirSync(errorsDir).filter((f) => f.endsWith('.md')) : [];

	const followups = complaints.length
		? complaints.map((c, i) => `- ${i + 1}. [${c.severity}] ${c.dimension}/${c.item}`)
		: ['- (미해결 불만 없음 — major 0건)'];

	return [
		`# 하니스 실행 최종 보고서`,
		``,
		`> 통합 데모(\`node scripts/demo.mjs\`)가 생성한 최종 보고서입니다. 값은 \`harness/evaluations/eval-0001\` 등 실제 런타임 산출물에서 채워졌습니다.`,
		``,
		`- 실행 ID: \`demo-US-010\``,
		`- 브랜치: \`${config.skipGitFlow ? '(git 미사용)' : 'main (+ step/<nn>-<slug>)'}\``,
		`- git 사용: \`useGit=${config.useGit ?? 'n/a'}\`  MCP: \`useMcp=${config.useMcp ?? 'n/a'}\``,
		`- 최종 상태(status): \`${loopDone ? 'done (데모 1-step 완주)' : 'running'}\``,
		`- 실행 페이즈: \`${executedPhases.join(' → ')}\``,
		``,
		`---`,
		``,
		`## 1. 종합 평점`,
		``,
		`| 항목 | 값 |`,
		`| --- | --- |`,
		`| 종합 평점 | \`${score10}\` / 10 (원점수 ${score100}/100) |`,
		`| 판정 | \`${verdict}\` (pass / needs-rework / blocked) |`,
		`| major 불만 | \`${major}\`건 |`,
		``,
		`한줄평: \`${major === 0 && score100 >= 90 ? '전 차원 임계 충족 — 종료 조건 만족' : '임계 미달 또는 불만 존재 — 재작업 후보'}\``,
		``,
		`---`,
		``,
		`## 2. 차원별 평점`,
		``,
		`> \`harness/evaluations/eval-0001\` 의 4차원(UI/UX/기능/품질) 점수를 10점 척도로 환산했습니다.`,
		``,
		`| 차원 | 점수 (/10) | 비고 |`,
		`| --- | --- | --- |`,
		`| ${dimLabel('ui', 'UI')} | \`${dim10('ui')}\` | 가중치 ${dims.ui?.weight ?? '-'} |`,
		`| ${dimLabel('ux', 'UX')} | \`${dim10('ux')}\` | 가중치 ${dims.ux?.weight ?? '-'} |`,
		`| ${dimLabel('fn', '기능')} | \`${dim10('fn')}\` | 가중치 ${dims.fn?.weight ?? '-'} |`,
		`| ${dimLabel('quality', '품질')} | \`${dim10('quality')}\` | 가중치 ${dims.quality?.weight ?? '-'} |`,
		``,
		`---`,
		``,
		`## 3. 단계 요약`,
		``,
		`> 데모는 1-step 계획(\`01-demo\`)을 \`decompose → … → merge\` 로 완주했습니다.`,
		``,
		`| # | 단계(step) | 실행 페이즈 | 결과 |`,
		`| --- | --- | --- | --- |`,
		`| 0 | \`01-demo\` | \`${executedPhases.join(' → ') || '-'}\` | \`${loopDone ? 'done (merge 완료)' : 'running'}\` |`,
		``,
		`---`,
		``,
		`## 4. 주요 의사결정`,
		``,
		`> 통합 데모의 협의 결정 시연: 총 ${decisionFiles.length}건 (임시 격리 — 실제 \`harness/decisions/\` 는 변경하지 않음).`,
		``,
		...(decisionFiles.length ? decisionFiles.map((f) => `- (임시 격리) \`${f}\``) : ['- (결정 없음)']),
		``,
		`## 5. 오류 및 수정`,
		``,
		`> \`harness/errors/\` 요약 (총 ${errorFiles.length}건, 데모/예시 포함).`,
		``,
		...(errorFiles.length ? errorFiles.map((f) => `- \`harness/errors/${f}\``) : ['- (오류 없음)']),
		``,
		`## 6. 후속 과제 / 미해결 불만`,
		``,
		`> \`harness/evaluations/\` 의 불만(개선점) 집계. **미해결 불만 수: ${complaints.length}건 (major ${major}건)**.`,
		``,
		...followups,
		``,
	].join('\n');
}
