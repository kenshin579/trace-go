<script lang="ts">
  import { stateColor } from '../lib/format'

  const states: { label: string; color: string }[] = [
    { label: 'running', color: stateColor('running') },
    { label: 'runnable', color: stateColor('runnable') },
    { label: 'blocked', color: stateColor('blocked') },
    { label: 'not alive', color: '#2a2e38' },
  ]
</script>

<div class="legend">
  {#each states as s}
    <span class="item"><span class="swatch" style="background:{s.color}"></span>{s.label}</span>
  {/each}
  <span class="item"><span class="edge active"></span>edge (firing now)</span>
  <span class="item"><span class="edge"></span>edge (inferred link)</span>
</div>

<style>
  .legend { display: flex; flex-wrap: wrap; gap: 14px; padding: 6px 14px; border-top: 1px solid #2a2e38; font-size: 12px; color: #8a93a3; }
  .item { display: flex; align-items: center; gap: 6px; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  .edge { width: 16px; height: 0; border-top: 2px solid #2a2e38; display: inline-block; }
  .edge.active { border-top-color: #5b8def; }
</style>
