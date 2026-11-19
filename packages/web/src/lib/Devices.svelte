<script lang="ts">
  /**
   * Server mode: the computers allowed to send data. Each gets a token, shown once, that goes in the
   * agent's settings on that computer (or in Deuchan). Revoking a device stops its token; its data stays.
   */
  import type { DeviceInfo } from "@mosaik/shared";
  import { onMount } from "svelte";
  import { ApiError, createDevice, getDevices, revokeDevice, setDeviceLabel } from "./api";

  let devices = $state<DeviceInfo[]>([]);
  let name = $state("");
  let created = $state<{ name: string; token: string } | null>(null);
  let copied = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const dateTime = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });
  const when = (ms: number | null) => (ms === null ? "nunca" : dateTime.format(ms));

  async function refresh() {
    try {
      devices = (await getDevices()).devices;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function add(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = null;
    copied = false;
    try {
      created = await createDevice(name.trim());
      name = "";
      await refresh();
    } catch (cause) {
      error =
        cause instanceof ApiError && cause.code === "device_exists"
          ? "Ya hay un dispositivo con ese nombre"
          : cause instanceof ApiError && cause.code === "invalid_name"
            ? "Usá letras, números, espacios, puntos o guiones"
            : "No se pudo crear el dispositivo";
    } finally {
      busy = false;
    }
  }

  async function revoke(device: string) {
    if (!confirm(`¿Revocar «${device}»? Su token deja de funcionar; lo que ya mandó se queda.`)) return;
    await revokeDevice(device);
    await refresh();
  }

  // The name stays (it is the key of the device's data); the label is how it is shown
  async function relabel(device: DeviceInfo) {
    const answer = prompt(
      `¿Cómo querés que se vea «${device.name}»? Vacío para usar su nombre.`,
      device.label ?? device.name,
    );
    if (answer === null) return;
    const label = answer.trim();
    error = null;
    try {
      await setDeviceLabel(device.name, label === "" || label === device.name ? null : label);
      await refresh();
    } catch (cause) {
      error =
        cause instanceof ApiError && cause.code === "invalid_label"
          ? "Usá letras, números, espacios, puntos o guiones"
          : "No se pudo cambiar cómo se ve";
    }
  }

  async function copy() {
    if (!created) return;
    await navigator.clipboard.writeText(created.token);
    copied = true;
  }

  onMount(() => void refresh());
</script>

<section class="card" aria-labelledby="devices-title">
  <h2 id="devices-title">Dispositivos</h2>
  <p class="note">
    Cada computadora que manda datos (el agente que lee Anki y GSM, o Deuchan) usa su propio token. El nombre
    es el que vas a ver en las fuentes, por ejemplo «notebook». Con «Cambiar» elegís cómo se ve, sin tocar sus
    datos; dos dispositivos de la misma computadora (el agente y Deuchan) pueden verse igual.
  </p>

  <form class="add" onsubmit={add}>
    <input
      type="text"
      bind:value={name}
      placeholder="Nombre de la computadora"
      aria-label="Nombre de la computadora"
      maxlength="64"
      required
    />
    <button type="submit" disabled={busy || name.trim() === ""}>Crear token</button>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if created}
    <div class="token" role="status">
      <p>Token de <strong>{created.name}</strong>. Guardalo ahora: no se vuelve a mostrar.</p>
      <div class="token-row">
        <code>{created.token}</code>
        <button type="button" onclick={copy}>{copied ? "Copiado" : "Copiar"}</button>
      </div>
    </div>
  {/if}

  {#if devices.length > 0}
    <table>
      <thead>
        <tr>
          <th scope="col">Nombre</th>
          <th scope="col">Se ve como</th>
          <th scope="col">Creado</th>
          <th scope="col">Último envío</th>
          <th scope="col"><span class="visually-hidden">Acciones</span></th>
        </tr>
      </thead>
      <tbody>
        {#each devices as device (device.name)}
          <tr class:revoked={device.revokedAt !== null}>
            <td>{device.name}</td>
            <td>
              {device.label ?? device.name}
              <button type="button" class="quiet" onclick={() => relabel(device)}>Cambiar</button>
            </td>
            <td class="meta">{when(device.createdAt)}</td>
            <td class="meta">{when(device.lastSeenAt)}</td>
            <td class="actions">
              {#if device.revokedAt === null}
                <button type="button" class="quiet" onclick={() => revoke(device.name)}>Revocar</button>
              {:else}
                <span class="meta">revocado</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .add {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }

  input {
    flex: 1;
    max-width: 320px;
    font: inherit;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    border: 1px solid var(--border-strong);
    background: var(--bg);
    color: var(--text);
  }

  button {
    font: inherit;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    border: 1px solid var(--border-strong);
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .quiet {
    border-color: transparent;
    background: none;
    color: var(--muted);
  }

  .quiet:hover {
    color: var(--text);
  }

  .token {
    margin-bottom: 16px;
    padding: 12px 16px;
    border-radius: var(--radius-control);
    border: 1px solid var(--border-strong);
    background: var(--surface-2);
  }

  .token p {
    margin: 0 0 8px;
  }

  .token-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .token code {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: var(--mono);
    font-size: 0.8571rem;
  }

  .actions {
    text-align: right;
  }

  .revoked td:first-child {
    color: var(--muted);
  }
</style>
