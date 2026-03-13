---
name: knowledge-base
description: knowledge base 읽기, 인덱스 생성, git sync. /workspace/knowledge_base에 파일이 마운트된 경우 사용.
---

# Knowledge Base

컨테이너 에이전트가 knowledge base를 읽고 쓸 수 있다.

## 경로

| 경로 | 설명 |
|------|------|
| `/workspace/knowledge_base/` | knowledge base 루트 (rw) |
| `/scripts/generate_indexes.ts` | INDEX.md / MOC 자동 생성 |
| `/scripts/sync_knowledge.sh` | git add → commit → pull-rebase → push |

## 사용법

### 파일 읽기 / 쓰기

```bash
ls /workspace/knowledge_base/
cat /workspace/knowledge_base/some-note.md
```

일반 파일처럼 Read / Write / Edit 도구를 사용한다.

### 인덱스 재생성

노트를 추가하거나 수정한 뒤 INDEX.md와 MOC를 최신화할 때:

```bash
npx ts-node /scripts/generate_indexes.ts
```

### git sync (원격 저장소에 push)

```bash
bash /scripts/sync_knowledge.sh "커밋 메시지"
```

내부 동작: `git add -A` → `git commit` → `git pull --rebase` → `git push`

SSH 키는 `/root/.ssh`에 마운트되어 있으므로 별도 설정 없이 push 가능.

## 언제 사용하나

- 태스크 결과를 knowledge base에 기록할 때
- 기존 노트를 검색하거나 참고할 때
- 인덱스가 오래된 경우 재생성할 때

> **Note**: 모든 agent 태스크가 끝나면 자동으로 sync가 실행된다. 수동으로 sync를 실행할 필요는 없지만, 중간 체크포인트가 필요하면 직접 호출해도 된다.
