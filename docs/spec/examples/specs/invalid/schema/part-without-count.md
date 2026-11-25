---
# A part says how many instances its parent holds.
# expect-error-at: $.parts.Icon
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
parts:
  Icon:
    parent: Chip
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
