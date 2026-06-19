# Edge Flash + Timeline Lane Labels — Design (Plan 2E)

- **날짜**: 2026-06-20
- **상태**: 설계 승인 대기
- **목표**: 하이브리드 시각화를 더 "살아있고 읽기 쉽게" 만드는 두 가지 폴리시 — 그래프 엣지 flash 애니메이션과 타임라인 레인 라벨

---

## 1. 개요 & 범위

기존 trace-go 하이브리드 뷰(타임라인 + 라이브 그래프 + 재생/필터 + 툴팁/범례) 위에 두 시각화 폴리시를 추가한다.

- **C7 — 엣지 flash 애니메이션**: 재생 또는 앞 방향 스크럽으로 플레이헤드가 한 인과 엣지의 발화 시각을 지나칠 때, **카테고리색 코멧**(꼬리 달린 빛 입자)이 엣지 선을 타고 깨운 쪽(from)→깨어나는 쪽(to)으로 흐르고, 도착 무렵 target 노드에서 **링**이 퍼진다. "A가 B를 깨운 인과"를 시간 축 위에서 눈으로 보게 한다.
- **C9 — 타임라인 레인 라벨**: 타임라인 캔버스 왼쪽 거터에 goroutine 이름을 상시 표시(현재는 hover로만 확인 가능).

### 범위 밖 (별도 계획)
- **C8 — 줌·팬**: 시간↔픽셀 스케일·스크럽·플레이헤드 좌표를 "보이는 창" 기준으로 전면 수정해야 해서 별도 spec/plan으로 분리.

### 정직성 원칙 (유지)
코멧과 카테고리색은 *추정된 동기화 종류*(channel/mutex/other)를 뜻하지, 채널을 흐르는 실제 값이 아니다. trace에는 채널 식별자도 전달 값도 없다(기존 설계 §3). 엣지 hover 툴팁의 `(inferred)` 표기와 범례의 "inferred" 단어를 유지한다.

---

## 2. C7 — 엣지 flash

### 동작
- **발화 검출**: 플레이헤드가 `t_prev → t_now`로 **앞으로**(`t_now > t_prev`) 이동할 때, `t_prev < edge.time ≤ t_now`인 엣지마다 코멧 1개를 spawn한다. 뒤로 이동 시(`t_now < t_prev`)엔 spawn 없이 `t_prev`만 갱신(재무장). 따라서 재생과 앞 방향 스크럽 모두에서 발동하고, 뒤로 스크럽 후 다시 앞으로 가면 재발동한다.
- **코멧**: 리드 점 + 페이드 트레일이 엣지 선을 타고 source→target으로 **실제 시간 약 600ms**(`FLASH_MS`) 이동한다. 이 시간은 **재생 배속과 무관**한 시각적 연출이다(벽시계 기준). 도착 무렵 target 노드에서 링이 확산 후 페이드한다. target 노드의 색은 기존 `stateAt(playhead)` 재그리기로 자연히 갱신된다(별도 처리 불필요).
- **색 (카테고리별)**: channel=`#5b8def`(파랑), mutex=`#e0a030`(앰버), other=`#a78bdb`(보라). ±윈도우 내 **활성 엣지 강조선도 같은 카테고리색**으로 그려 코멧과 일관성을 맞춘다. 그 외(비활성) 엣지는 dim(`DIM_COLOR`).
- **폭주 방지**: 빠른 앞 스크럽은 한 프레임에 다수 엣지를 넘을 수 있으므로 **동시 코멧 수 상한**(`MAX_PARTICLES`, 예: 60)을 둔다. 상한 초과 spawn은 무시한다.

### 구조
- **발화 검출은 원본 `summary.edges`에서** 한다 — dedup된 layout 링크(`graphModel`의 `links`)는 firing time을 잃었으므로(pair별 first-wins) 사용하지 않는다. 보이는 노드 집합(`visibleGoroutines($summary, $showSystem)`)에 from·to가 모두 포함된 엣지만 대상으로 한다.
- 코멧 좌표는 `nodeById: Map<number, GraphNode>`(force 시뮬레이션이 채운 `x/y`)에서 조회한다. 위치 미정(`x == null`, 첫 프레임)이면 해당 코멧은 그리지 않는다(가드).
- **별도 rAF 애니메이션 루프**: 살아있는 코멧이 하나라도 있으면 도는 두 번째 rAF로, 기존 force-sim tick·store 재생 rAF와 **분리**한다. 매 프레임 `performance.now()` 기준 각 코멷의 진행도(`(now - startWall)/FLASH_MS`)를 계산해 그리고, 만료분을 정리하며, 배열이 비면 루프를 멈춘다(이후 재그리기는 기존 `$playhead`/sim 경로에 맡김). `onDestroy`에서 rAF를 취소한다(누수 방지).
- **시뮬레이션 불변**: 이 루프는 노드 위치를 절대 건드리지 않는다. 따라서 "시간 이동 시 그래프 재배치 없음"이라는 2C의 핵심 속성이 유지된다.

### 순수 함수 (TDD 대상)
- `edgesCrossed(edges, prevT, nowT): CausalEdge[]` — `prevT < time ≤ nowT`인 엣지(앞 통과). `nowT ≤ prevT`면 빈 배열.
- `cometPoint(progress, ax, ay, bx, by): {x, y}` — 선상 선형 보간(`progress ∈ [0,1]`).
- `categoryColor(category): string` (format.ts) — channel/mutex/other → 색.
- 상수 `FLASH_MS`, `MAX_PARTICLES` (flash.ts).

---

## 3. C9 — 타임라인 레인 라벨 (캔버스 거터)

- **거터**: 타임라인 캔버스 왼쪽에 고정 폭 `GUTTER_W`(120px) 확보. 시간 축은 `[GUTTER_W, cssWidth]`로 매핑한다(`makeTimeScale(start, end, GUTTER_W, cssWidth)`).
- **레이아웃**: `timelineLayout`의 `LayoutOptions`에 **선택적** `gutter`(기본 0) 추가. 시간을 `[gutter, width]`로 매핑하므로 rect의 `x`가 거터 오프셋을 포함한다. 플레이헤드선·스크럽·`hitTimeline` 좌표가 모두 같은 좌표계를 쓴다.
- **라벨 그리기**: 각 레인 왼쪽(`x≈4`)에 `lane.label`(이미 `goroutineLabel`로 빈 이름은 `g<id>` 폴백)을 그린다. 거터 폭을 넘는 이름은 `ctx.measureText`로 측정해 말줄임(`…`). 라벨이 캔버스의 일부라 세로 스크롤 시 레인과 자동 동기화된다.
- **스크럽 가드**: `clientX - rect.left < GUTTER_W`(라벨 영역)면 스크럽을 무시하거나 시작 시각으로 클램프한다. 블록 이유는 C9로 이름이 보여도 계속 hover 툴팁에서 확인한다(중복 없음).
- **선택 하이라이트**: 기존 선택 레인 흰 테두리는 거터를 포함한 전체 폭으로 그린다.

---

## 4. 파일 경계 & 테스트

**수정/신규 (프론트엔드만; Go 파서·Wails 바인딩·store 변경 없음)**
- `frontend/src/lib/format.ts` *(수정)* — `categoryColor` + 카테고리 색 상수.
- `frontend/src/lib/flash.ts` *(신규)* — `edgesCrossed`, `cometPoint`, `FLASH_MS`, `MAX_PARTICLES`.
- `frontend/src/lib/timelineLayout.ts` *(수정)* — `LayoutOptions.gutter`(기본 0), 시간→`[gutter, width]`.
- `frontend/src/components/GraphCanvas.svelte` *(수정)* — `nodeById`, 코멧 상태, 앞 통과 검출, 별도 rAF 루프, 코멧+링 그리기, 카테고리색 활성 엣지.
- `frontend/src/components/TimelineCanvas.svelte` *(수정)* — 거터 라벨(말줄임), 스케일/스크럽/hit 거터 오프셋.
- `frontend/src/components/Legend.svelte` *(수정)* — channel/mutex/other + inferred link(dim).

**경계**: 애니메이션 루프는 `GraphCanvas` 안에 격리. 순수 발화/색/보간 로직은 `lib/`. store와 Go는 불변. `timelineLayout`의 `gutter`는 기본 0이라 기존 동작·테스트가 보존된다. `GraphCanvas`는 자신의 직전 `$playhead` 값을 로컬로 추적해 통과를 검출하므로 store 변경이 필요 없다.

**테스트 전략**
- **순수(Vitest TDD)**: `categoryColor`(format.test), `edgesCrossed`/`cometPoint`(flash.test), `timelineLayout` 거터 오프셋(timelineLayout.test).
- **시각(수동, `wails dev`)**: 코멧 이동·도착 링·카테고리색·거터 라벨/말줄임·범례. 핵심 검증 포인트:
  1. 재생/앞 스크럽 시 코멧이 발화 시각 통과마다 흐르고, **그래프 레이아웃은 재배치되지 않는다**(별도 루프, sim 무관).
  2. 뒤로 스크럽 시 발화하지 않고, 다시 앞으로 가면 재발화한다.
  3. 카테고리별 색이 코멧·활성 엣지·범례에서 일관된다.
  4. 타임라인 레인 왼쪽에 이름이 보이고 긴 이름은 말줄임되며, 스크럽/플레이헤드가 거터만큼 정확히 정렬된다.

---

## 5. 리스크 & 완화
- **스크럽 폭주**: 큰 앞 점프가 다수 엣지를 동시에 넘김 → `MAX_PARTICLES` 상한으로 코멧 수 제한.
- **rAF 누수**: 애니메이션 루프가 종료되지 않을 위험 → 코멧 배열이 비면 즉시 정지, `onDestroy`에서 취소.
- **거터 좌표 오정렬**: 시간 축 오프셋을 한 곳(`timelineLayout` + 컴포넌트의 `makeTimeScale` 호출)에서만 적용하고, 스크럽·hit·플레이헤드가 동일 스케일을 쓰도록 통일.
