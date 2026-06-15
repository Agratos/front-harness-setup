# /status — 하네스 진행 상태 요약

`harness/state.json` 의 현재 단계(step)/페이즈(phase)/평점(scores)을 한눈에 요약합니다.
드라이버 `loop.mjs` 호출 사이사이, 또는 재개 직전에 현재 위치를 확인할 때 사용합니다.

## 가장 빠른 확인 — loop.mjs (실행 없이 상태만)

`loop.mjs` 는 매 호출 시 현재 step/phase/phaseSeq/status 를 출력합니다.
다만 호출하면 **한 페이즈 전진**하므로, 단순 조회는 상태 파일을 직접 읽는 방식을 권장합니다.

## 상태 파일 직접 읽기

```bash
# 전체 상태
node -e "console.log(require('node:fs').readFileSync('harness/state.json','utf8'))"

# 핵심 요약만
node -e "const s=JSON.parse(require('node:fs').readFileSync('harness/state.json','utf8')); console.log(`step ${s.currentStepIdx+1}/${s.planSteps.length} (${s.planSteps[s.currentStepIdx]??'-'}) | phase=${s.phase} phaseSeq=${s.phaseSeq} | status=${s.status} | rework=${s.reworkCount}/5${s.gateOverride?' (gateOverride)':''}`); console.log('scores:', JSON.stringify(s.scores));"
```

## 읽는 법 — 필드 의미

| 필드                           | 의미                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `currentStepIdx` / `planSteps` | 현재 step 인덱스(0-based)와 전체 step 목록. `idx+1/length` 로 표시.                        |
| `phase`                        | 현재(=다음 실행될) 페이즈. `decompose/design/implement/verify/evaluate/debate/merge` + 분기 `vote`(재작업 5회 초과 시). |
| `phaseSeq`                     | 페이즈 시퀀스(단조 증가). 재개 앵커.                                                       |
| `status`                       | `init`(미시작) / `running`(진행) / `blocked`(차단) / `done`(완료).                         |
| `committed`                    | 현재 페이즈 결과 커밋 여부. `false`+페이즈 done 표시면 멱등 재실행 대상.                   |
| `reworkCount`                  | 현재 step 재작업 횟수 (한도 5). 도달 후에도 `rework` 면 `vote` 분기. step 바뀌면 0 초기화.  |
| `gateOverride`                 | `true` 면 직전 `vote` 의결로 다음 `merge` 가 주관 임계를 우회(결정적 게이트는 유지). 새 step 진입 시 `false`. |
| `scores[stepId]`               | step 별 `{ score, majorComplaints, latched }`. `latched=true` 면 done-gate 통과 래치 상태. |

## 평점(scores) 해석 — done-gate 히스테리시스

- `score ≥ 90` & `majorComplaints = 0` → 최초 통과 + 래치(`latched=true`).
- 래치 후 `score ≥ 88` → 계속 통과 (88~90 미세변동은 플래핑 없음).
- 래치 후 `score < 88` 또는 `majorComplaints > 0` → 탈락(`latched=false`).

## 산출물 위치

| 항목            | 경로                                                      |
| --------------- | --------------------------------------------------------- |
| 상태 매니페스트 | `harness/state.json`                                      |
| 사이클 로그     | `harness/cycles/cycle-log.ndjson` (페이즈별 1줄)          |
| 협의 기록       | `harness/decisions/<id>.md`, roster: `<id>-roster.md`     |
| 평가 결과       | `harness/evaluations/<id>.json` (종합 score + major 불만) |
| 에러 로그       | `harness/errors/`                                         |
| 리포트          | `harness/report.md`                                       |

## 예시 출력

```
step 2/3 (02-dashboard) | phase=evaluate phaseSeq=11 | status=running | rework=1
scores: {"step-0":{"score":92,"majorComplaints":0,"latched":true}}
```

→ 1번 step(`01-login`)은 92점으로 통과·래치 완료, 현재 2번 step 의 `evaluate` 페이즈 진행 중(재작업 1회)임을 의미합니다.
