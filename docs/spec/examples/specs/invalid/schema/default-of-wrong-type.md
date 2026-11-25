---
# A boolean prop's default is a boolean.
# expect-error-at: $.props.disabled.default
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
props:
  disabled:
    type: boolean
    default: "no"
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
