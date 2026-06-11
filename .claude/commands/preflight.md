# /preflight — 프로젝트 시작 전 게이트

harness-setup 의 자율 개발 루프를 시작하기 **전에** git/MCP 연동을 점검·결정하는 게이트입니다.
(인터뷰/계획보다 먼저 실행)

## 동작

1. `.git` 존재 여부를 출력합니다.
2. `useGit=true` 인데 저장소가 없으면 **`git init -b main`** 을 수행합니다 (이 명령이 저장소 생성을 소유).
3. `harness/config.json` 에 결정을 기록합니다:
   ```json
   {
   	"useGit": true,
   	"useMcp": false,
   	"mcpServers": [],
   	"skipGitFlow": false,
   	"preflight": { "ranAt": "...", "gitInitDone": true, "gitPresentBefore": false }
   }
   ```
4. `useGit=false` 면 `skipGitFlow=true` 가 기록되어 이후 git-flow(브랜치/병합)가 우회됩니다.

## 실행

```bash
# 기본값 (useGit=true, useMcp=false)
node scripts/preflight.mjs

# 비대화형 주입
node scripts/preflight.mjs --use-git=true --use-mcp=true
node scripts/preflight.mjs --no-git            # git 우회
HARNESS_USE_GIT=false HARNESS_USE_MCP=true node scripts/preflight.mjs
```

## 인자 / 환경변수

| 설정     | 인자                            | 환경변수          | 기본값  |
| -------- | ------------------------------- | ----------------- | ------- |
| git 사용 | `--use-git[=bool]` / `--no-git` | `HARNESS_USE_GIT` | `true`  |
| MCP 연동 | `--use-mcp[=bool]` / `--no-mcp` | `HARNESS_USE_MCP` | `false` |

대화형 환경에서는 오케스트레이터가 이 값을 `AskUserQuestion` 으로 물어 인자로 전달합니다.
비대화형(CI/자율 루프)에서는 인자·환경변수로 주입합니다.

## 다음 단계

preflight 통과 후 → `/start-project` (Q&A → 계획 → 조건부 main 시드) → `/run-cycle` 루프.
