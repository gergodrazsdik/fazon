---
# uses names a component that has no spec.
# fails: SPEC-008
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
uses: [Avatar]
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
