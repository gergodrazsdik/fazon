---
# Props take the long form only.
# expect-error-at: $.props.tone
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
props:
  tone: [neutral, positive]
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
