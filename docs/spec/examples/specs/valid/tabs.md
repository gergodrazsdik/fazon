---
# A composite with named parts, and extensions for four adapters.
fazon: 0
name: Tabs
tier: composite
summary: Switches between panels of related content in the same place.
props:
  value:
    type: string
    model: true
    description: The selected tab's value.
  orientation:
    type: enum
    values: [horizontal, vertical]
    default: horizontal
  activation:
    type: enum
    values: [automatic, manual]
    default: automatic
    description: Automatic selects a tab when it receives focus; manual waits for Enter or Space.
parts:
  List:
    parent: Tabs
    count: one
    props:
      label:
        type: string
        required: true
        description: The accessible name of the tab list.
    a11y:
      role: tablist
      name: prop:label
  Trigger:
    parent: List
    count: many
    props:
      value:
        type: string
        required: true
      disabled:
        type: boolean
        default: false
    slots:
      default:
        required: true
        description: The tab's label.
      icon:
        description: An icon before the label.
    states: [default, hover, focus-visible, selected, disabled]
    produce:
      selected:
        story: false
      disabled:
        story: false
    a11y:
      role: tab
      name: content
  Panel:
    parent: Tabs
    count: many
    props:
      value:
        type: string
        required: true
    slots:
      default:
        required: true
    a11y:
      role: tabpanel
      name: part:Trigger
a11y:
  keyboard:
    ArrowRight: focus the next Trigger, wrapping at the end (ArrowDown when vertical)
    ArrowLeft: focus the previous Trigger, wrapping at the start (ArrowUp when vertical)
    Home: focus the first Trigger
    End: focus the last Trigger
    Enter: select the focused Trigger (manual activation)
    Space: select the focused Trigger (manual activation)
  focus:
    roving: Trigger
fixtures:
  three:
    props: { value: overview }
    parts:
      List:
        - props: { label: Project sections }
      Trigger:
        - { props: { value: overview }, slots: { default: Overview } }
        - { props: { value: activity }, slots: { default: Activity } }
        - { props: { value: settings }, slots: { default: Settings } }
      Panel:
        - { props: { value: overview }, slots: { default: "The project's summary and its latest changes." } }
        - { props: { value: activity }, slots: { default: "Every change to the project, newest first." } }
        - { props: { value: settings }, slots: { default: "Name, visibility and members of the project." } }
  long-labels:
    extends: three
    parts:
      Trigger:
        - { props: { value: overview }, slots: { default: Overview and summary of recent work } }
        - { props: { value: activity }, slots: { default: Activity across every member } }
        - { props: { value: settings }, slots: { default: "Settings, members and integrations" } }
  one-disabled:
    extends: three
    parts:
      Trigger:
        - { props: { value: overview }, slots: { default: Overview } }
        - { props: { value: activity, disabled: true }, slots: { default: Activity } }
        - { props: { value: settings }, slots: { default: Settings } }
matrix:
  axes: [orientation]
  fixtures: [three, long-labels, one-disabled]
tokens:
  - part: List
    use:
      border-color: color.border.default
  - part: Trigger
    when: { state: default }
    use:
      color: color.text.secondary
  - part: Trigger
    when: { state: selected }
    use:
      color: color.text.primary
      border-color: color.action.primary
  - part: Trigger
    when: { state: focus-visible }
    use:
      outline-color: color.focus.ring
extensions:
  vue:
    reason: Reka UI's composition pattern
    add:
      parts.Trigger.props.asChild:
        type: boolean
        default: false
        description: Render the slotted element as the trigger.
  react:
    add:
      parts.Trigger.props.asChild:
        type: boolean
        default: false
        description: Render the child element as the trigger.
  angular:
    options:
      exportAs: fzTabs
    map:
      parts.Panel.slots.default:
        lazy: true
  web-components:
    reason: Native custom elements with shadow DOM
    options:
      tags: { Tabs: fz-tabs, List: fz-tab-list, Trigger: fz-tab, Panel: fz-tab-panel }
      cssParts: { Trigger: [indicator] }
    map:
      props.orientation:
        attribute: orientation
        reflect: true
---

## Purpose

Groups related content into panels in the same place; one panel shows at a time.

## Behaviour

- Selecting a Trigger shows its Panel and updates the value.
- A disabled Trigger is skipped by the arrow keys and can't be selected.
- Tab moves focus from the selected Trigger into its Panel.

## Appearance

- The selected Trigger is clearly distinguishable from the others without relying on colour alone.

## Never

- Never used to navigate between pages. Use Link.
- Never nested inside another Tabs.
