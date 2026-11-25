---
# A required prop has no default.
# expect-error-at: $.props.label
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
props:
  label:
    type: string
    required: true
    default: Status
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
