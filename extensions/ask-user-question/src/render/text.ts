import { Text, truncateToWidth } from "@earendil-works/pi-tui";

/** Native Text wraps content; clip only a grapheme wider than the viewport. */
export class WidthSafeText extends Text {
  override render(width: number): string[] {
    return super.render(Math.max(1, width)).map((line) => truncateToWidth(line, Math.max(1, width), ""));
  }
}
