# PROBLEM.md

> 목적: **내일 바로 이어서 작업**할 수 있도록, 현재 리포지토리 상태에서 확인된 문제(PLAN 구현 갭/테스트 실패/릴리즈 차단 요소)를 **증거 기반**으로 정리한다.
>
> 작성일: 2026-02-20

---

## 0) 현재 스냅샷

### 레포 목표(PLAN.md 기준)
- code-ledger는 **코드 인덱싱/검색 인프라 패키지**
- Watcher + Parser + Extractor + Store + Indexer + Search + Facade(=CodeLedger)로 구성
- 소비자는 `CodeLedger` 단일 엔트리포인트로 사용 (PLAN §16)

### 현재 상태(증거)
- Search 모듈(`symbolSearch`, `relationSearch`, `DependencyGraph`) 구현 파일/디렉토리 없음
  - 근거: `src/search/` 디렉토리 부재
- `CodeLedger` facade 클래스 구현 없음
  - 근거: 소스에서 `class CodeLedger` 정의 검색 결과 없음
- 테스트 상태: 475 pass / 4 fail
  - 근거: `bun test` 실행 결과 (foundation integration 4건 실패)

---

## 1) CRITICAL (릴리즈/사용 불가 수준)

### C-1) Phase 4 전체 미구현: Search 모듈(PLAN §14)

PLAN이 요구하는 기능:
- `symbolSearch()`
- `relationSearch()`
- `DependencyGraph` (build + 의존 그래프 질의)

현상:
- `src/search/` 자체가 없음

영향:
- 소비자가 DB 기반 검색/의존성 그래프 기능을 사용할 수 없음

### C-2) Phase 4 전체 미구현: CodeLedger facade(PLAN §16)

PLAN이 요구하는 공개 API:
- `CodeLedger.open()` / `close()`
- `search.symbols()` / `search.relations()` / `search.dependencyGraph()`
- `parseSource()` / `extractSymbols()` / `extractRelations()`
- `onIndexed()`

현상:
- `CodeLedger` 클래스 구현이 없음

영향:
- 패키지의 **단일 진입점**이 없어서 소비자 사용 패턴(PLAN §18)이 성립하지 않음

### C-3) 공개 export 불완전

현상:
- `src/index.ts`는 errors/common/watcher/parser/extractor만 export
- store/indexer/search/facade 미노출

영향:
- 내부 구현이 있어도 외부 소비자가 모듈을 import 할 수 없음

### C-4) 통합 테스트 4건 실패

실패 파일:
- `test/foundation.test.ts`

실패 케이스 (요약):
1) 프로젝트 경계 발견 결과 불일치
2) tsconfig paths 로드 결과 undefined
3) watcher event 기반 package.json 변경 시 프로젝트 resolve 불일치
4) tsconfig alias prefix 관련 resolve 결과 불일치

영향:
- 현재 main 브랜치 수준에서 최소 통합 안정성 미달

---

## 2) IMPORTANT (PLAN 위반/기능 결함)

### I-1) tsconfig paths 캐시 갱신 누락

증거:
- `loadTsconfigPaths()`는 모듈 레벨 cache를 사용
- watcher에서 `tsconfig.json` 변경 감지 시 `loadTsconfigPaths()`만 호출하고 cache 무효화(`clearTsconfigPathsCache`)가 없음

영향:
- tsconfig 변경이 인덱싱/관계 추출에 반영되지 않을 수 있음

### I-2) fullIndex()가 모노레포 전체 삭제를 보장하지 않음

PLAN 요구:
- `DELETE FROM files`로 workspace 전체 초기화(연쇄 삭제)

현상:
- root project 일부만 지우는 형태로 보이며(프로젝트별 레코드가 남을 수 있음)

영향:
- 모노레포에서 stale 데이터 잔존 가능

### I-3) IndexResult.totalSymbols / totalRelations 항상 0

현상:
- IndexCoordinator 반환값에서 `totalSymbols: 0`, `totalRelations: 0` 고정

영향:
- 소비자가 인덱싱 결과를 정량적으로 판단 불가

### I-4) onIndexed 콜백 결과 타입 불일치

PLAN 요구:
- `IndexedResult`에 `changedFiles[]`, `deletedFiles[]`가 필요

현상:
- `IndexResult`(숫자 카운트)만 전달

영향:
- 소비자 패턴(PLAN §18)의 `refreshCardCodeLinks(changedFiles)` 같은 업데이트가 불가

### I-5) DbConnection.transaction 시그니처/의도 불일치

PLAN 요구:
- `transaction<T>(fn: (tx) => T): T`

현상:
- `fn: () => T` (tx 파라미터 없음)

영향:
- 설계 의도(명시적 tx 전달)와 불일치

### I-6) watcher ownership heartbeat / reader healthcheck 미구현

PLAN 요구:
- owner는 30초 heartbeat
- reader는 60초 healthcheck 후 owner death 시 takeover

현상:
- `updateHeartbeat()`는 존재하나 주기 호출 로직 없음
- reader healthcheck 로직 없음

영향:
- 멀티 프로세스 환경에서 오너 교체/안정성이 미달

### I-7) graceful shutdown 미구현

PLAN 요구:
- SIGTERM/SIGINT/beforeExit → close()

현상:
- 시그널 핸들러 및 shutdown 프로토콜 일부 누락

영향:
- 종료 타이밍에 DB/워처 리소스가 안전하게 정리되지 않을 수 있음

### I-8) RelationRepository.getOutgoing 필터 정책 불일치

PLAN 요구:
- `srcSymbolName`로 필터할 때도 `NULL`(module-level) 포함 가능

현상:
- `srcSymbolName` 지정 시 정확히 그 값만 반환

영향:
- symbol-level 관계 조회가 기대보다 누락될 수 있음

---

## 3) 내일 작업 체크리스트(우선순위)

### P0 — 사용 가능 상태 만들기(Phase 4)
1) `src/search/` 추가
   - `symbol-search.ts`: FTS5 기반 조회 + 필터( kind / filePath / isExported / project / limit )
   - `relation-search.ts`: relations 테이블 필터 조회
   - `dependency-graph.ts`: imports relation 기반 그래프 구축 + BFS/DFS
2) `src/code-ledger.ts`(또는 동등) 추가
   - `CodeLedger.open()`에서 DbConnection + repositories + watcher ownership + IndexCoordinator wiring
   - `search` API 구현
   - `onIndexed()` 노출
3) `src/index.ts`에서 store/indexer/search/facade export

### P1 — 안정성/정합성
4) `tsconfig.json` 변경 이벤트에서 tsconfig cache 무효화
5) `fullIndex()`에서 workspace 전체를 확실히 초기화(모노레포 포함)
6) `IndexResult`에 totalSymbols/totalRelations 계산 반영
7) `onIndexed` 결과를 PLAN의 `IndexedResult`로 확장(파일 목록 포함)
8) ownership heartbeat + reader healthcheck 타이머 구현
9) SIGTERM/SIGINT/beforeExit 핸들러로 close 호출
10) shutdown 프로토콜을 PLAN에 맞게 완성

### P2 — 테스트
11) `test/foundation.test.ts` 4개 실패 원인 규명 및 수정
    - 원인 미확정: cache/격리/비동기 타이밍 등
    - 목표: bun test 전체 GREEN

---

## 4) 참고: 이번 staged 변경 목록(커밋 대상)

현재 git stage에 올라가 있는 변경(요약):
- store(drizzle schema/connection/migrations/repositories)
- indexer(file-indexer, symbol-indexer, relation-indexer, index-coordinator)
- tsconfig-resolver(jsconfig 제거)
- watcher(project-watcher config 필터)
- 테스트 파일/추가(store.test 등)

※ 이 문서는 위 변경을 **고정(snapshot)** 해 두기 위한 문서이며, 내일은 여기 적힌 체크리스트 기준으로 Phase 4 구현 및 결함 수정을 진행한다.
