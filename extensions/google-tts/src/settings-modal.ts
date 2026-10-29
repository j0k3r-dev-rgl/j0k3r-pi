import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { backgroundAnsi, foregroundAnsi, getTerminalColorMode, Input, SelectList, rgbColor, truncateToWidth, type Focusable, type TUI, type SelectItem } from "@earendil-works/pi-tui";
import { validatePreferences, type TTSPreferences } from "./config.js";
import type { VoiceCatalog, VoicePage } from "./tts-service.js";

// Native dialogs cannot provide the requested persistent, padded black overlay;
// use native Input/SelectList inside a small width-safe custom frame instead.
export async function openSettings(ctx: ExtensionCommandContext, preferences: TTSPreferences, listVoices: VoiceCatalog): Promise<TTSPreferences | undefined> {
  return ctx.ui.custom<TTSPreferences | undefined>(
    (tui, theme, _keys, done) => new SettingsModal(tui, theme, preferences, done, listVoices),
    { overlay: true, overlayOptions: { width: 72, maxHeight: "95%", anchor: "center", margin: 1 } },
  );
}

type Screen = "main" | "output" | "device" | "voices";
type EditField = "voice" | "search" | "style" | "speed" | "location" | "maxCharacters" | "deviceName" | "devicePort";

export class SettingsModal implements Focusable {
  private value: TTSPreferences;
  private screen: Screen = "main";
  private list!: SelectList;
  private input?: Input;
  private selectedDevice = "";
  private draftName = "";
  private message = "";
  private _focused = false;
  private tui: TUI;
  private theme: Theme;
  private done: (value: TTSPreferences | undefined) => void;
  private menuRows = 0;
  private listVoices?: VoiceCatalog;
  private voicePage: VoicePage = { voices: [] };
  private voiceSearch = "";
  private pageToken?: string;
  private previousPages: (string | undefined)[] = [];
  private voiceLoading = false;
  private voiceError = "";
  private voiceRequest?: AbortController;
  private disposed = false;

  constructor(tui: TUI, theme: Theme, preferences: TTSPreferences, done: (value: TTSPreferences | undefined) => void, listVoices?: VoiceCatalog) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.listVoices = listVoices;
    this.value = structuredClone(preferences);
    this.showMain();
  }

  get focused() { return this._focused; }
  set focused(value: boolean) { this._focused = value; if (this.input) this.input.focused = value; }

  private menu(items: SelectItem[], action: (value: string) => void, back: () => void, selected = "") {
    const t = this.theme;
    this.input = undefined;
    this.menuRows = this.tui.terminal.rows;
    const maxHeight = Math.min(Math.floor(this.menuRows * 0.95), this.menuRows - 2);
    // Reserve space for borders, title, hint, optional message, and the scroll indicator.
    this.list = new SelectList(items, Math.max(1, maxHeight - 6), {
      selectedPrefix: text => t.style(text, { fg: rgbColor(100, 210, 255) }), selectedText: text => t.style(text, { fg: rgbColor(100, 210, 255) }),
      description: text => t.fg("dim", text), scrollInfo: text => t.fg("dim", text), noMatch: text => t.fg("dim", text),
    });
    this.list.setSelectedIndex(Math.max(0, items.findIndex(item => item.value === selected)));
    this.list.onSelect = item => action(item.value);
    this.list.onCancel = back;
  }

  private showMain(selected = "") {
    this.screen = "main";
    const c = this.value.config;
    const items = [
      { value: "enabled", label: `TTS: ${c.enabled ? "activado" : "desactivado"}` },
      { value: "autoRead", label: `Activar lectura automática: ${this.value.autoRead ? "sí" : "no"}` },
      { value: "model", label: `Modelo: ${c.model}` },
      { value: "voice", label: `Voz: ${c.voice}` },
      { value: "style", label: `Estilo: ${c.style}` },
      { value: "speed", label: `Velocidad: ${c.speed}x` },
      { value: "location", label: `Ubicación: ${c.location}` },
      { value: "maxCharacters", label: `Máximo de caracteres: ${c.maxCharacters}` },
      { value: "output", label: `Salida: ${this.value.output ?? "Entorno predeterminado"}` },
      { value: "save", label: "Guardar y cerrar" },
      { value: "cancel", label: "Cancelar cambios" },
    ];
    this.menu(items, choice => {
      this.message = "";
      if (choice === "enabled") { c.enabled = !c.enabled; this.showMain(choice); }
      else if (choice === "autoRead") { this.value.autoRead = !this.value.autoRead; this.showMain(choice); }
      else if (choice === "model") { c.model = c.model === "gemini-3.8-flash-lite-tts" ? "gemini-3.8-flash-tts" : "gemini-3.8-flash-lite-tts"; this.showMain(choice); }
      else if (choice === "output") this.showOutput();
      else if (choice === "voice") { this.voiceSearch = ""; this.previousPages = []; this.pageToken = undefined; void this.loadVoices(); }
      else if (choice === "save") { try { this.done(validatePreferences(this.value)); } catch (error) { this.message = (error as Error).message; } }
      else if (choice === "cancel") this.done(undefined);
      else if (choice === "style" || choice === "speed" || choice === "location" || choice === "maxCharacters") this.edit(choice, String(c[choice]));
    }, () => this.done(undefined), selected);
  }

  private async loadVoices(search = this.voiceSearch, pageToken?: string, history = this.previousPages) {
    this.voiceRequest?.abort();
    const controller = new AbortController();
    this.voiceRequest = controller;
    this.voiceLoading = true;
    this.voiceError = "";
    this.voicePage = { voices: [] };
    this.voiceSearch = search;
    this.pageToken = pageToken;
    this.previousPages = history;
    this.screen = "voices";
    this.showVoices();
    this.tui.requestRender();
    try {
      if (!this.listVoices) throw new Error("Catálogo no disponible.");
      const page = await this.listVoices({ search: search || undefined, pageToken }, controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      this.voicePage = page;
      this.voiceSearch = search;
      this.pageToken = pageToken;
      this.previousPages = history;
    } catch (error) {
      if (controller.signal.aborted || this.disposed) return;
      const status = error instanceof Error ? /\(HTTP (\d{3})\)/.exec(error.message)?.[1] : undefined;
      this.voiceError = `Error${status ? ` HTTP ${status}` : ""}: comprueba credenciales, permisos y conexión.`;
      this.voicePage = { voices: [] };
    } finally {
      if (this.voiceRequest === controller && !controller.signal.aborted && !this.disposed) {
        this.voiceLoading = false;
        this.voiceRequest = undefined;
        this.showVoices();
        this.tui.requestRender();
      }
    }
  }

  private showVoices(selected = "") {
    this.screen = "voices";
    const items: SelectItem[] = [
      { value: "search", label: `Buscar: ${this.voiceSearch || "todas las argentinas"}` },
      { value: "manual", label: "Introducir voz o ID manualmente" },
    ];
    if (this.voiceLoading) items.push({ value: "loading", label: "Cargando voces de Google…" });
    else if (this.voiceError) {
      items.push({ value: "retry", label: "Reintentar consulta" });
      if (this.previousPages.length) items.push({ value: "previous", label: "← Página anterior" });
    }
    else {
      items.push(...this.voicePage.voices.map(voice => ({ value: `voice:${voice.id}`, label: `${voice.id === this.value.config.voice ? "●" : "○"} ${voice.displayName}${voice.languageCode ? ` · ${voice.languageCode}` : ""}`, description: [voice.gender, voice.accent, voice.description].filter(Boolean).join(" · ") })));
      if (!this.voicePage.voices.length) items.push({ value: "empty", label: "No hay voces argentinas en esta página" });
      if (this.previousPages.length) items.push({ value: "previous", label: "← Página anterior" });
      if (this.voicePage.nextPageToken) items.push({ value: "next", label: "Siguiente página →" });
    }
    items.push({ value: "back", label: "Volver" });
    this.message = this.voiceError;
    this.menu(items, choice => {
      if (choice === "back") { this.voiceRequest?.abort(); this.voiceRequest = undefined; this.voiceLoading = false; this.message = ""; this.showMain("voice"); }
      else if (choice === "search") { this.voiceRequest?.abort(); this.voiceRequest = undefined; this.voiceLoading = false; this.edit("search", this.voiceSearch); }
      else if (choice === "manual") { this.voiceRequest?.abort(); this.voiceRequest = undefined; this.voiceLoading = false; this.edit("voice", this.value.config.voice); }
      else if (choice === "retry") void this.loadVoices(this.voiceSearch, this.pageToken);
      else if (choice === "next" && this.voicePage.nextPageToken) void this.loadVoices(this.voiceSearch, this.voicePage.nextPageToken, [...this.previousPages, this.pageToken]);
      else if (choice === "previous") void this.loadVoices(this.voiceSearch, this.previousPages.at(-1), this.previousPages.slice(0, -1));
      else if (choice.startsWith("voice:")) { this.value.config.voice = choice.slice(6); this.message = ""; this.showMain("voice"); }
    }, () => { this.voiceRequest?.abort(); this.voiceRequest = undefined; this.voiceLoading = false; this.message = ""; this.showMain("voice"); }, selected);
  }

  private showOutput(selected = "") {
    this.screen = "output";
    const items: SelectItem[] = [
      { value: "default", label: `${this.value.output === null ? "●" : "○"} Entorno predeterminado` },
      ...this.value.devices.map(device => ({ value: `device:${device.name}`, label: `${this.value.output === device.name ? "●" : "○"} ${device.name} · puerto ${device.port}` })),
      { value: "add", label: "+ Añadir dispositivo" },
      { value: "back", label: "Volver" },
    ];
    this.menu(items, choice => {
      this.message = "";
      if (choice === "default") { this.value.output = null; this.showOutput(choice); }
      else if (choice === "add") { this.draftName = ""; this.edit("deviceName", ""); }
      else if (choice === "back") this.showMain("output");
      else { this.selectedDevice = choice.slice(7); this.showDevice(); }
    }, () => this.showMain("output"), selected);
  }

  private showDevice(selected = "") {
    this.screen = "device";
    const device = this.value.devices.find(item => item.name === this.selectedDevice)!;
    const items = [
      { value: "select", label: `${this.value.output === device.name ? "●" : "○"} Usar ${device.name}` },
      { value: "rename", label: `Nombre: ${device.name}` },
      { value: "port", label: `Puerto remoto: ${device.port}` },
      { value: "remove", label: "Eliminar dispositivo" },
      { value: "back", label: "Volver" },
    ];
    this.menu(items, choice => {
      this.message = "";
      if (choice === "select") { this.value.output = device.name; this.showOutput(`device:${device.name}`); }
      else if (choice === "rename") this.edit("deviceName", device.name);
      else if (choice === "port") this.edit("devicePort", String(device.port));
      else if (choice === "remove") {
        this.value.devices = this.value.devices.filter(item => item.name !== device.name);
        if (this.value.output === device.name) this.value.output = null;
        this.showOutput();
      } else this.showOutput(`device:${device.name}`);
    }, () => this.showOutput(`device:${device.name}`), selected);
  }

  private edit(field: EditField, initial: string) {
    const labels: Record<EditField, string> = { voice: "Voz o ID", search: "Buscar por nombre o descripción", style: "Estilo", speed: "Velocidad (0.5–3)", location: "Ubicación", maxCharacters: "Máximo de caracteres (1–30000)", deviceName: "Nombre del dispositivo", devicePort: "Puerto remoto en el servidor (1–65535)" };
    const input = new Input({ prompt: "" });
    this.input = input;
    input.focused = this.focused;
    input.setValue(initial);
    input.handleInput("\u0005"); // place the cursor at the end of the existing value
    this.message = labels[field];
    input.onEscape = () => { this.message = ""; this.returnFromEdit(); };
    input.onSubmit = raw => {
      const value = raw.trim();
      if (field === "search") {
        if (Buffer.byteLength(value, "utf8") > 2048) { this.message = "La búsqueda es demasiado larga."; return; }
        this.input = undefined;
        this.voicePage = { voices: [] };
        this.previousPages = [];
        this.pageToken = undefined;
        this.voiceSearch = value;
        void this.loadVoices(value);
        return;
      }
      const updated = structuredClone(this.value);
      const selected = updated.devices.find(device => device.name === this.selectedDevice);
      if (field === "deviceName") {
        if (this.screen === "device" && selected) {
          if (updated.output === selected.name) updated.output = value;
          selected.name = value;
        } else {
          // Validate the name with a temporary valid port before asking for it.
          updated.devices.push({ name: value, port: 1 });
        }
      } else if (field === "devicePort") {
        if (!/^\d+$/.test(value)) { this.message = "El puerto debe ser un número entre 1 y 65535."; return; }
        const port = Number(value);
        if (this.screen === "device" && selected) selected.port = port;
        else updated.devices.push({ name: this.draftName, port });
      } else if (field === "speed") {
        if (!/^(?:\d+)(?:\.\d+)?$/.test(value)) { this.message = "Velocidad inválida."; return; }
        updated.config.speed = Number(value);
      } else if (field === "maxCharacters") {
        if (!/^\d+$/.test(value)) { this.message = "El máximo debe ser un número entero."; return; }
        updated.config.maxCharacters = Number(value);
      } else updated.config[field] = value;
      try { validatePreferences(updated); }
      catch (error) { this.message = (error as Error).message; return; }
      if (field === "deviceName" && this.screen !== "device") {
        this.draftName = value;
        this.edit("devicePort", "14713");
        return;
      }
      if (field === "deviceName") this.selectedDevice = value;
      this.value = updated;
      this.message = "";
      if (field === "voice") this.showMain("voice");
      else this.returnFromEdit();
    };
  }

  private returnFromEdit() {
    if (this.screen === "voices") this.showVoices();
    else if (this.screen === "device") this.showDevice();
    else if (this.screen === "output") this.showOutput();
    else this.showMain();
  }

  private resizeMenu() {
    if (this.input || this.menuRows === this.tui.terminal.rows) return;
    const selected = this.list.getSelectedItem()?.value ?? "";
    if (this.screen === "main") this.showMain(selected);
    else if (this.screen === "output") this.showOutput(selected);
    else if (this.screen === "voices") this.showVoices(selected);
    else this.showDevice(selected);
  }

  handleInput(data: string) {
    this.resizeMenu();
    if (this.input) this.input.handleInput(data);
    else this.list.handleInput(data);
    this.tui.requestRender();
  }

  invalidate() { this.input?.invalidate(); this.list.invalidate(); }
  dispose() { this.disposed = true; this.voiceRequest?.abort(); this.voiceRequest = undefined; }

  render(width: number): string[] {
    this.resizeMenu();
    const w = Math.max(0, Math.floor(width));
    if (w < 4) return [truncateToWidth("TTS", w, "")];
    const inner = w - 2;
    const contentWidth = Math.max(1, inner - 4);
    const title = this.screen === "main" ? "Google TTS · Configuración" : this.screen === "output" ? "Salida de audio" : this.screen === "voices" ? `Voces argentinas · página ${this.previousPages.length + 1}` : "Dispositivo";
    const lines = this.input ? [this.input.render(contentWidth)[0] ?? ""] : this.list.render(contentWidth);
    const background = (text: string) => this.theme.style(text, { bg: rgbColor(0, 0, 0), fg: rgbColor(235, 235, 235) });
    const row = (text: string) => {
      // truncateToWidth closes ANSI styles on truncation, so reopen our colors.
      const mode = getTerminalColorMode();
      const reopen = backgroundAnsi(rgbColor(0, 0, 0), mode) + foregroundAnsi(rgbColor(235, 235, 235), mode);
      const clipped = truncateToWidth(text, inner - 2, "…", true).replaceAll("\u001b[0m", `\u001b[0m${reopen}`);
      return background(`│ ${clipped} │`);
    };
    const hint = this.input ? "Enter confirma · Esc vuelve" : "↑↓ navegar · Enter elegir · Esc cancelar";
    const maxHeight = Math.max(1, Math.min(Math.floor(this.tui.terminal.rows * 0.95), this.tui.terminal.rows - 2));
    const content = [...lines.map(line => row(` ${line}`)), ...(this.message ? [row(` ${this.message}`)] : [])];
    if (maxHeight < 5) return content.slice(0, maxHeight);
    const available = maxHeight - 3;
    const padding = available - content.length >= 2 ? [row("")] : [];
    const footer = available - content.length >= 1 ? [row(` ${hint}`)] : [];
    return [background(`╭${"─".repeat(inner)}╮`), row(` ${title}`), ...padding, ...content.slice(0, available - padding.length - footer.length), ...footer, background(`╰${"─".repeat(inner)}╯`)];
  }
}
