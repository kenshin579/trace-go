<script lang="ts">
  import { onMount } from 'svelte'
  import { traceStore } from '../stores/trace'
  import { layoutTimeline, type Lane } from '../lib/timelineLayout'
  import { makeTimeScale } from '../lib/timeMap'
  import { visibleGoroutines } from '../lib/filter'

  const { summary, playhead, showSystem, setPlayhead } = traceStore

  let container: HTMLDivElement
  let canvas: HTMLCanvasElement
  let cssWidth = 800 // CSS (layout) pixel width of the time axis; tracked to the container
  const LANE_H = 18
  const LANE_GAP = 3

  let dragging = false

  // Layout and height are derived reactively from the loaded summary and the
  // current width. Using $summary/$playhead auto-subscriptions means Svelte
  // owns subscription lifecycle (no manual leak).
  $: visible = $summary ? visibleGoroutines($summary, $showSystem) : []
  $: lanes = $summary
    ? layoutTimeline(
        { ...$summary, goroutines: visible },
        { width: cssWidth, laneHeight: LANE_H, laneGap: LANE_GAP },
      )
    : ([] as Lane[])
  $: cssHeight = Math.max(400, visible.length * (LANE_H + LANE_GAP))

  // Redraw whenever any input to the picture changes. draw() no-ops until the
  // canvas is mounted; onMount triggers the first real paint.
  $: void [$playhead, lanes, cssWidth, cssHeight], draw()

  function draw() {
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Size the bitmap to the CSS box so layout/pointer pixels share one
    // coordinate space (the playhead must land under the cursor), and scale by
    // devicePixelRatio for crisp lines. Setting canvas.width is a DOM op, not a
    // reactive write, so this does not re-trigger the reactive block above.
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)
    canvas.style.height = cssHeight + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = '#0f1117'
    ctx.fillRect(0, 0, cssWidth, cssHeight)

    for (const lane of lanes) {
      for (const r of lane.rects) {
        ctx.fillStyle = r.color
        ctx.fillRect(r.x, lane.y, r.width, lane.height)
      }
    }

    if ($summary) {
      const scale = makeTimeScale($summary.startTime, $summary.endTime, 0, cssWidth)
      const x = scale.toPixel($playhead)
      ctx.strokeStyle = '#5b8def'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, cssHeight)
      ctx.stroke()
    }
  }

  function timeAtClientX(clientX: number): number {
    if (!$summary) return 0
    const rect = canvas.getBoundingClientRect()
    const scale = makeTimeScale($summary.startTime, $summary.endTime, 0, cssWidth)
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
    const measure = () => {
      cssWidth = container.clientWidth || cssWidth
    }
    measure()
    draw()
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      ro.disconnect()
      window.removeEventListener('pointerup', onPointerUp)
    }
  })
</script>

<div bind:this={container} class="timeline-canvas-wrap">
  <canvas
    bind:this={canvas}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    style="width:100%; cursor: ew-resize; display:block;"
  ></canvas>
</div>

<style>
  .timeline-canvas-wrap {
    width: 100%;
  }
</style>
