---
# An extension block has only reason, options, map, add and omit.
# expect-error-at: $.extensions.vue
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
extensions:
  vue:
    replace:
      slots.default:
        name: label
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
