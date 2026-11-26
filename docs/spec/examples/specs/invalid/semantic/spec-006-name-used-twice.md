---
# A prop and an event share a name.
# fails: SPEC-006
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
props:
  dismiss:
    type: boolean
    default: false
events:
  dismiss:
    description: The close button was activated.
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
