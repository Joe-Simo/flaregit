/** F17 slice: accessible-name check for interactive elements described as data, so the rule is testable without a DOM. */

export interface InteractiveElement {
  readonly role: "button" | "link" | "textbox";
  readonly text?: string;
  readonly ariaLabel?: string;
}

export function missingAccessibleNames(elements: readonly InteractiveElement[]): number[] {
  return elements.flatMap((element, index) => ((element.ariaLabel ?? element.text ?? "").trim() ? [] : [index]));
}
