---
# Two token rules with the same part and condition set the same property.
# fails: SPEC-011
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
tokens:
  - use:
      color: color.text.primary
  - use:
      color: color.text.secondary
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
