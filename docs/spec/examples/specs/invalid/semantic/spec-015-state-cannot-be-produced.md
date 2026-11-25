---
# The state has no recipe, no boolean prop of its name, and isn't a pseudo-state.
# fails: SPEC-015
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
states: [default, pressed]
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
