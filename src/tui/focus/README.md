# OpenTUI Focus Bindings

This directory binds the universal focus model from `src/lib/focus` to OpenTUI and React.

The core README explains the platform-agnostic model. This README explains why the OpenTUI adapter looks the way it does.

It is also intentionally not an API reference. The goal is to explain the design decisions that make the binding work.

## The Main Constraint

OpenTUI already has a notion of real focus:

- a focused renderable receives keyboard input
- focused inputs and editors often consume arrow keys, enter, escape, and text input

That is exactly what we want during normal editing, and exactly what we do **not** want while focus navigation mode is active.

So the OpenTUI binding has to do two jobs at once:

- integrate with real renderable focus
- temporarily get keyboard control away from the focused widget during focus navigation

That is why this directory exists as a separate adapter layer instead of trying to fold those concerns into the universal core.

## Why Focus Navigation Uses A Global Renderer Handler

OpenTUI's `useKeyboard()` hooks attach through the renderer's key handler, but focused renderables also participate directly in keyboard dispatch.

If focus navigation relied only on ordinary widget-local keyboard handlers:

- a focused `<input>` or `<textarea>` could swallow arrows and `Esc`
- focus navigation would only work when the "right" subtree happened to be focused
- modal escape handling would become inconsistent

So the TUI layer installs one top-priority global handler in [`../ui/keybind/KeybindProvider.tsx`](../ui/keybind/KeybindProvider.tsx) using `renderer.keyInput.prependListener("keypress", ...)`.

That handler is intentionally shared by shortcuts and focus navigation. `useShortcut()` no longer installs flat `useKeyboard()` listeners in leaf components; it registers declarative shortcut metadata, and the router dispatches by focus ancestry using the focus tree. Widgets with directional behavior layer `useNavKeys()` on top of the same router instead of subscribing to `useKeyboard()` directly.

That makes focus navigation a renderer-level concern:

- `Esc` always reaches the focus system before focused widgets see it
- once navigation is active, arrows / `Enter` / `Space` are intercepted before focused widgets see them
- the focus tree becomes the single authority for directional traversal
- pane-scoped shortcuts like `Esc` can run before the focus-navigation fallback without local `prependListener()` hacks

This is one of the most important OpenTUI-specific design choices in the adapter.

## Real Focus Is Intentionally Blurred During Navigation

Starting focus navigation is not just a state flip in the tree.

In OpenTUI, the currently focused renderable is also a live event consumer. If we leave it focused while focus navigation is active, a text field can still mutate selection or cursor state when arrows are pressed, even if the global handler is trying to treat those keys as navigation commands.

So the adapter snapshots the currently focused renderable and blurs it when focus navigation starts. On cancel, it restores that renderable if appropriate. On activation, it intentionally does **not** restore it, because real focus is about to move to the newly activated target.

This means the adapter is effectively bridging three states:

- real OpenTUI focus
- universal focus-tree focused path
- universal focus-tree highlighted path

That bridge is renderer-specific, so it lives here.

## Why We Still Keep A Separate Highlight

OpenTUI only has real renderable focus. It does not have a built-in concept of "the thing currently highlighted by a reversible navigation session."

So the adapter renders that distinction explicitly:

- `useIsFocused()` reflects committed focus
- `useIsHighlighted()` reflects the temporary navigation target
- `Focusable` renders highlight chrome by default unless `hideNavigationHalo` is set
- [`FocusHalo.tsx`](./FocusHalo.tsx) implements the shared halo chrome
- [`FocusNavigationHint.tsx`](./FocusNavigationHint.tsx) renders the mode affordance

This is an important principle in the bindings: visual focus navigation state is derived from the focus tree, not inferred from OpenTUI's focused renderable.

## `Focusable` As The Registration Wrapper

`Focusable` is intentionally a wrapper component instead of a hook that expects the child to already be focusable.

That gives the binding a consistent place to do several jobs:

- compute the full path from context
- register and unregister the focusable
- attach a stable renderable id derived from the path
- expose a wrapper rect when the inner widget is not directly measurable
- synchronize mouse-down with real focus path updates
- render the shared navigation halo unless a caller opts out

Some widgets focus an inner renderable directly. Others only need the wrapper.

So the component supports both:

- measure/focus through the wrapper by default
- optionally target a specific inner renderable through `renderableRef` and `focus`

That keeps the binding flexible without leaking OpenTUI-specific focus mechanics back into the core.

One important consequence of nested `Focusable`s is that they participate in `Esc` step-out ancestry if they are logically focusable.

So a structural wrapper should usually stay `focusable={false}` and `navigable={false}` rather than being modeled as a separate "area" type.

## Why There Is Not A Separate "Area" Component

The older focus system had separate "navigable" and "area" wrappers. The current one does not.

A single `Focusable` can act as:

- a composite focus owner
- a trap scope
- a scroll-follow container
- a clipping container
- a structural subtree boundary

In practice, the container-specific behavior still lives in the binding, but it is surfaced as capabilities on one wrapper:

- `trap` / `onTrapEsc`
- viewport clipping
- descendant reveal
- snapshot / restore
- `delegatesFocus`
- `childrenNavigable={false}` for composite widgets that want local navigation but only one global stop

If a `scrollRef` is provided, the adapter supplies reasonable defaults:

- the scrollbox viewport becomes the focusable viewport and clip rect
- descendant reveal uses `scrollChildIntoView(...)`
- navigation snapshots capture `scrollLeft` / `scrollTop`
- cancel restores that scroll state

This gives scroll-follow behavior "for free" for ordinary scroll containers while still allowing more specialized widgets to provide custom reveal or snapshot logic.

## Why Descendant Reveal Uses Path-Derived Renderable IDs

The universal core reveals descendants by path. OpenTUI scrollboxes reveal descendants by renderable id.

So the adapter needs a deterministic path-to-renderable-id mapping.

That is what [`utils.ts`](./utils.ts) provides.

This is a good example of the adapter's role:

- the core knows semantic identity as a path
- OpenTUI exposes imperative reveal by id
- the adapter translates between the two

Without that mapping, nested scroll-follow would need widget-specific plumbing everywhere.

## Why Registration Uses `useInsertionEffect`

The binding now uses `useInsertionEffect` for one narrow job: make the structural focusable path exist before any layout effects try to move focus around.

That matters because focus requests can happen during layout effects in already-mounted components. If a newly mounted target only registers in `useLayoutEffect`, a sibling or ancestor may try to focus it one phase too early.

So the current split is:

- `useInsertionEffect`: silent structural register/unregister
- `useLayoutEffect` in `Focusable`: install the current live callbacks
- `useLayoutEffect` in `FocusProvider`: call `flushPendingChanges()`

That gives the tree a simple ordering story without leaking timing hacks into widget code.

## Why The Provider Flushes Pending Changes

The focus tree deliberately separates two concerns:

- the imperative registry of focusables
- the observable focus state that React components render from

Registration is therefore silent. It should not wake every subscriber just because a node mounted.

Instead, the provider performs one small post-commit flush:

- resolve any still-pending focus request against the now-complete tree
- repair focused/highlighted paths if structure changed
- notify subscribers only if committed observable state actually changed

This is intentionally not a large reconciler. It is just a narrow "finish commit-time focus bookkeeping" step.

## Geometry In OpenTUI

The core expects global viewport coordinates. OpenTUI renderables already expose enough information to produce them:

- `x`
- `y`
- `width`
- `height`
- visibility

The adapter treats a renderable's live layout as the viewport rect, and a scrollbox viewport as both the area viewport and the clip rect.

That means:

- ordinary renderables can participate with almost no extra logic
- clipped descendants become non-navigable automatically once ancestor clip rects are intersected in the core
- the adapter does not need to maintain a secondary layout cache

The adapter is intentionally thin here: it reads what OpenTUI already knows and hands that to the core.

## Why Local Widget Navigation Must Yield To Focus Navigation

Several widgets still have local keyboard behavior:

- lists move selection with arrows
- editors submit or clear on shortcuts
- fields may respond to `Tab`, `Up`, or `Down`

Those behaviors are valid only when focus navigation is inactive.

So the binding and surrounding widgets follow a rule:

- when focus navigation is active, the focus tree owns arrows / `Enter` / `Space` / `Esc`
- widget-local keyboard behavior must stand down

This is why some old direct `escape` shortcuts had to be removed from panes like add-connection and query history. They were competing with the navigation model instead of cooperating with it.

Outside focus navigation, `Esc` is still owned by the focus system first. It first tries to step real focus outward to an ancestor focusable. At a trap root, the next `Esc` enters focus navigation, and only `Esc` from focus-navigation mode triggers the trap action such as closing a modal.

## Visual Treatment Is Derived, Not Commanding

The halo and hint panel are deliberately passive.

They do not make decisions. They only reflect the current focus-tree state:

- whether focus navigation is active
- which focusable is highlighted
- whether the active scope exposes an `Esc` label

That separation matters because it keeps the renderer honest:

- the focus tree owns behavior
- the visuals explain the behavior

This avoids the common trap where UI chrome and input logic drift apart.

## OpenTUI Escape Timing Matters

One OpenTUI-specific operational detail is worth calling out: a bare `Esc` key is not emitted immediately. The stdin parser waits briefly so it can distinguish a lone `Esc` from the start of an Alt/meta sequence.

That is not a focus-system bug. It is terminal input reality.

The practical consequence is:

- runtime behavior is correct
- tests that assert on a bare `Esc` need to wait slightly before expecting the state change

That timing belongs in the binding's mental model because it affects how focus-navigation behavior is verified.

## Mouse And Programmatic Focus

The bindings treat mouse focus and programmatic focus as first-class, not as special cases.

Mouse-down on a `Focusable` updates the tree's focused path, and components can opt into `autoFocus` to establish initial real focus through the same path-based model.

That keeps all focus entry points aligned:

- mouse
- keyboard activation
- initial autofocus
- programmatic focus

The tree stays authoritative even though OpenTUI ultimately owns the real focused renderable.

## Design Summary

The OpenTUI layer is intentionally responsible for everything that is true because of OpenTUI and _only_ because of OpenTUI:

- renderer-level key interception
- temporary blur / restore of real focus
- converting renderables into viewport rects
- converting descendant paths into revealable renderable ids
- default scroll snapshot / restore behavior
- mode-specific visual affordances

Everything else belongs in the universal core.

That is the line this adapter is trying to preserve.
