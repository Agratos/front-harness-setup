# /clear-project — 복사 후 새 프로젝트로 초기화 (안전 절차 포함)

이 저장소를 **폴더째 복사해 새 프로젝트를 시작할 때 한 번** 실행하는 부트스트랩 커맨드입니다.
이전 프로젝트의 잔존물(런타임 로그·평가·결정·**실토큰**·제품 정체성·Notion 미러)을 정리해
"복사-즉시-사용" 상태로 만듭니다. 래핑 대상 스크립트는 `scripts/reset-project.mjs` 입니다.

> 이름 메모: `/clear` 는 Claude Code 빌트인(대화 비우기)으로 예약되어 있어 `/clear-project` 를 씁니다.

> ⚠️ **파괴적 커맨드입니다.** `.env` 토큰·이전 평가·결정 기록을 삭제합니다(커밋 안 된 것은 영구 손실).
> 그래서 이 커맨드는 **반드시 dry-run(미리보기) → 사용자 승인 → 적용** 순서로만 진행합니다.

## 동작 순서 (오케스트레이터가 따름)

### 1) dry-run 미리보기 — 무엇을 지울지 먼저 보여준다 (절대 생략 금지)

```bash
node scripts/reset-project.mjs --name=<새이름>
```

- `--apply` 없이 실행하면 **아무것도 바꾸지 않고** 정리 예정 항목만 출력합니다.
- 이 목록을 사용자에게 그대로 보여줍니다(삭제·치환·Notion 리셋 항목 포함).
- `<새이름>` 미지정 시 현재 폴더명이 기본값입니다.

### 2) 사용자 승인 — 파괴적이므로 확인을 받는다

미리보기 결과를 보여준 뒤, **적용해도 되는지 명시적으로 확인**받습니다.
특히 다음을 분명히 고지합니다:

- `.env` 의 실제 토큰이 제거됨(→ `.env.example` 내용으로 되돌림)
- `harness/evaluations/*`(이전 평가) 삭제 — 안 그러면 새 프로젝트 첫 merge 가 옛 점수로 가짜 통과
- `harness/decisions/*`·`report.md`·`state.json`·`config.json`·`cycles` 로그 정리

> 사용자가 승인하지 않으면 여기서 중단합니다(미리보기까지만).

### 3) 적용

```bash
node scripts/reset-project.mjs --name=<새이름> --apply
```

- 멱등합니다(이미 정리됐으면 변경 0건).
- Notion 미사용으로 강제하려면 `--no-notion`, 강제 적용하려면 `--notion` 을 덧붙입니다.

### 4) Notion 실제 초기화 (대시보드를 썼다면)

적용 결과에 `harness/notion-outbox/dashboard-reset.json` 적재가 포함되면, 그 페이로드대로
**Notion 대시보드를 실제로 비웁니다**(MCP 연동 시 오케스트레이터가 직접 수행):

- 페이로드의 `clear`(계획 DB 행·요약 카드·결정 댓글 미러)를 비우고
- `resetCallout`(프로젝트명·점수)을 새 프로젝트 상태로 초기화합니다.
- 처리 후 `harness/notion-outbox/dashboard-reset.json` 을 제거합니다(중복 적용 방지).
- MCP 미연동/비대화형이면 이 단계를 건너뛰고, outbox 페이로드를 남겨 둔 채 사용자에게 수동 초기화를 안내합니다.

### 5) 다음 단계 안내

- `.env` 를 열어 **새 토큰**을 채우도록 안내(또는 MCP 미사용이면 비워둠).
- `node scripts/init-project.mjs` → `/start-project` → `/run-cycle` 로 진행.
- (선택) 새 git 이력으로 시작: `rm -rf .git && git init -b main`. 이전 `step/*` 브랜치 정리.
  git 이력은 위험도가 높아 이 커맨드가 자동으로 건드리지 않습니다(안내만).

## 인자

| 설정          | 인자                              | 기본값                         |
| ------------- | --------------------------------- | ------------------------------ |
| 새 프로젝트명 | `--name=<v>` / `--name <v>`       | 현재 폴더명                    |
| 실제 적용     | `--apply` (= `--force`)           | 미지정 시 dry-run(미리보기)    |
| Notion 리셋   | `--notion` / `--no-notion`        | `harness/config.json` 의 `useMcp` 따름 |

## 정리/보존 범위

- **정리**: `harness/` 런타임 산출물(state·config·report·cycles·decisions·evaluations·errors),
  `.env` 토큰, 정체성(`package.json`·`index.html`·`src/app/App.tsx` 의 `harness-setup` → 새 이름),
  Notion outbox 잔존 + dashboard-reset 적재.
- **보존**: 하네스 엔진(`scripts/`·`.claude/`·`docs/`·`src/` 예시 슬라이스), `example-*`/`.gitkeep`.

## 비고

- 자가검증: `node scripts/reset-project.selftest.mjs` (CI self-test 에 포함).
- 단축 실행: `yarn reset` (= `node scripts/reset-project.mjs`). 단 안전을 위해 이 커맨드 절차(미리보기→승인→적용)를 권장합니다.
- 전체 흐름에서의 위치: **복사 직후 1회 `/clear-project`** → `/init-project` → `/start-project` → `/run-cycle`.
