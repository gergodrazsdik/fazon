---
# A press step sends a key to the focused element; it has no target.
# expect-error-at: $.produce.pressed.input[0]
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
states: [default, pressed]
produce:
  pressed:
    input:
      - { action: press, key: Enter, target: root }
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
