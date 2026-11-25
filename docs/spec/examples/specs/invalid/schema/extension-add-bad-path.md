---
# An added member is named by its path, such as props.size.
# expect-error-at: $.extensions.vue.add
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
extensions:
  vue:
    add:
      size:
        type: string
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
