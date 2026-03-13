---
name: knowledge-base-volume
description: 컨테이너 에이전트가 knowledge base를 읽고 쓸 수 있도록 volume mount와 scripts를 추가한다. GDrive 마운트 경로를 :rw로 주입하고, SSH 키로 git push를 가능하게 한다.
---

# Knowledge Base Volume Skill

이 스킬은 NanoClaw 컨테이너 에이전트에 knowledge base 읽기/쓰기 기능을 추가한다.

머지 내용:
- `src/container-runner.ts` — `/workspace/knowledge_base` `:rw`, `/root/.ssh` `:ro`, `/scripts` `:ro` 마운트 추가 + 환경변수 5종
- `container/scripts/generate_indexes.ts` — INDEX.md / MOC 자동 생성 스크립트
- `container/scripts/sync_knowledge.sh` — git add/commit/pull-rebase/push 스크립트
- `container/skills/knowledge-base/SKILL.md` — agent가 KB 스크립트를 능동적으로 사용할 수 있도록 Claude Code skill로 등록
- `container/agent-runner/src/index.ts` — post-hook: 모든 agent 작업 완료 후 자동 KB sync

## Phase 1: Pre-flight

### 이미 적용됐는지 확인

```bash
grep -n "knowledge_base" src/container-runner.ts
```

`/workspace/knowledge_base` 마운트가 있으면 이미 적용된 것이므로 Phase 3 (Setup)으로 건너뛴다.

### Knowledge base 경로 확인

```bash
ls $KNOWLEDGE_BASE_HOST_PATH
```

Phase 1 인프라(git repo + SSH key)가 준비된 상태여야 한다.

## Phase 2: Apply Code Changes

### Merge the skill branch

```bash
git fetch origin skill/knowledge-base-volume
git merge origin/skill/knowledge-base-volume
```

이 머지로 추가/변경되는 파일:
- `src/container-runner.ts` — knowledge_base :rw, /root/.ssh :ro, /scripts :ro 마운트 + 환경변수
- `container/scripts/generate_indexes.ts` — ts-node 기반 인덱스 생성기
- `container/scripts/sync_knowledge.sh` — git sync 스크립트
- `container/skills/knowledge-base/SKILL.md` — 에이전트용 KB 사용 가이드 (Claude Code skill)
- `container/agent-runner/src/index.ts` — post-hook: while 루프 종료 후 자동 KB sync 실행

충돌 발생 시 해당 파일을 직접 읽고 양쪽 의도를 파악하여 해결한다.
`container/agent-runner/src/index.ts` 충돌 시: post-hook 블록이 while 루프 종료 이후, `process.exit(1)` catch 블록 이후에 위치하도록 한다.

### Validate

```bash
npm run build
npm test
```

빌드와 전체 테스트가 통과해야 한다.

## Phase 3: Setup

### 환경변수 설정

`.env`에 추가:

```bash
# 필수: host 머신의 knowledge base 경로
KNOWLEDGE_BASE_HOST_PATH=/home/spow12/data/knowledge_base

# 선택: SSH 키 경로 (기본값: ~/.ssh)
# SSH_HOST_PATH=/home/spow12/.ssh

# 선택: git identity (기본값: DesktopMate / agent@local)
# GIT_AUTHOR_NAME=DesktopMate
# GIT_AUTHOR_EMAIL=agent@local
# GIT_COMMITTER_NAME=DesktopMate
# GIT_COMMITTER_EMAIL=agent@local
```

컨테이너 환경에 동기화:

```bash
mkdir -p data/env && cp .env data/env/env
```

### 빌드 및 재시작

```bash
npm run build
# Linux:
systemctl --user restart nanoclaw
# macOS:
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Phase 4: Verify

### 마운트 확인

컨테이너 실행 로그에서 마운트 목록 확인:

```bash
tail -f logs/nanoclaw.log | grep "knowledge_base\|/root/.ssh\|/scripts"
```

Expected: `/workspace/knowledge_base`, `/root/.ssh`, `/scripts` 마운트 항목 출력

### 스크립트 동작 확인 (컨테이너 내부)

컨테이너 에이전트에게 아래 명령 실행 요청:

```bash
ls /scripts/
# Expected: generate_indexes.ts  sync_knowledge.sh

ls $KNOWLEDGE_BASE_PATH
# Expected: knowledge base 파일 목록
```

## Removal

1. `src/container-runner.ts`에서 knowledge base 관련 마운트/환경변수 블록 제거:
   - `buildVolumeMounts()` 내 `KNOWLEDGE_BASE_HOST_PATH`, `SSH_HOST_PATH`, `scriptsPath` 블록
   - `buildContainerArgs()` 내 `kbPath` 블록 (KNOWLEDGE_BASE_PATH, GIT_* env vars)

2. `container/agent-runner/src/index.ts`에서 post-hook 블록 제거:
   - `// Post-hook: sync knowledge base ...` 주석부터 해당 `if` 블록 전체

3. `container/scripts/` 및 `container/skills/knowledge-base/` 삭제:
   ```bash
   rm -rf container/scripts/ container/skills/knowledge-base/
   ```

4. `.env`에서 `KNOWLEDGE_BASE_HOST_PATH` 제거

5. 기존 그룹의 agent-runner 복사본 재생성 (post-hook 제거 반영):
   ```bash
   rm -rf data/sessions/*/agent-runner-src/
   ```

6. 빌드 및 재시작:
   ```bash
   npm run build
   systemctl --user restart nanoclaw   # Linux
   # macOS: launchctl kickstart -k gui/$(id -u)/com.nanoclaw
   ```
