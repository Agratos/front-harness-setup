#!/usr/bin/env node
// eval-scenario.mjs — 실제 사용자 상호작용(E2E) 검증.
//
// 왜 필요한가: 결정적 게이트(단위 테스트)·정적 평가(eval-playwright 의 스크린샷 = B3)는
// "화면이 떴는가/보기 좋은가"는 보지만 **실제로 입력하고 누른 뒤 상태가 맞는가**는 못 본다.
// 그래서 "추가 후 폼이 안 비워진다 / 상태 변경이 안 먹는다" 같은 상호작용 버그가 통과한다.
// 이 러너는 dev 서버 + Playwright 로 **시나리오(액션 + 단언)를 실제로 실행**해 그런 버그를 잡는다.
//
// 스펙: harness/eval-scenario.json (또는 --spec=<path>)
//   { "scenarios": [ { "name": "...", "steps": [ <step>, ... ] } ] }
//   액션 step:  { "fill":  { "label": "제목", "value": "..." } }
//               { "select":{ "label": "상태", "value": "완독" } }   (Mantine Select: 입력 클릭 → 옵션 클릭)
//               { "click": { "text": "추가" } }                     (role=button name)
//   단언 step:  { "assert": "textVisible",  "text": "..." }
//               { "assert": "textGone",     "text": "..." }
//               { "assert": "inputEmpty",   "label": "제목" }        ← 폼 초기화 검증(핵심)
//               { "assert": "inputValue",   "label": "제목", "value": "..." }
//               { "assert": "minCount",     "selector": ".mantine-Card-root", "expect": 2 }
//
// ── 종료 코드 (2차 자기진단 F15·F16 반영: skip 과 pass 를 분리한다) ────────────────
//   0 = 통과 · 또는 **명시적 면제**(스펙에 skipReason 기재) · 또는 **환경 부재**(Playwright 미설치)
//   1 = 단언 실패 (기능 결함 → 구현으로 되돌림)
//   2 = **검증 불가** (스펙 없음 / 스펙 깨짐 / 시나리오 0개인데 면제 사유 없음 / dev 서버 미기동)
//
// 왜 갈랐나: 예전에는 위 모든 경우가 `{passed:true}` + exit 0 이었다. 그래서 스펙 파일을 만들지
// 않으면 verify 의 E2E 강제가 **아무 것도 검사하지 않고 통과**했고(실측), dev 서버가 아예 뜨지
// 않는 상태가 앱이 크래시한 상태보다 **관대하게** 처리됐다. 증거 부재는 통과가 아니다.
// skip 은 도구가 없어서 못 하는 경우(환경 부재)에만 허용하고, 산출물 부재는 실패로 분류한다.
//
// 면제가 필요할 때(예: UI 상호작용이 없는 리팩터 step)는 **명시적으로** 적는다:
//   harness/eval-scenario.json → { "scenarios": [], "skipReason": "이 step 은 순수 타입 리팩터" }
// 침묵의 통과 대신 기록된 면제를 요구한다.
//
// 실행: node scripts/eval-scenario.mjs [--port=8000] [--spec=<path>] [--id=scenario] [--no-server]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { teardownDevServer } from './lib/teardown.mjs';

const DEFAULT_PORT = 8000;
// 단언/액션 하나의 대기 한도. Playwright 기본 30s 는 크래시 뒤 남은 단계에서 시간을 크게 낭비한다.
const ASSERT_TIMEOUT_MS = 5_000;
const isWin = process.platform === 'win32';
const log = (...a) => console.error('[scenario]', ...a);

export const EXIT_PASS = 0;
export const EXIT_ASSERT_FAIL = 1;
export const EXIT_UNVERIFIABLE = 2;

/**
 * 결과 산출물을 항상 남긴다 — skip 경로도 포함.
 *
 * 예전에는 skip 경로가 파일을 아무것도 남기지 않아서, 나중에 "E2E 가 돌았는지" 를
 * 확인할 방법이 없었다(= 검증하지 않은 것과 검증해서 통과한 것이 구분되지 않음).
 * 이제 평가(eval-playwright)의 `fn.e2e-verified` 항목이 이 파일을 읽는다.
 */
function writeOutcome(repoRoot, id, payload) {
	try {
		const dir = path.join(repoRoot, 'harness', 'evaluations', id);
		mkdirSync(dir, { recursive: true });
		writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
	} catch {
		// 산출물 기록 실패가 판정을 뒤집지는 않는다.
	}
	return payload;
}

function parseArgs(argv) {
	const o = { port: DEFAULT_PORT, spec: null, id: 'scenario', noServer: false };
	for (const a of argv) {
		if (a.startsWith('--port=')) o.port = Number(a.slice('--port='.length));
		else if (a.startsWith('--spec=')) o.spec = a.slice('--spec='.length);
		else if (a.startsWith('--id=')) o.id = a.slice('--id='.length);
		else if (a === '--no-server') o.noServer = true;
	}
	return o;
}

function startDevServer(repoRoot, port) {
	const child = spawn('yarn', ['dev', '--port', String(port), '--strictPort'], {
		cwd: repoRoot,
		detached: !isWin,
		shell: isWin,
		stdio: 'ignore',
		windowsHide: true,
	});
	child.unref?.();
	return child;
}

function probe(port) {
	return new Promise((resolve) => {
		const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
			res.resume();
			resolve(res.statusCode ?? null);
		});
		req.on('timeout', () => { req.destroy(); resolve(null); });
		req.on('error', () => resolve(null));
	});
}
async function waitForReady(port, timeoutMs = 30_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const code = await probe(port);
		if (code && code < 500) return true;
		await new Promise((r) => setTimeout(r, 400));
	}
	return false;
}
async function tryLoadPlaywright() {
	try {
		const mod = await import('@playwright/test');
		return mod.chromium ? mod : null;
	} catch {
		return null;
	}
}

/** 한 step(액션 또는 단언)을 실행해 {ok, kind, detail} 반환. */
export async function runStep(page, step) {
	// ── 액션 ──
	if (step.fill) {
		await page.getByLabel(step.fill.label, { exact: false }).first().fill(String(step.fill.value));
		return { ok: true, kind: 'fill', detail: `${step.fill.label}=${step.fill.value}` };
	}
	if (step.select) {
		await page.getByLabel(step.select.label, { exact: false }).first().click();
		await page.getByRole('option', { name: String(step.select.value), exact: false }).first().click();
		return { ok: true, kind: 'select', detail: `${step.select.label}=${step.select.value}` };
	}
	if (step.click) {
		await page.getByRole('button', { name: String(step.click.text), exact: false }).first().click();
		await page.waitForTimeout(250);
		return { ok: true, kind: 'click', detail: String(step.click.text) };
	}
	if (step.check) {
		const cb = page.getByRole('checkbox', { name: String(step.check.name), exact: false }).first();
		if (!(await cb.isChecked())) await cb.click();
		await page.waitForTimeout(200);
		return { ok: true, kind: 'check', detail: String(step.check.name) };
	}
	if (step.uncheck) {
		const cb = page.getByRole('checkbox', { name: String(step.uncheck.name), exact: false }).first();
		if (await cb.isChecked()) await cb.click();
		await page.waitForTimeout(200);
		return { ok: true, kind: 'uncheck', detail: String(step.uncheck.name) };
	}
	if (step.clickText) {
		// 텍스트로 클릭. SegmentedControl 옵션은 radio role, 탭은 tab role 로 잡히므로 우선 시도하고
		// 없으면 일반 텍스트로 폴백. exact:true 면 정확 일치(필터 "완료" 가 "완료 1 / 전체 2"·"미완료"와 겹침 방지).
		const txt = String(step.clickText.text);
		const exact = step.clickText.exact === true;
		let target = null;
		let forced = false;
		for (const role of ['radio', 'tab']) {
			const loc = page.getByRole(role, { name: txt, exact });
			if ((await loc.count()) > 0) { target = loc.first(); forced = true; break; } // radio/tab 은 숨겨진 input 일 수 있어 force 클릭
		}
		if (!target) target = page.getByText(txt, { exact }).first();
		await target.click(forced ? { force: true } : {});
		await page.waitForTimeout(200);
		return { ok: true, kind: 'clickText', detail: `${txt}${exact ? ' (exact)' : ''}` };
	}
	// ── 단언 ──
	if (step.assert === 'textVisible') {
		const n = await page.getByText(String(step.text), { exact: false }).count();
		return { ok: n > 0, kind: 'assert.textVisible', detail: `"${step.text}" count=${n} (기대 ≥1)` };
	}
	if (step.assert === 'textGone') {
		const n = await page.getByText(String(step.text), { exact: false }).count();
		return { ok: n === 0, kind: 'assert.textGone', detail: `"${step.text}" count=${n} (기대 0)` };
	}
	if (step.assert === 'inputEmpty') {
		const v = await page.getByLabel(String(step.label), { exact: false }).first().inputValue();
		return { ok: v === '', kind: 'assert.inputEmpty', detail: `${step.label}="${v}" (기대 빈값)` };
	}
	if (step.assert === 'inputValue') {
		const v = await page.getByLabel(String(step.label), { exact: false }).first().inputValue();
		return { ok: v === String(step.value), kind: 'assert.inputValue', detail: `${step.label}="${v}" (기대 "${step.value}")` };
	}
	if (step.assert === 'checked' || step.assert === 'unchecked') {
		const c = await page.getByRole('checkbox', { name: String(step.name), exact: false }).first().isChecked();
		const want = step.assert === 'checked';
		return { ok: c === want, kind: `assert.${step.assert}`, detail: `${step.name} checked=${c} (기대 ${want})` };
	}
	if (step.assert === 'minCount') {
		const n = await page.locator(String(step.selector)).count();
		return { ok: n >= Number(step.expect), kind: 'assert.minCount', detail: `${step.selector} count=${n} (기대 ≥${step.expect})` };
	}
	return { ok: false, kind: 'unknown-step', detail: JSON.stringify(step).slice(0, 120) };
}

/** 메인: 스펙의 시나리오들을 dev 서버 + Playwright 로 실제 실행. */
export async function runScenarios(opts, repoRoot) {
	const specPath = opts.spec ?? path.join(repoRoot, 'harness', 'eval-scenario.json');
	const specRel = path.relative(repoRoot, specPath);
	const base = { id: opts.id, mode: 'scenario' };

	// ── 검증 불가 ①: 스펙 산출물 부재 → 실패(exit 2). 예전에는 조용히 통과했다.
	if (!existsSync(specPath)) {
		log(`❌ 시나리오 스펙 없음(${specRel}) — 상호작용 검증 불가`);
		log(`   이 step 의 핵심 유스케이스를 액션+단언으로 적으세요 (예시: harness/eval-scenario.example.json).`);
		log(`   상호작용이 없는 step 이면 면제를 명시하세요: { "scenarios": [], "skipReason": "<이유>" }`);
		return writeOutcome(repoRoot, opts.id, {
			...base,
			passed: false,
			exitCode: EXIT_UNVERIFIABLE,
			unverifiable: 'no-spec',
			reason: `스펙 파일 없음(${specRel})`,
			scenarioCount: 0,
			failures: [],
		});
	}
	let spec;
	try {
		spec = JSON.parse(readFileSync(specPath, 'utf8'));
	} catch (e) {
		// ── 검증 불가 ②: 스펙이 깨짐 → 실패. 문법 오류를 통과로 읽으면 게이트가 무의미해진다.
		log(`❌ 스펙 파싱 실패(${specRel}):`, e?.message ?? e);
		return writeOutcome(repoRoot, opts.id, {
			...base,
			passed: false,
			exitCode: EXIT_UNVERIFIABLE,
			unverifiable: 'bad-spec',
			reason: `스펙 JSON 파싱 실패: ${String(e?.message ?? e).slice(0, 200)}`,
			scenarioCount: 0,
			failures: [],
		});
	}
	const scenarios = spec.scenarios ?? [];
	const skipReason = typeof spec.skipReason === 'string' ? spec.skipReason.trim() : '';

	// ── 명시적 면제: 시나리오 0개 + 사유 기재 → 통과(exit 0). 기록은 남는다.
	if (scenarios.length === 0 && skipReason) {
		log(`⚠ 상호작용 검증 면제(명시) — 사유: ${skipReason}`);
		return writeOutcome(repoRoot, opts.id, {
			...base,
			passed: true,
			exitCode: EXIT_PASS,
			exempt: true,
			reason: skipReason,
			scenarioCount: 0,
			failures: [],
		});
	}
	// ── 검증 불가 ③: 빈 스펙인데 사유가 없음 → 실패. "스펙을 만들어 두고 비워두기" 우회를 막는다.
	if (scenarios.length === 0) {
		log(`❌ 스펙에 시나리오가 0개인데 면제 사유(skipReason)가 없습니다 — 검증 불가`);
		return writeOutcome(repoRoot, opts.id, {
			...base,
			passed: false,
			exitCode: EXIT_UNVERIFIABLE,
			unverifiable: 'empty-spec',
			reason: '시나리오 0개 + skipReason 없음',
			scenarioCount: 0,
			failures: [],
		});
	}
	const shotDir = path.join(repoRoot, 'harness', 'evaluations', opts.id);
	let child;
	let serverReady = false;
	const results = [];
	try {
		if (!opts.noServer) {
			log(`dev 서버 기동: yarn dev --port ${opts.port} --strictPort`);
			child = startDevServer(repoRoot, opts.port);
			serverReady = await waitForReady(opts.port);
		} else {
			serverReady = await waitForReady(opts.port, 3_000);
		}
		if (!serverReady) {
			// ── 검증 불가 ④: dev 서버가 뜨지 않음 → 실패.
			// 앱이 크래시하면 차단되는데 아예 뜨지 않으면 통과하던 역전을 바로잡는다.
			// typecheck/test 가 못 잡는 기동 실패(vite 설정, 포트 점유, 런타임 import 오류)가 이 경로다.
			log(`❌ dev 서버가 준비되지 않음(포트 ${opts.port}) — 상호작용 검증 불가`);
			return writeOutcome(repoRoot, opts.id, {
				...base,
				passed: false,
				exitCode: EXIT_UNVERIFIABLE,
				unverifiable: 'server-not-ready',
				reason: `dev 서버 미기동(포트 ${opts.port}) — 앱이 아예 뜨지 않음`,
				scenarioCount: scenarios.length,
				failures: [],
			});
		}
		const pw = await tryLoadPlaywright();
		if (!pw) {
			// 환경 부재(도구 미설치)는 유일하게 허용되는 skip 이다 — 산출물 부재와 구분한다.
			// 단 이 경우 eval-playwright 도 정적 폴백으로 떨어지고, 폴백은 루브릭상 90점을 넘지
			// 못하므로 merge 는 여전히 막힌다(F19 수정과 짝을 이룬다).
			log('⚠ Playwright 미설치 — 환경 부재로 skip(exit 0). 평가는 정적 폴백으로 떨어져 merge 는 막힙니다.');
			return writeOutcome(repoRoot, opts.id, {
				...base,
				passed: true,
				exitCode: EXIT_PASS,
				envSkip: 'no-playwright',
				reason: 'Playwright 미설치(환경 부재)',
				scenarioCount: scenarios.length,
				failures: [],
			});
		}
		const browser = await pw.chromium.launch({ headless: true });
		try {
			for (let si = 0; si < scenarios.length; si++) {
				const sc = scenarios[si];
				log(`▶ 시나리오 ${si + 1}: ${sc.name}`);
				const page = await browser.newPage();
					// ⚠️ 페이지 에러 구독 — 없으면 앱이 크래시해도 러너는 "Timeout 30000ms" 만 여러 줄 뱉는다.
					// 실측 사고: setState 업데이터 안에서 e.currentTarget 을 읽어 앱이 언마운트됐는데
					// 원인(`Cannot read properties of null (reading 'value')`)이 어디에도 안 남아
					// 별도 진단 스크립트를 손으로 짜야 했다. 한 줄이면 끝날 일이었다.
					const pageErrors = [];
					const consoleErrors = [];
					page.on('pageerror', (err) => pageErrors.push(String(err?.message ?? err).split('\n')[0].slice(0, 300)));
					page.on('console', (msg) => {
						if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
					});
					// 단언 하나가 30s(기본)를 다 쓰면 크래시 후 남은 단계들이 분 단위로 시간을 태운다.
					page.setDefaultTimeout(ASSERT_TIMEOUT_MS);
				await page.goto(`http://127.0.0.1:${opts.port}/`, { waitUntil: 'load', timeout: 15_000 });
				await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
				mkdirSync(shotDir, { recursive: true });
				const steps = [];
				let scenarioOk = true;
				let crashed = null;
				// 초기 상태 캡처(스토리보드 0번)
				const initShot = `harness/evaluations/${opts.id}/s${si + 1}-00-initial.png`;
				await page.screenshot({ path: path.join(repoRoot, initShot), fullPage: true }).catch(() => {});
				let stepNo = 0;
				for (const step of sc.steps ?? []) {
					stepNo++;
					let r;
					try {
						r = await runStep(page, step);
					} catch (e) {
						r = { ok: false, kind: 'error', detail: String(e?.message ?? e).slice(0, 200) };
					}
					// ⭐ 단계마다 화면 캡처 — 상태 전이 스토리보드(사용자 가이드처럼). 클릭/토글 후 실제로
					// 펼쳐졌는지/바뀌었는지 각 상황을 시각 증거로 남긴다(단언 + 캡처 둘 다).
					const shot = `harness/evaluations/${opts.id}/s${si + 1}-${String(stepNo).padStart(2, '0')}.png`;
					await page.screenshot({ path: path.join(repoRoot, shot), fullPage: true }).catch(() => {});
					r.shot = shot;
					steps.push(r);
					if (!r.ok) scenarioOk = false;
					if (pageErrors.length) r.pageErrors = [...pageErrors];
					log(`  [${r.ok ? 'ok' : 'FAIL'}] ${r.kind} — ${r.detail}  📷 ${path.basename(shot)}`);
					if (pageErrors.length) log(`      ⚠ 페이지 에러: ${pageErrors[pageErrors.length - 1]}`);

					// fail-fast: 앱이 죽었으면(런타임 에러 + #root 비어 있음) 남은 단계는 의미가 없다.
					// 계속 돌리면 단계마다 타임아웃을 태우고, 빈 페이지라 textGone 같은 단언이
					// **거짓 통과**한다(실측 사고). 즉시 중단하고 크래시로 명시 실패시킨다.
					const rootChildren = await page
						.evaluate(() => document.getElementById('root')?.childElementCount ?? -1)
						.catch(() => -1);
					if (pageErrors.length > 0 && rootChildren === 0) {
						crashed = { at: stepNo, error: pageErrors[pageErrors.length - 1] };
						scenarioOk = false;
						steps.push({
							ok: false,
							kind: 'crash',
							detail: `앱 크래시(단계 ${stepNo} 이후, #root 비어 있음): ${crashed.error}`,
							shot,
						});
						log(`  [FAIL] crash — 앱 언마운트 감지, 남은 단계 중단: ${crashed.error}`);
						break;
					}
				}
				results.push({ name: sc.name, ok: scenarioOk, initialShot: initShot, steps, crashed, pageErrors: [...pageErrors], consoleErrors: [...consoleErrors] });
				await page.close();
			}
		} finally {
			await browser.close().catch(() => {});
		}
		const failures = results.flatMap((r) => r.steps.filter((s) => !s.ok).map((s) => ({ scenario: r.name, ...s })));
		const out = {
			id: opts.id,
			mode: 'scenario',
			passed: failures.length === 0,
			exitCode: failures.length === 0 ? EXIT_PASS : EXIT_ASSERT_FAIL,
			scenarioCount: results.length,
			scenarios: results.map((r) => ({
				name: r.name,
				ok: r.ok,
				initialShot: r.initialShot,
				// 크래시·런타임 에러를 결과에 보존한다 — 실패 원인을 사람이 다시 파헤치지 않도록.
				crashed: r.crashed ?? null,
				pageErrors: r.pageErrors ?? [],
				consoleErrors: r.consoleErrors ?? [],
				// 스토리보드: 각 단계의 동작·단언 결과 + 그 시점 화면 캡처(사용자 가이드 flow)
				storyboard: r.steps.map((s) => ({ kind: s.kind, detail: s.detail, ok: s.ok, shot: s.shot })),
			})),
			failures,
		};
		// ⚠️ 결과는 반드시 <id> **서브폴더**에 쓴다. done-gate.loadLatestEvaluation 이
		// harness/evaluations/ 루트의 *.json 을 사전순으로 읽어 "최신 평가"로 쓰는데, 루트에
		// `*-scenario.json` 을 두면 score 없는 이 파일이 평가로 오인돼 NaN→rework 가 된다(실측 사고).
		mkdirSync(shotDir, { recursive: true });
		writeFileSync(path.join(shotDir, 'scenario.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
		log(`결과: ${out.passed ? 'PASS' : 'FAIL'} — 시나리오 ${results.length}개, 실패 단언 ${failures.length}건`);
		for (const f of failures) log(`  ✗ [${f.scenario}] ${f.kind} — ${f.detail}`);
		return out;
	} finally {
		if (child || !opts.noServer) {
			const td = await teardownDevServer({ pid: child?.pid, port: opts.port, child });
			log(`TEARDOWN: 포트 ${opts.port} free=${td.portFree}${td.portKill?.length ? ` (portKill=${td.portKill.join(',')})` : ''}`);
		}
	}
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const out = await runScenarios(opts, process.cwd());
	// exitCode 를 결과에 담아 반환하므로 그대로 쓴다 (0 통과/면제/환경부재, 1 단언실패, 2 검증불가).
	const code = Number.isInteger(out?.exitCode) ? out.exitCode : out?.passed === false ? EXIT_ASSERT_FAIL : EXIT_PASS;
	process.exit(code);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main();
}
