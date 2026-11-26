---
# produce has a recipe for a state the component doesn't list.
# fails: SPEC-016
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
props:
  selected:
    type: boolean
    default: false
slots:
  default:
    required: true
states: [default, hover]
produce:
  pressed:
    props: { selected: true }
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
