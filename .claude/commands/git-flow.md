# /git-flow — git-flow 오케스트레이션

harness-setup 자율 개발 루프에서 **브랜치 생성 → step 작업 → main 병합**을 관리하는 게이트입니다.
`init-project` 이후, 각 step 작업의 시작·종료 시 호출됩니다.

모든 명령은 `harness/config.json` 의 `skipGitFlow`(= `useGit=false`) 를 먼저 확인하며,
`skipGitFlow=true` 면 **아무 것도 하지 않고(no-op) exit 0** 으로 종료합니다.

## 서브커맨드

### `seed-main` — 조건부 초기 시드

- main 에 커밋이 **없을 때(unborn)** 또는 main 이 없을 때만 초기 시드 커밋을 만듭니다.
  - 전체 스테이징(`git add -A`) 후 `chore: harness 계획 시드` 커밋.
  - 스테이징할 변경이 없으면 `--allow-empty` 로 루트 커밋을 보장합니다.
- **멱등**: main 에 이미 커밋이 있으면 아무 것도 하지 않고 `seed skipped (main already seeded)` 로그만 남깁니다.

### `start-step <nn> <slug>` — step 브랜치 생성

- main 에서 `step/<nn>-<slug>` 브랜치를 만들고 체크아웃합니다.
- 이미 같은 이름의 브랜치가 있으면 체크아웃만 합니다.
- main 이 아직 시드 안됐으면 거부합니다 (먼저 `seed-main` 필요).

### `merge-step <nn> <slug> [--vote-override] [--allow-empty] [--any-step]` — done-gate 통과 시 병합

- 순서: **현재 step 일치 검증**(state.json) → **빈 병합 차단**(main 대비 커밋·변경 확인) → **done-gate** → (원격 있으면) step 브랜치 push → `--no-ff` 병합 → (main 전진 시) **병합 결과 재게이트** → (원격 있으면) main push.
- 게이트 실패 시 병합을 거부하고 `exit 1` + 사유를 로그로 남깁니다.
- **현재 step 일치 검증**: `harness/state.json` 이 가리키는 현재 step 과 인자(`<nn> <slug>`)가 다르면 거부합니다 — 오케스트레이터가 step 을 착각해도 **다른 step 브랜치가 병합되지 않습니다**. 의도적 예외는 `--any-step` 명시(state.json 없으면 검사 생략 — 셀프테스트·수동 운용).
- `--vote-override`: vote 페이즈 뒤 드라이버가 전달 — done-gate 의 **주관 임계(90/88)만 우회**하고 결정적 게이트(typecheck/lint/check-arch/test)는 그대로 강제합니다.
- **병합 충돌 시 자동 abort**: 충돌이 나면 `merge --abort` 후 step 브랜치로 복귀하고 `exit 1` 로 실패합니다 — 반쯤 병합된 더티 main 을 남기지 않습니다. 충돌은 **step 브랜치에서 main 을 병합해 해결·커밋**한 뒤 merge-step 을 재시도하세요.
- **main 전진 시 병합 결과 재게이트**: 게이트는 step 브랜치 트리에서 돌므로, main 이 분기점 이후 전진했다면 병합 결과는 게이트를 통과한 적 없는 트리입니다. 그 경우에만 병합 직후 main 트리에서 결정적 게이트를 재실행하고, 실패하면 `ORIG_HEAD` 로 롤백 + step 브랜치 복귀 + `exit 1` 합니다(정상 운용 — main 쓰기가 merge-step 뿐 — 에서는 발동하지 않아 비용 0).
- 원격(`origin`)이 없으면 push 는 경고만 남기고 skip 합니다(자율 유지).

## merge-gate (done-gate) 판정 규칙

1. **`scripts/done-gate.mjs` 가 존재하면(현재 기본)**: `node scripts/done-gate.mjs` 를 실행해 **exit 0** 이어야 통과.
   이때 `--gate-ok`/`HARNESS_GATE_OK` 는 **무시**됩니다.
2. **done-gate.mjs 가 없으면(폴백 — 스켈레톤·셀프테스트 임시 저장소 전용)**: 명시적 승인이 필요합니다.
   - `--gate-ok` 플래그, 또는 환경변수 `HARNESS_GATE_OK=1`. 둘 다 없으면 거부.
   - ⛔ **이 폴백은 셀프테스트/CI 전용이다. 자율 루프에서 게이트를 피하려는 용도로 쓰지 않는다** — 실제 프로젝트에는 done-gate.mjs 가 항상 존재하므로 애초에 동작하지 않는다.

## 직접 main 작업 차단 (pre-commit 훅 — 코드 강제)

- step 작업은 반드시 `start-step` → (step 브랜치에서 작업) → `merge-step` 경로를 거쳐야 합니다.
- **배선**: `seed-main`/`start-step` 이 `.git/hooks/pre-commit` 에 가드 훅을 설치합니다(`ensureMainGuardHook`, 멱등). 기존 다른 훅(husky 등)이 있으면 덮지 않고 **가드 블록을 셔뱅 바로 뒤에 체이닝**합니다 — 기존 훅은 그대로 실행되고, main 직접 커밋만 가드가 선행 차단합니다. 시드 이후 main 에서의 직접 `git commit` 은 훅이 거부합니다.
- 예외: merge 진행 중 커밋(merge-step 의 충돌 마무리)·`HARNESS_ALLOW_MAIN=1`(의도적 우회)·시드 전(unborn).
- `merge-step` 이 **시드 이후 main 에 쓰기를 하는 유일한 경로**입니다.
- `assertNotDirectMainWork()` 함수는 같은 정책의 프로그램용 가드(export)이며, 실제 강제는 위 훅이 담당합니다.
- 검증: `node scripts/git-flow.selftest.mjs` 시나리오 [7](훅 차단·우회)·[8](충돌 abort)·[9](step 일치)·[10](병합 결과 재게이트)·[11](훅 체이닝).

## 커밋 메시지 규약 (Conventional Commits 기반)

step 브랜치의 작업 커밋과 게이트 커밋 모두 아래 규약을 따릅니다. (단일 진실 공급원)

```
<type>(<scope>): <subject>

[본문 — 선택: 왜(why) / 영향]
[푸터 — 선택: Refs: harness/decisions/<id>.md, harness/errors/<id>.md]
```

- **type**: `feat`(기능) · `fix`(버그) · `refactor` · `style`(포맷) · `test` · `docs` · `perf` · `build` · `ci` · `chore` · `merge`(병합)
- **scope**(선택): FSD 레이어/슬라이스 또는 step 식별자 — 예: `entities/example`, `shared/ui`, `widgets/example-list`, `step-01`
- **subject**: 한국어, 명령형 톤, 마침표 없이 ~72자 이내. "무엇을" 명확히.
- **본문/푸터**(선택): 협의·오류 로그 참조 — `Refs: harness/decisions/dec-003.md`.
- **원칙**: 1 논리 변경 = 1 커밋. WIP/squash 흔적은 merge 전 정리.

**예시**

```
feat(entities/example): Zustand 스토어 + TanStack Query 목록 훅 추가
fix(widgets/example-list): 로딩 상태에서 빈 배열 렌더 방지
docs(fsd): 스토어 파일명 규약을 <name>.store.ts 로 통일
test(shared/ui): Button 렌더·클릭 테스트 추가
chore: harness 계획 시드            # ← seed-main 이 자동 생성
merge: step/01-login → main          # ← merge-step 이 자동 생성 (--no-ff)
```

**git-flow.mjs 가 자동 생성하는 커밋** (위 규약과 일치)

- `seed-main` → `chore: harness 계획 시드`
- `merge-step` → `merge: step/<nn>-<slug> → main` (`--no-ff` 병합 커밋)

> step 브랜치에서의 **작업 커밋은 사람/오케스트레이터가 위 규약으로 직접 작성**합니다(git-flow.mjs 는 작업 커밋을 만들지 않음). merge-step 은 done-gate 통과 시 병합 커밋만 생성합니다.

## 실행

```bash
# 1) 계획 시드 (멱등 — 재실행 안전)
node scripts/git-flow.mjs seed-main

# 2) step 시작 → step/01-login 브랜치 생성·체크아웃
node scripts/git-flow.mjs start-step 01 login

#    ... step 브랜치에서 작업 + 커밋 ...

# 3) done-gate 통과 시 main 으로 병합 (done-gate.mjs 가 자동 판정 — 플래그 불필요)
node scripts/git-flow.mjs merge-step 01 login
```

> ⛔ `--gate-ok`/`HARNESS_GATE_OK=1` 은 done-gate.mjs 가 **없는** 환경(셀프테스트 임시 저장소)의 폴백 전용이며,
> done-gate.mjs 가 있으면 무시됩니다. **자율 루프에서 게이트 우회 목적으로 사용 금지.**

## 원격 main 보호 (GitHub)

- 이 저장소(하네스 본체)의 원격은 **`Agratos/front-harness-setup`** 이다. `Agratos/harness-setup-test` 는
  테스트벤치 시행용 스크래치 저장소로, **보호를 걸지 않는다**(시행마다 무관한 이력으로 리셋 — force-push 필요).
- 본체 원격 main 에는 **최소 보호**를 적용한다: force-push 차단 + 브랜치 삭제 차단, required check 없음.
  (2026-08-12 적용 — `gh api PUT repos/Agratos/front-harness-setup/branches/main/protection`)
- **required status check / PR 필수를 걸지 않는 이유**: merge-step 은 로컬 done-gate 통과 후 main 을
  **직접 push** 한다. 원격이 "체크 통과 커밋만 push 허용" 을 요구하면 push 시점엔 체크가 존재하지 않아
  전부 거부되고, `pushIfRemote` 는 push 실패를 무시하므로 **로컬/원격 main 이 조용히 갈라진다**.
  원격 게이트로 승격하려면 push 직행 대신 PR 경유(+CI 조건 auto-merge)로 플로우 자체를 바꿔야 한다 —
  그 전환은 별도 결정 사항으로 남긴다(로컬 게이트가 1차 방어선, 원격 보호는 이력 보존 백스톱).

## useGit=false 우회

`init-project` 에서 `useGit=false` 로 결정되면 `harness/config.json` 에 `skipGitFlow=true` 가 기록되며,
`seed-main` / `start-step` / `merge-step` 모두 no-op 로그 후 exit 0 으로 빠집니다 (git 미사용 프로젝트 지원).

## 자가 검증

```bash
node scripts/git-flow.selftest.mjs   # 임시 git 저장소에서만 동작, PASS 시 exit 0
```

> selftest 는 `os.tmpdir()` 의 일회용 저장소에서만 실행되며 실제 저장소를 절대 변경하지 않습니다.
