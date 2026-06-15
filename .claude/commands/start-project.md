# /start-project — 프로젝트 시작 (정리 → 연동확인 → Q&A·계획·시드)

자율 개발 루프(`/run-cycle`)를 돌리기 **직전에 한 번** 실행하는 부트스트랩 커맨드입니다.
이전의 `/clear-project`(제자리 정리)와 `/init-project`(연동 확인)를 **단계로 흡수**해, 프로젝트 시작 전체를 한 커맨드로 처리합니다.

> 스크립트는 그대로 재사용합니다: `reset-project.mjs`(정리) · `init-project.mjs`(연동 확인) · `loop.mjs --init`(계획) · `git-flow.mjs seed-main`(시드). 이 커맨드는 그 순서를 오케스트레이션합니다.
> 다른 경로로 **복사하며 시작**하려면 `/copy-project`(복사 후 자동 정리)를 먼저 쓰고, 그 폴더에서 이 커맨드를 1번 단계부터 실행하세요.

## 동작 순서

### 0) (선택 `--fresh`) 제자리 초기화 — 파괴적

복사 없이 **현재 폴더**를 새 프로젝트로 쓸 때만 수행합니다. 이전 산출물·`.env` 토큰·정체성·Notion outbox 를 정리합니다. 파괴적이므로 **미리보기 → 사용자 승인 → 적용** 순서로만 진행합니다:

```bash
node scripts/reset-project.mjs --name=<이름>          # 미리보기(dry-run)
node scripts/reset-project.mjs --name=<이름> --apply  # 적용
```

> `/copy-project` 로 복사해 온 경우엔 복사 시 이미 초기화되므로 이 단계를 건너뜁니다.

### 1) 연동 접근 확인 (git 원격 · Notion)

git/MCP 사용 여부와 주소를 받아 **실제 접근 가능한지 확인**하고 `harness/config.json` 에 기록합니다:

```bash
node scripts/init-project.mjs --use-mcp=true \
  --git-remote=git@github.com:me/my-app.git \
  --notion-url=https://www.notion.so/.../Dashboard-<32hex>
```

- **git**: `git ls-remote` 로 접근·인증 확인 → 성공 시 `origin` 연결.
- **Notion**: URL 에서 page id 추출 → `NOTION_TOKEN` 으로 페이지 조회(integration 연결 확인) → page id 저장.
- 실패는 차단하지 않고 경고만(자율 유지). 대화형에서는 `AskUserQuestion` 으로 사용 여부·주소를 물어 전달하고 ✅/❌ 결과를 보여줍니다.

### 2) deep-interview 식 Q&A (요구사항 결정화)

핵심 질문으로 모호성을 제거합니다(충분히 명확하면 건너뜀):

- **목표/범위**: 무엇을 만드는가? 완료의 정의는?
- **페르소나**: 누가 쓰는가? 핵심 시나리오 1~2개.
- **제약**: 기술 스택 고정 여부, 일정, 비기능 요구(성능/접근성).
- **평가 기준**: done-gate 임계(기본 종합 90점, major 불만 0)를 따를지.

### 3) 계획 시드 (planSteps 도출)

Q&A 결과를 step 목록으로 분해해 시드합니다. 각 step 은 `"<nn>-<slug>"` 형식(예: `01-login`) — 이 라벨이 `git-flow` 의 `step/<nn>-<slug>` 브랜치명으로 직결됩니다.

```bash
node scripts/loop.mjs --init "01-login,02-dashboard,03-settings"
```

- `--init` 은 상태가 `init`/없을 때만 시드(기존 진행 상태는 덮어쓰지 않음).

### 4) 조건부 main 시드 (git 사용 시에만)

```bash
node scripts/git-flow.mjs seed-main   # 멱등 — main 에 커밋 있으면 no-op. useGit=false 면 자동 우회.
```

## 실행 요약

```bash
# (제자리 새 프로젝트면) 0) 정리
node scripts/reset-project.mjs --name=my-app --apply
# 1) 연동 확인
node scripts/init-project.mjs --use-mcp=true --git-remote=<url> --notion-url=<url>
# 2) (대화형) Q&A → planSteps 확정
# 3) 계획 시드
node scripts/loop.mjs --init "01-login,02-dashboard"
# 4) git 사용 시 main 시드
node scripts/git-flow.mjs seed-main
```

## 다음 단계

`/run-cycle` — 드라이버(`loop.mjs`)를 페이즈마다 재호출하며 각 step 을 완주합니다.

## 비고

- 비대화형(CI/자율 루프)에서는 Q&A 를 건너뛰고 `--init` 으로 planSteps 를 직접 주입하며, 연동값은 인자/환경변수로 주입합니다.
- 사용자 전역 규칙상 범위/옵션을 되묻지 않고 즉시 실행해야 하는 맥락에서는, 합리적 기본 planSteps 를 도출해 바로 시드하고 진행합니다.
- 단축 실행: 정리=`yarn reset`, 복사+정리=`yarn copy`.
