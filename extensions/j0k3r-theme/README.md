# j0k3r Theme Extension

[English](#english) | [Español](#español)

## English

Pi TUI theme extension providing custom interactive header, editor, and footer components, alongside the `arch-electric` color theme. In this agent-dir checkout it lives at `extensions/j0k3r-theme`; when copied into a project-local Pi setup the equivalent path is `.pi/extensions/j0k3r-theme`.

### What it provides

- **Interactive Header (`J0k3rThemeHeader`)**:
  - Displays project name, repository name (resolved via Git remote or directory name), and current Git branch.
  - Real-time detection and count of loaded skills and extensions.
  - Selectable startup welcome banner: defaults to the animated 3D spinning Arch Linux logo with gradient "j0k3r" typography, with an optional static "Pink Mustache" avatar banner option.
  - Automatically plays on startup and cleanly hides upon user input or when the agent starts processing.
- **Welcome Banner Selector & `/banner` Command**:
  - Optional setting key `j0k3rTheme.welcomeBanner` in `settings.json` accepting `"default"` or `"mustache"`. When absent, unreadable, or set to an unrecognized value, it falls back to `"default"` preserving existing startup behavior.
  - Bundled static ASCII/ANSI art: the `mustache` option is self-contained static art approximating the pink mustache avatar with zero runtime image loading or conversions.
  - `/banner` command: switch banners dynamically during an active session:
    - `/banner`: opens an interactive TUI selector with options `default (Arch 3D plus j0k3r)` and `mustache (Pink Mustache)`.
    - `/banner default`: immediately switches active header to the animated Arch 3D banner.
    - `/banner mustache`: immediately switches active header to the static Pink Mustache banner.
    - Handles invalid arguments gracefully with a warning notification and fallback to interactive selection.
    - Switches active header immediately in memory and notifies via `ctx.ui.notify` without requiring a Pi restart.
- **Responsive Footer (`J0k3rThemeFooter`)**:
  - Multi-tier adaptive layout that gracefully scales across wide and narrow terminal viewports.
  - Shows Git repository and branch, current model, token counts, context window usage progress bar, thinking level, and Engram memory status.
- **Custom Editor (`J0k3rThemeEditor`)**:
  - Custom styled input editor component with electric cyan borders.
  - Animated working status indicator in the top border featuring the Arch Linux logo (`󰣇`) with a pulsing neon breathing effect (scaling brightness and contrast) while smoothly cycling through electric cyberpunk gradient colors (Cyan, Arch Blue, Cyber Violet, Neon Pink, Electric Amber, Neon Green) during agent processing and thinking.
- **Theme `arch-electric` (`themes/arch-electric.json`)**:
  - Cyberpunk color palette inspired by Arch Linux: electric cyan (`#00e5ff`), Arch blue (`#1793d1`), cyberpunk violet (`#9b5cff`), neon pink (`#ff2df7`), lime green (`#66ff66`), and deep dark panel backgrounds (`#05080d`).
- **Hollow Bordered Tool Cards (`renderShell: "self"`)**:
  - Custom TUI card framing for native tools (`bash`, `read`, `edit`, `write`) matching the theme aesthetic (rounded corners `╭╮╰╯`, vertical lines `│`, horizontal dashes `─`, electric ANSI borders, unshaded transparent background).
  - Dynamic bash border state: electric cyan/amber while executing/streaming, neon green (`#66ff66`) on success, neon red (`#ff4d6d`) on failure/non-zero exit.
  - Non-bash tools: electric cyan border on success/pending, neon red on error.
  - Collapsed mode: bounded summary with keybinding hints (`keyHint("app.tools.expand", "to expand")`).
  - Expanded mode: full output / syntax-highlighted code / unified diff within width-safe card bounds.

---

## Español

Extensión de tema e interfaz para Pi que provee componentes interactivos personalizados de cabecera (header), editor y pie (footer), junto con el tema de colores `arch-electric`. En este repositorio reside en `extensions/j0k3r-theme`; en una instalación local de proyecto la ruta equivalente es `.pi/extensions/j0k3r-theme`.

### Qué incluye

- **Cabecera Interactiva (`J0k3rThemeHeader`)**:
  - Muestra el nombre del proyecto, el repositorio Git (resuelto vía remotos de Git o carpeta local) y la rama activa.
  - Detección y conteo en tiempo real de las skills y extensiones cargadas.
  - Banner de bienvenida seleccionable: por defecto el banner animado 3D de Arch Linux con tipografía "j0k3r", con opción estática alternativa "Pink Mustache".
  - Se ejecuta en la pantalla de bienvenida y se oculta automáticamente ante el primer input del usuario o cuando el agente inicia su turno.
- **Selector de Banner y Comando `/banner`**:
  - Clave de configuración opcional `j0k3rTheme.welcomeBanner` en `settings.json` con valores `"default"` o `"mustache"`. Si no está configurada o contiene un valor inválido, utiliza `"default"` sin alterar el comportamiento existente.
  - Arte ASCII/ANSI estático empaquetado: la opción `mustache` está completamente integrada en el código sin requerir carga o conversión de imágenes en tiempo de ejecución.
  - Comando `/banner`: permite alternar el estilo de banner en caliente durante la sesión:
    - `/banner`: abre un selector interactivo en la TUI con opciones `default (Arch 3D plus j0k3r)` y `mustache (Pink Mustache)`.
    - `/banner default`: cambia inmediatamente la cabecera activa al banner 3D de Arch.
    - `/banner mustache`: cambia inmediatamente la cabecera activa al banner Pink Mustache.
    - Notificación informativa mediante `ctx.ui.notify` tras cada cambio y manejo seguro de argumentos no reconocidos.
- **Pie Responsivo (`J0k3rThemeFooter`)**:
  - Diseño responsivo adaptativo que se ajusta a terminales estrechas y anchas sin cortes abruptos.
  - Muestra repositorio y rama Git, modelo activo, conteo de tokens, barra de progreso de uso de contexto (%), nivel de thinking y estado de Engram.
- **Editor Personalizado (`J0k3rThemeEditor`)**:
  - Componente de editor de entrada estilizado con bordes en cian eléctrico.
  - Indicador animado de estado de trabajo (worker / spinner) en el borde superior con el logo de Arch Linux (`󰣇`) con efecto de latido/respiración neón (pulsación de brillo y contraste) mientras cicla suavemente a través de colores cyberpunk (cian eléctrico, azul Arch, violeta, rosa neón, ámbar, verde lima) cuando el agente procesa o piensa.
- **Tema `arch-electric` (`themes/arch-electric.json`)**:
  - Paleta cyberpunk con estética Arch Linux: cian eléctrico (`#00e5ff`), azul Arch (`#1793d1`), violeta cyberpunk (`#9b5cff`), rosa neón (`#ff2df7`), verde lima (`#66ff66`) y fondos oscuros profundos (`#05080d`).
- **Tarjetas de Herramientas sin Relleno (`renderShell: "self"`)**:
  - Renderizado de tarjetas con bordes para herramientas nativas (`bash`, `read`, `edit`, `write`) con esquinas redondeadas (`╭╮╰╯`), líneas verticales (`│`), guiones horizontales (`─`), colores eléctricos ANSI y fondo transparente sin sombras de relleno.
  - Color dinámico en bash: cian/ámbar eléctrico mientras ejecuta/transmite, verde neón (`#66ff66`) al terminar con éxito, rojo neón (`#ff4d6d`) en caso de error o código de salida distinto de cero.
  - Herramientas no-bash: borde cian eléctrico en ejecución y éxito, rojo neón en error.
  - Modo colapsado: resumen compacto delimitado con atajo nativo (`keyHint("app.tools.expand", "to expand")`).
  - Modo expandido: salida completa, código con resaltado de sintaxis o diff unificado formateado para ajuste seguro al ancho disponible.
