# Focus Core

This directory contains the platform-agnostic focus navigation model.

It exists because "whatever currently has keyboard focus" is not enough to build the interaction we want:

- `Esc` should act as a structured "step out" key instead of immediately mutating the focused widget.
- arrow keys should move between explicit UI targets based on layout, not widget-local tab order.
- modal and pop-up regions should be able to trap navigation and own `Esc`.
- scrolling or other temporary UI changes caused by navigation should be reversible on cancel.
- the same model should be reusable outside OpenTUI.

This README documents the design and the reasoning behind it. It intentionally does not try to be an API reference.

## Problem Statement

We want two distinct notions of focus:

- **real focus**: the thing that currently receives actual input
- **navigation highlight**: the thing focus navigation mode is pointing at

Those are often the same, but they should not be forced to be the same.

If they are collapsed into one concept, a text input keeps eating arrow keys while we are trying to navigate, modal escape handling becomes ad hoc, and scrolling side effects become permanent even when the user was only "looking around."

The core model is therefore a small state machine over an explicit tree of focusable things.

## Why The Tree Is Explicit

The tree is registered manually instead of being inferred from the renderer.

That is deliberate.

Automatic discovery sounds convenient, but it makes several important properties hard or impossible:

- stable identity across renders
- deterministic debugging
- trap scoping
- programmatic focus by path
- cross-platform reuse
- opt-in participation for composite widgets

The rule is simple: if something should participate in focus navigation, it must register itself.

## Stable Identity By Path

Each area and node provides a stable `focusNavigableId`.

The canonical identity for any registered thing is its full path:

- `[areaId]`
- `[modalId, fieldId]`
- `[sidebarId, sectionId, rowId]`

That path is the source of truth for:

- current real focus
- current navigation highlight
- scope / ancestry checks
- snapshot bookkeeping
- debug snapshots

Paths are preferred over opaque generated ids because they explain *where* something lives, not just *that* it exists.

## Areas And Nodes

The core recognizes two kinds of participants:

- **areas**
- **nodes**

Areas define structure and policy. Nodes are actual focus targets.

An area may:

- establish a subtree boundary
- trap navigation
- own an `Esc` action
- provide clipping information
- reveal descendants
- snapshot and restore temporary UI state

A node may:

- expose a focus callback
- expose its visible rect
- be disabled
- snapshot and restore temporary UI state

This split is important because scrolling, clipping, and escape behavior are usually container concerns, while actual focus transfer is a leaf concern.

## Trap Scope

Trap semantics are intentionally simple:

- navigation scope defaults to the root
- if the currently focused or highlighted path lives inside trapped areas, the **innermost** trapped ancestor becomes the active scope
- directional movement cannot leave that scope
- if that area provides an `Esc` action, focus navigation surfaces that as the current escape affordance

This gives modals and popovers a clean ownership boundary without teaching the rest of the tree anything special about "modals."

## Escape Means "Step Out"

`Esc` is treated as an outward-navigation key.

Outside focus navigation:

1. try to move real focus to the nearest ancestor node within the current trap scope
2. if there is no such ancestor and the active trapped area owns `Esc`, invoke that action
3. otherwise start focus navigation

Inside focus navigation:

1. try to move the highlighted path to the nearest ancestor node within the active scope
2. if there is no such ancestor and the active trapped area owns `Esc`, invoke that action and cancel navigation
3. otherwise cancel navigation

This lets deeply nested sub-content back out step by step before the system falls back to closing a modal or entering/leaving navigation mode.

It also implies an important modeling rule:

- if a container is structural and should **not** become an `Esc` step-out target, it should usually be an **area**, not a **node**

## Real Focus vs Navigation Highlight

The core stores both:

- the currently focused path
- the currently highlighted path

When focus navigation starts, the initial highlighted node is chosen in this order:

1. the current focused node, if it is visible in scope
2. the previous highlight, if it is still visible in scope
3. the first visible node in scope by registration order

When focus navigation activates the highlight, the node's real `focus()` callback is invoked and the highlighted path becomes the focused path.

When focus navigation is cancelled, the highlighted path may change, but real focus should conceptually remain where it was before navigation began.

The core deliberately models both states so renderers can express that distinction clearly.

## Geometry Is Lazy

The core does not cache layout.

Instead, areas and nodes provide lazy callbacks that return visible viewport rects when needed.

That choice matters for two reasons:

1. layout can change for many reasons outside focus navigation
2. caching geometry inside the focus engine would couple it to renderer timing and invalidation rules

So the core only reads geometry during navigation commands such as:

- start focus navigation
- move in a direction
- activate the highlighted node

This keeps the core deterministic and portable while letting each renderer decide how to measure itself.

## Geometry Uses Global Viewport Space

All geometry seen by the core is in global viewport coordinates.

That means:

- `x` and `y` are measured in the root viewport
- ancestor offsets are already applied
- scroll offsets are already applied
- clipping has already been accounted for

The core does not know about local coordinate systems.

That simplifies directional navigation because every candidate can be compared in one space.

## Clipping And Visibility

Nodes provide a base visible rect. Areas may provide clip rects.

When the core evaluates a node, it intersects the node rect with every ancestor clip rect. If the result is empty, the node is treated as non-visible for navigation.

This keeps visibility decisions local:

- renderers know how to expose clip rects
- the core only knows how to intersect them

## Spatial Navigation Algorithm

Directional navigation is geometry-driven, not tree-order-driven.

The current ranking is:

1. candidate must be in the requested half-plane
2. prefer candidates that overlap on the orthogonal axis
3. prefer smaller primary-axis distance
4. prefer smaller orthogonal center distance
5. use registration order as the final tie-breaker

This gives reasonable behavior for grids, forms, lists, sidebars, and modal content without inventing per-widget navigation rules.

Registration order is intentionally only the last tie-breaker. The tree provides determinism, not the main traversal heuristic.

## Focus Navigation Sessions

Entering focus navigation creates a temporary session.

That session owns state displaced by navigation itself.

Originally this started as "scroll restore," but the more general abstraction is more useful:

- scroll position
- text selection
- cursor position
- temporary list state
- any other renderer-local state that navigation may disturb

The session stores snapshots lazily.

Nothing is captured up front. A snapshot is only captured when navigation is about to mutate that participant for the first time.

That keeps the system cheap and makes the abstraction honest: if focus navigation never touched a thing, it should not restore it.

## Cancel vs Activate

The session distinguishes two exits:

- **cancel**
- **activate**

Cancel means "revert navigation-only side effects."

Activate means "commit the reveal/highlight/focus transfer."

So:

- cancelling restores captured snapshots, deepest path first
- activating discards snapshots without restoring them

This is the heart of the model. It lets focus navigation temporarily move the viewport or other UI state without making those moves permanent unless the user actually commits to the target.

## Reveal Descendant

The core does not scroll anything itself.

Instead, it asks ancestor areas to reveal the highlighted descendant.

Reveal runs from inner to outer ancestors because nested scrolling containers are common and that order composes naturally:

1. inner area reveals the descendant locally
2. outer area reveals that inner region
3. repeat outward as needed

The core only coordinates this. Each renderer decides what "reveal" means.

## Why The Core Is Intentionally Small

The focus core does **not** know about:

- React
- OpenTUI
- DOM nodes
- keyboard event sources
- animations
- borders, halos, or overlays
- how real focus is represented in the platform

Its job is narrower:

- maintain the explicit tree
- compute navigation scope
- choose visible candidates
- manage navigation sessions
- expose enough state for renderers to build UX around it

That separation is what makes the model reusable instead of accidentally becoming "the OpenTUI focus system, but hidden in `lib`."

## Design Tradeoffs

Several choices here are opinionated:

- explicit registration instead of auto-discovery
- path identity instead of opaque ids
- lazy geometry instead of cached layout state
- spatial navigation instead of authored next/previous links
- generalized snapshot/restore instead of hard-coded scroll restoration

They were chosen because they keep the system debuggable, portable, and honest about where platform behavior lives.

## Mental Model

The shortest way to think about this subsystem is:

- the app declares a tree of navigable areas and nodes
- the core turns that into a deterministic navigation graph at event time
- navigation mode is a reversible session layered on top of real focus

That is the design center for everything in this directory.
