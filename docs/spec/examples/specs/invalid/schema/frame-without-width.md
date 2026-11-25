---
# A frame gives its width.
# expect-error-at: $.fixtures.short.frame
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
fixtures:
  short:
    slots: { default: Active }
    frame: {}
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
