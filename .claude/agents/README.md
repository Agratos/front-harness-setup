# 협의체 에이전트 인덱스

> 사양서 참조: `docs/spec/interview-2026-06-11.md`

## 9개 역할 일람

| 에이전트           | 파일                | 한 줄 책임                                                | 주요 산출                                                               |
| ------------------ | ------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| **CEO**            | `ceo.md`            | 각 단계 투입 에이전트 subset 선정 및 협의체 운영 총괄, 복잡도 판정, 캐스팅보트 | `harness/decisions/<id>-roster.md`                                      |
| **PM**             | `pm.md`             | CEO 선정 subset 호출(K≤3), 기여 수집·중재·합성 코디네이터, 투표 소집 | `harness/decisions/<id>.md` (증분 append)                               |
| **Architect**      | `architect.md`      | 설계·구조 결정, FSD 경계 준수, 기술 트레이드오프 평가     | `harness/decisions/<id>-arch.md` (ADR)                                  |
| **UI**             | `ui.md`             | FSD features/widgets/pages ui 세그먼트 컴포넌트 구현      | `src/{features,widgets,pages}/*/ui/`                                    |
| **UX**             | `ux.md`             | 사용 흐름·정보구조·인터랙션 사용성 평가 및 개선 제안      | `harness/evaluations/ux-<id>.md`                                        |
| **QA**             | `qa.md`             | typecheck/lint/test/check-arch 실행·판정·회귀 점검        | `harness/errors/`, `harness/evaluations/qa-<id>.md`                     |
| **Quality**        | `quality.md`        | 성능 예산(Core Web Vitals) 및 접근성(a11y) 심화 점검, 로컬 빌드 검증, 번들 크기 분석, 릴리스 노트 작성 | `harness/evaluations/quality-<id>.md`, `harness/evaluations/release-notes-<id>.md` |
| **Customer**       | `customer.md`       | 페르소나로 dev 서버 직접 사용(Playwright), 100점 채점 (기본 1 페르소나, 복잡 화면 시 2~3 페르소나) | `harness/evaluations/<id>.json` + `<id>.md` (done-gate 가 `.json` 소비) |
| **Entity Modeler** | `entity-modeler.md` | API 문서 → FSD 엔티티 DTO/타입/매퍼/스토어 생성           | `src/entities/<entity>/{dto,types,mapper,store}/`                       |

---

## 오케스트레이터 중재 모델

```
오케스트레이터(하네스)
    │
    ▼
  CEO  ──────────────────────────────────────────────────────┐
    │  페이즈별 투입 subset + 지침                              │
    ▼                                                         │
   PM (코디네이터)                                             │ 미합의 에스컬레이션
    │                                                         │
    ├─ 호출(최대 동시 K=3) ──► Architect                       │
    │                                                         │
    ├─ 호출(최대 동시 K=3) ──► UI / UX / QA / Quality 등       │
    │                                                         │
    └─ 호출(최대 동시 K=3) ──► Customer / Entity …             │
                                                              │
    ◄────────────────── 각 에이전트 주장:이유 수신              │
    │                                                         │
    ▼                                                         │
  harness/decisions/<id>.md  (증분 append)                   │
    │                                                         │
    ├─ 충돌 없음 → 최종 합성 결론 기록                          │
    └─ 충돌 있음 → 추가 반박 라운드(최대 3R) → 합성 → 기록     ─┘
```

### 핵심 제약

1. **서브에이전트는 서로 직접 대화하지 않습니다.**
   - 모든 에이전트 간 통신은 PM 코디네이터를 통해 릴레이됩니다.
   - 에이전트 A가 에이전트 B에게 반박할 때도 PM을 거쳐 전달됩니다.

2. **공유 문서(`harness/decisions/<id>.md`)가 단일 진실 공급원입니다.**
   - PM은 기여를 받는 즉시 증분 append 합니다(배치 처리 금지).
   - 모든 에이전트는 이 파일을 통해 다른 에이전트의 입장을 파악합니다.

3. **최대 동시 호출 K=3.**
   - PM은 CEO가 선정한 subset 내에서 한 번에 최대 3개 에이전트를 동시 호출합니다.
   - 나머지 에이전트는 앞선 기여가 기록된 후 순차 호출합니다.

4. **3 라운드 반박 후 미합의 시 CEO 에스컬레이션.**
   - PM이 3 라운드 반박 후에도 합의 실패를 감지하면 CEO에게 에스컬레이션합니다.
   - CEO가 최종 결정권을 행사하고 `harness/decisions/<id>.md` 에 기록합니다.

5. **모든 협의 발언은 `주장:이유` 형식을 준수합니다.**
   - 형식을 준수하지 않은 발언은 PM이 재요청합니다.
   - 형식: `주장: <한 줄 입장>` 다음 줄 `이유: <근거>`

---

## 페이즈별 에이전트 투입 예시

| 페이즈        | 투입 에이전트 (예시)                   | 근거                                  |
| ------------- | -------------------------------------- | ------------------------------------- |
| 엔티티 모델링 | CEO, PM, Architect, Entity Modeler, QA | 구조 결정 + 타입 생성 + 검증          |
| UI 구현       | CEO, PM, Architect, UI, UX             | 설계 감독 + 구현 + 사용성             |
| 품질 검증     | CEO, PM, QA, Quality, Customer         | 자동화 검사 + 심화 점검 + 실사용 평가 |
| 빌드·릴리스   | CEO, PM, Quality, QA                   | 빌드 검증 + 번들 분석 + 릴리스 노트   |
