# Tasks Track + Graph Clusters — Design (Plan 2G / B4-2)

- **날짜**: 2026-06-20
- **상태**: 설계 승인 대기
- **목표**: trace의 사용자 **task**(`runtime/trace.NewTask`, 여러 goroutine에 걸친 논리 작업)를 ① 타임라인 상단 트랙과 ② 그래프 정적 클러스터(hull)로 표현해, "이 요청 전체가 어디서 어디까지, 어떤 goroutine들에 걸쳐 진행됐나"를 보이게 한다.

---

## 1. 개요 & 범위

B4-1이 region/log를 타임라인에 얹었다. B4-2는 그 위에 **task**를 더한다.

- **task** — `trace.NewTask(ctx, name)`. 시작~끝 구간이며 **여러 goroutine에 걸치고** 계층(부모/자식)을 가지며, region·log를 묶는다.
- **표현 두 곳**: 타임라인 상단의 task 트랙(시간 전반, 부모 중첩), 그래프의 정적 task 클러스터(같은 task의 goroutine을 한곳에 모으고 hull로 감쌈).

### Carried-over 결정 (B4 브레인스토밍에서 확정)
- 타임라인 task = 상단 트랙(레인 위), 부모 깊이로 중첩.
- 그래프 = **정적 클러스터**: goroutine의 task 소속을 **한 번만** 계산해(rebuild 시) force로 묶고 hull을 그린다. 플레이헤드 변경 시엔 **재배치 없이 색만** 갱신 → 2C의 "시간 이동 시 그래프 재배치 없음" 불변식을 지킨다.
- **goroutine → task 배정 = 그 goroutine의 첫 task-소속 region의 task** (없으면 미클러스터). 대부분의 trace에서 goroutine 하나는 한 task를 담당한다.

### 범위 밖
- hull 자체 hover, task별 노드 색 링(C1), 타임라인 시간 줌(C8) — 모두 별개/YAGNI.

---

## 2. 파서 & 모델 (additive)

### 파서 (`internal/parse`)
기존 단일 패스에 추가(기존 interval/edge/region/log 로직 불변):
- `EventTaskBegin` → task의 시작: `Tasks[id] = {ID, Parent, Name: ev.Task().Type, Start: now}`. `EventTaskEnd` → 해당 id의 `End = now`. 미종료 task는 trace 끝에서 `End = maxT`. 시작 없이 끝난 task(begin 못 봄)는 `Name=""`로 등재되거나 무시 — End만 있으면 `Start=minT`로 보정해 등재.
- **region·log에 Task 저장**: region begin 시 `ev.Region().Task`, log 시 `ev.Log().Task`를 함께 기록한다(B4-1에서 무시했던 필드).
- task ID는 `exptrace.TaskID`(uint64). "사용자 task"는 `Tasks` 맵에 등재된 것(= TaskBegin/End를 본 것). region의 Task가 등재되지 않은 background면 클러스터 대상이 아니다.

### 모델 (`internal/model`)
```
type Task struct {
    ID     uint64 `json:"id"`
    Parent uint64 `json:"parent"`
    Name   string `json:"name"`
    Start  Time   `json:"start"`
    End    Time   `json:"end"`
}
```
- `TraceSummary.Tasks []Task` 추가.
- `Region`에 `Task uint64 \`json:"task"\``, `Log`에 `Task uint64 \`json:"task"\`` 추가.

주석/ task가 없는 trace면 `Tasks`는 비고 화면은 기존과 동일.

---

## 3. 타임라인 상단 task 트랙

- **위치**: goroutine 레인들 **위**의 고정 블록. 트랙 높이만큼 레인 전체가 아래로 내려간다.
- **레이아웃 (`lib/taskTrack.ts`, 순수)**: `layoutTaskTrack(tasks, {width, gutter, startTime, endTime, taskRowH})` → task 바 목록(`{x, width, depth, name, start, end}`) + 트랙 총 높이. `depth`는 부모 체인 길이(root=0). 트랙 높이 = `(maxDepth+1) * taskRowH`(task 없으면 0). 바의 x/width는 거터 오프셋된 동일 시간 스케일로 매핑.
- **레인 오프셋**: `timelineLayout`에 `topOffset?`(트랙 높이)를 더해 첫 레인 y를 트랙 아래에서 시작(기본 0이라 기존 보존). `cssHeight`도 포함.
- **그리기 (`TimelineCanvas`)**: 트랙 영역에 task 바를 깊이 행별로, task 색(`taskColor`)으로, 이름 말줄임. 좌측 거터에 "TASKS" 라벨.
- **상호작용**: task 바 hover → `taskTooltip`(이름 + 지속시간). 기존 interval/region/log hover 유지(hit-test에 트랙 영역 분기 추가).

---

## 4. 그래프 정적 task 클러스터

- **소속 (`lib/graphCluster.ts`, 순수)**: `clusterByTask(goroutines, knownTaskIds) → Map<goId, taskId>`. 각 goroutine의 첫 region(그 `task`가 `knownTaskIds`에 속하는)으로 배정. 없으면 미포함(미클러스터). rebuild(노드셋 변경) 시 1회 계산.
- **레이아웃 (`GraphCanvas`)**: 기존 force에 **클러스터 인력** 추가 — 같은 클러스터 노드를 공통 목표점(클러스터별 시드 좌표)으로 당기는 `forceX`/`forceY`. sim은 노드셋 변경 시에만 재구동(기존과 동일, 플레이헤드 무관).
- **hull (`lib/graphCluster.ts` `convexHull`, 순수)**: 클러스터별 노드 좌표로 볼록 외곽(Andrew monotone chain) 계산, 약간의 패딩을 줘 매 프레임 그림(멤버십 고정이라 안정적) + task 라벨. 색 = `taskColor`(타임라인과 동일 팔레트). hull은 노드/엣지 **아래** 레이어.
- **불변**: 노드 상태색·엣지·코멧 flash 모두 기존 그대로(시점 반영). 멤버십이 정적이라 `$playhead` 변경 시 hull은 **재그리기만**(위치 불변).

---

## 5. 파일 경계 & 테스트

**Go**: `internal/model/model.go`(Task + Region.Task/Log.Task), `internal/parse/parse.go`(task 이벤트 + region/log task), testutil 시나리오(NewTask+중첩+task 하 region), parse_test invariant.

**Frontend**
- `lib/types.ts` — Task 미러 + region.task?/log.task?/summary.tasks?.
- `lib/taskTrack.ts` *(신규)* — `layoutTaskTrack` (순수 TDD).
- `lib/timelineLayout.ts` — `topOffset` (순수 TDD).
- `lib/graphCluster.ts` *(신규)* — `clusterByTask` + `convexHull` (순수 TDD).
- `lib/tooltip.ts` — `taskTooltip` (TDD). `lib/format.ts` — `taskColor` (TDD).
- `components/TimelineCanvas.svelte` — 상단 트랙 + 레인 오프셋 + task hover (시각).
- `components/GraphCanvas.svelte` — 클러스터 force + hull/라벨 (시각).

**테스트 전략**
- **순수(Vitest TDD)**: taskTrack 레이아웃(바·깊이·높이), timelineLayout topOffset, clusterByTask 배정, convexHull 정확성, taskTooltip/taskColor.
- **Go 파서**: NewTask(중첩) + task 하 region을 단 trace를 in-process 생성해 tasks(id/parent/name/start<end)와 region.task 링크를 invariant 검증.
- **시각(수동, `wails dev`)**: 상단 task 트랙(부모 중첩·hover), 그래프 hull(같은 task 노드 묶임·라벨·색). 핵심 확인: **재생/스크럽 시 hull 멤버십·위치 고정(무지터), 노드 색만 변함**. NewTask 단 테스트 trace 생성.

**경계**: store·재생·필터·flash 불변; 클러스터 정적 멤버십으로 2C 불변식 유지; 파서/모델 additive(task 없는 trace는 기존과 동일).

---

## 6. 리스크 & 완화
- **클러스터가 force를 흔들 위험** → 클러스터 인력은 rebuild 시 1회 적용, `$playhead`엔 sim 미구동(재그리기만). hull은 매 프레임 계산해도 멤버십·위치가 안정적이라 무지터.
- **상단 트랙이 레인 좌표를 밀어냄** → `topOffset`을 `timelineLayout` 한 곳에서만 더하고 playhead·스크럽·hit·선택이 동일 좌표계를 쓰도록 통일(B4-1 가변 높이와 동일 원칙).
- **task 없는 trace / background-only region** → Tasks 비고 클러스터 없음, 화면 기존과 동일(회귀 없음).
