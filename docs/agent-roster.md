# 페이즈별 기본 에이전트 subset (힌트)

CEO 가 각 페이즈에 투입할 에이전트 subset 을 정할 때 **출발점으로 쓰는 기본값**입니다.
**강제 규칙이 아니라 힌트**입니다 — CEO 는 페이즈 목표·복잡도·이전 페이즈 결과에 따라 가감하고, 그 근거를 `harness/decisions/<id>-roster.md` 에 기록합니다.

> 코드로 강제하지 않는 이유: "이 페이즈에 누구를 부를지"는 화면·프로젝트마다 다른 **판단**입니다. 고정하면 CEO 의 비용·위험·가치 판단이 죽습니다. 그래서 기본값은 힌트로만 두고, 실제 선택은 CEO(LLM)가 합니다. (게이트·시퀀싱·기록은 코드 강제, 선택·토론은 LLM — 하네스의 일관된 원칙.)

## 기본 subset

`CEO`·`PM` 은 모든 협의 페이즈에 기본 포함됩니다(CEO=subset 선정·총괄, PM=호출·중재 코디네이터).

| 페이즈        | 기본 subset (CEO·PM 외)              | 비고 |
| ------------- | ------------------------------------- | ---- |
| `decompose`   | `architect` (+ `entity-modeler`*)     | CEO 가 페르소나 복잡도 판정도 수행 |
| `design`      | `architect`, `ui`, `ux`               | 구조·화면 설계 |
| `implement`   | `ui`, `entity-modeler`* (`architect` 감독) | 실제 구현 |
| `verify`      | — (드라이버 페이즈)                   | `done-gate --deterministic-only` |
| `evaluate`    | `customer`, `quality`, `ux`           | 채점·심화 점검·사용성 |
| `debate`      | 직전 페이즈 관련 에이전트             | 평가 결과 토론·재작업 판정 |
| `vote`        | 해당 step 참여 에이전트 전원          | 다수결, 동률 시 CEO 캐스팅보트 |
| `merge`       | — (드라이버 페이즈)                   | `git-flow merge-step` |

\* `entity-modeler` 는 서버 API/엔티티 타입·매퍼·스토어 작업이 있는 step 에서만 투입.

## 페르소나 수 (decompose 에서 CEO 판정)

복잡도 체크리스트 3개 중 **2개 이상 = 복잡 화면 → `customer` 페르소나 2~3개**, 그 외 1개:

1. 폼 필드 5개 이상
2. 상태 분기(로딩/에러/빈/권한 등) 3개 이상
3. 관여 슬라이스(feature/widget) 4개 이상

## 조정 가이드

- **단순 페이즈**(골격 구현 등) → subset 을 줄여 의사결정 속도↑ (예: `architect`+`ui` 만)
- **위험·복잡 페이즈**(권한·결제 등) → `quality`·`customer` 추가, 페르소나 다수
- 제외한 에이전트와 이유도 roster 에 남겨 사후 점검이 가능하게 합니다.
