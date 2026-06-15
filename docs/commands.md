# 슬래시 커맨드 인덱스

harness-setup 의 슬래시 커맨드 목록과 실행 흐름입니다. 각 커맨드의 전체 정의는 [`.claude/commands/`](../.claude/commands/) 의 `<name>.md` 에 있습니다.

> 커맨드 이름 규칙: `*-project` 는 **프로젝트 단위 부트스트랩**(복사/초기화/시작), 나머지는 **개발 사이클** 단계입니다.
> `/copy`·`/clear`·`/init` 단독 이름은 Claude Code 빌트인과 겹쳐 예약되어 있어 `-project` 접미사를 씁니다.

## 한눈에 보기

| 커맨드           | 한 줄 역할                                                            | 래핑 스크립트                | 파괴적? |
| ---------------- | --------------------------------------------------------------------- | ---------------------------- | ------- |
| `/copy-project`  | 다른 경로로 **복사 + 빈 껍데기화**(테스트 산출물·토큰 제거, Notion 미건드림) | `copy-project.mjs`           | 아니오(새 위치 생성) |
| `/start-project` | git/Notion **접속 확인 + Notion 대시보드 초기화** → Q&A·계획·main 시드 | `init-project`·`loop`·`git-flow` `.mjs` | 아니오 |
| `/run-cycle`     | 사이클 완주 — 페이즈 드라이버 재호출 + 협의 위임                      | `loop.mjs`                   | 아니오 |
| `/status`        | 진행 상태(step/phase/score/rework) 요약                              | `state.json` 조회            | 아니오 |
| `/git-flow`      | `seed-main` / `start-step` / `merge-step` (직푸시 차단)              | `git-flow.mjs`               | 쓰기(merge 게이트) |
| `/evaluate`      | 고객 평가(Playwright) + 루브릭 채점 + Notion 미러                     | `eval-playwright.mjs`        | 아니오(teardown 포함) |

## 실행 흐름

```
/copy-project        →  cd <새폴더> → yarn install →  /start-project           →  /run-cycle  ⟳ … (status=done)
(복사 + 빈 껍데기화)                                    (git/Notion 접속 확인           ├─ 내부: verify → /evaluate → debate/vote → merge(/git-flow)
                                                        + Notion 대시보드 초기화        └─ 진행 확인: /status (언제든)
                                                        → Q&A·계획·main 시드)
```

- **부트스트랩**: `/copy-project` 로 다른 경로에 빈 껍데기로 복사(Notion 미건드림) → 그 폴더에서 `/start-project` 로 git/Notion 주소를 넣어 접속 확인 + Notion 초기화 후 Q&A·계획.
- **반복(루프)**: `/run-cycle` 를 status=done 까지 재호출. 한 번 호출 = 한 페이즈 진행(크래시·턴 경계를 넘어 재개).
- **보조**: `/status`(상태 조회), `/git-flow`·`/evaluate` 는 보통 `/run-cycle` 이 내부에서 호출하지만 단독으로도 실행 가능.

> `/start-project` 는 이전의 `init-project`(연동 확인)를 흡수했고, **정리(빈 껍데기화)는 `/copy-project` 가 복사 시 수행**합니다. 스크립트 `reset-project.mjs`·`init-project.mjs` 는 그대로 재사용되며 `yarn reset`·`yarn copy` 로도 직접 실행할 수 있습니다.

## 관련 문서

- 협의체 9역할 → [../.claude/agents/README.md](../.claude/agents/README.md)
- 상세 사용법 → [usage.md](usage.md)
- 빠른 시작 → [../README.md](../README.md)
