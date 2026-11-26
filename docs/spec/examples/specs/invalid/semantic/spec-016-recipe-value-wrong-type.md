---
# The recipe sets an enum prop to a value that isn't one of its values.
# fails: SPEC-016
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
props:
  tone:
    type: enum
    values: [neutral, positive]
    default: neutral
slots:
  default:
    required: true
states: [default, highlighted]
produce:
  highlighted:
    props: { tone: bright }
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
