---
# The part's parent is neither the component nor another part.
# fails: SPEC-005
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
parts:
  Icon:
    parent: Label
    count: optional
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
