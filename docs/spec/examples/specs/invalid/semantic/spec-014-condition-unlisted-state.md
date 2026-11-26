---
# The token rule's condition names a state the component doesn't list.
# fails: SPEC-014
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
states: [default, hover]
tokens:
  - when: { state: pressed }
    use:
      color: color.text.primary
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
