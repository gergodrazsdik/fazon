---
# The enum default isn't one of its values.
# fails: SPEC-004
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
props:
  tone:
    type: enum
    values: [neutral, positive]
    default: negative
slots:
  default:
    required: true
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
