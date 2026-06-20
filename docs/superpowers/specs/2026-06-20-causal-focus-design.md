# Selection Causal Focus — Design (analysis ①)

## 1. 개요 & 범위

그래프에서 goroutine 노드를 선택하면, 그것의 **1-hop 인과 사슬**(직접 깨운 것 + 직접 깨워진 것)만 강조하고 나머지는 흐리게 한다. "이 goroutine은 왜 깨어났고(누가 깨웠나) / 무엇을 깨웠나"를 한 클릭에 답하는 **선택 기반 포커스**. 화면을 더 채우는 게 아니라 *주목을 좁히는* 방향(B5 교훈: 보조 신호 남발 금지).

### Carried-over 결정 (브레인스토밍에서 확정)
- **사슬 범위 = 1-hop 양방향**: 선택 노드를 직접 깨운 것(들어오는 엣지) + 선택이 직접 깨운 것(나가는 엣지). 전이적 전체 사슬은 dense trace에서 신호가 떨어져 배제.
- **적용 범위 = 그래프 + 타임라인 둘 다**: 비사슬 노드/엣지/레인을 모두 흐리게.
- **시간 무관(정적)**: 사슬 멤버십은 전체 엣지 집합에서 한 번 계산, playhead 이동과 무관(2C "시간 이동은 재배치 말고 재색칠만"과 일관). 사슬 노드는 시점 상태색만 갱신.

### 범위 밖 (YAGNI / 후속)
- 전이적 "전체 사슬 펼치기" 토글, 시간 인지(자라나는) 사슬.
- 타임라인 레인 클릭으로 선택(선택은 그래프 노드 클릭에서만 발생; 타임라인은 반영만).
- 들어오는/나가는 방향을 색으로 구분(둘 다 동일 강조).
- hover 기반 포커스(클릭/선택만 트리거).

---

## 2. 순수 로직 (`frontend/src/lib/causalFocus.ts`)

선택 노드의 1-hop 사슬 집합을 구하는 순수 함수. 그래프·타임라인이 **같은 집합**을 소비(단일 소스).

```ts
import type { CausalEdge } from './types'

// causalNeighbors returns the 1-hop causal chain of a selected goroutine: itself
// plus every goroutine directly linked by a causal edge (incoming or outgoing).
// Time-independent — computed once from the full edge set.
export function causalNeighbors(edges: CausalEdge[], selectedId: number): Set<number> {
  const set = new Set<number>([selectedId])
  for (const e of edges) {
    if (e.from === selectedId) set.add(e.to)   // selected woke e.to
    if (e.to === selectedId) set.add(e.from)   // e.from woke selected
  }
  return set
}
```

- `selectedId`가 `null`이면 호출하지 않는다(기존 동작 유지).
- 인과 엣지 없는 노드 선택 → 집합 = `{selectedId}`뿐(나머지 전부 흐려짐 = 인과 관계 없음의 정확한 표현).
- 집합에 보이지 않는(필터된) goroutine id가 포함될 수 있으나, 렌더링은 보이는 노드/레인의 멤버십 여부만 사용하므로 무해.

---

## 3. 그래프 렌더링 (`GraphCanvas.svelte`)

`$selectedId`가 있을 때 `chain = causalNeighbors($summary.edges, $selectedId)`:
- **비사슬 노드/엣지**: 낮은 `globalAlpha`(예: 0.15)로 흐리게.
- **사슬 노드**: 시점 t의 상태색 유지(running/blocked 등 그대로). 선택 노드는 흰 테두리 유지.
- **사슬 엣지**(선택 노드에 직접 붙은 것, `from===sel || to===sel`): category 색 + 굵게, **시간 창과 무관하게** 강조(선택 포커스가 시간색을 덮음).
- **comet·시뮬레이션·playback 불변**: 포커스는 위에 얹는 시각 오버레이.

`$selectedId === null`이면 **현재 동작 그대로**(시간 창 기반 active 엣지 색칠). 즉 포커스는 선택했을 때만 켜지는 모드.

구현: `draw()`에서 노드/엣지 그릴 때 `chain` 멤버십으로 `globalAlpha`만 분기. 순수 계산은 lib, 컴포넌트는 얇게.

---

## 4. 타임라인 렌더링 (`TimelineCanvas.svelte`)

같은 `chain` 집합을 소비:
- **사슬 레인**(goroutine id ∈ chain): 평소대로(상태 바·region·log·거터 라벨 정상).
- **비사슬 레인**: 낮은 `globalAlpha`로 바·region·log·라벨 전체를 흐리게.
- **선택 레인**: 흰 테두리 유지.
- **TASKS 트랙·playhead·거터 배경**: 전역 요소라 dim 안 함.
- `$selectedId === null`이면 **기존 그대로**.

구현: `draw()`에서 레인을 그릴 때 `chain.has(lane.goroutineId)` 여부로 `globalAlpha` 분기. 동일한 lib `causalNeighbors` 재사용.

---

## 5. 파일 경계 & 테스트

### 파일
- `frontend/src/lib/causalFocus.ts` (+ `.test.ts`) — **신규**: `causalNeighbors`.
- `frontend/src/components/GraphCanvas.svelte` — **수정**: 선택 시 비사슬 dim + 사슬 엣지 강조.
- `frontend/src/components/TimelineCanvas.svelte` — **수정**: 선택 시 비사슬 레인 dim.

### 테스트
- **lib 단위(`causalFocus.test.ts`)**: 들어오는+나가는 → {자기,from,to}; 무관 엣지 무시; 엣지 없는 노드 → {자기}; 방향성(from===sel→to, to===sel→from) 각각.
- **컴포넌트**: alpha 분기 dim은 얇은 렌더러 변경이라 시각 확인(Canvas 픽셀은 수동 검증, 프로젝트 관례).

### 불변식 / 호환
- `$selectedId === null` → 양쪽 뷰가 **현재와 픽셀 동일**.
- 레이아웃·시뮬레이션·playback·comet **불변** — `globalAlpha`만 얹는 순수 시각 오버레이.
- **단일 소스**: 양쪽 뷰가 `causalNeighbors($summary.edges, $selectedId)` 동일 집합 사용.

---

## 6. 리스크 & 완화

- **globalAlpha 누수**(이후 그리기에 흐림 번짐) → 각 dim 블록 후 `globalAlpha = 1` 복원(기존 task track/GC 오버레이와 동일 방어 패턴). (완화)
- **연결 촘촘한 노드 선택 시 여전히 많이 켜짐** → 1-hop 한정이라 상한이 직접 이웃 수로 묶임. (완화)
- **고립 노드 선택 시 화면이 거의 다 흐려짐** → 정확한 표현(인과 관계 없음); 사용자는 다시 클릭(토글)하면 해제. (수용)
