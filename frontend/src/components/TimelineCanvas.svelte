<script lang="ts">
  import { onMount } from 'svelte'
  import { traceStore } from '../stores/trace'
  import { layoutTimeline, type Lane } from '../lib/timelineLayout'
  import { makeTimeScale } from '../lib/timeMap'
  import type { TraceSummary } from '../lib/types'

  const { summary, playhead, setPlayhead } = traceStore

  let canvas: HTMLCanvasElement
  let width = 800
  let height = 400
  const LANE_H = 18
  const LANE_GAP = 3

  let lanes: Lane[] = []
  let current: TraceSummary | null = null
  let dragging = false

  summary.subscribe((s) => {
    current = s
    relayout()
    draw()
  })
  playhead.subscribe(() => draw())

  function relayout() {
    if (!current) {
      lanes = []
      return
    }
    height = Math.max(400, current.goroutines.length * (LANE_H + LANE_GAP))
    lanes = layoutTimeline(current, { width, laneHeight: LANE_H, laneGap: LANE_GAP })
  }

  function draw() {
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#0f1117'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    for (const lane of lanes) {
      for (const r of lane.rects) {
        ctx.fillStyle = r.color
        ctx.fillRect(r.x, lane.y, r.width, lane.height)
      }
    }

    if (current) {
      const scale = makeTimeScale(current.startTime, current.endTime, 0, width)
      let ph = 0
      playhead.subscribe((v) => (ph = v))()
      const x = scale.toPixel(ph)
      ctx.strokeStyle = '#5b8def'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
  }

  function timeAtClientX(clientX: number): number {
    if (!current) return 0
    const rect = canvas.getBoundingClientRect()
    const scale = makeTimeScale(current.startTime, current.endTime, 0, width)
    return scale.toTime(clientX - rect.left)
  }

  function onPointerDown(e: PointerEvent) {
    dragging = true
    setPlayhead(timeAtClientX(e.clientX))
  }
  function onPointerMove(e: PointerEvent) {
    if (dragging) setPlayhead(timeAtClientX(e.clientX))
  }
  function onPointerUp() {
    dragging = false
  }

  onMount(() => {
    relayout()
    draw()
    window.addEventListener('pointerup', onPointerUp)
    return () => window.removeEventListener('pointerup', onPointerUp)
  })
</script>

<canvas
  bind:this={canvas}
  {width}
  {height}
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  style="width:100%; cursor: ew-resize; display:block;"
></canvas>
