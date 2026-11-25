---
# map names a member the neutral API doesn't have.
# fails: SPEC-013
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
extensions:
  vue:
    map:
      props.tone:
        name: color
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.
