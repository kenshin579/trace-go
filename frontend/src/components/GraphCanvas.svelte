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
  import { stateColor, DIM_COLOR, EDGE_ACTIVE_COLOR } from '../lib/format'
  import type { Goroutine, CausalEdge } from '../lib/types'

  const { summary, playhead, showSystem, selectedId } = traceStore

  let container: HTMLDivElement
  let canvas: HTMLCanvasElement
  let cssWidth = 600
  let cssHeight = 360

  let nodes: GraphNode[] = []
  let links: GraphLink[] = []
  let goroutineById = new Map<number, Goroutine>()
  let sim: Simulation<GraphNode, GraphLink> | undefined

  // Rebuild the graph + simulation ONLY when the visible node set changes
  // (summary or filter) — never on playhead, so the layout stays stable.
  $: rebuild($summary ? visibleGoroutines($summary, $showSystem) : [], $summary?.edges ?? [])

  function rebuild(goroutines: Goroutine[], edges: CausalEdge[]) {
    goroutineById = new Map(goroutines.map((g) => [g.id, g]))
    const model = buildGraphModel(goroutines, edges)
    nodes = model.nodes
    links = model.links
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

  // Redraw (recolor + active-edge emphasis) on time/selection change. Does NOT
  // touch the simulation, so node positions are preserved.
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

    // Edges first (under nodes).
    for (const l of links) {
      const s = l.source as unknown as GraphNode
      const tg = l.target as unknown as GraphNode
      if (s.x == null || tg.x == null) continue
      const isActive = active.has(`${s.id}->${tg.id}`)
      ctx.strokeStyle = isActive ? EDGE_ACTIVE_COLOR : DIM_COLOR
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
  }

  function nodeAt(px: number, py: number): GraphNode | undefined {
    return nodes.find((n) => n.x != null && Math.hypot(n.x - px, n.y! - py) <= 10)
  }
  function onClick(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect()
    const n = nodeAt(e.clientX - rect.left, e.clientY - rect.top)
    if (n) traceStore.toggleSelected(n.id)
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
  onDestroy(() => sim?.stop())
</script>

<div bind:this={container} class="graph-wrap">
  <canvas bind:this={canvas} on:click={onClick} style="width:100%; display:block; cursor:pointer;"></canvas>
</div>

<style>
  .graph-wrap { width: 100%; height: 100%; min-height: 280px; }
</style>
