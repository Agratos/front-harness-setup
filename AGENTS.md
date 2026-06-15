# AGENTS — 협의체 & 디렉터리 맵

harness-setup 의 협의체(consensus) 구성, 오케스트레이터 중재 모델, 저장소 디렉터리 맵을 요약합니다. 각 역할의 전체 정의(입력·산출·도구·`주장:이유` 포맷)는 [`.claude/agents/`](.claude/agents/) 에 있고, 인덱스는 [`.claude/agents/README.md`](.claude/agents/README.md) 입니다.

---

## 협의체 9역할 (v2 — 사양서 확정 9: Deploy 를 Quality 에 흡수)

| 에이전트           | 파일                | 한 줄 책임                                                    | 주요 산출                                                               |
| ------------------ | ------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **CEO**            | `ceo.md`            | 각 단계 투입 에이전트 subset 선정 및 협의체 운영 총괄         | `harness/decisions/<id>-roster.md`                                      |
| **PM**             | `pm.md`             | CEO 선정 subset 호출(K≤3), 기여 수집·중재·합성 **코디네이터** | `harness/decisions/<id>.md` (증분 append)                               |
| **Architect**      | `architect.md`      | 설계·구조 결정, FSD 경계 준수, 기술 트레이드오프 평가         | `harness/decisions/<id>-arch.md` (ADR)                                  |
| **UI**             | `ui.md`             | FSD features/widgets/pages `ui` 세그먼트 컴포넌트 구현        | `src/{features,widgets,pages}/*/ui/`                                    |
| **UX**             | `ux.md`             | 사용 흐름·정보구조·인터랙션 사용성 평가 및 개선 제안          | `harness/evaluations/ux-<id>.md`                                        |
| **QA**             | `qa.md`             | typecheck/lint/test/check-arch 실행·판정·회귀 점검            | `harness/errors/`, `harness/evaluations/qa-<id>.md`                     |
| **Quality**        | `quality.md`        | 성능·접근성 심화 점검 + 빌드 검증·번들 분석·릴리스 노트(구 Deploy 흡수) | `harness/evaluations/quality-<id>.md`                            |
| **Customer**       | `customer.md`       | 페르소나(가변 1~3)로 dev 서버 직접 사용(Playwright), 100점 채점 | `harness/evaluations/<id>.json` + `<id>.md` (done-gate 가 `.json` 소비) |
| **Entity Modeler** | `entity-modeler.md` | 서버 API 문서 → FSD 엔티티 DTO/타입/매퍼/스토어 생성          | `src/entities/<entity>/{dto,types,mapper,store}/`                       |

> 9역할 = UI · UX · QA · Architect(설계) · Customer(고객) · CEO · PM(코디네이터) · Quality(품질+배포) · Entity Modeler. PM 이 진행관리·중재 코디네이터를 겸하고, 투표 동률 시 CEO 가 캐스팅보트를 가집니다.

---

## 오케스트레이터 중재 모델

```
오케스트레이터(하니스)
    │
    ▼
  CEO  ──────────────────────────────────────────────┐
    │  페이즈별 투입 subset + 지침                      │
    ▼                                                 │
   PM (코디네이터)                                     │ 미합의 에스컬레이션
    │                                                 │
    ├─ 호출(최대 동시 K=3) ──► Architect               │
    ├─ 호출(최대 동시 K=3) ──► UI / UX / QA / Quality   │
    └─ 호출(최대 동시 K=3) ──► Customer / Entity Modeler │
                                                      │
    ◄────────────── 각 에이전트 `주장:이유` 수신          │
    ▼                                                 │
  harness/decisions/<id>.md  (증분 append)            │
    ├─ 충돌 없음 → 최종 합성 결론 기록                   │
    └─ 충돌 있음 → 반박 라운드(최대 3R) → 합성 → 기록  ──┘
```

### 핵심 제약

1. **서브에이전트는 서로 직접 대화하지 않습니다.** 모든 통신은 PM 코디네이터를 통해 릴레이됩니다.
2. **공유 문서(`harness/decisions/<id>.md`)가 단일 진실 공급원입니다.** PM 은 기여를 받는 즉시 증분 append 합니다(배치 금지).
3. **최대 동시 호출 K=3.** 나머지는 앞선 기여가 기록된 후 순차 호출합니다.
4. **3 라운드 미합의 시 CEO 에스컬레이션.** CEO 가 최종 결정권을 행사하고 결과를 기록합니다.
5. **모든 협의 발언은 `주장:이유` 형식.** 형식: `주장: <한 줄 입장>` 다음 줄 `이유: <근거>`.

### 강제 모델 — 코드 강제 vs. 오케스트레이터 준수

이 협의 모델에서 **무엇이 코드로 강제되고 무엇이 LLM(오케스트레이터)의 준수에 의존하는지** 를 명시합니다. (혼동 방지: 모든 규칙이 자동 차단되는 것은 아닙니다.)

| 항목                                                                    | 강제 방식                                                                                       |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 페이즈 시퀀싱(1 호출 = 1 페이즈), 멱등 재개                             | **코드 강제** — `scripts/loop.mjs` / `state.mjs`                                                |
| 결정적 게이트 4종(typecheck/lint/arch/test)                             | **코드 강제** — `scripts/done-gate.mjs`                                                         |
| 평가 임계치(히스테리시스/래치), 채점 산식                               | **코드 강제** — `done-gate.mjs` / `rubric.mjs`                                                  |
| **재작업 카운트(`reworkCount`)·5회 초과 시 `vote` 분기·투표 후 진행(gateOverride)** | **코드 강제** — `scripts/loop.mjs`(`computeTransition`) + `done-gate.mjs --vote-override` |
| 브랜치 보호(직푸시 차단), merge 게이트                                  | **코드 강제** — `scripts/git-flow.mjs`                                                          |
| dev 서버 teardown·포트 해제                                             | **코드 강제** — `scripts/eval-playwright.mjs` / `teardown.mjs`                                  |
| Notion 미러 **적재 + 라이브 flush**(대시보드 진행상황·결정 결론)        | **코드** — 적재: `loop.mjs`→`upsertDashboard`, `log.mjs`→`mirrorDecisionComment`; flush: `loop`·`init-project` 가 `notion-flush.mjs`(Notion REST) 자동 실행(useMcp+`NOTION_TOKEN` 게이트, best-effort) |
| **에이전트 subset 선정**(누구를 투입할지), K=3 동시 호출 상한, 3 라운드 반박, `주장:이유` 형식, PM 경유 릴레이, 투표의 *내용*(누가 무엇에 표를 던지나·다수결 판단·캐스팅보트) | **오케스트레이터 수동 준수** — 코드 차단 없음. CEO 가 `docs/agent-roster.md` 기본값을 출발점으로 판단(힌트, 강제 아님). |

> 즉 **토론·중재의 절차 규칙(K=3·3R·형식)과 투표의 내용은 코드로 강제되지 않습니다.** 오케스트레이터가 이 규약을 따르도록 작성돼 있으며, 결과물(decisions 파일)의 형식·내용으로 사후 점검합니다.
> 반면 **"몇 번 재작업했는가 → 언제 투표로 넘어가는가 → 투표 후 어떻게 진행하는가"는 `loop.mjs` 가 코드로 강제**합니다(확정 2·3). 결정적 게이트와 함께 자동 차단/분기되는 부분입니다. 검증: `node scripts/loop.selftest.mjs`(시나리오 B).

### 결정 스키마

토론 결과는 `logDecision()`(`scripts/lib/log.mjs`)이 다음 스키마로 기록합니다:
**안건 / 제기자 / 주장:이유[] / 관점·반박 / 타협 / 결론 + 근거(why) / 영향 / 연결단계.**
예시: `harness/decisions/example-0001.md`. 상세는 [docs/usage.md](docs/usage.md) §3.

### 페이즈별 투입 예시

> 기본 subset(힌트)의 정본은 [`docs/agent-roster.md`](docs/agent-roster.md) 입니다. CEO 가 이를 출발점으로 상황에 맞게 가감합니다(강제 아님).

| 페이즈        | 투입 에이전트(예시)                    | 근거                                  |
| ------------- | -------------------------------------- | ------------------------------------- |
| 엔티티 모델링 | CEO, PM, Architect, Entity Modeler, QA | 구조 결정 + 타입 생성 + 검증          |
| UI 구현       | CEO, PM, Architect, UI, UX             | 설계 감독 + 구현 + 사용성             |
| 품질 검증     | CEO, PM, QA, Quality, Customer         | 자동화 검사 + 심화 점검 + 실사용 평가 |
| 배포 준비     | CEO, PM, Quality, QA                   | 빌드 검증 + 릴리스 노트 (Quality 담당) |

---

## 디렉터리 맵

| 경로                | 무엇이 있나                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/`          | 하니스 드라이버·게이트·평가·로깅 (Node `.mjs`). `loop.mjs`(드라이버), `git-flow.mjs`, `done-gate.mjs`, `eval-playwright.mjs`, `check-arch.js`, `init-project.mjs`, `demo.mjs`, `copy-project.mjs`(다른 경로로 복사+초기화), `reset-project.mjs`(제자리 초기화), `notion-flush.mjs`(outbox→Notion REST flush), `*.selftest.mjs`. `lib/`: `notion.mjs`(적재)·`notion-api.mjs`(flush) |
| `scripts/lib/`      | 공용 모듈: `state.mjs`(상태 매니페스트), `log.mjs`(logError/logCycle/logDecision), `rubric.mjs`(채점), `teardown.mjs`(프로세스 정리), `notion.mjs`(미러 어댑터)                                                                   |
| `.claude/agents/`   | 협의체 9역할 정의 + `README.md` 인덱스                                                                                                                                                                                            |
| `.claude/commands/` | 슬래시 커맨드: `copy-project`(다른 경로로 복사+초기화), `start-project`(제자리 정리·연동확인·Q&A·계획·시드 통합), `run-cycle`, `status`, `git-flow`, `evaluate`                                                                                                                                        |
| `harness/`          | 런타임 1차 로그: `config.json`, `state.json`, `decisions/`, `cycles/`, `errors/`, `evaluations/`, `report.md`                                                                                                                     |
| `docs/`             | 규약·레퍼런스: `usage.md`, `fsd/`(FSD 6레이어 문서 + `naming.md` + `README.md`; **실재 예시** = `src/entities/example`·`src/features/example-list`·`src/pages/home`), `eval-rubric.md`, `state-manifest.md`, `notion-dashboard.md` |
| `src/`              | FSD 웹프론트 산출물. 레이어(저 → 고): `shared` < `entities` < `features` < `widgets` < `pages` < `app`. 각 슬라이스는 `ui/ api/ model/(dto·types·mapper·store) lib/ …` 세그먼트 + `index.ts` 배럴 (entities 는 `model/` 아래 DTO↔Mapper↔Types 패턴 — scms-ems 방식) |

> 레이어 경계는 `scripts/check-arch.js` 가 강제합니다(상위 레이어 import 금지). 세부 규약은 [docs/fsd/](docs/fsd/) 참고.

---

## 관련 문서

- 빠른 시작 → [README.md](README.md)
- 상세 사용법·명령어·협의 동작 → [docs/usage.md](docs/usage.md)
- 역할 전체 정의 → [.claude/agents/README.md](.claude/agents/README.md)
- 상태/재개 규칙 → [docs/state-manifest.md](docs/state-manifest.md)
