#!/usr/bin/env node
// git-flow.selftest.mjs — git-flow.mjs 자가 검증 (US-006)
// 반드시 os.tmpdir 의 임시 git 저장소에서만 동작하며,
// 실제 harness-setup 저장소는 절대 변경하지 않습니다.
// 성공: 'GITFLOW SELFTEST: PASS' 출력 + exit 0 / 실패: 실패 목록 + exit 1.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(__filename);
const gitFlow = path.join(scriptsDir, 'git-flow.mjs');

const failures = [];
function check(label, condition) {
	if (condition) {
		console.log(`  ✓ ${label}`);
	} else {
		console.log(`  ✗ ${label}`);
		failures.push(label);
	}
}

/** 임시 디렉터리에 git 저장소 초기화 + 로컬 user 설정 */
function makeTempRepo(skipGitFlow) {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'gitflow-selftest-'));
	try {
		execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'pipe' });
	} catch {
		execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
		execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir, stdio: 'pipe' });
	}
	execFileSync('git', ['config', 'user.name', 'Harness Selftest'], { cwd: dir, stdio: 'pipe' });
	execFileSync('git', ['config', 'user.email', 'selftest@harness.local'], { cwd: dir, stdio: 'pipe' });
	execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'pipe' });
	mkdirSync(path.join(dir, 'harness'), { recursive: true });
	writeFileSync(
		path.join(dir, 'harness', 'config.json'),
		JSON.stringify({ useGit: !skipGitFlow, useMcp: false, mcpServers: [], skipGitFlow }, null, 2) + '\n',
		'utf8',
	);
	// 시드 대상이 될 파일 하나
	writeFileSync(path.join(dir, 'README.md'), '# selftest fixture\n', 'utf8');
	return dir;
}

/** 임시 저장소에서 git-flow.mjs 실행 → {code, stdout, stderr} */
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
		return {
			code: err.status ?? 1,
			stdout: (err.stdout || '').toString(),
			stderr: (err.stderr || '').toString(),
		};
	}
}

/** 임시 저장소에서 git 헬퍼 */
function git(dir, args) {
	return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
}
function commitCount(dir) {
	try {
		return Number(git(dir, ['rev-list', '--count', 'main']));
	} catch {
		return 0;
	}
}
function currentBranch(dir) {
	try {
		return git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
	} catch {
		return '';
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
function isAncestor(dir, ancestor, descendant) {
	try {
		git(dir, ['merge-base', '--is-ancestor', ancestor, descendant]);
		return true;
	} catch {
		return false;
	}
}

function runMainFlowTests() {
	console.log('[1] skipGitFlow=false — 전체 플로우');
	const dir = makeTempRepo(false);
	try {
		// seed-main: 시드 커밋 생성
		const seed1 = runGitFlow(dir, ['seed-main']);
		check('seed-main exit 0', seed1.code === 0);
		const afterSeed = commitCount(dir);
		check('seed-main 후 main 커밋 1개', afterSeed === 1);

		// seed-main 멱등성: 재실행해도 커밋 수 불변 + skip 로그
		const seed2 = runGitFlow(dir, ['seed-main']);
		check('seed-main 재실행 exit 0', seed2.code === 0);
		check('seed-main 재실행 멱등 (커밋 수 불변)', commitCount(dir) === afterSeed);
		check('seed-main 재실행 skip 로그', /seed skipped \(main already seeded\)/.test(seed2.stdout));

		// start-step 01 demo
		const start = runGitFlow(dir, ['start-step', '01', 'demo']);
		check('start-step exit 0', start.code === 0);
		check('브랜치 step/01-demo 존재', branchExists(dir, 'step/01-demo'));
		check('step/01-demo 체크아웃됨', currentBranch(dir) === 'step/01-demo');

		// step 브랜치에서 변경 + 커밋
		writeFileSync(path.join(dir, 'feature.txt'), 'demo work\n', 'utf8');
		git(dir, ['add', '-A']);
		git(dir, ['commit', '-m', 'feat: demo step work']);
		const stepCommit = git(dir, ['rev-parse', 'HEAD']);

		// merge-step (gate NOT ok): 거부 + exit != 0
		const mergeNoGate = runGitFlow(dir, ['merge-step', '01', 'demo']);
		check('merge-step gate 미충족 시 exit != 0', mergeNoGate.code !== 0);
		check('merge-step gate 미충족 거부 로그', /done-gate 실패/.test(mergeNoGate.stderr));
		check('gate 미충족 시 main 미병합 (커밋 수 불변)', commitCount(dir) === afterSeed);

		// merge-step (HARNESS_GATE_OK=1): main 에 병합
		const mergeOk = runGitFlow(dir, ['merge-step', '01', 'demo'], { HARNESS_GATE_OK: '1' });
		check('merge-step gate ok exit 0', mergeOk.code === 0);
		const mainLog = git(dir, ['log', '--oneline', 'main']);
		check('merge-step 후 main 커밋 증가', commitCount(dir) > afterSeed);
		check('step 커밋이 main 조상에 포함', isAncestor(dir, stepCommit, 'main'));
		check('main 에 merge 커밋 존재', /merge: step\/01-demo → main/.test(mainLog));

		// 직접 main 작업 차단: --gate-ok 플래그 폴백 경로도 확인 (별도 step)
		const start2 = runGitFlow(dir, ['start-step', '02', 'flag']);
		check('start-step 02 flag exit 0', start2.code === 0);
		writeFileSync(path.join(dir, 'flag.txt'), 'flag work\n', 'utf8');
		git(dir, ['add', '-A']);
		git(dir, ['commit', '-m', 'feat: flag step work']);
		const mergeFlag = runGitFlow(dir, ['merge-step', '02', 'flag', '--gate-ok']);
		check('merge-step --gate-ok exit 0', mergeFlag.code === 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function runSkipFlowTests() {
	console.log('[2] skipGitFlow=true — 전 명령 no-op');
	const dir = makeTempRepo(true);
	try {
		const seed = runGitFlow(dir, ['seed-main']);
		check('skipGitFlow seed-main exit 0 (no-op)', seed.code === 0);
		check('skipGitFlow seed-main 커밋 생성 안함', commitCount(dir) === 0);
		check('skipGitFlow seed-main no-op 로그', /seed skipped \(skipGitFlow=true/.test(seed.stdout));

		const start = runGitFlow(dir, ['start-step', '01', 'demo']);
		check('skipGitFlow start-step exit 0 (no-op)', start.code === 0);
		check('skipGitFlow start-step 브랜치 생성 안함', !branchExists(dir, 'step/01-demo'));
		check('skipGitFlow start-step no-op 로그', /start-step skipped \(skipGitFlow=true/.test(start.stdout));

		const merge = runGitFlow(dir, ['merge-step', '01', 'demo']);
		check('skipGitFlow merge-step exit 0 (no-op)', merge.code === 0);
		check('skipGitFlow merge-step no-op 로그', /merge-step skipped \(skipGitFlow=true/.test(merge.stdout));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function runDirectMainGuardTests() {
	console.log('[3] assertNotDirectMainWork — 직접 main 작업 차단');
	const dir = makeTempRepo(false);
	try {
		runGitFlow(dir, ['seed-main']);
		// import 한 가드를 임시 저장소 cwd 에서 평가하기 위해 별도 노드 프로세스로 검증
		const probe = `
import { assertNotDirectMainWork } from ${JSON.stringify(pathToFileURL(gitFlow).href)};
try {
  assertNotDirectMainWork('test-commit');
  console.log('GUARD_NO_THROW');
} catch (e) {
  console.log('GUARD_THROW');
}
`;
		const probePath = path.join(dir, 'probe.mjs');
		writeFileSync(probePath, probe, 'utf8');
		// 현재 main 체크아웃 상태 → throw 되어야 함
		const onMain = execFileSync('node', [probePath], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
		check('main 에서 직접 작업 시 가드 throw', /GUARD_THROW/.test(onMain));

		// step 브랜치로 이동 → throw 안되어야 함
		runGitFlow(dir, ['start-step', '03', 'guard']);
		const onStep = execFileSync('node', [probePath], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
		check('step 브랜치에서는 가드 통과', /GUARD_NO_THROW/.test(onStep));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function runRemoteFlowTests() {
	console.log('[4] origin push — 원격 있으면 step 브랜치·main push');
	const dir = makeTempRepo(false);
	const bare = mkdtempSync(path.join(os.tmpdir(), 'gitflow-bare-'));
	try {
		execFileSync('git', ['init', '--bare', bare], { stdio: 'pipe' });
		execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir, stdio: 'pipe' });
		runGitFlow(dir, ['seed-main']);
		runGitFlow(dir, ['start-step', '01', 'pushdemo']);
		writeFileSync(path.join(dir, 'p.txt'), 'push work\n', 'utf8');
		git(dir, ['add', '-A']);
		git(dir, ['commit', '-m', 'feat: push step work']);
		const merge = runGitFlow(dir, ['merge-step', '01', 'pushdemo', '--gate-ok']);
		check('remote merge-step exit 0', merge.code === 0);
		check('merge-step 로그에 main push 완료', /push 완료: origin main/.test(merge.stdout));
		check('merge-step 로그에 step 브랜치 push 완료', /push 완료: origin step\/01-pushdemo/.test(merge.stdout));
		const bareRef = (name) => {
			try {
				return execFileSync('git', ['rev-parse', name], { cwd: bare, encoding: 'utf8' }).trim();
			} catch {
				return '';
			}
		};
		check('원격(bare) main == 로컬 main (push 반영)', bareRef('main') !== '' && bareRef('main') === git(dir, ['rev-parse', 'main']));
		check('원격(bare) 에 step 브랜치 push 됨', bareRef('step/01-pushdemo') !== '');
	} finally {
		rmSync(dir, { recursive: true, force: true });
		rmSync(bare, { recursive: true, force: true });
	}
}

function runNoRemotePushSkipTest() {
	console.log('[5] origin 없으면 push 생략 (병합은 계속)');
	const dir = makeTempRepo(false);
	try {
		runGitFlow(dir, ['seed-main']);
		runGitFlow(dir, ['start-step', '01', 'noremote']);
		writeFileSync(path.join(dir, 'n.txt'), 'no remote\n', 'utf8');
		git(dir, ['add', '-A']);
		git(dir, ['commit', '-m', 'feat: no-remote work']);
		const merge = runGitFlow(dir, ['merge-step', '01', 'noremote', '--gate-ok']);
		check('no-remote merge-step exit 0', merge.code === 0);
		check('no-remote merge-step push 생략 로그', /push 생략: origin 미설정/.test(merge.stdout));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function main() {
	console.log('=== git-flow selftest (임시 저장소에서만 실행) ===');
	console.log(`temp base: ${os.tmpdir()}`);
	try {
		runMainFlowTests();
		runSkipFlowTests();
		runDirectMainGuardTests();
		runRemoteFlowTests();
		runNoRemotePushSkipTest();
	} catch (err) {
		console.error('SELFTEST 예외:', err.message);
		failures.push(`예외: ${err.message}`);
	}

	console.log('');
	if (failures.length === 0) {
		console.log('GITFLOW SELFTEST: PASS');
		process.exit(0);
	} else {
		console.log(`GITFLOW SELFTEST: FAIL (${failures.length}개 실패)`);
		for (const f of failures) console.log(`  - ${f}`);
		process.exit(1);
	}
}

main();
