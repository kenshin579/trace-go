<script lang="ts">
  import { OpenTraceDialog } from '../wailsjs/go/main/App'
  import { traceStore } from './stores/trace'
  import type { TraceSummary } from './lib/types'
  import TimelineCanvas from './components/TimelineCanvas.svelte'
  import Controls from './components/Controls.svelte'
  import GraphCanvas from './components/GraphCanvas.svelte'
  import Legend from './components/Legend.svelte'

  const { summary } = traceStore
  let error = ''
  let loading = false

  async function open() {
    error = ''
    loading = true
    try {
      const s = (await OpenTraceDialog()) as unknown as TraceSummary | null
      if (s) traceStore.loadSummary(s)
    } catch (e) {
      error = String(e)
    } finally {
      loading = false
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.code !== 'Space' || !$summary) return
    // If a control (button/select/checkbox) is focused, let its native Space
    // activation handle it — otherwise both fire and the toggle cancels out.
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return
    e.preventDefault()
    traceStore.toggle()
  }
</script>

<svelte:window on:keydown={onKeydown} />

<main>
  <header>
    <button on:click={open} disabled={loading}>Open trace…</button>
    {#if $summary}
      <span class="info">
        {$summary.goroutines.length} goroutines · {$summary.edges.length} edges ·
        {(($summary.endTime - $summary.startTime) / 1e6).toFixed(1)} ms
      </span>
      <Controls />
    {/if}
    {#if error}<span class="error">{error}</span>{/if}
  </header>

  {#if $summary}
    <section class="timeline"><TimelineCanvas /></section>
    <section class="graph"><GraphCanvas /></section>
  {:else}
    <section class="empty">Open a Go execution trace (.out) to begin.</section>
  {/if}
  {#if $summary}<Legend />{/if}
</main>

<style>
  main { font-family: system-ui, sans-serif; color: #cdd3df; background: #0f1117; height: 100vh; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #2a2e38; }
  button { background: #5b8def; color: white; border: 0; padding: 6px 12px; border-radius: 6px; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; }
  .info { font-size: 13px; color: #8a93a3; }
  .error { color: #c25450; font-size: 13px; }
  .timeline { flex: 0 0 42%; overflow: auto; border-bottom: 1px solid #2a2e38; }
  .graph { flex: 1; min-height: 0; }
  .empty { flex: 1; display: flex; align-items: center; justify-content: center; color: #5b6270; }
</style>
