# j0k3r Theme Extension

[English](#english) | [Español](#español)

## English

Pi TUI theme extension providing custom interactive header, editor, and footer components, alongside the `arch-electric` color theme. In this agent-dir checkout it lives at `extensions/j0k3r-theme`; when copied into a project-local Pi setup the equivalent path is `.pi/extensions/j0k3r-theme`.

### What it provides

- **Interactive Header (`J0k3rThemeHeader`)**:
  - Displays project name, repository name (resolved via Git remote or directory name), and current Git branch.
  - Real-time detection and count of loaded skills and extensions.
  - Animated 3D spinning Arch Linux ASCII logo rendered with perspective projection and depth shading, combined with custom electric cyberpunk gradient ASCII typography for "j0k3r".
  - Automatically plays on startup and cleanly hides upon user input or when the agent starts processing.
- **Responsive Footer (`J0k3rThemeFooter`)**:
  - Multi-tier adaptive layout that gracefully scales across wide and narrow terminal viewports.
  - Shows Git repository and branch, current model, token counts, context window usage progress bar, thinking level, and Engram memory status.
- **Custom Editor (`J0k3rThemeEditor`)**:
  - Custom styled input editor component with electric cyan borders.
  - Animated working status indicator in the top border featuring the Arch Linux logo (`󰣇`) with a pulsing neon breathing effect (scaling brightness and contrast) while smoothly cycling through electric cyberpunk gradient colors (Cyan, Arch Blue, Cyber Violet, Neon Pink, Electric Amber, Neon Green) during agent processing and thinking.
- **Theme `arch-electric` (`themes/arch-electric.json`)**:
  - Cyberpunk color palette inspired by Arch Linux: electric cyan (`#00e5ff`), Arch blue (`#1793d1`), cyberpunk violet (`#9b5cff`), neon pink (`#ff2df7`), lime green (`#66ff66`), and deep dark panel backgrounds (`#05080d`).

---

## Español

Extensión de tema e interfaz para Pi que provee componentes interactivos personalizados de cabecera (header), editor y pie (footer), junto con el tema de colores `arch-electric`. En este repositorio reside en `extensions/j0k3r-theme`; en una instalación local de proyecto la ruta equivalente es `.pi/extensions/j0k3r-theme`.

### Qué incluye

- **Cabecera Interactiva (`J0k3rThemeHeader`)**:
  - Muestra el nombre del proyecto, el repositorio Git (resuelto vía remotos de Git o carpeta local) y la rama activa.
  - Detección y conteo en tiempo real de las skills y extensiones cargadas.
  - Banner animado con logo 3D de Arch Linux giratorio en ASCII clásico con gradiente cyberpunk eléctrico y tipografía estilizada "j0k3r".
  - Se ejecuta en la pantalla de bienvenida y se oculta automáticamente ante el primer input del usuario o cuando el agente inicia su turno.
- **Pie Responsivo (`J0k3rThemeFooter`)**:
  - Diseño responsivo adaptativo que se ajusta a terminales estrechas y anchas sin cortes abruptos.
  - Muestra repositorio y rama Git, modelo activo, conteo de tokens, barra de progreso de uso de contexto (%), nivel de thinking y estado de Engram.
- **Editor Personalizado (`J0k3rThemeEditor`)**:
  - Componente de editor de entrada estilizado con bordes en cian eléctrico.
  - Indicador animado de estado de trabajo (worker / spinner) en el borde superior con el logo de Arch Linux (`󰣇`) con efecto de latido/respiración neón (pulsación de brillo y contraste) mientras cicla suavemente a través de colores cyberpunk (cian eléctrico, azul Arch, violeta, rosa neón, ámbar, verde lima) cuando el agente procesa o piensa.
- **Tema `arch-electric` (`themes/arch-electric.json`)**:
  - Paleta cyberpunk con estética Arch Linux: cian eléctrico (`#00e5ff`), azul Arch (`#1793d1`), violeta cyberpunk (`#9b5cff`), rosa neón (`#ff2df7`), verde lima (`#66ff66`) y fondos oscuros profundos (`#05080d`).
