<script lang="ts">
  import { stateColor, DIM_COLOR, categoryColor } from '../lib/format'

  const states: { label: string; color: string }[] = [
    { label: 'running', color: stateColor('running') },
    { label: 'runnable', color: stateColor('runnable') },
    { label: 'blocked', color: stateColor('blocked') },
    { label: 'not alive', color: DIM_COLOR },
  ]
  const edges: { label: string; color: string }[] = [
    { label: 'channel', color: categoryColor('channel') },
    { label: 'mutex', color: categoryColor('mutex') },
    { label: 'other', color: categoryColor('other') },
  ]
</script>

<div class="legend">
  {#each states as s}
    <span class="item"><span class="swatch" style="background:{s.color}"></span>{s.label}</span>
  {/each}
  {#each edges as e}
    <span class="item"><span class="edge" style="border-top-color:{e.color}"></span>{e.label} (inferred)</span>
  {/each}
  <span class="item"><span class="edge" style="border-top-color:{DIM_COLOR}"></span>inferred link</span>
</div>

<style>
  .legend { display: flex; flex-wrap: wrap; gap: 14px; padding: 6px 14px; border-top: 1px solid #2a2e38; font-size: 12px; color: #8a93a3; }
  .item { display: flex; align-items: center; gap: 6px; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  .edge { width: 16px; height: 0; border-top: 2px solid; display: inline-block; }
</style>
