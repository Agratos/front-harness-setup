# 상태 매니페스트 (State Manifest)

하니스 실행의 진행 상태를 단일 JSON 파일(`harness/state.json`)에 원자적으로 기록·복원하는 모듈입니다. 크래시가 발생해도 마지막으로 안전하게 기록된 상태에서 멱등(idempotent)하게 재개할 수 있도록 설계되었습니다.

구현: `scripts/lib/state.mjs`
자가검증: `node scripts/lib/state.selftest.mjs`

---

## (a) 상태 스키마 (필드별)

`defaultState(planSteps)` 가 생성하는 상태 객체의 스키마입니다.

| 필드               | 타입                                         | 설명                                                                                                                                               |
| ------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planSteps`        | `string[]`                                   | 계획 단계 라벨 배열. 실행 계획의 전체 단계 목록입니다.                                                                                             |
| `currentStepIdx`   | `number`                                     | 현재 진행 중인 단계의 인덱스(0-based). `planSteps.length` 이상이면 모든 단계를 소진한 것으로 봅니다.                                               |
| `phase`            | `string`                                     | 현재 페이즈 이름(예: `init`, `design`, `implement`, `verify`). 초기값 `'init'`.                                                                    |
| `phaseSeq`         | `number`                                     | 페이즈 시퀀스 번호. `advancePhase` 마다 단조(monotonic) 증가합니다. 재개 앵커이자 토큰 유일성의 근거입니다.                                        |
| `checkpointToken`  | `string`                                     | 결정적(deterministic) 체크포인트 토큰. 형식 `${phaseSeq}-${phase}-${counter}`. `Math.random`/`Date` 를 쓰지 않아 동일 입력에 동일 토큰이 나옵니다. |
| `committed`        | `boolean`                                    | 현재 페이즈의 결과가 커밋 완료되었는지 여부. `advancePhase` 시 `false` 로 리셋, `markCommitted` 시 `true`.                                         |
| `branch`           | `string \| null`                             | 작업 브랜치 이름. 미설정이면 `null`.                                                                                                               |
| `lastCommittedSha` | `string \| null`                             | 마지막 커밋의 SHA. **비-git 실행(`useGit=false`) 시에는 항상 `null`**.                                                                             |
| `scores`           | `object`                                     | 평가 차원별 점수 누적(예: `{ correctness: 8, design: 7 }`). 초기값 `{}`.                                                                           |
| `reworkCount`      | `number`                                     | 현재 step 의 재작업(rework) 횟수. `loop.mjs` 가 `debate` 의 `rework` 판정마다 1 증가시키고 `implement` 로 되돌립니다. `MAX_REWORK(=5)` 도달 후에도 `rework` 면 `vote` 로 분기합니다. step 이 바뀌면(merge→다음 decompose) 0 으로 초기화됩니다. |
| `gateOverride`     | `boolean`                                    | 투표 오버라이드 플래그. `vote` 페이즈를 마치면 `true` 가 되어 다음 `merge` 의 done-gate 가 `--vote-override`(주관 임계만 우회, 결정적 게이트는 유지)로 호출됩니다. 새 step 진입 시 `false` 로 초기화. 초기값 `false`. |
| `status`           | `'init' \| 'running' \| 'blocked' \| 'done'` | 실행 전체 상태. 초기값 `'init'`.                                                                                                                   |

---

## (b) 원자적 쓰기(temp → rename) 근거

`writeState(statePath, state)` 는 다음 2단계로 동작합니다.

1. `<statePath>.tmp` 에 직렬화된 JSON 을 **완전히** 기록합니다.
2. `fs.renameSync(tmp, statePath)` 로 임시 파일을 최종 경로로 **교체**합니다.

`rename(2)` 은 동일 볼륨 내에서 **원자적(atomic)** 연산입니다. 따라서 독자(reader)는 다음 둘 중 하나만 보게 됩니다.

- 이전(old) 상태 파일 전체, 또는
- 새(new) 상태 파일 전체.

절대로 **반쯤 쓰인(half-written)** 파일이 노출되지 않습니다. 만약 `writeFileSync` 로 최종 파일에 직접 덮어쓰면, 쓰는 도중 크래시가 났을 때 잘려나간 JSON 이 남아 `readState` 가 파싱에 실패하고 상태를 통째로 잃을 위험이 있습니다. temp→rename 패턴은 이 윈도우(window)를 제거합니다.

부모 디렉터리는 쓰기 전에 `mkdirSync(dir, { recursive: true })` 로 보장합니다.

> 참고: Windows 에서 `rename` 은 대상이 이미 존재하면 동작이 플랫폼마다 미묘하게 다를 수 있으나, Node.js `fs.renameSync` 는 동일 볼륨에서 기존 파일을 원자적으로 교체합니다. 본 하니스는 동일 볼륨(`harness/`) 내에서만 동작하므로 이 보장을 사용합니다.

---

## (c) 비-git 재개

`useGit=false` 로 실행하는 경우 git commit/SHA 개념이 없습니다.

- `lastCommittedSha` 는 항상 `null` 입니다. `markCommitted(state)` 를 sha 인자 없이 호출하면 `committed=true`, `lastCommittedSha=null` 이 됩니다(허용된 경로).
- 재개 앵커로는 **`phaseSeq` + `checkpointToken`** 을 사용합니다. SHA 가 없으므로 "어느 페이즈까지 진행했는가"를 SHA 가 아니라 `phaseSeq`(단조 증가)와 그로부터 결정적으로 파생되는 `checkpointToken` 으로 식별합니다.
- 즉, 비-git 모드의 진실 원천(source of truth)은 `harness/state.json` 자체이며, `phaseSeq`/`checkpointToken`/`committed` 의 조합으로 재개 지점을 복원합니다.

---

## (d) 정합성 규칙 (멱등 재실행)

핵심 규칙: **"state 가 진실이다. 미커밋이면 재실행한다."**

`needsRerun(state)` 는 다음을 만족할 때 `true` 를 반환합니다.

```
phase 가 done 으로 간주됨  AND  committed === false
```

여기서 "phase done" 은 `status === 'done'` 이거나, `planSteps.length > 0` 이고 `currentStepIdx >= planSteps.length`(모든 단계 소진)인 경우입니다.

### 왜 필요한가 — rename↔commit 사이 크래시

실행 흐름은 대략 다음과 같습니다.

```
페이즈 작업 수행
  → writeState (rename: state 파일 갱신, committed=false)   ← (1)
  → git commit                                              ← (2)
  → markCommitted + writeState (committed=true)             ← (3)
```

(1)과 (3) 사이, 특히 **rename 직후 ~ commit 직후 사이**에 크래시가 나면 상태 파일에는 "이 페이즈를 끝냈다(`status=done` 또는 단계 소진)"가 기록되어 있지만 `committed=false` 로 남습니다. 이때 두 가지 가능성이 있습니다.

- commit 이 아직 안 됨 → 재실행해야 함.
- commit 은 됐지만 (3)의 `committed=true` 기록 전에 죽음 → 다시 실행해도 결과가 동일(멱등)하므로 안전.

어느 쪽이든 **재실행이 안전**합니다. 따라서 정책을 단순화하여 "미커밋이면 무조건 멱등 재실행"으로 둡니다. 재실행되는 작업은 멱등이어야 합니다(같은 입력→같은 산출).

> 주의: 이 **크래시 재개(멱등 재실행)** 는 `reworkCount` 를 증가시키지 **않습니다**. `reworkCount` 는 `debate` 가 품질 미달로 `rework` 판정을 낸 경우(=의도된 재작업)에만 `loop.mjs` 가 증가시킵니다. 둘은 별개입니다.

`committed=true` 인데 phase done 이면 `needsRerun` 은 `false` 입니다(정상 완료, 재개 불필요).

---

## (e) 로그 디렉터리 스키마

하니스는 실행 중 산출물을 다음 디렉터리에 누적합니다. 각 디렉터리는 `.gitkeep` 으로 빈 상태에서도 추적됩니다.

### `harness/decisions/` — 의사결정 로그

쟁점별 토론·합의 기록입니다. 파일명 예: `<phaseSeq>-<주제-slug>.md`.

| 키            | 설명                                                  |
| ------------- | ----------------------------------------------------- |
| `안건`        | 결정해야 할 쟁점/질문                                 |
| `제기자`      | 안건을 제기한 에이전트(예: pm, architect)             |
| `주장:이유[]` | 각 입장의 `주장` 과 이를 뒷받침하는 `이유` 목록(배열) |
| `관점·반박`   | 다른 관점에서의 반박/리스크                           |
| `타협`        | 절충안                                                |
| `결론+근거`   | 최종 결론과 그 근거                                   |
| `영향`        | 코드/아키텍처/일정에 미치는 영향                      |
| `연결단계`    | 이 결정이 연결되는 `planSteps` 단계/`phaseSeq`        |

JSON 형태 예:

```json
{
	"phaseSeq": 2,
	"안건": "상태 파일을 원자적으로 쓸 것인가",
	"제기자": "architect",
	"주장이유": [
		{ "주장": "temp→rename 을 쓴다", "이유": ["반쯤 쓰인 파일 노출 방지", "동일 볼륨 atomic 보장"] }
	],
	"관점반박": ["Windows rename 동작 차이 우려 → Node fs.renameSync 가 교체 보장"],
	"타협": "동일 볼륨 한정으로 사용",
	"결론": "temp→rename 채택",
	"근거": ["크래시 윈도우 제거"],
	"영향": ["writeState 구현"],
	"연결단계": ["US-005"]
}
```

### `harness/errors/` — 오류 로그

실패/수정 기록입니다. 파일명 예: `<phaseSeq>-<오류-slug>.md`.

| 키             | 설명                     |
| -------------- | ------------------------ |
| `위치`         | 파일:라인 또는 모듈 위치 |
| `오류메시지`   | 원문 에러 메시지         |
| `원인`         | 근본 원인 분석           |
| `수정diff요약` | 적용한 수정의 diff 요약  |

JSON 형태 예:

```json
{
	"phaseSeq": 3,
	"위치": "scripts/lib/state.mjs:90",
	"오류메시지": "ENOENT: no such file or directory, rename ...",
	"원인": "부모 디렉터리 미생성 상태에서 rename 시도",
	"수정diff요약": "writeState 시작부에 mkdirSync(dir, {recursive:true}) 추가"
}
```

### `harness/evaluations/` — 평가 로그

차원별 채점 기록입니다. 파일명 예: `<phaseSeq>-eval.md`.

| 키           | 설명                                                          |
| ------------ | ------------------------------------------------------------- |
| `차원별점수` | 평가 차원→점수 매핑(예: `{ correctness: 8, design: 7, ... }`) |
| `불만`       | 개선이 필요한 지적사항 목록                                   |

JSON 형태 예:

```json
{
	"phaseSeq": 4,
	"차원별점수": { "정확성": 8, "설계": 7, "테스트": 9, "문서": 8 },
	"불만": ["needsRerun 의 경계 조건에 대한 테스트 추가 필요"]
}
```

### `harness/cycles/` — 사이클 로그

페이즈별 진행을 **append** 로 누적합니다. 파일명 예: `cycle-<phaseSeq>.md` 또는 단일 `cycles.md` 에 추가.

| 키                | 설명                                     |
| ----------------- | ---------------------------------------- |
| `phaseSeq`        | 페이즈 시퀀스                            |
| `phase`           | 페이즈 이름                              |
| `진행`            | 해당 페이즈에서 수행한 작업 요약(append) |
| `checkpointToken` | 당시 체크포인트 토큰                     |
| `committed`       | 커밋 여부                                |

JSON 형태 예:

```json
{
	"phaseSeq": 1,
	"phase": "design",
	"진행": "상태 스키마 확정 및 atomic write 설계",
	"checkpointToken": "1-design-0",
	"committed": true
}
```
