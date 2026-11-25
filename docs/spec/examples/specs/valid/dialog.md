---
# A composite whose parts render outside the story root, composing another component.
fazon: 0
name: Dialog
tier: composite
summary: Asks for a decision or shows focused content on top of the page.
uses: [Button]
props:
  open:
    type: boolean
    model: true
    default: false
    description: Whether the dialog is shown.
forward: Content
parts:
  Trigger:
    parent: Dialog
    count: optional
    description: Opens the dialog. Focus returns to it on close.
    slots:
      default:
        required: true
        description: Usually a Button.
  Overlay:
    parent: Dialog
    count: one
    portal: true
    description: Dims the page behind the dialog. A click on it closes the dialog.
  Content:
    parent: Dialog
    count: one
    portal: true
    props:
      size:
        type: enum
        values: [sm, md, lg]
        default: md
    slots:
      default:
        required: true
        description: The body.
      footer:
        description: Actions, usually Buttons, the primary action last.
    a11y:
      role: dialog
      name: part:Title
      describedBy: part:Description
      aria:
        aria-modal: "true"
  Title:
    parent: Content
    count: one
    slots:
      default:
        required: true
  Description:
    parent: Content
    count: optional
    slots:
      default:
        required: true
  Close:
    parent: Content
    count: optional
    props:
      label:
        type: string
        default: Close
        description: The accessible name of the icon-only close button.
    states: [default, hover, focus-visible]
    a11y:
      role: button
      name: prop:label
states: [closed]
produce:
  closed:
    props: { open: false }
a11y:
  keyboard:
    Escape: close the dialog
    Tab: focus the next focusable element in the dialog, wrapping at the end
    Shift+Tab: focus the previous focusable element in the dialog, wrapping at the start
  focus:
    trap: true
    restore: true
    initial: Content
fixtures:
  confirm:
    props: { open: true }
    parts:
      Trigger:
        - slots:
            default: { component: Button, props: { variant: secondary }, slots: { default: Delete project } }
      Overlay:
        - {}
      Content:
        - slots:
            default: All its components, specs and baselines are removed.
            footer:
              - { component: Button, props: { variant: secondary }, slots: { default: Cancel } }
              - { component: Button, props: { variant: primary }, slots: { default: Delete } }
      Title:
        - slots: { default: "Delete this project?" }
      Description:
        - slots: { default: "This can't be undone." }
      Close:
        - {}
  long-content:
    extends: confirm
    parts:
      Content:
        - slots:
            default:
              - Every component in the project is removed, together with its spec, stories, tests and screenshot baselines.
              - Pull requests that are still open keep their branches, but their checks will fail until the project is restored from a backup.
              - Members keep access to other projects. Their roles in this project are removed, and the audit log keeps a record of the deletion.
              - Integrations that publish this project's package stop at their next run.
            footer:
              - { component: Button, props: { variant: secondary }, slots: { default: Cancel } }
              - { component: Button, props: { variant: primary }, slots: { default: Delete } }
matrix:
  axes: [Content.size]
  fixtures: [confirm, long-content]
  exclude:
    - { state: closed, props: { Content.size: sm } }
    - { state: closed, props: { Content.size: lg } }
tokens:
  - part: Overlay
    use:
      background-color: color.overlay
  - part: Content
    use:
      background-color: color.surface.raised
      color: color.text.primary
  - part: Close
    when: { state: focus-visible }
    use:
      outline-color: color.focus.ring
exemptions:
  - check: layout
    rule: scroll
    part: Content
    fixture: long-content
    reason: The body scrolls inside Content by design when it is taller than the viewport.
extensions:
  web-components:
    options:
      nativeDialog: true
---

## Purpose

Asks for a decision, or shows content that needs the user's full attention, on top of the page.

## Behaviour

- Opening moves focus into the dialog; closing returns it to the element that opened it.
- Escape, a click on the Overlay and Close all close the dialog and update `open`.
- The page behind doesn't scroll while the dialog is open.

## Appearance

- The dialog reads as clearly above the page; the page behind is dimmed but recognisable.

## Never

- Never opened without a Title.
- Never used for messages that don't need a response. Use a non-modal pattern.
