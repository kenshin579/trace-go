# Graph Super-Nodes — Design (B6 Stage 2)

## 1. 개요 & 범위

타임라인에서 goroutine 그룹을 접으면(Stage 1) **그래프에서도 그 그룹의 멤버들이 슈퍼노드 1개로 병합**되도록 한다. 멤버로 드나들던 인과 엣지는 슈퍼노드로 재배선되고, comet·causal focus도 슈퍼노드 기준으로 동작한다. 타임라인 접힘과 그래프 슈퍼노드가 **동일 `collapsedGroups` 단일 소스**로 자동 동기화된다.

Stage 1(타임라인 그룹핑)이 접힘 상태를 store에 둔 토대 위에 올린다. 이 작업은 그래프의 force 시뮬레이션·엣지·comet·hull과 얽혀 위험이 크므로, 핵심 불변식(2C: 시간 이동 시 그래프 재배치 없음) 보존에 집중한다.

### Carried-over 결정 (브레인스토밍에서 확정)
- **접힘 = 슈퍼노드 병합** (멤버 ghost가 아니라 진짜 노드 1개로 합침).
- **슈퍼노드 색 = 중립 그룹 색 고정** (집계 상태색 아님; playhead 무관). "여기 N개가 접혀 있다"를 표시하고, 정확한 상태는 펼쳐서 본다.
- **엣지 재배선**: 외부↔멤버 → 슈퍼노드↔외부, 같은 외부로 가는 멤버 엣지들은 **dedup**(category는 첫 엣지). 그룹 **내부 엣지(양끝이 같은 접힌 그룹)는 버림**(self-loop 노이즈).
- **슈퍼노드는 task hull에서 제외** (cluster 없음). hull은 개별 goroutine의 task 묶음만 표현.
- **슈퍼노드 클릭 = 그룹 펼치기** (`toggleGroup(key)`, 타임라인 헤더와 대칭). 그룹 단위 선택/포커스는 범위 밖.
- **causal focus**: 슈퍼노드는 멤버 중 하나라도 선택 사슬(chain)에 속하면 밝게, 아니면 ghost.

### 범위 밖 (YAGNI / 후속)
- 슈퍼노드 집계 상태색, 멤버 수 반영 크기(기본 동일 반지름 + 흰 링).
- 그룹 단위 선택/causal focus(클릭은 펼침만).
- self-loop(내부 엣지) 시각 표시.
- 슈퍼노드의 task hull 참여.

---

## 2. 순수 병합 로직 (`frontend/src/lib/graphCollapse.ts`)

```ts
import type { Goroutine, CausalEdge } from './types'
import type { GraphNode, GraphLink } from './graphModel'
import type { GoroutineGroup } from './grouping'

export interface CollapsedGraph {
  nodes: GraphNode[]          // 개별 노드 + 슈퍼노드(group 필드 보유)
  links: GraphLink[]          // 재배선·dedup된 엣지
  remap: Map<number, number>  // 원본 goroutine id → 표시 노드 id (comet/포커스용)
}

// collapseGraph merges each collapsed group's members into one super-node and
// reroutes edges. Node-set changes, so it is called only on rebuild (2C: never
// on playhead). With an empty collapsedKeys it is equivalent to buildGraphModel.
export function collapseGraph(
  goroutines: Goroutine[],
  edges: CausalEdge[],
  groups: GoroutineGroup[],
  collapsedKeys: Set<string>,
): CollapsedGraph
```

- 접힌 그룹(`members.length >= 2` && `collapsedKeys.has(key)`)마다 **슈퍼노드 1개**: 합성 음수 id(예 `-(collapsedIndex + 1)` — 양수 goroutine id와 충돌 없음). `node.group = { key, name, count, memberIds }`.
- `remap`: 접힌 그룹의 각 멤버 id → 슈퍼노드 id. 그 외 id → 자기 자신(remap에 없으면 항등으로 취급).
- **개별 노드**: 비접힘 goroutine은 기존 `buildGraphModel`처럼 `{ id, label }`.
- **링크**: 각 엣지의 from/to를 `remap`으로 치환 → **self-loop(from===to) 버림** → **(from,to) dedup**(첫 엣지 category 유지).
- `GraphNode`에 optional 필드 추가(타입 비파괴):
  ```ts
  group?: { key: string; name: string; count: number; memberIds: number[] }
  ```
- 접힘 빈 Set → 노드/링크가 기존 `buildGraphModel`과 동일, remap은 비어 있음(전부 항등).

---

## 3. rebuild 통합 (`GraphCanvas.svelte`)

- store 구독에 `collapsedGroups, toggleGroup` 추가.
- rebuild 트리거에 `$collapsedGroups` 추가 (접힘 토글 = 정당한 노드셋 변경, `$showSystem`과 동급):
  ```svelte
  $: rebuild(visible, $summary?.edges ?? [], $collapsedGroups)
  ```
  (`visible = visibleGoroutines($summary, $showSystem)`)
- rebuild 내부: `buildGraphModel` 대신 `collapseGraph(goroutines, edges, groupGoroutines(goroutines), collapsedKeys)` → `nodes`/`links`/`remap`. `remap`은 컴포넌트 상태로 보관(§4 comet용).
- **클러스터**: `clusterByTask`는 슈퍼노드가 아닌 개별 노드에만 적용; 슈퍼노드는 `cluster = undefined` → hull 제외 + 약한 center force(0.03).
- **불변식(2C)**: 병합·재배선·seed·force·remap은 전부 rebuild 안에서만. `$playhead`/`$selectedId` 변경 시 재계산 없이 `draw()`만 → 시간 이동 시 재배치 없음. 접힘 빈 Set → 그래프 이전과 픽셀 동일.

---

## 4. 렌더링 + 인터랙션 (`GraphCanvas.svelte` draw/click/comet)

**노드 draw** (`n.group` 분기):
- 슈퍼노드: 중립 그룹 색(`GROUP_NODE_COLOR`, 예 `#7a8290`) 고정 + 흰 외곽 링 + 옆/아래 라벨 `name ×count`. playhead 무관.
- 개별 노드: 기존 그대로(시점 상태색 / not-alive dim / 선택 흰 링).
- **causal focus**: 슈퍼노드는 `n.group.memberIds.some(id => chain.has(id))` → 밝게, 아니면 ghost(0.15). 개별 노드는 기존 `chain.has(n.id)`.

**hull**: `n.cluster != null`인 개별 노드만 참여(슈퍼노드는 cluster 없음 → 자동 제외).

**엣지**: `links`가 이미 슈퍼노드 id로 재배선됨 → 기존 엣지 그리기 로직 그대로.

**comet 리매핑** (`onPlayheadChange`):
```ts
const a = nodeById.get(remap.get(e.from) ?? e.from)
const b = nodeById.get(remap.get(e.to) ?? e.to)
if (!a || !b || a === b) continue  // 내부 엣지(같은 슈퍼노드로 귀결)는 comet 생략
```

**클릭** (`onClick`): `nodeAtPoint`로 잡은 노드가 슈퍼노드면 `toggleGroup(n.group.key)`(펼침); 아니면 기존 `toggleSelected(n.id)`.

**hover 툴팁**: 슈퍼노드 위 → `name ×count`; 개별 노드 → 기존 `nodeTooltip`.

---

## 5. 파일 경계 & 테스트

### 파일
- `frontend/src/lib/graphCollapse.ts` (+ `.test.ts`) — **신규**: `collapseGraph`, `CollapsedGraph`.
- `frontend/src/lib/graphModel.ts` — **수정**: `GraphNode.group?` optional 필드.
- `frontend/src/components/GraphCanvas.svelte` — **수정**: rebuild에 collapsedGroups·collapseGraph·remap; 슈퍼노드 렌더/클릭/comet/focus.

### 테스트 (불변식 기반)
- `graphCollapse.test.ts`:
  - 접힘 빈 Set → 노드/링크가 `buildGraphModel`과 동일, remap 비어 있음(하위 호환).
  - 그룹 1개 접힘 → 노드 수 = 전체 − N + 1, 슈퍼노드 `group.memberIds` 정확, remap이 멤버→슈퍼노드.
  - 외부 엣지: 멤버→외부가 슈퍼노드→외부로, 같은 외부로 가던 멤버 2개 엣지가 1개로 dedup.
  - 내부 엣지: 같은 접힌 그룹 멤버끼리 엣지는 결과 링크에 없음.
  - 슈퍼노드 `cluster == null`.
- 컴포넌트: 슈퍼노드 색/라벨, comet 리매핑, 클릭 펼침, focus 멤버 판정 → 시각 확인(Canvas 픽셀 수동, 프로젝트 관례).

### 불변식 / 호환
- **2C 유지**: 병합/force/seed/remap은 rebuild에서만; 시간/선택 변경 시 재배치 없음.
- 접힘 빈 Set → `collapseGraph` ≡ `buildGraphModel` → 그래프 이전과 픽셀 동일.
- 타임라인 그룹핑(Stage 1)과 동일 `collapsedGroups` 단일 소스 → 타임라인 접기 ↔ 그래프 슈퍼노드 자동 동기화.

---

## 6. 리스크 & 완화

- **2C(시간 이동 시 재배치 없음) 침해 우려** → 병합/force는 rebuild 한정, 접힘 토글만 rebuild 유발(showSystem과 동일). (완화)
- **합성 슈퍼노드 id 충돌** → 음수 id(`-(idx+1)`); 실제 goroutine id는 양수라 충돌 없음. (완화)
- **comet이 사라진 멤버를 참조** → `remap`으로 표시 노드 치환, 내부 엣지는 `a === b`로 생략. (완화)
- **causal focus가 슈퍼노드를 항상 ghost** → 멤버-중-하나 판정(`memberIds.some(chain.has)`)으로 접힌 그룹과의 인과 관계 유지. (완화)
- **복잡도/가치 불확실(B5 교훈)** → 접힘 빈 Set는 완전 하위 호환이고 opt-in(접어야 슈퍼노드 등장)이라 무해; 써보고 가치 없으면 revert 용이. (수용)
