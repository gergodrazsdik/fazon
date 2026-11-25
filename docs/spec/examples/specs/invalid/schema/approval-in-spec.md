---
# The approved API is recorded in the provenance file, not in the spec.
# expect-error-at: $
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
approved:
  date: 2026-11-25
  hash: 3f9a1c
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
