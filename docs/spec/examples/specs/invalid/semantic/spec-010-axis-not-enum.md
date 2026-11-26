---
# The axis is a string prop; an axis is an enum or a boolean.
# fails: SPEC-010
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
props:
  label:
    type: string
    default: Active
matrix:
  axes: [label]
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
