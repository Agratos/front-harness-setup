// eval-review.mjs — **격리 채점 리뷰** (세션 분리 1단계, docs/spec/session-isolation-2026-08-11.md)
//
// 왜 필요한가:
//   주관 채점(score·complaints 조정)의 최종 반영을 **구현을 지휘한 메인 세션**이 쥐고 있었다.
//   서브에이전트(customer/quality/ux)의 컨텍스트가 분리되어 있어도, 수집·합성·기록의 손이
//   같은 세션이라 점수의 독립성이 구조적으로 보장되지 않았다(시행 6의 96→100 은 독립성 없는 숫자).
//
// 격리의 7조건 (사양 §2 — 이 파일이 전부 코드로 강제한다):
//   ① 새 프로세스(`claude -p` 헤드리스 — 대화 이력 무공유)  ② 입력은 파일 산출물만
//   ③ 리뷰어는 읽기 전용(--allowedTools Read)               ④ 반영·스탬프는 이 래퍼만
//   ⑤ 하향 단조(점수는 낮추기만, 상향은 코드 재계측으로만)   ⑥ 변조 탐지(정규화 해시)
//   ⑦ 환경 부재(claude CLI 없음)만 기록된 skip — 침묵의 통과 없음
//
// exit code: 0 반영 완료·기록된 환경 부재 / 1 리뷰어 실행·verdict 파싱 실패(재시도 대상) / 2 대상 평가 없음
//
// 우회 노출(F24 원칙): HARNESS_REVIEW_CMD 는 셀프테스트의 환경 조건이자 우회 경로다 —
//   스탬프 `cmd` 에 그대로 기록되어 사후 감사에서 보인다. 자율 루프에서 사용 금지.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIMENSIONS } from './lib/rubric.mjs';

const log = (...a) => console.log('[review]', ...a);

/** 리뷰 계약의 환경 조건 — 검사자(done-gate·loop)가 같은 조건을 공유한다. */
export function reviewContractActive(repoRoot) {
	return existsSync(path.join(repoRoot, 'scripts', 'eval-review.mjs'));
}

export function evalJsonPath(repoRoot, id) {
	return path.join(repoRoot, 'harness', 'evaluations', `${id}.json`);
}

/** 최신 평가 id (done-gate 의 loadLatestEvaluation 과 같은 정렬 규칙 — eval-*.json 사전순). */
export function latestEvalId(repoRoot) {
	const dir = path.join(repoRoot, 'harness', 'evaluations');
	let entries = [];
	try {
		entries = readdirSync(dir).filter((f) => /^eval-.*\.json$/.test(f));
	} catch {
		return null;
	}
	if (entries.length === 0) return null;
	entries.sort();
	return path.basename(entries[entries.length - 1], '.json');
}

/** 키 정렬 재귀 canonical JSON — 해시 입력. 직렬화 순서 차이로 오탐하지 않게 한다. */
export function canonicalize(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
	if (value && typeof value === 'object') {
		const keys = Object.keys(value).sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
	}
	return JSON.stringify(value ?? null);
}

/**
 * 평가의 판정 필드(score·majorComplaints·dimensions·complaints) 정규화 sha256.
 * 리뷰 반영 직후 래퍼가 스탬프에 남기고, done-gate 가 병합 전에 재검증한다(사후 변조 탐지).
 */
export function integrityOf(evalObj) {
	const core = {
		score: evalObj?.score ?? null,
		majorComplaints: evalObj?.majorComplaints ?? null,
		dimensions: evalObj?.dimensions ?? null,
		complaints: evalObj?.complaints ?? null,
	};
	return createHash('sha256').update(canonicalize(core), 'utf8').digest('hex');
}

/**
 * 평가에 유효한 격리 리뷰가 있는지 검증 — done-gate 가 병합 판정에서 호출한다.
 * @param {{probeTool?: () => boolean}} [opts] probeTool: 리뷰 도구 가용성 프로브(셀프테스트 주입용).
 *   미지정 시 실제 프로브(HARNESS_REVIEW_CMD 유무 + claude CLI)를 쓴다.
 * @returns {{ok:boolean, mode:string|null, reason:string}}
 */
export function verifyEvalReview(repoRoot, id, opts = {}) {
	const p = evalJsonPath(repoRoot, id);
	let evalObj;
	try {
		evalObj = JSON.parse(readFileSync(p, 'utf8'));
	} catch {
		return { ok: false, mode: null, reason: `평가 파일을 읽을 수 없음 — ${path.relative(repoRoot, p)}` };
	}
	// --score 주입 평가는 이미 노출된 CI 전용 bypass — 이중 요구를 얹지 않는다(사양 §4.3).
	// 단, 리뷰 스탬프가 **이미 있는** 평가의 injected 플래그는 주입이 아니라 후행 편집(변조 시도)이다 —
	// 정상 주입 평가는 리뷰 자체가 no-op 이라 스탬프가 생기지 않으므로, 둘의 공존은 위조 신호다.
	// 그 경우 bypass 를 적용하지 않고 아래 무결성 검증을 그대로 받게 한다(감사 발견: injected 한 줄 우회).
	if (evalObj.injected === true && !evalObj.review) {
		return { ok: true, mode: 'injected-bypass', reason: '주입 평가(injected) — 리뷰 요구 제외(bypass 표시는 평가에 있음)' };
	}
	const review = evalObj.review;
	if (!review || typeof review !== 'object') {
		return { ok: false, mode: null, reason: '격리 리뷰 스탬프 없음 — node scripts/eval-review.mjs 를 실행하세요' };
	}
	if (review.mode === 'skipped-no-tool') {
		// skip 스탬프는 "환경 부재"의 **기록**이다. 검증 시점에 리뷰 도구가 가용하다면 이 스탬프는
		// 위조이거나 낡은 것이고, 어느 쪽이든 지금 리뷰를 실행할 수 있으므로 통과시키지 않는다
		// (감사 발견: 손으로 쓴 skip 스탬프가 무검증 통과 — 스탬프 발급자 규칙이 관례에 불과했다).
		const probe = opts.probeTool ?? defaultReviewToolProbe;
		if (probe()) {
			return {
				ok: false,
				mode: review.mode,
				reason: 'skip 스탬프 무효 — 리뷰 도구가 가용합니다. node scripts/eval-review.mjs 를 실행하세요(skip 은 환경 부재에만 허용)',
			};
		}
		return { ok: true, mode: review.mode, reason: '격리 리뷰 생략(claude CLI 없음 — 환경 부재, 기록됨)' };
	}
	if (review.integrity !== integrityOf(evalObj)) {
		return { ok: false, mode: review.mode ?? null, reason: '격리 리뷰 이후 평가가 변조됨(정규화 해시 불일치) — 점수·불만은 리뷰 세션만 조정할 수 있다' };
	}
	return { ok: true, mode: review.mode ?? 'isolated', reason: `격리 리뷰 확인(${review.cmd ?? '?'}, ${review.at ?? '?'})` };
}

/**
 * 리뷰어 최종 출력에서 verdict JSON 추출.
 * ```json 펜스를 뒤에서부터 찾고, 없으면 마지막 균형 잡힌 {...} 를 파싱한다.
 * @returns {{ok:boolean, verdict?:object, reason?:string}}
 */
export function extractVerdict(text) {
	const s = String(text ?? '');
	const candidates = [];
	const fence = /```json\s*([\s\S]*?)```/g;
	let m;
	while ((m = fence.exec(s)) !== null) candidates.push(m[1]);
	if (candidates.length === 0) {
		// 펜스가 없으면 **최상위** 균형 객체들을 앞에서부터 수집한다.
		// (뒤의 `{` 에서 시작하면 중첩된 내부 객체 — 예: complaints 의 한 항목 — 를 verdict 로 오인한다.)
		let i = s.indexOf('{');
		while (i >= 0) {
			let depth = 0;
			let end = -1;
			let inStr = false;
			let esc = false;
			for (let j = i; j < s.length; j++) {
				const ch = s[j];
				if (inStr) {
					if (esc) esc = false;
					else if (ch === '\\') esc = true;
					else if (ch === '"') inStr = false;
					continue;
				}
				if (ch === '"') inStr = true;
				else if (ch === '{') depth++;
				else if (ch === '}') {
					depth--;
					if (depth === 0) {
						end = j;
						break;
					}
				}
			}
			if (end < 0) break;
			candidates.push(s.slice(i, end + 1));
			i = s.indexOf('{', end + 1);
		}
	}
	if (candidates.length === 0) return { ok: false, reason: '출력에서 verdict JSON 을 찾지 못함' };
	// 뒤에서부터 첫 번째로 "파싱되고 형식이 맞는" 후보를 채택한다(리뷰어의 마지막 결론 우선).
	let lastReason = 'verdict JSON 을 찾지 못함';
	for (let k = candidates.length - 1; k >= 0; k--) {
		let verdict;
		try {
			verdict = JSON.parse(candidates[k]);
		} catch (e) {
			lastReason = `verdict JSON 파싱 실패 — ${e?.message ?? e}`;
			continue;
		}
		if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) {
			lastReason = 'verdict 가 객체가 아님';
			continue;
		}
		if (verdict.dimensionScores && (typeof verdict.dimensionScores !== 'object' || Array.isArray(verdict.dimensionScores))) {
			lastReason = 'dimensionScores 형식 오류(객체 아님)';
			continue;
		}
		if (verdict.complaints && !Array.isArray(verdict.complaints)) {
			lastReason = 'complaints 형식 오류(배열 아님)';
			continue;
		}
		return { ok: true, verdict };
	}
	return { ok: false, reason: lastReason };
}

/**
 * verdict 반영 — **하향 단조**. 점수는 베이스라인보다 낮을 때만, 불만은 추가만.
 * 종합 score 는 차원 가중 평균으로 재계산하고 majorComplaints 도 재계산한다(사양 §4.2).
 * @returns {{evalObj:object, loweredDimensions:string[], addedComplaints:number, ignored:string[]}}
 */
export function applyVerdict(evalObj, verdict) {
	const out = { ...evalObj, dimensions: { ...(evalObj.dimensions ?? {}) }, complaints: [...(evalObj.complaints ?? [])] };
	const loweredDimensions = [];
	const ignored = [];

	const dimWeightOf = (key) => out.dimensions[key]?.weight ?? DIMENSIONS.find((d) => d.key === key)?.dimWeight ?? 0;

	for (const [key, valRaw] of Object.entries(verdict.dimensionScores ?? {})) {
		const val = Number(valRaw);
		const base = out.dimensions[key];
		if (!base || !Number.isFinite(val)) {
			ignored.push(`dimension '${key}' — 알 수 없는 차원 또는 숫자 아님`);
			continue;
		}
		if (val >= base.score) {
			if (val > base.score) ignored.push(`dimension '${key}' ${base.score}→${val} — 상향은 무시(하향 단조, 상향은 코드 재계측으로만)`);
			continue;
		}
		out.dimensions[key] = { ...base, score: Math.max(0, Math.round(val)) };
		loweredDimensions.push(key);
	}

	let addedComplaints = 0;
	for (const c of verdict.complaints ?? []) {
		const severity = c?.severity === 'major' ? 'major' : c?.severity === 'minor' ? 'minor' : null;
		if (!severity || !c?.item || !c?.dimension) {
			ignored.push(`complaint ${JSON.stringify(c)} — dimension/item/severity(major|minor) 필수`);
			continue;
		}
		const dup = out.complaints.some((x) => x.dimension === c.dimension && x.item === c.item);
		if (dup) continue; // 추가만 허용 — 기존 불만은 리뷰가 지울 수 없다
		out.complaints.push({ dimension: c.dimension, item: c.item, severity, reason: String(c.reason ?? 'review'), source: 'review' });
		addedComplaints += 1;
	}

	// 종합 재계산 — 차원 점수 × 가중치 (rubric.mjs scoreObservations 와 같은 산식)
	let weightedSum = 0;
	for (const [key, d] of Object.entries(out.dimensions)) weightedSum += (d.weight ?? dimWeightOf(key)) * d.score;
	out.score = Math.round(weightedSum);
	out.majorComplaints = out.complaints.filter((c) => c.severity === 'major').length;

	return { evalObj: out, loweredDimensions, addedComplaints, ignored };
}

/** 리뷰어 세션에 줄 프롬프트 — 입력은 파일 산출물만(사양 §2-②). 감사 추적을 위해 파일로도 보존된다. */
export function buildPrompt(repoRoot, id, evalObj) {
	const abs = (rel) => path.join(repoRoot, rel).split(path.sep).join('/');
	const artifactDir = `harness/evaluations/${id}`;
	const files = [
		{ rel: `harness/evaluations/${id}.json`, what: '평가 베이스라인(코드 계측 — 이 파일이 채점의 출발점)' },
		{ rel: `${artifactDir}/screenshot.png`, what: '데스크톱 스크린샷 (Read 로 열면 이미지가 렌더됨)' },
		{ rel: `${artifactDir}/screenshot-mobile.png`, what: '모바일(375px) 스크린샷' },
		{ rel: `${artifactDir}/dom.html`, what: '렌더된 DOM 스냅샷' },
		{ rel: 'harness/plan.json', what: '계획 정본 — 이번 step 의 goal 과 수용기준(AC). "무엇을 만들었어야 하는가"의 기준' },
		{ rel: 'docs/eval-rubric.md', what: '채점 루브릭(차원·심각도 기준)' },
	];
	const fileList = files
		.map((f) => `- ${abs(f.rel)} — ${f.what}${existsSync(path.join(repoRoot, f.rel)) ? '' : ' ⚠ 파일 없음(없다는 사실 자체를 채점에 반영)'}`)
		.join('\n');
	return [
		`# 격리 채점 리뷰 — ${id}`,
		'',
		'당신은 이 평가의 **격리 채점 리뷰어**입니다. 개발 과정·구현 의도를 일절 모르는 상태에서,',
		'아래 파일 산출물만 근거로 실사용자(페르소나) 관점의 채점을 수행합니다.',
		'',
		'## 규칙 (전부 강제 — 어기면 반영되지 않습니다)',
		'',
		'1. **아래 파일만** 근거로 판단합니다. 파일 밖의 추측·선의 해석 금지.',
		'2. 캡처물(스크린샷 2종·DOM)을 **반드시 Read 로 직접 열어 보고** 판단합니다 —',
		'   레이아웃/여백(사이드 padding)/정렬/시각 위계/반응형(가로 overflow·터치 영역)/빈·에러 상태/a11y(lang·접근가능한 이름).',
		'3. plan.json 의 AC 와 화면을 대조합니다 — AC 가 화면에서 확인되지 않으면 불만으로 기록합니다.',
		'4. **점수는 낮추거나 불만을 추가만 할 수 있습니다.** 베이스라인보다 높은 점수는 무시됩니다.',
		'5. 최종 응답은 아래 스키마의 **verdict JSON 하나만** ```json 펜스로 출력합니다. 다른 텍스트를 뒤에 붙이지 마세요.',
		'',
		'## 읽을 파일',
		'',
		fileList,
		'',
		'## verdict 스키마',
		'',
		'```json',
		JSON.stringify(
			{
				dimensionScores: { ui: 90, ux: 100, fn: 100, quality: 80 },
				complaints: [{ dimension: 'ui', item: 'review.side-padding', severity: 'minor', reason: '본문이 뷰포트 가장자리에 밀착' }],
				summary: '한 줄 총평',
			},
			null,
			2,
		),
		'```',
		'',
		`- dimensionScores 키: ${DIMENSIONS.map((d) => `${d.key}(${d.label})`).join(' · ')} — 조정할 차원만 포함해도 됩니다.`,
		'- complaints 의 item 은 기존 루브릭 항목 id 또는 `review.<슬러그>` 형식의 새 항목. severity 는 major|minor.',
		'- **major 는 done-gate 를 막습니다** — 실사용을 막거나 AC 를 깨는 결함에만 부여하세요.',
		`- 문제가 없으면 {"complaints": [], "summary": "..."} 만 출력합니다.`,
		'',
		`현재 베이스라인: 종합 ${evalObj.score} / major ${evalObj.majorComplaints} (cycleId=${evalObj.cycleId ?? '?'})`,
	].join('\n');
}

/** claude CLI 가용성 프로브 — 환경 부재(skipped-no-tool) 판정에만 쓴다. 프로세스당 1회 캐시(스폰 비용). */
let claudeAvailableCache = null;
export function claudeAvailable() {
	if (claudeAvailableCache !== null) return claudeAvailableCache;
	try {
		const r = spawnSync('claude --version', { shell: true, encoding: 'utf8', timeout: 30_000 });
		claudeAvailableCache = r.status === 0;
	} catch {
		claudeAvailableCache = false;
	}
	return claudeAvailableCache;
}

/**
 * 리뷰 도구 가용성의 기본 프로브 — skip 스탬프 검증(verifyEvalReview)이 쓴다.
 * HARNESS_REVIEW_CMD 가 설정돼 있으면 커스텀 리뷰어가 "가용한 도구"다(셀프테스트 포함).
 */
function defaultReviewToolProbe() {
	return Boolean(process.env.HARNESS_REVIEW_CMD) || claudeAvailable();
}

/**
 * 리뷰어 세션 실행. 프롬프트는 stdin 으로 전달한다(따옴표 이스케이프 사고 방지).
 * 기본: `claude -p --allowedTools Read` (fresh 세션 — 오케스트레이터 컨텍스트 무공유).
 * HARNESS_REVIEW_CMD 가 있으면 그 커맨드를 대신 실행한다(stdin=프롬프트, stdout=verdict — 셀프테스트/우회 노출).
 * @returns {{ok:boolean, stdout:string, stderr:string, code:number|null, cmdLabel:string}}
 */
export function runReviewer(promptText, { repoRoot, timeoutMs } = {}) {
	const custom = process.env.HARNESS_REVIEW_CMD;
	const model = process.env.HARNESS_REVIEW_MODEL ?? readConfigModel(repoRoot);
	let cmd;
	let cmdLabel;
	if (custom) {
		cmd = custom;
		cmdLabel = `custom(${custom})`;
	} else {
		cmd = `claude -p --allowedTools Read${model ? ` --model ${model}` : ''}`;
		cmdLabel = cmd;
	}
	const r = spawnSync(cmd, {
		shell: true,
		cwd: repoRoot,
		input: promptText,
		encoding: 'utf8',
		timeout: timeoutMs ?? Number(process.env.HARNESS_REVIEW_TIMEOUT_MS ?? 420_000),
		maxBuffer: 16 * 1024 * 1024,
	});
	return {
		ok: r.status === 0 && !r.error,
		stdout: String(r.stdout ?? ''),
		stderr: String(r.stderr ?? ''),
		code: r.status,
		cmdLabel,
	};
}

function readConfigModel(repoRoot) {
	try {
		const cfg = JSON.parse(readFileSync(path.join(repoRoot ?? process.cwd(), 'harness', 'config.json'), 'utf8'));
		return cfg?.review?.model ?? null;
	} catch {
		return null;
	}
}

/** 원자적 JSON 쓰기(tmp+rename) — eval-playwright 의 writeEvaluation 과 같은 규칙. */
function writeJsonAtomic(target, obj) {
	mkdirSync(path.dirname(target), { recursive: true });
	const tmp = `${target}.tmp`;
	writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
	renameSync(tmp, target);
}

/** 스탬프를 찍어 평가 JSON 을 갱신하고, 사람용 md 에 리뷰 절을 append 한다. */
export function stampAndWrite(repoRoot, id, evalObj, review, mdNoteLines = []) {
	const stamped = { ...evalObj, review };
	writeJsonAtomic(evalJsonPath(repoRoot, id), stamped);
	const mdPath = path.join(repoRoot, 'harness', 'evaluations', `${id}.md`);
	if (existsSync(mdPath)) {
		const lines = [
			'',
			'## 격리 리뷰 (세션 분리 1단계)',
			'',
			`- 모드: \`${review.mode}\` / 실행: \`${review.cmd}\` / 시각: ${review.at}`,
			...mdNoteLines,
			'',
		];
		appendFileSync(mdPath, lines.join('\n'), 'utf8');
	}
	return stamped;
}

/** CLI 인자: --id=eval-NNNN --timeout=ms */
function parseArgs(argv) {
	const opts = { id: null, timeoutMs: undefined };
	for (const a of argv) {
		if (a.startsWith('--id=')) opts.id = a.slice('--id='.length);
		else if (a.startsWith('--timeout=')) opts.timeoutMs = Number(a.slice('--timeout='.length));
	}
	return opts;
}

export async function main(argv = process.argv.slice(2)) {
	const repoRoot = process.cwd();
	const opts = parseArgs(argv);
	const id = opts.id ?? latestEvalId(repoRoot);
	if (!id || !existsSync(evalJsonPath(repoRoot, id))) {
		log(`대상 평가 없음 — harness/evaluations/${id ?? 'eval-*'}.json (exit 2)`);
		return 2;
	}
	let evalObj;
	try {
		evalObj = JSON.parse(readFileSync(evalJsonPath(repoRoot, id), 'utf8'));
	} catch (e) {
		log(`평가 JSON 파싱 실패 — ${e?.message ?? e} (exit 2)`);
		return 2;
	}

	// 멱등: 유효한 리뷰가 이미 있으면 재실행하지 않는다(재작업 라운드는 새 평가 id 가 생기므로 안전).
	const existing = verifyEvalReview(repoRoot, id);
	if (evalObj.review && existing.ok) {
		log(`이미 리뷰됨 — ${existing.reason} (no-op)`);
		return 0;
	}

	// 환경 부재 판정: 오버라이드도 없고 claude CLI 도 없으면 기록된 skip (침묵의 통과 없음).
	if (!process.env.HARNESS_REVIEW_CMD && !claudeAvailable()) {
		const review = { mode: 'skipped-no-tool', cmd: null, at: new Date().toISOString(), added: null, integrity: null };
		stampAndWrite(repoRoot, id, evalObj, review, ['- claude CLI 없음 — 환경 부재로 기록된 skip']);
		log('claude CLI 없음 — skipped-no-tool 스탬프 기록(환경 부재, exit 0)');
		return 0;
	}

	// 프롬프트 생성·보존(감사 추적) → 격리 세션 실행
	const promptText = buildPrompt(repoRoot, id, evalObj);
	const artifactDir = path.join(repoRoot, 'harness', 'evaluations', id);
	mkdirSync(artifactDir, { recursive: true });
	writeFileSync(path.join(artifactDir, 'review-prompt.md'), promptText, 'utf8');

	log(`격리 리뷰 세션 시작 — ${id} (프롬프트: harness/evaluations/${id}/review-prompt.md)`);
	const run = runReviewer(promptText, { repoRoot, timeoutMs: opts.timeoutMs });
	if (!run.ok) {
		log(`리뷰어 실행 실패(exit ${run.code}) — ${run.cmdLabel}`);
		if (run.stderr.trim()) log(`stderr(끝부분): ${run.stderr.trim().slice(-500)}`);
		return 1;
	}
	const parsed = extractVerdict(run.stdout);
	if (!parsed.ok) {
		log(`verdict 추출 실패 — ${parsed.reason}`);
		log(`stdout(끝부분): ${run.stdout.trim().slice(-500)}`);
		return 1;
	}

	const { evalObj: applied, loweredDimensions, addedComplaints, ignored } = applyVerdict(evalObj, parsed.verdict);
	for (const i of ignored) log(`무시: ${i}`);

	// 리뷰어 원문 보존 — 무엇을 근거로 무엇이 반영/무시됐는지 추적 가능해야 한다.
	writeJsonAtomic(path.join(artifactDir, 'review.json'), {
		id,
		cycleId: evalObj.cycleId ?? null,
		cmd: run.cmdLabel,
		at: new Date().toISOString(),
		verdict: parsed.verdict,
		applied: { loweredDimensions, addedComplaints },
		ignored,
	});

	const review = {
		mode: 'isolated',
		cmd: run.cmdLabel,
		at: new Date().toISOString(),
		added: { complaints: addedComplaints, loweredDimensions },
		integrity: integrityOf(applied),
	};
	stampAndWrite(repoRoot, id, applied, review, [
		`- 반영: 불만 +${addedComplaints}건, 하향 차원 [${loweredDimensions.join(', ') || '없음'}]`,
		`- 점수: ${evalObj.score} → **${applied.score}** / major ${evalObj.majorComplaints} → **${applied.majorComplaints}**`,
		`- 리뷰어 원문: harness/evaluations/${id}/review.json`,
	]);
	log(`격리 리뷰 반영 — 종합 ${evalObj.score}→${applied.score} / major ${evalObj.majorComplaints}→${applied.majorComplaints} / 불만 +${addedComplaints} / 하향 [${loweredDimensions.join(',') || '-'}]`);
	return 0;
}

// CLI 진입점 (import 시에는 실행하지 않음 — done-gate·selftest 가 함수만 쓴다)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().then(
		(code) => process.exit(code),
		(err) => {
			console.error('[review] 예기치 못한 실패:', err?.stack ?? err);
			process.exit(1);
		},
	);
}
