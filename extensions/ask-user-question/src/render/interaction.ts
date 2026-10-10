// Native dock wrapper adapted from gentle-shell (MIT); see LICENSE.
import { Container, type Component, type Focusable } from "@earendil-works/pi-tui";

/** Native Container owns mouse dispatch; only this view owns keyboard input. */
export class QuestionnaireInteraction extends Container implements Focusable {
  constructor(
    private readonly target: Component & Focusable,
    private readonly requestRender: () => void,
    private readonly cleanup: () => void,
  ) { super(); }

  get focused(): boolean { return this.target.focused; }
  set focused(value: boolean) { this.target.focused = value; }

  handleInput(data: string): void {
    this.target.handleInput?.(data);
    this.requestRender();
  }

  dispose(): void { this.cleanup(); }
}
