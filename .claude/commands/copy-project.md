# /copy-project — 이 하네스를 새 위치로 복사해 새 프로젝트 시작

이 저장소를 다른 경로로 복사하고, 복사본을 곧바로 새 프로젝트로 초기화(clear)합니다.
"복사 → 초기화"를 한 번에 끝내는 부트스트랩 커맨드입니다.
래핑 대상 스크립트는 `scripts/copy-project.mjs` 입니다.

> 복사는 **새 위치에 생성**하는 비파괴 작업이라 **미리보기·승인 단계가 없습니다.**
> 경로·이름만 받으면 바로 진행합니다. (안전장치: 대상이 이미 있거나 소스 내부 경로면 거부)

## 동작 순서 (오케스트레이터가 따름)

### 1) 경로·이름 묻기

사용자에게 두 가지를 묻습니다(`AskUserQuestion` 또는 대화):

- **대상 경로(dest)**: 새 프로젝트 폴더를 만들 **부모 디렉터리**. (예: `C:\Users\me\Desktop\project`)
- **프로젝트 이름(name)**: 새 프로젝트 이름. 폴더명·`package.json` name·문서 정체성에 쓰입니다.

> 최종 생성 위치는 `<dest>/<name>` 입니다.

### 2) 바로 복사 + 빈 껍데기화 (미리보기·재승인 없음)

```bash
node scripts/copy-project.mjs --dest=<dest> --name=<name>
```

이 한 번으로:

- 저장소를 `<dest>/<name>` 으로 복사합니다. **제외**: `node_modules` · `.git` · `dist` · `.yarn`(cache·unplugged·install-state) · **`.env`(토큰)** · `*.tsbuildinfo` · `.omc`.
- 복사본 안에서 `reset-project.mjs --apply --no-notion` 을 실행해 **빈 껍데기로 정리**합니다: 런타임 산출물·이전 평가(가짜 통과 방지)·정체성·`.env` 토큰·Notion outbox 를 비웁니다.
- **Notion 대시보드는 건드리지 않습니다.** 현재 프로젝트(harness-setup)에 종속된 테스트 데이터가 따라오지 않게 비운 상태로만 가져오고, **Notion 초기화·접속 확인은 새 프로젝트의 `/start-project` 에서 새 URL 로 수행**합니다.
- 복사만 하고 정리를 생략하려면 `--no-clear` 를 덧붙입니다.

> 거부되는 경우: 대상이 이미 존재하고 비어있지 않음 / 대상이 이 저장소 내부 경로. 이때는 다른 경로·이름을 다시 묻습니다.

### 3) 다음 단계 안내

- `cd <dest>/<name>`
- `yarn install`
- `.env` 에 **새 토큰** 입력(또는 MCP 미사용이면 비워둠) — 원본의 토큰은 복사되지 않았습니다.
- `/start-project` → `/run-cycle` (start-project 가 연동 확인·Q&A·계획·시드를 모두 수행)
- (선택) 새 git 이력: `git init -b main`. 복사본엔 `.git` 이 없어 깨끗한 상태에서 시작합니다.

## 인자

| 설정          | 인자                          | 기본값                         |
| ------------- | ----------------------------- | ------------------------------ |
| 대상 부모경로 | `--dest=<v>` / `--dest <v>`   | (필수)                         |
| 프로젝트명    | `--name=<v>` / `--name <v>`   | (필수)                         |
| 정리 생략     | `--no-clear`                  | 미지정 시 복사 후 빈 껍데기 정리 |

## 비고

- 자가검증: `node scripts/copy-project.selftest.mjs` (CI self-test 에 포함).
- 단축 실행: `yarn copy --dest=<v> --name=<v>`.
- 복사 없이 제자리에서 다시 시작해야 하면 `yarn reset --apply` 로 직접 정리할 수 있습니다(특수 상황).
- 전체 흐름: **`/copy-project`(복사+빈 껍데기)** → `cd` → `yarn install` → `/start-project`(연동확인·Notion 초기화·Q&A·계획) → `/run-cycle`.
