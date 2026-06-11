# 협의 결정 로그 — decision-0001

| 키 | 값 |
| --- | --- |
| 안건 | 통합 데모에서 git-flow 와 loop 드라이버를 실제 repo 에 직접 적용할지, 임시 repo/상태로 격리할지 |
| 제기자 | architect |
| 타협 | git/loop 부작용은 임시 repo·임시 cwd 로 완전 격리하고, 실제 repo 에는 (1) decisions 결정 1건, (2) report.md 최종 보고, (3) cycles 요약 로그만 남긴다. |
| 결론 | git-flow 와 loop 완주는 임시 격리 환경에서 시연하고, 실제 repo 에는 최소 산출물만 기록한다. |
| 영향 | scripts/demo.mjs 의 격리 전략 확정. 통합 스모크를 반복 실행해도 실제 repo 가 안전하다. |
| 연결단계 | US-010 (통합 데모) |

## 안건

통합 데모에서 git-flow 와 loop 드라이버를 실제 repo 에 직접 적용할지, 임시 repo/상태로 격리할지

## 제기자

architect

## 주장 : 이유

| 에이전트 | 주장(claim) | 이유(reason) |
| --- | --- | --- |
| architect | git-flow 시연은 throwaway 임시 git repo 에서만 수행해야 한다 | 실제 repo 의 main 은 "미존재 시 1회 시드" 규약이라, 데모 커밋이 들어가면 부트스트랩 히스토리를 오염시킨다 |
| qa | loop 드라이버 완주도 임시 cwd(demo state)에서 돌려야 한다 | loop.mjs 는 cwd 의 harness/state.json 을 원자적으로 덮어쓰므로, 실제 state 를 건드리면 진행 상태가 손상된다 |
| pm | 데모가 실제 repo 에 남기는 산출물은 decisions 1건 + report.md 채우기로 한정한다 | 투명성(감사 추적)은 보장하되 부작용은 최소화해야 통합 스모크가 반복 실행에 안전하다 |

## 관점 · 반박

- qa → architect: 임시 repo 격리에 동의. 다만 cycle 로그 요약은 실제 repo 에 남겨야 감사 추적이 가능하다는 의견 → cycles 에 요약 1줄만 append 하기로 절충.

## 타협

git/loop 부작용은 임시 repo·임시 cwd 로 완전 격리하고, 실제 repo 에는 (1) decisions 결정 1건, (2) report.md 최종 보고, (3) cycles 요약 로그만 남긴다.

## 결론 + 근거(why)

- **결론**: git-flow 와 loop 완주는 임시 격리 환경에서 시연하고, 실제 repo 에는 최소 산출물만 기록한다.
- **근거(why)**: 실제 repo 의 git 히스토리·진행 상태(state.json) 오염을 막으면서도 전체 골격 흐름과 투명성(감사 추적)을 동시에 시연할 수 있기 때문이다.

## 영향

scripts/demo.mjs 의 격리 전략 확정. 통합 스모크를 반복 실행해도 실제 repo 가 안전하다.

## 연결 단계

US-010 (통합 데모)
