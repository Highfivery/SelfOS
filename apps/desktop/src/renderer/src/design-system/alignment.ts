/**
 * Flex alignment unions shared by the `Stack` and `Inline` layout primitives.
 *
 * These are deliberately CLOSED unions rather than `CSSProperties['alignItems' | 'justifyContent']`,
 * which are effectively `string` and therefore accept values CSS does not. The trap this closes:
 * `justify="between"` — the shorthand the prop name invites — is not valid CSS. The browser drops it
 * and computes `normal`, so the row silently bunches to the left instead of spreading, with no error
 * anywhere. That shipped at ten call sites (Usage, Switcher, Together, People, Budgets, auto
 * check-ins) before a screenshot caught it. Keeping these to real CSS values makes it a build error.
 */

export type FlexJustify =
  | 'flex-start'
  | 'flex-end'
  | 'start'
  | 'end'
  | 'center'
  | 'space-between'
  | 'space-around'
  | 'space-evenly';

export type FlexAlign =
  | 'flex-start'
  | 'flex-end'
  | 'start'
  | 'end'
  | 'center'
  | 'baseline'
  | 'stretch';
