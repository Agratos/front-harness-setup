#!/usr/bin/env node
// copy-project.selftest.mjs — copy-project 복사/제외 로직 자가검증.
//
// 실행: node scripts/copy-project.selftest.mjs
// 임시 가짜 저장소를 만들어 doCopy 로 복사한 뒤, 제외 대상(node_modules·.git·.env·
// .yarn 캐시·dist·*.tsbuildinfo·.omc)은 빠지고 일반 파일·.env.example·.yarn/releases 는
// 복사되는지, planCopy 의 거부 판정(내부 경로/기존 비어있지 않음)이 맞는지 검증합니다.
// 성공 시 'COPY SELFTEST: PASS' + exit 0.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { doCopy, makeCopyFilter, planCopy } from './copy-project.mjs';

const failures = [];
function check(label, cond) {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		console.log(`  ✗ ${label}`);
		failures.push(label);
	}
}

const root = mkdtempSync(path.join(os.tmpdir(), 'copy-selftest-'));
try {
	console.log('=== copy-project selftest (임시 가짜 저장소) ===');
	const src = path.join(root, 'src-repo');
	const w = (rel, content) => {
		const p = path.join(src, rel);
		mkdirSync(path.dirname(p), { recursive: true });
		writeFileSync(p, content, 'utf8');
	};
	// 포함 대상
	w('src/app.txt', 'app');
	w('harness/report.md', 'report');
	w('.env.example', 'TOKEN=\n');
	w('.yarn/releases/yarn.cjs', 'yarn');
	w('package.json', '{"name":"x"}');
	// 제외 대상
	w('node_modules/pkg/index.js', 'mod');
	w('.git/config', 'gitcfg');
	w('.env', 'TOKEN=secret\n');
	w('.yarn/cache/a.zip', 'cache');
	w('dist/bundle.js', 'dist');
	w('build.tsbuildinfo', 'tsbuild');
	w('.omc/state/x.json', 'omc');

	// (1) makeCopyFilter 단위 판정
	const f = makeCopyFilter(src);
	check('filter: node_modules 제외', f(path.join(src, 'node_modules', 'pkg', 'index.js')) === false);
	check('filter: .git 제외', f(path.join(src, '.git', 'config')) === false);
	check('filter: .env 제외', f(path.join(src, '.env')) === false);
	check('filter: dist 제외', f(path.join(src, 'dist', 'bundle.js')) === false);
	check('filter: .yarn/cache 제외', f(path.join(src, '.yarn', 'cache', 'a.zip')) === false);
	check('filter: *.tsbuildinfo 제외', f(path.join(src, 'build.tsbuildinfo')) === false);
	check('filter: .omc 제외', f(path.join(src, '.omc', 'state', 'x.json')) === false);
	check('filter: 일반 파일 포함', f(path.join(src, 'src', 'app.txt')) === true);
	check('filter: .env.example 포함', f(path.join(src, '.env.example')) === true);
	check('filter: .yarn/releases 포함', f(path.join(src, '.yarn', 'releases', 'yarn.cjs')) === true);

	// (2) planCopy 거부 판정
	const outside = path.join(root, 'dest');
	const plan = planCopy(src, outside, 'My New App');
	check('planCopy: 이름 정규화', plan.name === 'my-new-app');
	check('planCopy: target = dest/name', plan.target === path.resolve(outside, 'my-new-app'));
	check('planCopy: 외부 경로는 내부판정 false', plan.targetInsideRepo === false);
	const planInside = planCopy(src, src, 'sub');
	check('planCopy: 내부 경로는 내부판정 true', planInside.targetInsideRepo === true);

	// (3) doCopy 통합 — 실제 복사 후 포함/제외 확인
	const target = path.join(outside, 'my-new-app');
	doCopy(src, target);
	check('복사: src/app.txt 포함', existsSync(path.join(target, 'src', 'app.txt')));
	check('복사: harness/report.md 포함', existsSync(path.join(target, 'harness', 'report.md')));
	check('복사: .env.example 포함', existsSync(path.join(target, '.env.example')));
	check('복사: .yarn/releases 포함', existsSync(path.join(target, '.yarn', 'releases', 'yarn.cjs')));
	check('복사: node_modules 제외', !existsSync(path.join(target, 'node_modules')));
	check('복사: .git 제외', !existsSync(path.join(target, '.git')));
	check('복사: .env 제외(토큰 유출 방지)', !existsSync(path.join(target, '.env')));
	check('복사: .yarn/cache 제외', !existsSync(path.join(target, '.yarn', 'cache')));
	check('복사: dist 제외', !existsSync(path.join(target, 'dist')));
	check('복사: *.tsbuildinfo 제외', !existsSync(path.join(target, 'build.tsbuildinfo')));
	check('복사: .omc 제외', !existsSync(path.join(target, '.omc')));

	// (4) 기존 비어있지 않은 대상 판정
	const occupied = path.join(root, 'occupied', 'my-new-app');
	mkdirSync(occupied, { recursive: true });
	writeFileSync(path.join(occupied, 'keep.txt'), 'x', 'utf8');
	const planOcc = planCopy(src, path.join(root, 'occupied'), 'my-new-app');
	check('planCopy: 기존 비어있지 않은 대상 감지', planOcc.targetExistsNonEmpty === true);
} catch (err) {
	failures.push(`예외: ${err && err.stack ? err.stack : String(err)}`);
} finally {
	try {
		rmSync(root, { recursive: true, force: true });
	} catch {
		// 정리 실패는 결과에 영향 없음
	}
}

console.log('');
if (failures.length === 0) {
	console.log('COPY SELFTEST: PASS');
	process.exit(0);
} else {
	console.log(`COPY SELFTEST: FAIL (${failures.length}개 실패)`);
	for (const ff of failures) console.log(`  - ${ff}`);
	process.exit(1);
}
