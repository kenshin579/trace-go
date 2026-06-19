# Timeline Regions + Logs — Design (Plan 2F / B4-1)

- **날짜**: 2026-06-20
- **상태**: 설계 승인 대기
- **목표**: trace의 사용자 주석 중 **region**과 **log**를 타임라인에 표시해, "이 goroutine이 그때 무엇을 하던 중이었나(region)"와 "이 순간 무슨 일이 있었나(log)"를 보이게 한다.

---

## 1. 개요 & 범위

Go 실행 trace는 `runtime/trace`의 사용자 주석을 담는다. 현재 trace-go 파서는 이를 전부 무시한다. 이 작업(B4-1)은 그중 **region**과 **log**를 파싱해 타임라인에 얹는다.

- **region** — `trace.WithRegion`/`StartRegion`. **한 goroutine 안의 이름 붙은 시간 구간**(중첩 가능). 예: `db-query`.
- **log** — `trace.Log`/`Logf`. **지속시간 없는 시점 이벤트**(category + message).

### 범위 밖 (별도 계획 B4-2)
- **task** — `trace.NewTask`. 여러 goroutine에 걸친 논리 작업. 타임라인 상단 트랙 + 그래프 **정적 task 클러스터(hull)** 로 표현. cross-goroutine이라 본질적으로 더 큰 작업이며, 그래프 클러스터링은 "시간 이동 시 재배치 없음" 불변식을 지키기 위해 **소속을 한 번만 계산하는 정적 방식**으로 설계한다(시점은 색으로 표현).
- 그래프 뷰는 B4-1에서 **무변경**.

---

## 2. 파서 & 모델

### 파서 (`internal/parse`)
현재 단일 패스는 `EventStateTransition`만 처리한다. 다음 이벤트 처리를 추가한다(기존 interval/edge 로직은 불변):

- `EventRegionBegin` / `EventRegionEnd` → **region**. goroutine마다 **스택**을 유지: begin 시 `depth = 현재 스택 크기`로 push(start=ev.Time, name=region.Type), end 시 pop하여 end=ev.Time 확정. 보정:
  - 끝나지 않은 region(추적 종료 시 스택에 남음): end = trace 끝(maxT).
  - 시작 없이 끝난 region(추적 시작 전부터 열려 있던 경우, begin 이벤트를 못 봄): 무시(매칭 begin이 없으면 깊이 계산이 불가능하므로 안전하게 버림).
- `EventLog` → **log**: time = ev.Time, goID = ev.Goroutine, category·message = log.Category·log.Message.

region/log의 소속 goroutine은 이벤트의 실행 goroutine(`ev.Goroutine()`)이다. region의 `Task` 필드는 B4-1에서 사용하지 않는다.

### 모델 (`internal/model`)
```
type Region struct {
    Start Time   `json:"start"`
    End   Time   `json:"end"`
    Name  string `json:"name"`   // trace의 region Type
    Depth int    `json:"depth"`  // 중첩 깊이(0=최상위)
}
type Log struct {
    Time     Time   `json:"time"`
    GoID     int64  `json:"goId"`
    Category string `json:"category"`
    Message  string `json:"message"`
}
```
- `Goroutine`에 `Regions []Region` 추가(region은 한 goroutine 귀속).
- `TraceSummary`에 `Logs []Log` 추가(시점 이벤트, B4-2에서 task와도 엮을 수 있게 top-level; 프론트는 GoID로 인덱싱).

주석이 없는 trace면 `Regions`/`Logs`는 비고, 화면은 기존과 동일하다.

---

## 3. 타임라인 렌더링 (핵심 변경: 가변 레인 높이)

승인된 레이아웃: **region = 상태 바 아래 sub-row**, **log = 상태 바 위 마커**.

### 가변 레인 높이
- region이 있는 goroutine의 레인 높이 = 상태 행(`LANE_H`) + (그 goroutine의 **최대 region 깊이 + 1**) × `REGION_ROW_H`. region 없는 goroutine은 상태 행만(기존 컴팩트 높이).
- 따라서 레인 높이가 **가변**이 된다. 현재 `timelineLayout`의 균일 stride(`y = i*(LANE_H+GAP)`) 가정을 버리고, 각 레인 높이를 계산해 **누적 y**로 배치한다. `cssHeight`는 레인 높이 합(+gap).
- `Lane`은 이미 `y`/`height`를 가지므로 시그니처는 유지하되 값이 가변이 된다. region rect 목록과 log 마커 목록을 레인에 추가한다.

### 그리기
- 상태 바: 기존과 동일(거터 오프셋 포함).
- region 바: 깊이 `d` 행(`y = lane.stateBottom + d*REGION_ROW_H`)에 `[start,end]` 시간 구간을 시간 스케일로 매핑한 rect + 이름(폭 좁으면 `fitLabel` 말줄임). 색은 상태색과 구분되는 중립 톤(예: `#5a6b8c` 계열, 깊이에 따라 약간 명도 차).
- log 마커: 상태 행 위(또는 상단 모서리)에 작은 마름모(◆)를 시간 위치에 그림.

### hit-test 변경
- `hitTimeline`을 균일 stride 가정에서 **레인 y-범위 스캔**으로 바꾼다(레인 수가 적어 선형 스캔 허용). 반환은 기존 interval hit에 더해 region/log hit도 식별할 수 있게 한다(또는 region/log 전용 hit 함수 추가).

### 상호작용
- region hover → 이름 + 지속시간 툴팁(`regionTooltip`).
- log hover → `category: message` 툴팁(`logTooltip`).
- 기존 툴팁 오버레이·스크럽·선택 하이라이트·플레이헤드는 가변 높이 좌표계에 맞춰 일관 유지.
- 필터(showSystem): 보이는 goroutine의 region/log만 렌더.

---

## 4. 파일 경계 & 테스트

**Go (additive — 기존 interval/edge 불변)**
- `internal/model/model.go` — `Region`/`Log` + `Goroutine.Regions`/`TraceSummary.Logs`.
- `internal/parse/parse.go` — region(깊이 스택)·log 이벤트 처리.
- `internal/parse/testutil_test.go` — `trace.WithRegion`(중첩 포함)+`trace.Log`를 쓰는 시나리오 추가.
- `internal/parse/parse_test.go` — region 이름·중첩 깊이·start<end, log time·category·message에 대한 invariant 테스트.

**Frontend**
- `frontend/src/lib/types.ts` — `Region`/`Log` 미러 + `Goroutine.regions`/`TraceSummary.logs`.
- `frontend/src/lib/timelineLayout.ts` — **가변 높이 레이아웃**: 레인별 높이 계산, 누적 y, region rect + log 마커 좌표. 순수, TDD.
- `frontend/src/lib/hit.ts` — `hitTimeline` 가변 높이 + region/log hit. 순수, TDD.
- `frontend/src/lib/tooltip.ts` — `regionTooltip`/`logTooltip`. 순수, TDD.
- `frontend/src/components/TimelineCanvas.svelte` — region sub-row + log 마커 그리기, 가변 높이, region/log hover. 시각 검증.

**테스트 전략**
- **순수(Vitest TDD)**: 가변 레인 레이아웃(높이·누적 y·region 깊이행·log 위치), region/log hit-testing, 툴팁 텍스트.
- **Go 파서**: 주석(`WithRegion`/`Log`)을 단 trace를 in-process로 생성해 region/log가 올바른 이름·깊이·시점으로 파싱되는지 invariant 검증.
- **시각(수동, `wails dev`)**: region sub-row·log 마커·가변 높이·hover 툴팁. 핵심 확인:
  1. region 있는 goroutine은 상태 바 아래에 중첩 깊이만큼 sub-row가 보이고, 없는 goroutine은 컴팩트.
  2. log 마커 hover 시 category·message.
  3. 가변 높이에서도 스크럽·플레이헤드·선택·거터 라벨이 정확히 정렬.
  - **주석 있는 테스트 trace를 새로 생성**해 검증.

**경계**: GraphCanvas·store·재생/필터/flash 불변. 가변 레인 높이가 최대 리스크라 레이아웃 수학을 순수 함수로 격리해 TDD. 파서/모델 변경은 순수 additive(주석 없는 trace는 기존과 동일).

---

## 5. 리스크 & 완화
- **가변 레인 높이**가 layout·hit-test·스크럽 좌표를 동시에 건드림 → 레이아웃 수학을 순수 함수(`timelineLayout`)에 모으고 단위 테스트로 누적 y·hit 범위를 고정. 컴포넌트는 그 결과를 그리기만.
- **region 중첩 비정상**(짝 안 맞는 begin/end) → 파서에서 스택 기반으로 안전 처리(미종료는 trace 끝으로, 미시작은 버림).
- **주석 없는 trace** → Regions/Logs 비어 화면 기존과 동일(회귀 없음).
