---
# A token rule names a token, not a raw value.
# expect-error-at: $.tokens[0].use.color
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
tokens:
  - use:
      color: "#0055ff"
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
