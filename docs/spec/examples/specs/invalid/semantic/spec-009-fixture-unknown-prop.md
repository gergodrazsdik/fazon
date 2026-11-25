---
# The fixture sets a prop the component doesn't have.
# fails: SPEC-009
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
fixtures:
  short:
    props: { tone: positive }
    slots: { default: Active }
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
