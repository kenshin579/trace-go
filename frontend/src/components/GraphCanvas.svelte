<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import {
    forceSimulation,
    forceManyBody,
    forceLink,
    forceCenter,
    forceCollide,
    type Simulation,
  } from 'd3-force'
  import { traceStore } from '../stores/trace'
  import { visibleGoroutines } from '../lib/filter'
  import { buildGraphModel, type GraphNode, type GraphLink } from '../lib/graphModel'
  import { stateAt, activeEdges } from '../lib/activeAt'
  import { stateColor, DIM_COLOR, categoryColor, goroutineLabel } from '../lib/format'
  import { edgesCrossed, cometPoint, FLASH_MS, MAX_PARTICLES } from '../lib/flash'
  import type { Goroutine, CausalEdge } from '../lib/types'
  import { nodeAtPoint, distToSegment } from '../lib/hit'
  import { nodeTooltip, edgeTooltip } from '../lib/tooltip'

  const { summary, playhead, showSystem, selectedId } = traceStore

  let container: HTMLDivElement
  let canvas: HTMLCanvasElement
  let cssWidth = 600
  let cssHeight = 360

  let nodes: GraphNode[] = []
  let links: GraphLink[] = []
  let goroutineById = new Map<number, Goroutine>()
  let nodeById = new Map<number, GraphNode>()
  let sim: Simulation<GraphNode, GraphLink> | undefined
  let tip: { text: string; x: number; y: number } | null = null

  // Flash state: comets in flight + last playhead for crossing detection.
  type Comet = { from: GraphNode; to: GraphNode; color: string; start: number }
  let comets: Comet[] = []
  let prevT: number | null = null
  let animId = 0

  // Rebuild the graph + simulation ONLY when the visible node set changes
  // (summary or filter) — never on playhead, so the layout stays stable.
  $: rebuild($summary ? visibleGoroutines($summary, $showSystem) : [], $summary?.edges ?? [])

  function rebuild(goroutines: Goroutine[], edges: CausalEdge[]) {
    goroutineById = new Map(goroutines.map((g) => [g.id, g]))
    const model = buildGraphModel(goroutines, edges)
    nodes = model.nodes
    links = model.links
    nodeById = new Map(nodes.map((n) => [n.id, n]))
    comets = []
    prevT = null // re-arm crossing detection for the new node set
    sim?.stop()
    if (nodes.length === 0) {
      draw()
      return
    }
    sim = forceSimulation<GraphNode>(nodes)
      .force('charge', forceManyBody().strength(-120))
      .force('link', forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance(60))
      .force('center', forceCenter(cssWidth / 2, cssHeight / 2))
      .force('collide', forceCollide(16))
      .on('tick', draw)
  }

  // Spawn comets when the playhead moves FORWARD across edge fire times.
  $: onPlayheadChange($playhead)

  function onPlayheadChange(t: number) {
    if (prevT === null) {
      prevT = t
      return
    }
    if (t > prevT && $summary) {
      for (const e of edgesCrossed($summary.edges, prevT, t)) {
        if (comets.length >= MAX_PARTICLES) break
        const a = nodeById.get(e.from)
        const b = nodeById.get(e.to)
        if (!a || !b) continue
        comets.push({ from: a, to: b, color: categoryColor(e.category), start: performance.now() })
      }
      if (comets.length) ensureAnim()
    }
    prevT = t
  }

  function ensureAnim() {
    if (!animId && typeof requestAnimationFrame !== 'undefined') {
      animId = requestAnimationFrame(animTick)
    }
  }
  function animTick(now: number) {
    comets = comets.filter((c) => now - c.start < FLASH_MS)
    draw()
    if (comets.length && typeof requestAnimationFrame !== 'undefined') {
      animId = requestAnimationFrame(animTick)
    } else {
      animId = 0
    }
  }

  // Redraw (recolor + comets) on time/selection change. Does NOT touch the sim.
  $: void [$playhead, $selectedId], draw()

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

    const t = $playhead
    const span = $summary ? $summary.endTime - $summary.startTime : 0
    const win = span * 0.03
    const active = $summary ? new Set(activeEdges($summary.edges, t, win).map((e) => `${e.from}->${e.to}`)) : new Set<string>()
    const catByPair = new Map<string, string>()
    if ($summary) for (const e of $summary.edges) catByPair.set(`${e.from}->${e.to}`, e.category)

    // Edges first (under nodes). Active edges take their category color.
    for (const l of links) {
      const s = l.source as unknown as GraphNode
      const tg = l.target as unknown as GraphNode
      if (s.x == null || tg.x == null) continue
      const key = `${s.id}->${tg.id}`
      const isActive = active.has(key)
      ctx.strokeStyle = isActive ? categoryColor((catByPair.get(key) as any) ?? l.category) : DIM_COLOR
      ctx.lineWidth = isActive ? 2.5 : 1
      ctx.beginPath()
      ctx.moveTo(s.x, s.y!)
      ctx.lineTo(tg.x, tg.y!)
      ctx.stroke()
    }

    // Nodes.
    for (const n of nodes) {
      if (n.x == null) continue
      const g = goroutineById.get(n.id)
      const st = g ? stateAt(g, t) : null
      ctx.fillStyle = st ? stateColor(st) : DIM_COLOR // dim if not alive at t
      ctx.beginPath()
      ctx.arc(n.x, n.y!, 9, 0, Math.PI * 2)
      ctx.fill()
      if (n.id === $selectedId) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }

    // Comets + arrival rings (on top).
    const nowMs = typeof performance !== 'undefined' ? performance.now() : 0
    for (const c of comets) {
      if (c.from.x == null || c.to.x == null) continue
      const p = Math.min(1, (nowMs - c.start) / FLASH_MS)
      // Trailing dots behind the lead for a comet look.
      const lead = [
        { off: 0, r: 5, a: 1 },
        { off: -0.06, r: 3.5, a: 0.5 },
        { off: -0.12, r: 2.5, a: 0.25 },
      ]
      for (const d of lead) {
        const pp = p + d.off
        if (pp < 0) continue
        const pt = cometPoint(pp, c.from.x, c.from.y!, c.to.x, c.to.y!)
        ctx.globalAlpha = d.a
        ctx.fillStyle = c.color
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      // Arrival ring in the last 30% of travel.
      if (p > 0.7) {
        const rp = (p - 0.7) / 0.3
        ctx.globalAlpha = 1 - rp
        ctx.strokeStyle = c.color
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(c.to.x, c.to.y!, 9 + rp * 16, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }
  }

  function labelOf(id: number): string {
    const g = goroutineById.get(id)
    return g ? goroutineLabel(g) : `g${id}`
  }
  function onClick(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect()
    const n = nodeAtPoint(nodes, e.clientX - rect.left, e.clientY - rect.top, 10)
    if (n) traceStore.toggleSelected(n.id)
  }
  function onPointerMove(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const n = nodeAtPoint(nodes, px, py, 10)
    if (n) {
      const g = goroutineById.get(n.id)
      tip = { text: nodeTooltip(n.label, g ? stateAt(g, $playhead) : null), x: px, y: py }
      return
    }
    let best: { l: GraphLink; d: number } | null = null
    for (const l of links) {
      const s = l.source as unknown as GraphNode
      const t = l.target as unknown as GraphNode
      if (s.x == null || t.x == null) continue
      const d = distToSegment(px, py, s.x, s.y!, t.x, t.y!)
      if (d <= 5 && (!best || d < best.d)) best = { l, d }
    }
    if (best) {
      const s = best.l.source as unknown as GraphNode
      const t = best.l.target as unknown as GraphNode
      tip = { text: edgeTooltip(best.l.category, labelOf(s.id), labelOf(t.id)), x: px, y: py }
    } else {
      tip = null
    }
  }
  function onPointerLeave() {
    tip = null
  }

  onMount(() => {
    const measure = () => {
      cssWidth = container.clientWidth || cssWidth
      cssHeight = container.clientHeight || cssHeight
      sim?.force('center', forceCenter(cssWidth / 2, cssHeight / 2))
      sim?.alpha(0.3).restart()
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    draw()
    return () => ro.disconnect()
  })
  onDestroy(() => {
    sim?.stop()
    if (animId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animId)
  })
</script>

<div bind:this={container} class="graph-wrap" on:pointerleave={onPointerLeave}>
  <canvas
    bind:this={canvas}
    on:click={onClick}
    on:pointermove={onPointerMove}
    style="width:100%; display:block; cursor:pointer;"
  ></canvas>
  {#if tip}
    <div class="tip" style="left:{tip.x + 12}px; top:{tip.y + 12}px">{tip.text}</div>
  {/if}
</div>

<style>
  .graph-wrap { width: 100%; height: 100%; min-height: 280px; position: relative; }
  .tip {
    position: absolute; pointer-events: none; white-space: pre; z-index: 10;
    background: #161922; color: #cdd3df; border: 1px solid #2a2e38;
    border-radius: 4px; padding: 4px 8px; font-size: 12px; line-height: 1.35;
  }
</style>
