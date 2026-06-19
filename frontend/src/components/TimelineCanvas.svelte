<script lang="ts">
  import { onMount } from 'svelte'
  import { traceStore } from '../stores/trace'
  import { layoutTimeline, type Lane } from '../lib/timelineLayout'
  import { makeTimeScale } from '../lib/timeMap'
  import { visibleGoroutines } from '../lib/filter'
  import { hitTimeline } from '../lib/hit'
  import { intervalTooltip } from '../lib/tooltip'

  const { summary, playhead, showSystem, selectedId, setPlayhead } = traceStore

  let container: HTMLDivElement
  let canvas: HTMLCanvasElement
  let cssWidth = 800
  const LANE_H = 18
  const LANE_GAP = 3
  const GUTTER_W = 120 // left column reserved for goroutine labels

  let dragging = false
  let tip: { text: string; x: number; y: number } | null = null

  $: visible = $summary ? visibleGoroutines($summary, $showSystem) : []
  $: lanes = $summary
    ? layoutTimeline(
        { ...$summary, goroutines: visible },
        { width: cssWidth, laneHeight: LANE_H, laneGap: LANE_GAP, gutter: GUTTER_W },
      )
    : ([] as Lane[])
  $: cssHeight = Math.max(400, visible.length * (LANE_H + LANE_GAP))

  $: void [$playhead, lanes, cssWidth, cssHeight, $selectedId], draw()

  // Truncate a label with an ellipsis so it fits in maxW pixels.
  function fitLabel(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text
    let s = text
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1)
    return s + '…'
  }

  function draw() {
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

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

    // Lane labels in the left gutter.
    ctx.font = '11px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#cdd3df'
    for (const lane of lanes) {
      ctx.fillText(fitLabel(ctx, lane.label, GUTTER_W - 10), 4, lane.y + lane.height / 2)
    }

    const lanesBottom = lanes.length * (LANE_H + LANE_GAP)

    for (const lane of lanes) {
      if (lane.goroutineId === $selectedId) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.strokeRect(GUTTER_W + 0.5, lane.y + 0.5, cssWidth - GUTTER_W - 1, lane.height - 1)
      }
    }

    if ($summary) {
      const scale = makeTimeScale($summary.startTime, $summary.endTime, GUTTER_W, cssWidth)
      const x = scale.toPixel($playhead)
      ctx.strokeStyle = '#5b8def'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, Math.max(lanesBottom, 1))
      ctx.stroke()
    }
  }

  function timeAtClientX(clientX: number): number {
    if (!$summary) return 0
    const rect = canvas.getBoundingClientRect()
    const scale = makeTimeScale($summary.startTime, $summary.endTime, GUTTER_W, cssWidth)
    return scale.toTime(clientX - rect.left) // store clamps to [startTime,endTime]
  }

  function onPointerDown(e: PointerEvent) {
    dragging = true
    setPlayhead(timeAtClientX(e.clientX))
  }
  function onPointerMove(e: PointerEvent) {
    if (dragging) {
      setPlayhead(timeAtClientX(e.clientX))
      tip = null
      return
    }
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const h = hitTimeline(lanes, x, y, LANE_H + LANE_GAP, LANE_H)
    if (h && h.rect) {
      tip = { text: intervalTooltip(h.lane.label, h.rect.state, h.rect.blockReason), x, y }
    } else {
      tip = null
    }
  }
  function onPointerLeave() {
    tip = null
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

<div bind:this={container} class="timeline-canvas-wrap" on:pointerleave={onPointerLeave}>
  <canvas
    bind:this={canvas}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    style="width:100%; cursor: ew-resize; display:block;"
  ></canvas>
  {#if tip}
    <div class="tip" style="left:{tip.x + 12}px; top:{tip.y + 12}px">{tip.text}</div>
  {/if}
</div>

<style>
  .timeline-canvas-wrap { width: 100%; position: relative; }
  .tip {
    position: absolute; pointer-events: none; white-space: pre; z-index: 10;
    background: #161922; color: #cdd3df; border: 1px solid #2a2e38;
    border-radius: 4px; padding: 4px 8px; font-size: 12px; line-height: 1.35;
  }
</style>
