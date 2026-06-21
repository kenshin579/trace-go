<script lang="ts">
  import { onMount } from 'svelte'
  import { traceStore } from '../stores/trace'
  import { layoutTimelineRows, hitGroupHeader, type TimelineRow, type Lane } from '../lib/timelineLayout'
  import { groupGoroutines } from '../lib/grouping'
  import { layoutTaskTrack, type TaskBar } from '../lib/taskTrack'
  import { makeTimeScale } from '../lib/timeMap'
  import { visibleGoroutines } from '../lib/filter'
  import { hitTimeline } from '../lib/hit'
  import { intervalTooltip, regionTooltip, logTooltip, taskTooltip } from '../lib/tooltip'
  import { taskColor } from '../lib/format'
  import { causalNeighbors } from '../lib/causalFocus'

  const { summary, playhead, showSystem, selectedId, setPlayhead, collapsedGroups, toggleGroup } = traceStore

  let container: HTMLDivElement
  let canvas: HTMLCanvasElement
  let cssWidth = 800
  const LANE_H = 18
  const LANE_GAP = 3
  const GUTTER_W = 120
  const REGION_ROW_H = 9
  const REGION_COLOR = '#5a6b8c'
  const LOG_COLOR = '#e0c030'
  const TASK_ROW_H = 14
  const GROUP_HEADER_BG = '#1b2130'
  const GHOST_ALPHA = 0.15

  let dragging = false
  let tip: { text: string; x: number; y: number } | null = null

  $: visible = $summary ? visibleGoroutines($summary, $showSystem) : []
  $: taskTrack = $summary
    ? layoutTaskTrack($summary.tasks ?? [], {
        width: cssWidth, gutter: GUTTER_W, startTime: $summary.startTime, endTime: $summary.endTime, taskRowH: TASK_ROW_H,
      })
    : { bars: [] as TaskBar[], height: 0 }
  $: rows = $summary
    ? layoutTimelineRows(
        { ...$summary, goroutines: visible },
        groupGoroutines(visible),
        $collapsedGroups,
        { width: cssWidth, laneHeight: LANE_H, laneGap: LANE_GAP, gutter: GUTTER_W, regionRowH: REGION_ROW_H, topOffset: taskTrack.height },
      )
    : ([] as TimelineRow[])
  $: lanes = rows.filter((r): r is { kind: 'lane' } & Lane => r.kind === 'lane')
  $: headers = rows.filter((r) => r.kind === 'header') as Extract<TimelineRow, { kind: 'header' }>[]
  $: cssHeight = rows.length
    ? Math.max(400, (() => { const last = rows[rows.length - 1]; return last.kind === 'lane' ? last.y + last.totalHeight : last.y + last.height })())
    : 400

  $: chain = $summary && $selectedId !== null ? causalNeighbors($summary.edges, $selectedId) : null

  $: void [$playhead, lanes, headers, cssWidth, cssHeight, $selectedId, taskTrack], draw()

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

    // Task track (top): bars by parent depth + a gutter label.
    if (taskTrack.bars.length) {
      ctx.font = '9px system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      for (const bar of taskTrack.bars) {
        const by = bar.depth * TASK_ROW_H
        ctx.fillStyle = taskColor(bar.id)
        ctx.fillRect(bar.x, by + 1, bar.width, TASK_ROW_H - 2)
        if (bar.width > 16) {
          ctx.fillStyle = '#0f1117'
          ctx.fillText(fitLabel(ctx, bar.name, bar.width - 4), bar.x + 3, by + TASK_ROW_H / 2)
        }
      }
      ctx.fillStyle = '#8a93a3'
      ctx.font = '10px system-ui, sans-serif'
      ctx.fillText('TASKS', 4, TASK_ROW_H / 2)
    }

    // In focus mode, lanes whose goroutine is not in the selected chain are ghosted.
    const laneAlpha = (gid: number) => (chain && !chain.has(gid) ? GHOST_ALPHA : 1)

    // Group header rows: a disclosure triangle + "name ×count" on a faint band.
    ctx.textBaseline = 'middle'
    ctx.font = '11px system-ui, sans-serif'
    for (const h of headers) {
      ctx.fillStyle = GROUP_HEADER_BG
      ctx.fillRect(0, h.y, cssWidth, h.height)
      ctx.fillStyle = '#cdd3df'
      ctx.fillText(`${h.collapsed ? '▸' : '▾'} ${h.name} ×${h.count}`, 6, h.y + h.height / 2)
    }

    // State bars.
    for (const lane of lanes) {
      ctx.globalAlpha = laneAlpha(lane.goroutineId)
      for (const r of lane.rects) {
        ctx.fillStyle = r.color
        ctx.fillRect(r.x, lane.y, r.width, lane.height)
      }
    }

    // Region sub-rows.
    ctx.font = '9px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    for (const lane of lanes) {
      ctx.globalAlpha = laneAlpha(lane.goroutineId)
      for (const reg of lane.regions) {
        const ry = lane.y + lane.height + reg.depth * REGION_ROW_H
        ctx.fillStyle = REGION_COLOR
        ctx.fillRect(reg.x, ry + 1, reg.width, REGION_ROW_H - 2)
        if (reg.width > 14) {
          ctx.fillStyle = '#e6ebf2'
          ctx.fillText(fitLabel(ctx, reg.name, reg.width - 4), reg.x + 3, ry + REGION_ROW_H / 2)
        }
      }
    }

    // Log markers (small diamonds on the top edge of the state row).
    for (const lane of lanes) {
      ctx.globalAlpha = laneAlpha(lane.goroutineId)
      for (const lg of lane.logs) {
        const my = lane.y + 4
        ctx.fillStyle = LOG_COLOR
        ctx.beginPath()
        ctx.moveTo(lg.x, my - 3)
        ctx.lineTo(lg.x + 3, my)
        ctx.lineTo(lg.x, my + 3)
        ctx.lineTo(lg.x - 3, my)
        ctx.closePath()
        ctx.fill()
      }
    }

    // Lane labels in the gutter.
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillStyle = '#cdd3df'
    for (const lane of lanes) {
      ctx.globalAlpha = laneAlpha(lane.goroutineId)
      ctx.fillText(fitLabel(ctx, lane.label, GUTTER_W - 10), 4, lane.y + lane.height / 2)
    }
    ctx.globalAlpha = 1

    // Selected lane outline (full lane incl. region rows).
    for (const lane of lanes) {
      if (lane.goroutineId === $selectedId) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.strokeRect(GUTTER_W + 0.5, lane.y + 0.5, cssWidth - GUTTER_W - 1, lane.totalHeight - 1)
      }
    }

    // Playhead.
    if ($summary && lanes.length) {
      const scale = makeTimeScale($summary.startTime, $summary.endTime, GUTTER_W, cssWidth)
      const x = scale.toPixel($playhead)
      const bottom = lanes[lanes.length - 1].y + lanes[lanes.length - 1].totalHeight
      ctx.strokeStyle = '#5b8def'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, bottom)
      ctx.stroke()
    }
  }

  function timeAtClientX(clientX: number): number {
    if (!$summary) return 0
    const rect = canvas.getBoundingClientRect()
    const scale = makeTimeScale($summary.startTime, $summary.endTime, GUTTER_W, cssWidth)
    return scale.toTime(clientX - rect.left)
  }

  function onPointerDown(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect()
    const key = hitGroupHeader(rows, e.clientY - rect.top)
    if (key !== null) {
      toggleGroup(key)
      return // header click toggles collapse; do not scrub the playhead
    }
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
    if (taskTrack.bars.length && y < taskTrack.height) {
      const depth = Math.floor(y / TASK_ROW_H)
      const bar = taskTrack.bars.find((b) => b.depth === depth && x >= b.x && x < b.x + b.width)
      tip = bar ? { text: taskTooltip(bar.name, bar.start, bar.end), x, y } : null
      return
    }
    const h = hitTimeline(lanes, x, y, REGION_ROW_H)
    if (!h) {
      tip = null
    } else if (h.kind === 'interval') {
      tip = { text: intervalTooltip(h.lane.label, h.rect.state, h.rect.blockReason), x, y }
    } else if (h.kind === 'region') {
      tip = { text: regionTooltip(h.region.name, h.region.start, h.region.end), x, y }
    } else {
      tip = { text: logTooltip(h.log.category, h.log.message), x, y }
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
