<script lang="ts">
  /**
   * Server mode: log in, or create the account the first time (with the setup token the server was
   * started with).
   */
  import { ApiError, login, setupAccount } from "../lib/api";
  import { refreshAuth } from "../lib/auth.svelte";

  let { setup }: { setup: boolean } = $props();

  let token = $state("");
  let username = $state("");
  let password = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  function message(cause: unknown): string {
    if (!(cause instanceof ApiError)) return "No se pudo conectar con Mosaik";
    switch (cause.code) {
      case "invalid_credentials":
        return "Usuario o contraseña incorrectos";
      case "too_many_attempts": {
        const minutes = Math.max(1, Math.ceil(Number(cause.body.retryAfterSeconds ?? 60) / 60));
        return `Demasiados intentos. Probá de nuevo en ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
      }
      case "invalid_setup_token":
        return "El token de instalación no coincide con el del servidor";
      case "setup_disabled":
        return "El servidor no tiene SETUP_TOKEN: agregalo a sus variables para crear la cuenta";
      case "weak_password":
        return `La contraseña necesita al menos ${String(cause.body.minLength ?? 10)} caracteres`;
      case "invalid_username":
        return "Elegí un nombre de usuario";
      case "already_set_up":
        return "La cuenta ya existe: entrá con tu usuario";
      default:
        return `Algo falló (${cause.status})`;
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = null;
    try {
      if (setup) await setupAccount(token.trim(), username, password);
      else await login(username, password);
      await refreshAuth();
    } catch (cause) {
      error = message(cause);
    } finally {
      busy = false;
    }
  }
</script>

<main class="login">
  <form class="panel" onsubmit={submit}>
    <div class="brand">
      <span class="tiles" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      Mosaik
    </div>
    <h1>{setup ? "Crear la cuenta" : "Entrar"}</h1>
    {#if setup}
      <p class="note">
        Es la única cuenta de este Mosaik. El token de instalación es el valor de <code>SETUP_TOKEN</code> en el
        servidor; después de crear la cuenta ya no sirve.
      </p>
      <label>
        Token de instalación
        <input type="password" bind:value={token} autocomplete="off" required />
      </label>
    {/if}
    <label>
      Usuario
      <input type="text" bind:value={username} autocomplete="username" required />
    </label>
    <label>
      Contraseña
      <input
        type="password"
        bind:value={password}
        autocomplete={setup ? "new-password" : "current-password"}
        minlength={setup ? 10 : undefined}
        required
      />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button type="submit" disabled={busy}>{busy ? "Un momento…" : setup ? "Crear cuenta" : "Entrar"}</button>
  </form>
</main>

<style>
  .login {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px 16px;
    box-sizing: border-box;
  }

  .panel {
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 32px 24px;
    border-radius: var(--radius-card);
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 1.1429rem;
    font-weight: 500;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(2, 8px);
    gap: 2px;
  }

  .tiles i {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--series-gsm);
  }

  .tiles i:nth-child(2) {
    background: var(--series-youtube);
  }

  .tiles i:nth-child(3) {
    background: var(--series-refold);
  }

  .tiles i:nth-child(4) {
    background: var(--accent);
  }

  h1 {
    margin: 8px 0 0;
    font-size: 1.5rem;
  }

  .note {
    margin: 0;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: var(--secondary);
  }

  input {
    font: inherit;
    height: 36px;
    padding: 0 12px;
    border-radius: var(--radius-control);
    border: 1px solid var(--border-strong);
    background: var(--bg);
    color: var(--text);
  }

  .error {
    margin: 0;
  }

  button {
    font: inherit;
    font-weight: 500;
    height: 40px;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--accent);
    color: var(--on-accent);
    cursor: pointer;
    transition: filter 150ms var(--ease);
  }

  button:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
