<script lang="ts">
  import { traceStore } from '../stores/trace'

  const { playing, speed, showSystem } = traceStore
  const SPEEDS = [0.25, 0.5, 1, 2, 4]

  function onSpeed(e: Event) {
    traceStore.setSpeed(Number((e.target as HTMLSelectElement).value))
  }
  function onSystem(e: Event) {
    traceStore.setShowSystem((e.target as HTMLInputElement).checked)
  }
</script>

<div class="controls">
  <button class="play" on:click={() => traceStore.toggle()} title="Play/Pause (Space)">
    {$playing ? '⏸' : '▶'}
  </button>

  <label class="speed">
    Speed
    <select on:change={onSpeed} value={$speed}>
      {#each SPEEDS as s}
        <option value={s}>{s}×</option>
      {/each}
    </select>
  </label>

  <label class="sys">
    <input type="checkbox" checked={$showSystem} on:change={onSystem} />
    Show system goroutines
  </label>
</div>

<style>
  .controls { display: flex; align-items: center; gap: 14px; }
  .play { background: #2a2e38; color: #cdd3df; border: 0; width: 30px; height: 30px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .speed, .sys { font-size: 13px; color: #8a93a3; display: flex; align-items: center; gap: 6px; }
  select { background: #161922; color: #cdd3df; border: 1px solid #2a2e38; border-radius: 4px; padding: 2px 4px; }
</style>
