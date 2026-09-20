import {
  YELLOW,
  RED,
  cardTopBorder,
  cardBottomBorder,
  frameContent,
  fit,
} from './borders.ts';

export interface TypesafeCardState {
  hasResult?: boolean;
  isPartial?: boolean;
  isError?: boolean;
  expanded?: boolean;
  borderColor?: string;
  [key: string]: any;
}

export function getTypesafeBorderColor(state: TypesafeCardState): string {
  if (state.isError) {
    return RED;
  }
  return YELLOW;
}

export class TypesafeCardCallComponent {
  private readonly toolName: string;
  private readonly getAction: () => string | undefined;
  private readonly getPendingStatus: () => string;
  private readonly getBorderColor: (state: TypesafeCardState) => string;
  private readonly state: TypesafeCardState;
  private readonly getBodyLines?: (width: number, innerWidth: number) => string[];

  private cachedWidth?: number;
  private cachedBorderColor?: string;
  private cachedTopBorder?: string[];

  constructor(
    toolName: string,
    getAction: () => string | undefined,
    getPendingStatus: () => string,
    getBorderColor: (state: TypesafeCardState) => string,
    state: TypesafeCardState,
    getBodyLines?: (width: number, innerWidth: number) => string[]
  ) {
    this.toolName = toolName;
    this.getAction = getAction;
    this.getPendingStatus = getPendingStatus;
    this.getBorderColor = getBorderColor;
    this.state = state;
    this.getBodyLines = getBodyLines;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const action = this.getAction();
    if (width < 24) {
      return [fit(`${this.toolName} ${action ?? ''}`.trim(), width)];
    }
    const innerWidth = Math.max(0, width - 2);
    const borderColor = this.getBorderColor(this.state);

    if (this.state.hasResult) {
      if (
        this.cachedWidth === innerWidth &&
        this.cachedBorderColor === borderColor &&
        this.cachedTopBorder
      ) {
        return this.cachedTopBorder;
      }
      const topBorder = cardTopBorder(this.toolName, action, innerWidth, borderColor, borderColor);
      this.cachedWidth = innerWidth;
      this.cachedBorderColor = borderColor;
      this.cachedTopBorder = [topBorder];
      return this.cachedTopBorder;
    }

    const topBorder = cardTopBorder(this.toolName, action, innerWidth, borderColor, borderColor);
    const bodyLines = this.getBodyLines ? this.getBodyLines(width, innerWidth) : [];
    const statusLine = this.getPendingStatus();
    const framed = frameContent([...bodyLines, statusLine], innerWidth, borderColor, true);

    return [
      topBorder,
      ...framed,
      cardBottomBorder(innerWidth, borderColor),
    ];
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedBorderColor = undefined;
    this.cachedTopBorder = undefined;
  }

  get text(): string {
    return this.render(80).join('\n');
  }
}

export class TypesafeCardResultComponent {
  private readonly getBodyLines: (width: number, innerWidth: number) => string[];
  private readonly getBorderColor: (state: TypesafeCardState) => string;
  private readonly state: TypesafeCardState;
  private readonly wrap: boolean;

  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    getBodyLines: (width: number, innerWidth: number) => string[],
    getBorderColor: (state: TypesafeCardState) => string,
    state: TypesafeCardState,
    wrap = true
  ) {
    this.getBodyLines = getBodyLines;
    this.getBorderColor = getBorderColor;
    this.state = state;
    this.wrap = wrap;
    this.state.hasResult = true;
  }

  render(width: number): string[] {
    if (width <= 0 || width < 24) {
      return [];
    }

    if (!this.state.isPartial && this.cachedWidth === width && this.cachedLines !== undefined) {
      return this.cachedLines;
    }

    const innerWidth = Math.max(0, width - 2);
    const borderColor = this.getBorderColor(this.state);
    const bodyLines = this.getBodyLines(width, innerWidth);
    const framed = frameContent(bodyLines, innerWidth, borderColor, this.wrap);
    const bottom = cardBottomBorder(innerWidth, borderColor);
    const lines = [...framed, bottom];

    if (!this.state.isPartial) {
      this.cachedWidth = width;
      this.cachedLines = lines;
    }

    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  get text(): string {
    return this.render(80).join('\n');
  }
}
