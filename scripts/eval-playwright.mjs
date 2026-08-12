#!/usr/bin/env node
// eval-playwright.mjs — 고객 평가 (Playwright) + 루브릭 채점 + Windows teardown (US-009)
//
// 동작 개요:
//   1) vite dev 서버를 FIXED 포트(기본 8000)에 detached/background child 로 띄운다(pid 캡처).
//   2) http://localhost:<port> 가 준비될 때까지 폴링(기본 타임아웃 ~30s).
//   3) @playwright/test 가 설치돼 있으면 chromium headless 로 앱에 접속해
//      스크린샷(harness/evaluations/<id>/screenshot.png) 과 기본 관찰값(title/heading 등)을 수집.
//   4) docs/eval-rubric.md 의 고정 루브릭으로 채점(scripts/lib/rubric.mjs). --score/--major-complaints
//      주입 시 결정적으로 덮어씀.
//   5) harness/evaluations/<id>.md (+ <id>.json) 기록 — done-gate 계약 필드(score, majorComplaints).
//   6) **TEARDOWN(critical, Windows)**: finally 에서 항상 dev 서버 프로세스 트리를
//      `taskkill /F /T /PID` 로 종료하고, 포트가 free 인지 검증·로그한다. orphan node/vite 미잔존 보장.
//   7) Playwright 미설치/브라우저 실패 → STATIC FALLBACK 평가 로그('Playwright 미설치 — 정적 폴백')
//      를 쓰고도 dev 서버 teardown 은 수행. exit 0.
//
// 실행:
//   node scripts/eval-playwright.mjs [--port=8000] [--id=eval-0001]
//                                    [--score=N] [--major-complaints=N] [--no-server]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readGateStatus } from './done-gate.mjs';
import { allAcIds, checkAcCoverage, findStep, readPlan, scenarioSpecPath } from './lib/plan.mjs';
import { applyInjectedScore, DIMENSIONS, scoreObservations } from './lib/rubric.mjs';
import { cycleIdOf, readState, stateFilePath, stepIdOf } from './lib/state.mjs';
import { isPortInUse, teardownDevServer } from './lib/teardown.mjs';

const DEFAULT_PORT = 8000;
const READY_TIMEOUT_MS = 30_000;
const isWin = process.platform === 'win32';

/** 사람용 로그는 stderr 로(머신리더블 stdout 오염 방지). */
function log(...args) {
	console.error('[eval]', ...args);
}

/** CLI 인자 파싱. */
function parseArgs(argv) {
	const opts = {
		port: DEFAULT_PORT,
		id: undefined,
		score: undefined,
		majorComplaints: undefined,
		noServer: false,
		gatesGreen: undefined,
	};
	for (const arg of argv) {
		if (arg.startsWith('--port=')) opts.port = Number(arg.slice('--port='.length));
		else if (arg.startsWith('--id=')) opts.id = arg.slice('--id='.length);
		else if (arg.startsWith('--score=')) opts.score = Number(arg.slice('--score='.length));
		else if (arg.startsWith('--major-complaints=')) opts.majorComplaints = Number(arg.slice('--major-complaints='.length));
		else if (arg === '--no-server') opts.noServer = true;
		else if (arg.startsWith('--gates-green=')) opts.gatesGreen = arg.slice('--gates-green='.length) !== 'false';
	}
	return opts;
}

/**
 * 루브릭 `q.gates-green` 에 넣을 **실측** 게이트 상태를 구한다.
 *
 * 예전에는 호출부가 `gatesGreen: true` 를 하드코딩해 넘겨서, 게이트가 실제로 깨져 있어도
 * 이 항목(major, weight 40)이 항상 만점을 받았다 — 종합 8점이 무조건 지급되던 실측 버그.
 * 이제 verify 페이즈가 남긴 `harness/gate-status.json` 의 **이번 사이클 결과**를 읽는다.
 *
 * 우선순위: `--gates-green=` 주입 > 이번 사이클 gate-status > 알 수 없음(false).
 * "알 수 없음"을 통과로 치지 않는 것이 핵심이다 — 모르면 만점을 주지 않는다.
 *
 * @param {string} repoRoot
 * @param {{gatesGreen?:boolean}} opts
 * @param {object|null} state
 * @returns {{gatesGreen:boolean, source:'injected'|'gate-status'|'unknown'}}
 */
export function resolveGatesGreen(repoRoot, opts, state) {
	if (opts?.gatesGreen !== undefined) {
		return { gatesGreen: opts.gatesGreen === true, source: 'injected' };
	}
	const status = readGateStatus(repoRoot, cycleIdOf(state));
	if (status) {
		return { gatesGreen: status.passed === true, source: 'gate-status' };
	}
	return { gatesGreen: false, source: 'unknown' };
}

/** 다음 평가 id 생성: harness/evaluations 의 eval-*.json 수 기반 결정적 시퀀스. */
function nextEvalId(repoRoot) {
	const dir = path.join(repoRoot, 'harness', 'evaluations');
	let count = 0;
	try {
		count = readdirSync(dir).filter((f) => /^eval-\d+\.json$/.test(f)).length;
	} catch {
		count = 0;
	}
	return `eval-${String(count + 1).padStart(4, '0')}`;
}

/**
 * 기대 앱 이름 = package.json 의 name. reset-project 가 새 프로젝트명으로 치환하므로
 * (제목/heading 도 함께 치환됨) 평가의 기대값도 하드코딩('harness-setup') 대신 여기서 따른다.
 * 못 읽으면 'harness-setup' 폴백.
 */
function expectedAppName(repoRoot) {
	try {
		const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
		return typeof pkg.name === 'string' && pkg.name.trim() ? pkg.name.trim() : 'harness-setup';
	} catch {
		return 'harness-setup';
	}
}

/** vite dev 서버를 FIXED 포트에 detached child 로 띄운다. */
function startDevServer(repoRoot, port) {
	// yarn 4 berry: `yarn dev` → vite --host. 포트는 --port 로 고정.
	// Windows 에서 .cmd 래퍼는 shell 경유가 필요(execFile EINVAL 회피, done-gate.mjs 참고).
	const args = ['dev', '--port', String(port), '--strictPort'];
	const child = spawn('yarn', args, {
		cwd: repoRoot,
		detached: !isWin, // POSIX: 자체 프로세스 그룹 → kill(-pid) 로 트리 종료. Windows 는 taskkill /T.
		shell: isWin, // Windows: yarn.cmd 래퍼 셸 경유.
		stdio: 'ignore',
		windowsHide: true,
	});
	child.unref?.();
	return child;
}

/** 단일 HTTP GET → status code (실패 시 null). */
function probe(port) {
	return new Promise((resolve) => {
		const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
			res.resume();
			resolve(res.statusCode ?? null);
		});
		req.on('timeout', () => {
			req.destroy();
			resolve(null);
		});
		req.on('error', () => resolve(null));
	});
}

/** 서버가 준비될 때까지 폴링. */
async function waitForReady(port, timeoutMs = READY_TIMEOUT_MS) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const code = await probe(port);
		if (code && code < 500) return true;
		await new Promise((r) => setTimeout(r, 400));
	}
	return false;
}

/** @playwright/test 가 resolve 가능한지. */
async function tryLoadPlaywright() {
	try {
		const mod = await import('@playwright/test');
		return mod.chromium ? mod : null;
	} catch {
		return null;
	}
}

/**
 * 정적 폴백 관찰값 — index.html 을 파싱해 **정말로 알 수 있는 것만** 채운다(Playwright 없이).
 *
 * ⚠️ 미관찰은 `null` 이다 (2차 자기진단 F19). 예전에는 관찰하지 않은 항목을
 * `layoutStable: true`·`responsiveLayout: true`·`a11yViolations: 0` 처럼 통과로 채우고,
 * 심지어 `appMounted: serverReady === true`·`runtimeErrors: 0` 처럼 **브라우저를 띄우지도 않고
 * 앱이 마운트됐고 런타임 에러가 없다고 단정**했다. 그 결과 정적 폴백만으로 종합 92점 / major 0 →
 * done-gate PASS 가 났다(실측). `resolveGatesGreen` 은 이미 "모르면 false" 로 고쳐져 있었는데
 * 나머지 필드에는 같은 원칙이 적용되지 않은 **부분 수정** 상태였다.
 *
 * 이제 폴백은 구조적으로 임계(90)를 넘을 수 없다 — 관찰하지 못했으면 점수를 주지 않는다.
 * 서버 준비 여부(serverReady)는 호출자가 주입(HTTP 프로브로 실제 관찰한 값).
 */
function staticObservations(repoRoot, { serverReady, gatesGreen, e2ePassed }) {
	const expected = expectedAppName(repoRoot);
	let title = null;
	let headingPresent = false;
	let hasViewportMeta = false;
	try {
		const html = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
		const m = html.match(/<title>([^<]*)<\/title>/i);
		title = m ? m[1].trim() : null;
		hasViewportMeta = /name=["']viewport["']/i.test(html);
		// App.tsx 의 heading 텍스트 확인(정적): <h1><프로젝트명></h1> (= package.json name)
		headingPresent = existsSync(path.join(repoRoot, 'src', 'app', 'App.tsx'))
			? readFileSync(path.join(repoRoot, 'src', 'app', 'App.tsx'), 'utf8').includes(expected)
			: false;
	} catch {
		/* 파싱 실패 → 기본값 유지 */
	}
	return {
		// ── 정적으로 관찰 가능한 것 ──
		titleMatches: title === expected, // index.html 파싱
		headingPresent, // App.tsx 소스 확인
		hasViewportMeta, // index.html 파싱
		serverReady: serverReady === true, // HTTP 프로브 실측
		gatesGreen: gatesGreen === true, // gate-status.json 실측
		e2ePassed: e2ePassed === undefined ? null : e2ePassed, // eval-scenario 산출물(있으면)
		// ── DOM 을 보지 않고는 알 수 없는 것 → null(미관찰) ──
		bodyNonEmpty: null,
		consoleErrors: null,
		layoutStable: null,
		responsiveLayout: null,
		hasLandmarks: null,
		appMounted: null,
		runtimeErrors: null,
		navigable: null,
		a11yViolations: null,
		screenshotOk: false, // 폴백은 스크린샷 없음(관찰이 아니라 사실)
		observable: false, // 실측 관찰 불가
	};
}

/**
 * 이번 사이클의 상호작용(E2E) 결과를 읽는다 — 루브릭 `fn.e2e-verified` 의 입력.
 * loop 의 verify 가 `harness/evaluations/scen-step-<idx>-r<rework>/scenario.json` 을 남긴다.
 * 파일이 없으면 null(미관찰) → 그 항목은 major 불만이 된다.
 * @returns {boolean|null}
 */
export function readE2eOutcome(repoRoot, state) {
	const scenId = `scen-${cycleIdOf(state).replace('#', '-r')}`;
	try {
		const raw = JSON.parse(readFileSync(path.join(repoRoot, 'harness', 'evaluations', scenId, 'scenario.json'), 'utf8'));
		return raw.passed === true;
	} catch {
		return null;
	}
}

/**
 * AC 실증 관찰 — 루브릭 `fn.ac-verified`(단일 최대 가중)의 입력.
 *
 * "검증됨" 의 정의: 이 step 의 **모든 AC 가 단언으로 덮였고**(plan.json ↔ eval-scenario.json 커버리지 —
 * verify preflight 와 같은 판정 함수) **그 단언들이 이번 사이클 E2E 에서 실제 통과**(scenario.json)했다.
 * plan.json 이 없거나 이 step 에 AC 가 없으면 applicable=false — 루브릭이 명시 skip 으로 처리한다
 * (환경 부재만 skip, 미관찰은 불만 — F19 원칙 유지).
 *
 * @param {string} repoRoot
 * @param {object|null} state
 * @param {boolean|null} e2ePassed readE2eOutcome 결과
 * @returns {{applicable:boolean, verified:boolean|null, total:number, missing:string[]}}
 */
export function readAcVerification(repoRoot, state, e2ePassed) {
	const { present, plan, error } = readPlan(repoRoot);
	if (!present || error || !plan) return { applicable: false, verified: null, total: 0, missing: [] };
	const idx = state?.currentStepIdx ?? 0;
	const label = (state?.planSteps ?? [])[idx];
	const { step } = findStep(plan, { label, idx });
	let spec = null;
	try {
		spec = JSON.parse(readFileSync(scenarioSpecPath(repoRoot), 'utf8'));
	} catch {
		spec = null;
	}
	const cov = checkAcCoverage(step, spec, { knownAcIds: allAcIds(plan) });
	if (!cov.applicable) return { applicable: false, verified: null, total: 0, missing: [] };
	return { applicable: true, verified: cov.ok && e2ePassed === true, total: cov.total, missing: cov.missing };
}

/** Playwright 로 실측 관찰값 수집 + 스크린샷. 실패 시 null. */
async function playwrightObservations(pw, port, shotPath, { gatesGreen, expectedName, e2ePassed }) {
	let browser;
	try {
		browser = await pw.chromium.launch({ headless: true });
		const page = await browser.newPage();
		const consoleErrors = [];
		const runtimeErrors = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error') consoleErrors.push(msg.text());
		});
		page.on('pageerror', (err) => runtimeErrors.push(String(err)));

		await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 15_000 });
		// React 마운트 대기(짧게).
		await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

		const title = await page.title();
		const headingPresent = (await page.locator('h1', { hasText: expectedName }).count()) > 0;
		const bodyText = (await page.locator('body').innerText().catch(() => '')) ?? '';
		const rootChildren = await page.evaluate(() => {
			const el = document.getElementById('root');
			return el ? el.childElementCount : 0;
		});
		const hasViewportMeta = (await page.locator('meta[name="viewport"]').count()) > 0;

		mkdirSync(path.dirname(shotPath), { recursive: true });
		await page.screenshot({ path: shotPath, fullPage: true });
		// DOM/HTML 덤프 — ui/ux/customer 에이전트가 평가 시 실제로 읽도록 로그로 남긴다(B3: 캡처물 소비 평가).
		const domPath = path.join(path.dirname(shotPath), 'dom.html');
		writeFileSync(domPath, await page.content(), 'utf8');

		// a11y(경량): landmark 존재 여부 + html lang / img alt / 접근가능한 이름 위반 카운트
		const hasLandmarks =
			(await page.locator('nav, main, header, footer, aside, [role="navigation"], [role="main"]').count()) > 0;
		const a11yViolations = await page.evaluate(() => {
			let v = 0;
			if (!document.documentElement.getAttribute('lang')) v += 1;
			v += document.querySelectorAll('img:not([alt])').length;
			for (const el of Array.from(document.querySelectorAll('a, button'))) {
				const name = (el.textContent ?? '').trim() || el.getAttribute('aria-label') || el.getAttribute('title');
				if (!name) v += 1;
			}
			return v;
		});

		// 반응형: 모바일 폭(375px)에서 가로 overflow(스크롤) 확인 + 모바일 화면 캡처(B3) 후 원복
		await page.setViewportSize({ width: 375, height: 800 });
		const responsiveLayout = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
		const mobileShotPath = path.join(path.dirname(shotPath), 'screenshot-mobile.png');
		await page.screenshot({ path: mobileShotPath, fullPage: true });
		await page.setViewportSize({ width: 1280, height: 800 });

		// 실제 내비게이션: 첫 내부 링크 클릭 후에도 앱(#root)이 살아있는지 (단일 페이지면 기본 통과)
		let navigable = true;
		try {
			const link = page.locator('a[href^="/"]').first();
			if ((await link.count()) > 0) {
				await link.click();
				await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
				navigable =
					(await page.evaluate(() => {
						const el = document.getElementById('root');
						return el ? el.childElementCount : 0;
					})) > 0;
			}
		} catch {
			navigable = false;
		}

		await browser.close();

		return {
			bodyNonEmpty: bodyText.trim().length > 0 || rootChildren > 0,
			titleMatches: title === expectedName,
			headingPresent,
			consoleErrors: consoleErrors.length,
			serverReady: true,
			layoutStable: true,
			hasViewportMeta,
			responsiveLayout,
			hasLandmarks,
			appMounted: rootChildren > 0,
			runtimeErrors: runtimeErrors.length,
			navigable,
			a11yViolations,
			gatesGreen: gatesGreen === true,
			// 상호작용 실증 — verify 가 남긴 이번 사이클 산출물. 없으면 null(미관찰 → major 불만).
			e2ePassed: e2ePassed === undefined ? null : e2ePassed,
			screenshotOk: existsSync(shotPath),
			domOk: existsSync(domPath),
			screenshotMobileOk: existsSync(mobileShotPath),
			observable: true,
			_raw: { title, rootChildren, consoleErrors, runtimeErrors, hasLandmarks, a11yViolations, responsiveLayout, navigable },
		};
	} catch (err) {
		log('Playwright 관찰 실패:', err?.message ?? err);
		try {
			await browser?.close();
		} catch {
			/* ignore */
		}
		return null;
	}
}

/** 평가 결과 객체를 JSON + MD 로 기록 (원자적). */
function writeEvaluation(repoRoot, id, evalObj, shotRelPath) {
	const dir = path.join(repoRoot, 'harness', 'evaluations');
	mkdirSync(dir, { recursive: true });

	// JSON (done-gate 계약: score, majorComplaints)
	const jsonPath = path.join(dir, `${id}.json`);
	const jsonTmp = `${jsonPath}.tmp`;
	writeFileSync(jsonTmp, JSON.stringify(evalObj, null, 2) + '\n', 'utf8');
	renameSync(jsonTmp, jsonPath);

	// MD (사람용)
	const dimRows = DIMENSIONS.map((d) => {
		const ds = evalObj.dimensions[d.key];
		return `| ${d.label} | ${ds.score} | ${d.dimWeight} |`;
	}).join('\n');

	const complaintRows = evalObj.complaints.length
		? evalObj.complaints
				.map((c) => `| ${c.dimension} | ${c.item} | ${c.severity} | ${c.reason === 'unobserved' ? '미관찰' : '관찰 실패'} |`)
				.join('\n')
		: '| — | (불만 없음) | — | — |';

	const md = [
		`# 평가 로그 — ${id}`,
		``,
		`- 모드: \`${evalObj.mode}\`${evalObj.mode === 'static-fallback' ? ' (Playwright 미설치 — 정적 폴백)' : ''}`,
		`- 생성: ${evalObj.createdAt}`,
		`- **종합 점수: ${evalObj.score} / 100**`,
		`- **major 불만: ${evalObj.majorComplaints}건**${evalObj.injected ? ' (주입값 적용)' : ''}`,
		`- 스크린샷: ${shotRelPath ?? '(없음)'}`,
		``,
		`## 차원 점수`,
		``,
		`| 차원 | 점수(0~100) | 가중치 |`,
		`| --- | --- | --- |`,
		dimRows,
		``,
		`## 불만 목록 (실패한 체크리스트 항목)`,
		``,
		`| 차원 | 항목 | 심각도 | 사유 |`,
		`| --- | --- | --- | --- |`,
		complaintRows,
		``,
		`## 관찰값`,
		``,
		'```json',
		JSON.stringify(evalObj.observations, null, 2),
		'```',
		``,
	].join('\n');

	const mdPath = path.join(dir, `${id}.md`);
	const mdTmp = `${mdPath}.tmp`;
	writeFileSync(mdTmp, md, 'utf8');
	renameSync(mdTmp, mdPath);

	return { jsonPath, mdPath };
}

/** 메인 평가 흐름. */
export async function runEvaluation(opts, repoRoot) {
	const port = opts.port ?? DEFAULT_PORT;
	const id = opts.id ?? nextEvalId(repoRoot);
	const shotPath = path.join(repoRoot, 'harness', 'evaluations', id, 'screenshot.png');
	const shotRel = path.relative(repoRoot, shotPath).split(path.sep).join('/');

	let child;
	let serverReady = false;
	let mode = 'static-fallback';
	let observations;

	// 현재 사이클 식별자 + 결정적 게이트의 **실측** 상태를 먼저 확정한다.
	// (게이트 상태는 관찰값의 입력이므로 서버 기동보다 앞서 결정)
	const st = readState(stateFilePath(repoRoot));
	const { gatesGreen, source: gatesSource } = resolveGatesGreen(repoRoot, opts, st);
	if (gatesSource === 'unknown') {
		log(
			`⚠ 게이트 상태 미확인 — 이번 사이클(${cycleIdOf(st)})의 harness/gate-status.json 이 없습니다. ` +
				`q.gates-green 을 실패로 처리합니다. verify 페이즈(done-gate)를 먼저 실행하거나 --gates-green=true 로 주입하세요.`,
		);
	} else {
		log(`게이트 상태(${gatesSource}): ${gatesGreen ? 'green' : 'RED'}`);
	}

	// 상호작용(E2E) 실증 결과 — 루브릭 fn.e2e-verified 의 입력. verify 가 먼저 돌아야 존재한다.
	const e2ePassed = readE2eOutcome(repoRoot, st);
	if (e2ePassed === null) {
		log(
			`⚠ 상호작용(E2E) 산출물 없음 — 이번 사이클(${cycleIdOf(st)})의 scenario.json 이 없습니다. ` +
				`fn.e2e-verified 를 실패(major)로 처리합니다. verify 페이즈를 먼저 실행하세요.`,
		);
	} else {
		log(`상호작용(E2E) 실증: ${e2ePassed ? 'PASS' : 'FAIL'}`);
	}

	// AC 실증 — 루브릭 fn.ac-verified(단일 최대 가중)의 입력 (4순위 verdict).
	const ac = readAcVerification(repoRoot, st, e2ePassed);
	if (!ac.applicable) {
		log('AC 실증: 해당 없음(plan.json 없음 또는 이 step 의 AC 미선언) — fn.ac-verified 는 명시 skip');
	} else {
		log(
			`AC 실증: ${ac.verified ? `검증됨 (AC ${ac.total}건 전부 단언 커버 + E2E 통과)` : `미검증 — ${ac.missing.length ? `미커버 ${ac.missing.join(', ')}` : 'E2E 미통과/미실행'} → major`}`,
		);
	}

	try {
		// 1) dev 서버 기동 (--no-server 면 생략 — 외부에서 띄운 서버 가정)
		if (!opts.noServer) {
			log(`dev 서버 기동: yarn dev --port ${port} --strictPort (detached)`);
			child = startDevServer(repoRoot, port);
			log(`pid=${child.pid} — http://127.0.0.1:${port} 준비 대기(최대 ${READY_TIMEOUT_MS / 1000}s)`);
			serverReady = await waitForReady(port);
			log(`서버 준비: ${serverReady ? 'OK' : '타임아웃'}`);
		} else {
			serverReady = await waitForReady(port, 3_000);
		}

		// 2) Playwright 실측 시도 → 실패/미설치 시 정적 폴백
		const pw = serverReady ? await tryLoadPlaywright() : null;
		if (pw && serverReady) {
			observations = await playwrightObservations(pw, port, shotPath, {
				gatesGreen,
				expectedName: expectedAppName(repoRoot),
				e2ePassed,
			});
			if (observations) {
				mode = 'playwright';
			} else {
				log('Playwright 브라우저 실패 → 정적 폴백으로 전환');
				observations = staticObservations(repoRoot, { serverReady, gatesGreen, e2ePassed });
			}
		} else {
			if (!pw) log('Playwright 미설치 — 정적 폴백(미관찰 항목은 감점 → 임계 통과 불가)');
			observations = staticObservations(repoRoot, { serverReady, gatesGreen, e2ePassed });
		}

		// AC 실증 관찰 주입 — 관찰 수집 방식(playwright/정적 폴백)과 무관한 파일 산출물 기반이므로 공통.
		if (observations) {
			observations.acApplicable = ac.applicable;
			observations.acVerified = ac.applicable ? ac.verified : null;
			observations.acTotal = ac.total;
		}

		// 3) 채점 (루브릭) + 주입 오버라이드
		const computed = scoreObservations(observations);
		const finalScore = applyInjectedScore(computed, {
			score: opts.score,
			majorComplaints: opts.majorComplaints,
		});

		// 현재 step/사이클 식별자를 평가에 스탬프한다 — done-gate 의 freshness 게이트가
		// "이번 사이클의 신선한 평가"인지 검증하는 데 쓴다(stale 평가 가짜 통과 차단).
		const stepId = stepIdOf(st);
		const cycleId = cycleIdOf(st);
		const phaseSeq = st?.phaseSeq ?? null;

		const evalObj = {
			id,
			stepId,
			cycleId,
			gatesSource,
			phaseSeq,
			createdAt: new Date().toISOString(),
			mode,
			score: finalScore.score,
			majorComplaints: finalScore.majorComplaints,
			injected: finalScore.injected === true,
			dimensions: finalScore.dimensions,
			complaints: finalScore.complaints,
			observations,
			screenshot: observations.screenshotOk ? shotRel : null,
			// B3: ui/ux/customer 에이전트가 평가 시 실제로 볼/읽을 캡처물 경로
			screenshotMobile: observations.screenshotMobileOk ? `harness/evaluations/${id}/screenshot-mobile.png` : null,
			dom: observations.domOk ? `harness/evaluations/${id}/dom.html` : null,
		};

		const { jsonPath, mdPath } = writeEvaluation(repoRoot, id, evalObj, evalObj.screenshot);
		log(`평가 기록: ${path.relative(repoRoot, mdPath)} / ${path.relative(repoRoot, jsonPath)}`);
		log(`종합=${evalObj.score} major=${evalObj.majorComplaints} mode=${mode}`);

		return { evalObj, jsonPath, mdPath };
	} finally {
		// 4) TEARDOWN — 항상 실행. dev 서버 프로세스 트리 종료 + 포트 해제 검증.
		if (child || !opts.noServer) {
			log('TEARDOWN: dev 서버 프로세스 트리 종료 시작');
			const td = await teardownDevServer({ pid: child?.pid, port, child });
			log(`TEARDOWN: kill(${td.killed.method}) pid=${td.pid ?? '?'} → 포트 ${port} free=${td.portFree}`);
			// 최종 확인 로그
			const stillInUse = await isPortInUse(port, 500);
			log(`TEARDOWN 검증: 포트 ${port} ${stillInUse ? '여전히 점유 중(!)' : 'free 확인 — orphan 없음'}`);
		}
	}
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const repoRoot = process.cwd();
	try {
		await runEvaluation(opts, repoRoot);
		process.exit(0); // 폴백 포함 정상 흐름은 항상 0.
	} catch (err) {
		// 예기치 못한 오류라도 teardown 은 finally 에서 이미 수행됨.
		log('치명적 오류:', err?.stack ?? err);
		process.exit(0); // 평가 실패가 루프를 멈추지 않도록 — done-gate 가 점수로 판정.
	}
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main();
}
