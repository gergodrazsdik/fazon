---
# No rule of the visual check can be exempted.
# fails: SPEC-012
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
exemptions:
  - check: visual
    rule: changed
    reason: The chip's shadow renders differently between runs.
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
