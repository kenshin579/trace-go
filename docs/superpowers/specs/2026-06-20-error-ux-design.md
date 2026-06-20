# Trace Open Error UX — Design (A3)

## 1. 개요 & 범위

`go tool trace`/`runtime/trace`로 만든 trace를 여는 과정에서 실패하면, 지금은 라이브러리의 raw 에러 문자열이 헤더의 작은 빨간 글씨로 그대로 노출된다(예: `bad file format: not a Go execution trace?`). A3는 이를 **사람이 읽고 바로 행동할 수 있는 친절한 메시지 + 눈에 띄는 표시**로 바꾼다.

탐색 중 확인한 사실: 현 의존성(`golang.org/x/exp/trace`)은 구 포맷(Go 1.11/1.19/1.21) trace를 **거부하지 않고 변환해 로드**한다(`reader.go`에서 `tracev1.Parse`). 따라서 "1.22 미만 거부"라는 기존 전제는 더 이상 맞지 않으며, 실제 에러는 아래 출처에서 나온다.

### 실제 에러 출처
| 상황 | raw 에러 | 출처 |
|---|---|---|
| trace 아님 / 빈 파일 / 엉뚱한 파일 | `bad file format: not a Go execution trace?` | version.go |
| 알 수 없는/미지원 버전 | `unknown or unsupported trace version go 1.N` / `unknown or unsupported version go 1.N` | version.go / reader.go |
| 손상/잘린 trace (파싱 중) | `broken trace: frontier is empty: …` 등 | reader.go (ReadEvent) |
| 파일 열기 실패 | `open …: no such file` / permission 등 | os.Open |

### 다룰 범위 (확정)
4종 분류 + fallback, Go 쪽에서 분류, 프론트는 받은 친절 문자열을 배너로 표시. 메시지는 기존 UI에 맞춰 **영어**.

### 범위 밖 (YAGNI / 후속)
- 구 포맷(Go 1.11~1.21) 로드 *성공* 시 "기능 제한(region/task 없음)" 안내 — 성공 케이스 경고라 에러 UX와 별개.
- raw 에러 원문 노출 / "에러 복사" 버튼.
- 빈 파일 전용 메시지(①에 흡수).
- 배너 안 재시도 버튼(기존 "Open trace…"가 재시도).
- i18n / 한국어 메시지.
- 파싱 중 실패 시 부분 trace 표시(파싱은 all-or-nothing).
- **후속(별개):** CLAUDE.md / 기존 설계서의 "구 포맷 거부" 문구가 현 의존성에선 부정확 — 정정은 이 작업 밖의 별도 doc 수정으로 둔다.

---

## 2. 분류 함수 (Go, main 패키지)

`os.Open` 실패와 `parse.Parse` 실패를 **둘 다** 받아 사용자 메시지로 매핑하는 표현(presentation) 관심사이므로, 순수 `parse` 패키지가 아니라 **바인딩 계층(main 패키지)** 에 둔다. `app_test.go`가 이미 main 패키지를 테스트하므로 단위 테스트도 자연스럽다.

```go
// errors.go (package main)
// classifyOpenError maps a raw os/parse error into a short, user-facing message.
func classifyOpenError(err error) string
```

순수 함수(에러 in → 문자열 out). 매칭 순서(위에서부터, 먼저 걸리는 것):

| # | 감지 | 메시지 |
|---|---|---|
| ④ | `errors.Is(err, os.ErrNotExist)` | `Can't find that file — it may have been moved or deleted.` |
| ④ | `errors.Is(err, os.ErrPermission)` | `Can't open that file — permission denied.` |
| ① | raw에 `bad file format` 포함 | `This file isn't a Go execution trace (or is empty). Open one produced by runtime/trace — e.g. "go test -trace=trace.out", or trace.Start/Stop in your program.` |
| ③ | raw에 `unknown or unsupported` 포함 | `This trace uses an unsupported format version. Re-capture it with Go 1.22 or newer.` |
| ② | raw에 `broken trace` 포함 | `This trace looks corrupted or was cut off. Make sure trace.Stop() ran before the program exited, then re-capture.` |
| — | 그 외 (fallback) | `Couldn't read this trace — it may be corrupted or in an unexpected format.` |

- os 검사(`errors.Is`)를 substring 검사보다 **먼저** 둔다(파일 열기 실패가 가장 구체적이고 확실).
- substring 매칭이라 라이브러리 문구가 약간 바뀌어도 fallback이 받아준다(견고).

### 배선 (`app.go`)
```go
func (a *App) OpenTrace(path string) (*model.TraceSummary, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, errors.New(classifyOpenError(err))
	}
	defer f.Close()
	sum, err := parse.Parse(f)
	if err != nil {
		return nil, errors.New(classifyOpenError(err))
	}
	return sum, nil
}
```
`OpenTraceDialog`는 `OpenTrace`를 호출하므로 자동으로 친절 메시지를 받는다(취소 시 `(nil, nil)` 동작 불변). 프론트는 지금처럼 `String(e)`로 받은 문자열을 그대로 쓴다.

---

## 3. 프론트 표시 (App.svelte)

현재는 헤더의 작은 빨간 글씨(`.error`, 13px)라 눈에 안 띄고, 이미 trace가 로드된 상태에서 잘못된 파일을 또 열면 가운데 빈 화면이 안 떠 메시지가 묻힌다.

**헤더 아래 전폭 에러 배너** (로드 여부와 무관하게 동작):
- `error !== ''`일 때 헤더 바로 아래 한 줄 배너: 옅은 적색 배경 + 메시지 + 우측 작은 `×`(닫기).
- 기존 헤더의 `.error` span은 **제거**(중복 방지).
- `×` 클릭 시 `error = ''`; 다음 "Open trace…" 시도 시에도 `open()` 시작부의 `error = ''`로 초기화되어 사라짐.
- 빈 상태 가운데 안내문(`Open a Go execution trace (.out) to begin.`)은 그대로 — 배너가 에러를 담당.

App.svelte만 변경(배너 markup + 스타일 + `×` 핸들러, 헤더 span 제거). store·canvas·기타 컴포넌트 불변.

---

## 4. 테스트 전략

**Go 단위 (`errors_test.go`, main 패키지) — table-driven, 모든 분기 결정적 검증:**
```go
os.ErrNotExist                                          → "Can't find that file …"
os.ErrPermission                                        → "… permission denied."
errors.New("bad file format: not a Go execution trace?") → not-a-trace 메시지
errors.New("unknown or unsupported trace version go 1.17") → unsupported version
errors.New("broken trace: frontier is empty: …")        → corrupt 메시지
errors.New("something unexpected")                      → fallback 메시지
```
(`broken trace`는 실제 재현이 어려워 합성 에러로만 분기 검증.)

**Go 통합 (`app_test.go`에 추가) — 실제 배선 end-to-end:**
- 존재하지 않는 경로 → `OpenTrace` → "Can't find that file …".
- 임시 파일에 쓰레기 바이트(`"not a trace"`) → `OpenTrace` → not-a-trace 메시지(실제 `os.Open`+`parse.Parse`+`classifyOpenError` 통과).
- 정상 trace(`writeSampleTrace`) → `OpenTrace` → 에러 nil + 요약 정상(회귀 방지).

**프론트:** 에러 배너는 얇은 컴포넌트 변경이라 **시각 확인**(관례: 컴포넌트는 thin, 픽셀은 수동). 메시지는 Go에서 오므로 새 순수 함수/Vitest 테스트 없음.

---

## 5. 파일 경계 & 불변식

### 파일
- `errors.go` (package main) — **신규**: `classifyOpenError`.
- `errors_test.go` (package main) — **신규**: 분류 단위 테스트.
- `app.go` — **수정**: `OpenTrace`가 `classifyOpenError`로 감싸 반환.
- `app_test.go` — **수정**: `OpenTrace` 통합 테스트 추가.
- `frontend/src/App.svelte` — **수정**: 에러 배너 + 헤더 span 제거.

### 불변식 / 호환
- **정상 경로 완전 불변** — `classifyOpenError`는 에러일 때만 실행되며, 유효 trace는 이전과 동일하게 로드된다.
- 프론트는 **App.svelte만** 변경(store·canvas 불변, 데이터 계약 불변).
- `OpenTraceDialog`의 취소 동작(`(nil, nil)`) 불변.

---

## 6. 리스크 & 완화

- **라이브러리 에러 문구 변경** → substring 매칭 + fallback으로 흡수(견고). (완화)
- **새 에러 종류 등장** → fallback "Couldn't read this trace …"가 받아 raw 노출 없음. (완화)
- **`broken trace` 분기 미통합테스트** → 합성 단위 테스트로 분기 자체는 결정적으로 검증. (완화)
- **이미 로드된 상태의 에러 묻힘** → 전폭 배너가 로드 여부와 무관하게 표시. (완화)
