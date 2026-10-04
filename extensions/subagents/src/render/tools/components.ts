import { truncateToWidth, visibleWidth, wrapLineToWidth } from '../text-width.js';
import { BOX_CHARS, CYAN, electricBorder, padToWidth, themeFg } from '../completion-message.js';

export function emptyComponent() {
  return {
    invalidate() {},
    render(_width?: number): string[] {
      return [];
    },
  };
}

export function textComponent(text: string) {
  return {
    invalidate() {},
    render(width: number): string[] {
      if (!text) return [];
      return text.split('\n').map((line) => truncateToWidth(line, width, '…'));
    },
  };
}

export function wrappedTextComponent(text: string) {
  return {
    invalidate() {},
    render(width: number) {
      return text.split('\n').flatMap((line) => wrapLineToWidth(line, width));
    },
  };
}

export interface BoxedComponentOptions {
  title?: string;
  theme?: any;
  borderFn?: (text: string) => string;
  wrapped?: boolean;
  onClick?: () => void;
}

export function boxedComponent(linesOrText: string | string[], options?: BoxedComponentOptions) {
  return {
    invalidate() {},
    handleMouse(event: any) {
      if (!options?.onClick) return undefined;
      const isLeft = event?.button === 'left' || event?.button === undefined;
      if (event?.type === 'press' && isLeft) {
        return { handled: true };
      }
      if (event?.type === 'release' && isLeft) {
        return { handled: true };
      }
      if (event?.type === 'click' || (!event?.type && isLeft)) {
        options.onClick();
        return { handled: true };
      }
      return undefined;
    },
    render(width: number): string[] {
      const borderFn = options?.borderFn ?? ((text: string) => {
        if (options?.theme) return themeFg(options.theme, 'accent', text, CYAN);
        return electricBorder(text);
      });
      const rawLines = Array.isArray(linesOrText)
        ? linesOrText.flatMap((l) => l.split('\n'))
        : linesOrText.split('\n');
      const safeWidth = Math.max(1, Math.floor(width || 1));
      if (safeWidth < 10) {
        const all = options?.title ? [options.title, ...rawLines] : rawLines;
        return all.map((l) => truncateToWidth(l, safeWidth, '…'));
      }
      const innerWidth = safeWidth - 2;
      const contentWidth = Math.max(1, innerWidth - 2);

      let top: string;
      if (options?.title) {
        const maxTitleWidth = Math.max(0, innerWidth - 4);
        const clippedTitle = truncateToWidth(options.title, maxTitleWidth, '…');
        const titleVisWidth = visibleWidth(clippedTitle);
        const filler = Math.max(0, innerWidth - titleVisWidth - 3);
        top = `${borderFn(BOX_CHARS.topLeft + BOX_CHARS.horizontal)} ${clippedTitle} ${borderFn(BOX_CHARS.horizontal.repeat(filler))}${borderFn(BOX_CHARS.topRight)}`;
      } else {
        top = `${borderFn(BOX_CHARS.topLeft)}${borderFn(BOX_CHARS.horizontal.repeat(innerWidth))}${borderFn(BOX_CHARS.topRight)}`;
      }

      const formattedLines = options?.wrapped
        ? rawLines.flatMap((l) => wrapLineToWidth(l, contentWidth))
        : rawLines.map((l) => truncateToWidth(l, contentWidth, '…'));
      const middle = formattedLines.map((l) => `${borderFn(BOX_CHARS.vertical)} ${padToWidth(l, contentWidth)} ${borderFn(BOX_CHARS.vertical)}`);
      const bottom = `${borderFn(BOX_CHARS.bottomLeft)}${borderFn(BOX_CHARS.horizontal.repeat(innerWidth))}${borderFn(BOX_CHARS.bottomRight)}`;

      return [top, ...middle, bottom];
    },
  };
}
