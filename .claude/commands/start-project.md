# /start-project — 프로젝트 시작 (Q&A → 계획 → 조건부 main 시드)

`init-project` 통과 이후, 자율 개발 루프(`/run-cycle`)를 돌리기 **직전**에 한 번 실행하는 부트스트랩 커맨드입니다.
deep-interview 식 Q&A 로 요구사항을 결정화하고, 계획(planSteps)을 세우며, git 사용 시 main 을 시드합니다.

## 동작 순서

### 1) deep-interview 식 Q&A (요구사항 결정화)

오케스트레이터가 사용자에게 핵심 질문을 던져 모호성을 제거합니다. 최소 확인 항목:

- **목표/범위**: 무엇을 만드는가? 성공 기준(완료의 정의)은?
- **페르소나**: 누가 쓰는가? 핵심 시나리오 1~2개.
- **제약**: 기술 스택 고정 여부, 일정, 비기능 요구(성능/접근성).
- **평가 기준**: done-gate 평가 임계치(기본 종합 90점, major 불만 0)를 따를지.

> 모호도가 충분히 낮아질 때까지 질문합니다. 충분히 명확하면 곧바로 다음 단계로 넘어갑니다.

### 2) 계획 수립 (planSteps 도출)

Q&A 결과를 step 목록으로 분해합니다. 각 step 은 `"<nn>-<slug>"` 형식 라벨을 권장합니다
(예: `01-login`, `02-dashboard`). 이 라벨이 `git-flow` 의 `step/<nn>-<slug>` 브랜치명으로 직결됩니다.

계획을 `harness/state.json` 의 `planSteps` 에 시드합니다 (드라이버 `loop.mjs --init` 사용):

```bash
node scripts/loop.mjs --init "01-login,02-dashboard,03-settings"
```

- `--init` 은 상태가 `init` 이거나 없을 때만 `planSteps` 를 시드합니다 (기존 진행 상태는 덮어쓰지 않음).
- 시드 직후 첫 페이즈(`decompose`)가 1회 실행되고 다음 페이즈로 전진합니다.

### 3) 조건부 main 시드 (git 사용 시에만)

`harness/config.json` 의 `useGit=true`(= `skipGitFlow=false`) 일 때만 main 을 시드합니다:

```bash
node scripts/git-flow.mjs seed-main
```

- **멱등**: main 에 이미 커밋이 있으면 no-op.
- `useGit=false` 면 `seed-main` 은 no-op 로그 후 exit 0 (git 미사용 프로젝트 우회).

## 실행 요약

```bash
# (대화형) 오케스트레이터가 Q&A 진행 → planSteps 확정
# 1) 계획 시드 + 첫 페이즈 진입
node scripts/loop.mjs --init "01-login,02-dashboard"

# 2) git 사용 시 main 시드 (멱등)
node scripts/git-flow.mjs seed-main
```

## 다음 단계

`/run-cycle` — 드라이버(`loop.mjs`)를 페이즈마다 재호출하며 각 step 을 완주합니다.

## 비고

- 비대화형(CI/자율 루프)에서는 Q&A 를 건너뛰고 `--init` 으로 planSteps 를 직접 주입합니다.
- 사용자 전역 규칙상 범위/옵션을 되묻지 않고 즉시 실행해야 하는 맥락에서는,
  합리적 기본 planSteps 를 도출해 바로 시드하고 진행합니다.
