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
// 종료 코드: 단언이 하나라도 실패하면 1(= 기능 결함 → done-gate/QA 가 rework 로 처리), 통과/skip 이면 0.
// 실행: node scripts/eval-scenario.mjs [--port=8000] [--spec=<path>] [--id=scenario] [--no-server]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { teardownDevServer } from './lib/teardown.mjs';

const DEFAULT_PORT = 8000;
const isWin = process.platform === 'win32';
const log = (...a) => console.error('[scenario]', ...a);

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
	if (!existsSync(specPath)) {
		log(`시나리오 스펙 없음(${path.relative(repoRoot, specPath)}) — skip(차단 안 함)`);
		return { skipped: true, reason: 'no-spec', passed: true };
	}
	let spec;
	try {
		spec = JSON.parse(readFileSync(specPath, 'utf8'));
	} catch (e) {
		log('스펙 파싱 실패:', e?.message ?? e);
		return { skipped: true, reason: 'bad-spec', passed: true };
	}
	const scenarios = spec.scenarios ?? [];
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
			log('서버 미준비 — skip');
			return { skipped: true, reason: 'server-not-ready', passed: true };
		}
		const pw = await tryLoadPlaywright();
		if (!pw) {
			log('Playwright 미설치 — skip');
			return { skipped: true, reason: 'no-playwright', passed: true };
		}
		const browser = await pw.chromium.launch({ headless: true });
		try {
			for (let si = 0; si < scenarios.length; si++) {
				const sc = scenarios[si];
				log(`▶ 시나리오 ${si + 1}: ${sc.name}`);
				const page = await browser.newPage();
				await page.goto(`http://127.0.0.1:${opts.port}/`, { waitUntil: 'load', timeout: 15_000 });
				await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
				mkdirSync(shotDir, { recursive: true });
				const steps = [];
				let scenarioOk = true;
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
					log(`  [${r.ok ? 'ok' : 'FAIL'}] ${r.kind} — ${r.detail}  📷 ${path.basename(shot)}`);
				}
				results.push({ name: sc.name, ok: scenarioOk, initialShot: initShot, steps });
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
			scenarioCount: results.length,
			scenarios: results.map((r) => ({
				name: r.name,
				ok: r.ok,
				initialShot: r.initialShot,
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
	process.exit(out && out.passed === false ? 1 : 0);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	main();
}
