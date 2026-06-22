<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import {
    forceSimulation,
    forceManyBody,
    forceLink,
    forceCenter,
    forceCollide,
    forceX,
    forceY,
    type Simulation,
  } from 'd3-force'
  import { traceStore } from '../stores/trace'
  import { visibleGoroutines } from '../lib/filter'
  import type { GraphNode, GraphLink } from '../lib/graphModel'
  import { stateAt, activeEdges } from '../lib/activeAt'
  import { stateColor, DIM_COLOR, categoryColor, goroutineLabel, taskColor } from '../lib/format'
  import { clusterByTask, convexHull } from '../lib/graphCluster'
  import { edgesCrossed, cometPoint, FLASH_MS, MAX_PARTICLES } from '../lib/flash'
  import type { Goroutine, CausalEdge } from '../lib/types'
  import { nodeAtPoint, distToSegment } from '../lib/hit'
  import { nodeTooltip, edgeTooltip } from '../lib/tooltip'
  import { causalNeighbors } from '../lib/causalFocus'
  import { collapseGraph } from '../lib/graphCollapse'
  import { groupGoroutines } from '../lib/grouping'

  const { summary, playhead, showSystem, selectedId, collapsedGroups, toggleGroup } = traceStore

  let container: HTMLDivElement
  let canvas: HTMLCanvasElement
  let cssWidth = 600
  let cssHeight = 360
  const GHOST_ALPHA = 0.15
  const GROUP_NODE_COLOR = '#7a8290'

  let nodes: GraphNode[] = []
  let links: GraphLink[] = []
  let goroutineById = new Map<number, Goroutine>()
  let nodeById = new Map<number, GraphNode>()
  let remap = new Map<number, number>()
  let clusterSeeds = new Map<number, { x: number; y: number }>()
  let sim: Simulation<GraphNode, GraphLink> | undefined
  let tip: { text: string; x: number; y: number } | null = null

  // Flash state: comets in flight + last playhead for crossing detection.
  type Comet = { from: GraphNode; to: GraphNode; color: string; start: number }
  let comets: Comet[] = []
  let prevT: number | null = null
  let animId = 0

  // Rebuild the graph + simulation ONLY when the visible node set changes
  // (summary or filter) — never on playhead, so the layout stays stable.
  $: rebuild($summary ? visibleGoroutines($summary, $showSystem) : [], $summary?.edges ?? [], $collapsedGroups)

  function rebuild(goroutines: Goroutine[], edges: CausalEdge[], collapsedKeys: Set<string>) {
    goroutineById = new Map(goroutines.map((g) => [g.id, g]))
    const collapsed = collapseGraph(goroutines, edges, groupGoroutines(goroutines), collapsedKeys)
    nodes = collapsed.nodes
    links = collapsed.links
    remap = collapsed.remap
    nodeById = new Map(nodes.map((n) => [n.id, n]))
    const known = new Set(($summary?.tasks ?? []).map((t) => t.id))
    const clusters = clusterByTask(goroutines, known)
    // Cluster only individual nodes; super-nodes carry no task cluster (excluded from hulls).
    for (const n of nodes) n.cluster = n.group ? undefined : clusters.get(n.id)
    const clusterIds = [...new Set([...clusters.values()])]
    clusterSeeds = new Map()
    clusterIds.forEach((cid, i) => {
      const ang = clusterIds.length ? (i / clusterIds.length) * Math.PI * 2 : 0
      clusterSeeds.set(cid, { x: cssWidth / 2 + Math.cos(ang) * cssWidth * 0.28, y: cssHeight / 2 + Math.sin(ang) * cssHeight * 0.28 })
    })
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
      .force('cx', forceX<GraphNode>((n) => (n.cluster != null ? clusterSeeds.get(n.cluster)!.x : cssWidth / 2)).strength((n) => (n.cluster != null ? 0.2 : 0.03)))
      .force('cy', forceY<GraphNode>((n) => (n.cluster != null ? clusterSeeds.get(n.cluster)!.y : cssHeight / 2)).strength((n) => (n.cluster != null ? 0.2 : 0.03)))
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
        const a = nodeById.get(remap.get(e.from) ?? e.from)
        const b = nodeById.get(remap.get(e.to) ?? e.to)
        if (!a || !b || a === b) continue // skip if either endpoint is hidden or both fold into one super-node
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
  $: chain = $summary && $selectedId !== null ? causalNeighbors($summary.edges, $selectedId) : null
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

    // Static task-cluster hulls (background layer).
    const byCluster = new Map<number, GraphNode[]>()
    for (const n of nodes) {
      if (n.cluster == null || n.x == null) continue
      const arr = byCluster.get(n.cluster)
      if (arr) arr.push(n)
      else byCluster.set(n.cluster, [n])
    }
    const taskName = new Map<number, string>(($summary?.tasks ?? []).map((t) => [t.id, t.name]))
    for (const [cid, members] of byCluster) {
      ctx.globalAlpha = chain && !members.some((n) => chain.has(n.id)) ? GHOST_ALPHA : 1
      const pts = members.map((n) => [n.x!, n.y!] as [number, number])
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
      const padded = pts.map(([px, py]) => {
        const dx = px - cx
        const dy = py - cy
        const len = Math.hypot(dx, dy) || 1
        return [px + (dx / len) * 22, py + (dy / len) * 22] as [number, number]
      })
      const hull = convexHull(padded)
      if (hull.length >= 3) {
        ctx.beginPath()
        ctx.moveTo(hull[0][0], hull[0][1])
        for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i][0], hull[i][1])
        ctx.closePath()
        ctx.fillStyle = taskColor(cid) + '22'
        ctx.fill()
        ctx.strokeStyle = taskColor(cid)
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      ctx.fillStyle = taskColor(cid)
      ctx.font = '10px system-ui, sans-serif'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(taskName.get(cid) ?? `task ${cid}`, cx - 20, cy - 24)
      ctx.globalAlpha = 1
    }

    const t = $playhead
    const span = $summary ? $summary.endTime - $summary.startTime : 0
    const win = span * 0.03
    const active = !chain && $summary ? new Set(activeEdges($summary.edges, t, win).map((e) => `${e.from}->${e.to}`)) : new Set<string>()

    // Edges first (under nodes). When a node is selected, focus mode emphasizes
    // the selected node's incident (chain) edges and ghosts the rest; otherwise
    // the playhead-window "active" coloring applies.
    for (const l of links) {
      const s = l.source as unknown as GraphNode
      const tg = l.target as unknown as GraphNode
      if (s.x == null || tg.x == null) continue
      if (chain) {
        // Incident = directly touches the selected node (its unblockers/unblockees);
        // edges between two chain peers are intentionally not emphasized.
        const incident = s.id === $selectedId || tg.id === $selectedId
        ctx.globalAlpha = incident ? 1 : GHOST_ALPHA
        ctx.strokeStyle = incident ? categoryColor(l.category) : DIM_COLOR
        ctx.lineWidth = incident ? 2.5 : 1
      } else {
        const isActive = active.has(`${s.id}->${tg.id}`)
        ctx.globalAlpha = 1
        ctx.strokeStyle = isActive ? categoryColor(l.category) : DIM_COLOR
        ctx.lineWidth = isActive ? 2.5 : 1
      }
      ctx.beginPath()
      ctx.moveTo(s.x, s.y!)
      ctx.lineTo(tg.x, tg.y!)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // Nodes. Super-nodes (collapsed groups) draw in a fixed neutral color with a
    // ring + label; individual nodes keep their state-at-t color. In focus mode a
    // super-node stays bright if any member is in the chain.
    for (const n of nodes) {
      if (n.x == null) continue
      const inChain = !chain ? true : n.group ? n.group.memberIds.some((id) => chain.has(id)) : chain.has(n.id)
      ctx.globalAlpha = inChain ? 1 : GHOST_ALPHA
      if (n.group) {
        ctx.fillStyle = GROUP_NODE_COLOR
        ctx.beginPath()
        ctx.arc(n.x, n.y!, 9, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.fillStyle = '#cdd3df'
        ctx.font = '10px system-ui, sans-serif'
        ctx.textBaseline = 'middle'
        ctx.fillText(n.label, n.x + 12, n.y!)
      } else {
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
    ctx.globalAlpha = 1

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
    if (!n) return
    if (n.group) toggleGroup(n.group.key) // clicking a super-node expands the group
    else traceStore.toggleSelected(n.id)
  }
  function onPointerMove(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const n = nodeAtPoint(nodes, px, py, 10)
    if (n) {
      if (n.group) {
        tip = { text: n.label, x: px, y: py }
      } else {
        const g = goroutineById.get(n.id)
        tip = { text: nodeTooltip(n.label, g ? stateAt(g, $playhead) : null), x: px, y: py }
      }
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
